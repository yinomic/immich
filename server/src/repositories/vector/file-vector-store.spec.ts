import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { FileVectorStore } from 'src/repositories/vector/file-vector-store.js';

const logger = {
  setContext: () => {},
  log: () => {},
  warn: () => {},
  debug: () => {},
  verbose: () => {},
  error: () => {},
} as unknown as LoggingRepository;

describe(FileVectorStore.name, () => {
  let folder: string;
  let file: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'immich-vectors-'));
    file = join(folder, 'vectors.jsonl');
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const newStore = (dimSize?: number) => new FileVectorStore({ file, dimSize }, logger);

  it('returns the nearest vectors first', async () => {
    const store = newStore(3);
    await store.upsert('near', [1, 0, 0]);
    await store.upsert('far', [0, 1, 0]);

    const matches = await store.search([1, 0, 0], { topK: 10 });

    expect(matches.map((match) => match.assetId)).toEqual(['near', 'far']);
    expect(matches[0].distance).toBeCloseTo(0, 5);
    expect(matches[1].distance).toBeCloseTo(1, 5);
  });

  it('replaces the vector of an asset on re-index', async () => {
    const store = newStore(3);
    await store.upsert('asset', [1, 0, 0]);
    await store.upsert('asset', [0, 1, 0]);

    expect(await store.get('asset')).toEqual([0, 1, 0]);
    expect(store.count).toBe(1);
  });

  it('applies topK and maxDistance', async () => {
    const store = newStore(3);
    await store.upsert('a', [1, 0, 0]);
    await store.upsert('b', [0.9, 0.1, 0]);
    await store.upsert('c', [0, 1, 0]);

    const topOne = await store.search([1, 0, 0], { topK: 1 });
    expect(topOne.map((match) => match.assetId)).toEqual(['a']);

    const withinDistance = await store.search([1, 0, 0], { topK: 10, maxDistance: 0.1 });
    expect(withinDistance.map((match) => match.assetId)).toEqual(['a', 'b']);
  });

  it('restricts the search to the given assets', async () => {
    const store = newStore(3);
    await store.upsert('a', [1, 0, 0]);
    await store.upsert('b', [1, 0, 0]);

    const matches = await store.search([1, 0, 0], { topK: 10, assetIds: ['b'] });

    expect(matches.map((match) => match.assetId)).toEqual(['b']);
  });

  it('deletes and clears vectors', async () => {
    const store = newStore(3);
    await store.upsert('a', [1, 0, 0]);
    await store.upsert('b', [1, 0, 0]);

    await store.delete(['a']);
    expect(await store.get('a')).toBeUndefined();
    expect(store.count).toBe(1);

    await store.clear();
    expect(store.count).toBe(0);
    expect(await store.search([1, 0, 0], { topK: 10 })).toEqual([]);
  });

  it('survives a restart', async () => {
    const store = newStore(3);
    await store.upsert('a', [1, 0, 0]);
    await store.upsert('b', [0, 1, 0]);
    await store.delete(['b']);

    const reloaded = newStore(3);
    expect(await reloaded.get('a')).toEqual([1, 0, 0]);
    expect(await reloaded.get('b')).toBeUndefined();
    expect(reloaded.count).toBe(1);
  });

  it('rejects vectors with the wrong dimension', async () => {
    const store = newStore(3);

    await expect(store.upsert('a', [1, 0])).rejects.toThrow('dimensions');
  });

  it('skips corrupt journal lines', async () => {
    const store = newStore(3);
    await store.upsert('a', [1, 0, 0]);
    await store.delete(['a']);

    const { appendFile } = await import('node:fs/promises');
    await appendFile(file, 'not-json\n{"t":"u","id":"b","v":[0,1,0]}\n');

    const reloaded = newStore(3);
    expect(await reloaded.get('b')).toEqual([0, 1, 0]);
    expect(reloaded.count).toBe(1);
  });
});
