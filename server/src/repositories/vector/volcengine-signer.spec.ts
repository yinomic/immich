import { signRequest } from 'src/repositories/vector/volcengine-signer.js';

/**
 * Golden test: the expected signature/header values were produced by the
 * official Volcengine Python SDK algorithm (`SignerV4` + `Util`), reduced to
 * stdlib and run against the same fixed request. If this test breaks, the
 * cloud vector store would be rejected with an auth error.
 */
describe('volcengine signer', () => {
  const credentials = {
    accessKeyId: 'AKID',
    secretAccessKey: 'SECRET',
    region: 'cn-north-1',
    service: 'air',
  };

  const body = '{"collection_name":"immich","fields":[{"assetId":"a","embedding":[1,2]}],"ttl":0}';

  it('matches the reference V4 signature', () => {
    const { headers } = signRequest({
      method: 'POST',
      host: 'api-vikingdb.volces.com',
      path: '/api/collection/upsert_data',
      body,
      credentials,
      date: new Date('2026-01-02T03:04:05Z'),
    });

    expect(headers['X-Date']).toBe('20260102T030405Z');
    expect(headers['X-Content-Sha256']).toBe('fccd57de7a8f6b8c4bfc553869afbbaa0ffc217c1b03b35619ed9b1d309f005d');
    expect(headers.Authorization).toBe(
      'HMAC-SHA256 Credential=AKID/20260102/cn-north-1/air/request, ' +
        'SignedHeaders=content-type;host;x-content-sha256;x-date, ' +
        'Signature=a40119f74c0576fb577917ef54e3629a18483c41dce577e5dab2a1294b237cde',
    );
  });

  it('includes the session token when present', () => {
    const { headers } = signRequest({
      method: 'POST',
      host: 'api-vikingdb.volces.com',
      path: '/api/collection/upsert_data',
      body,
      credentials: { ...credentials, sessionToken: 'token' },
      date: new Date('2026-01-02T03:04:05Z'),
    });

    expect(headers['X-Security-Token']).toBe('token');
    expect(headers.Authorization).toContain('SignedHeaders=content-type;host;x-content-sha256;x-date;x-security-token');
  });

  it('signs an empty body deterministically', () => {
    const { headers } = signRequest({
      method: 'GET',
      host: 'api-vikingdb.volces.com',
      path: '/api/viking_db/data/ping',
      credentials,
      date: new Date('2026-01-02T03:04:05Z'),
    });

    expect(headers['X-Content-Sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
