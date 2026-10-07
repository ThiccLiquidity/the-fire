/** AWS Signature Version 4 with WebCrypto (browser and Node), for Filebase's S3-compatible API (filebase.ts).
 *  Only what S3 needs: header-signed requests (no presigned URLs, no chunked signing). */

const te = new TextEncoder()
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')

export async function sha256HexBytes(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? te.encode(data) : data
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, te.encode(data))
}

/** RFC 3986 encoding as SigV4 wants it (unreserved: A-Z a-z 0-9 - _ . ~). */
export function uriEncode(s: string, keepSlash = false): string {
  return Array.from(te.encode(s), (b) => {
    const c = String.fromCharCode(b)
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === '/')) return c
    return `%${b.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')
}

export interface Credentials { accessKeyId: string; secretAccessKey: string }

export interface SignInput {
  method: string
  url: string
  /** Extra headers to send and sign (lowercase names). host and x-amz-date are added. */
  headers?: Record<string, string>
  /** Hex SHA-256 of the body (e3b0... for an empty body). */
  payloadHash: string
  region: string
  service: string
  credentials: Credentials
  /** For tests: the signing time. */
  now?: Date
}

/** The headers to send (including Authorization) for a SigV4-signed request. */
export async function signV4(i: SignInput): Promise<Record<string, string>> {
  const u = new URL(i.url)
  const now = i.now ?? new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const headers: Record<string, string> = { ...(i.headers ?? {}), host: u.host, 'x-amz-date': amzDate }
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort()
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  const canonicalHeaders = names.map((n) => `${n}:${String(lower[n]).trim().replace(/\s+/g, ' ')}\n`).join('')
  const signedHeaders = names.join(';')
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  // the path as sent, each segment encoded once (S3 doesn't double-encode)
  const path = u.pathname.split('/').map((seg) => uriEncode(decodeURIComponent(seg))).join('/') || '/'
  const canonical = [i.method.toUpperCase(), path, query, canonicalHeaders, signedHeaders, i.payloadHash].join('\n')
  const scope = `${date}/${i.region}/${i.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256HexBytes(canonical)].join('\n')
  const kDate = await hmac(te.encode(`AWS4${i.credentials.secretAccessKey}`), date)
  const kRegion = await hmac(kDate, i.region)
  const kService = await hmac(kRegion, i.service)
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = hex(await hmac(kSigning, toSign))
  const out: Record<string, string> = { ...headers }
  delete out.host // the browser sets it
  out.authorization = `AWS4-HMAC-SHA256 Credential=${i.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return out
}
