// One-time setup for the second pin: lets the studio (a page on localhost) talk to your Filebase bucket.
// Browsers only send the studio's upload to Filebase if the bucket has a CORS rule for the studio's address that also
// exposes the ETag and x-amz-meta-cid headers. This sets that rule (S3 PutBucketCors, signed with SigV4).
//
//   cd studio
//   node scripts/filebase-cors.mjs [--origin http://localhost:5173] [--origin https://another.example]
//
// It asks for the access key, the secret (hidden) and the bucket; nothing is saved. Default origins: the studio's dev
// server (http://localhost:5173 and http://127.0.0.1:5173). Create the bucket first in the Filebase console
// (Buckets -> Create bucket, network IPFS) and an access key that can write to it (Access Keys).
import { createHash, createHmac } from 'node:crypto'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const ENDPOINT = 'https://s3.filebase.com'
const REGION = 'us-east-1'

const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** SigV4 headers for an S3 request (same algorithm as src/sigv4.ts; checked against AWS's published example). */
export function sign({ method, url, headers = {}, body = '', accessKeyId, secretAccessKey, now = new Date(), region = REGION, service = 's3' }) {
  const u = new URL(url)
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const payloadHash = headers['x-amz-content-sha256'] ?? sha256(body)
  const all = { ...headers, host: u.host, 'x-amz-date': amzDate }
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort()
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]))
  const query = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&')
  const path = u.pathname.split('/').map((s) => enc(decodeURIComponent(s))).join('/') || '/'
  const canonical = [method, path, query, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), payloadHash].join('\n')
  const scope = `${date}/${region}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), 'aws4_request')
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` }
}

export function corsXml(origins) {
  const o = origins.map((x) => `<AllowedOrigin>${x}</AllowedOrigin>`).join('')
  const m = ['GET', 'PUT', 'POST', 'HEAD'].map((x) => `<AllowedMethod>${x}</AllowedMethod>`).join('')
  return `<CORSConfiguration><CORSRule>${o}${m}<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><ExposeHeader>x-amz-meta-cid</ExposeHeader><MaxAgeSeconds>3000</MaxAgeSeconds></CORSRule></CORSConfiguration>`
}

async function ask(q, hidden) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s) }
  const a = await new Promise((r) => rl.question(q, r))
  rl.close()
  if (hidden) process.stdout.write('\n')
  return a.trim()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const origins = process.argv.flatMap((a, i, all) => (a === '--origin' && all[i + 1] ? [all[i + 1]] : []))
  if (!origins.length) origins.push('http://localhost:5173', 'http://127.0.0.1:5173')
  const accessKeyId = await ask('Filebase access key: ', true)
  const secretAccessKey = await ask('Filebase secret: ', true)
  const bucket = await ask('Bucket: ', false)
  const body = corsXml(origins)
  const md5 = createHash('md5').update(body).digest('base64')
  const url = `${ENDPOINT}/${encodeURIComponent(bucket)}?cors=`
  const headers = sign({ method: 'PUT', url, body, accessKeyId, secretAccessKey, headers: { 'content-md5': md5, 'content-type': 'application/xml', 'x-amz-content-sha256': sha256(body) } })
  delete headers.host
  const r = await fetch(url, { method: 'PUT', headers, body })
  if (!r.ok) {
    const t = await r.text()
    console.error(`Filebase said ${r.status}: ${(/<Code>([^<]*)/.exec(t)?.[1] ?? '')} ${(/<Message>([^<]*)/.exec(t)?.[1] ?? '')}`)
    process.exit(1)
  }
  console.log(`CORS set on "${bucket}" for ${origins.join(', ')}. The studio can now pin to it (Export & Upload).`)
}
