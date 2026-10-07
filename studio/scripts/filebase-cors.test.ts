/** The CORS setup script signs like AWS documents (the S3 GET object example) and asks for the right rule. */
import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain .mjs script, run by node
import { corsXml, sign } from './filebase-cors.mjs'

describe('scripts/filebase-cors.mjs', () => {
  it('signs the S3 documentation\'s GET object example', () => {
    const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const h = sign({
      method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { range: 'bytes=0-9', 'x-amz-content-sha256': sha },
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })

  it('allows the studio\'s origin and exposes ETag and x-amz-meta-cid', () => {
    const x = corsXml(['http://localhost:5173'])
    expect(x).toContain('<AllowedOrigin>http://localhost:5173</AllowedOrigin>')
    for (const m of ['GET', 'PUT', 'POST', 'HEAD']) expect(x).toContain(`<AllowedMethod>${m}</AllowedMethod>`)
    expect(x).toContain('<ExposeHeader>ETag</ExposeHeader>')
    expect(x).toContain('<ExposeHeader>x-amz-meta-cid</ExposeHeader>')
  })
})
