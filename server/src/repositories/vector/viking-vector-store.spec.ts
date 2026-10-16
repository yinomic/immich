import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { VikingVectorStore } from 'src/repositories/vector/viking-vector-store.js';

const logger = {
  setContext: () => {},
  log: () => {},
  warn: () => {},
  debug: () => {},
  verbose: () => {},
  error: () => {},
} as unknown as LoggingRepository;

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

const newStore = (overrides: Record<string, unknown> = {}) =>
  new VikingVectorStore(
    {
      host: 'api-vikingdb.volces.com',
      region: 'cn-north-1',
      collection: 'immich',
      index: 'clip',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      ...overrides,
    },
    logger,
  );

describe(VikingVectorStore.name, () => {
  let fetchMock: ReturnType<typeof vitest.fn>;

  beforeEach(() => {
    fetchMock = vitest.fn();
    vitest.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vitest.unstubAllGlobals();
  });

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    return { url, init, body: JSON.parse(init.body as string) };
  };

  it('signs writes with the Volcengine V4 authorization header', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ code: 0 }));

    await newStore().upsert('asset-id', [1, 2, 3]);

    const { url, init, body } = lastCall();
    expect(url).toBe('https://api-vikingdb.volces.com/api/collection/upsert_data');
    expect(body).toEqual({
      collection_name: 'immich',
      fields: [{ assetId: 'asset-id', embedding: [1, 2, 3] }],
      ttl: 0,
    });

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/HMAC-SHA256 Credential=AK\/\d{8}\/cn-north-1\/air\/request/);
    expect(headers.Authorization).toContain('SignedHeaders=');
    expect(headers['X-Date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers['X-Content-Sha256']).toHaveLength(64);
  });

  it('uses a bearer token when an api key is configured', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ code: 0 }));

    await newStore({ accessKeyId: undefined, secretAccessKey: undefined, apiKey: 'token' }).upsert('asset-id', [1]);

    const { init } = lastCall();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('parses nested search hits and ranks by distance', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({
        code: 0,
        data: [
          [
            { assetId: 'far', dist: 0.8 },
            { assetId: 'near', dist: 0.2 },
          ],
        ],
      }),
    );

    const matches = await newStore().search([1, 0], { topK: 10 });

    expect(matches).toEqual([
      { assetId: 'near', distance: 0.2 },
      { assetId: 'far', distance: 0.8 },
    ]);

    const { body } = lastCall();
    expect(body).toEqual({
      collection_name: 'immich',
      index_name: 'clip',
      search: { order_by_vector: { vectors: [[1, 0]] }, limit: 10, output_fields: [] },
    });
  });

  it('converts a cosine score into a distance and honours maxDistance', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({
        data: [
          [
            { assetId: 'close', score: 0.95 },
            { assetId: 'distant', score: 0.5 },
          ],
        ],
      }),
    );

    const matches = await newStore().search([1, 0], { topK: 10, maxDistance: 0.2 });

    expect(matches).toEqual([{ assetId: 'close', distance: 0.050000000000000044 }]);
  });

  it('pre-filters by primary key and batches large writes', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ code: 0 }));
    const store = newStore();

    const entries = Array.from({ length: 150 }, (_, index) => ({ assetId: `asset-${index}`, vector: [index] }));
    await store.upsertMany(entries);
    await store.delete(entries.map((entry) => entry.assetId));

    const calls = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    const upserts = calls.filter((body) => Array.isArray(body.fields));
    expect(upserts.map((body) => body.fields.length)).toEqual([100, 50]);
    expect(upserts[0].fields[0]).toEqual({ assetId: 'asset-0', embedding: [0] });

    await store.search([1], { topK: 5, assetIds: ['a', 'b'] });
    expect(lastCall().body.search).toMatchObject({ primary_key_in: ['a', 'b'] });
  });

  it('clears the collection', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ code: 0 }));

    await newStore().clear();

    expect(lastCall().url).toBe('https://api-vikingdb.volces.com/api/collection/del_data');
    expect(lastCall().body).toEqual({ collection_name: 'immich', del_all: true });
  });

  it('surfaces API errors and rejects incomplete configuration', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ code: 1, message: 'bad' }));
    await expect(newStore().upsert('a', [1])).rejects.toThrow('VikingDB returned code 1: bad');

    fetchMock.mockImplementation(() => jsonResponse('denied', false, 403));
    await expect(newStore().upsert('a', [1])).rejects.toThrow('status 403');

    expect(() => newStore({ accessKeyId: undefined, secretAccessKey: undefined })).toThrow('VIKINGDB_API_KEY');
  });

  it('reports that stored vectors cannot be read back', async () => {
    await expect(newStore().get('asset-id')).resolves.toBeUndefined();
  });
});
