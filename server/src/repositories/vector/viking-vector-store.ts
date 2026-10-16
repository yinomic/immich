import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { VectorMatch, VectorSearchOptions, VectorStore } from 'src/repositories/vector/vector-store.js';
import { VolcengineCredentials, signRequest } from 'src/repositories/vector/volcengine-signer.js';

export interface VikingVectorStoreOptions {
  /** e.g. api-vikingdb.volces.com */
  host: string;
  /** e.g. cn-north-1 */
  region: string;
  scheme?: 'https' | 'http';
  collection: string;
  index: string;
  /** primary key field in the collection, default `assetId` */
  primaryKey?: string;
  /** vector field in the collection, default `embedding` */
  vectorField?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** newer data-plane endpoints accept a bearer token instead of AK/SK signing */
  apiKey?: string;
  timeoutMs?: number;
}

const UPSERT_BATCH_SIZE = 100;
const DELETE_BATCH_SIZE = 100;

/**
 * VikingDB (火山引擎向量数据库) backed vector store.
 *
 * Contract taken from the official Python SDK (`volcengine.viking_db`):
 *   - host `api-vikingdb.volces.com`, region `cn-north-1`, V4 signing with
 *     service name `air`
 *   - write  `POST /api/collection/upsert_data`  {collection_name, fields: [...], ttl}
 *   - delete `POST /api/collection/del_data`     {collection_name, primary_keys | del_all}
 *   - search `POST /api/index/search`            {collection_name, index_name, search: {...}}
 *
 * The request side is verified against the official algorithm (see
 * volcengine-signer.spec.ts), but the *response* field names differ between
 * VikingDB generations, so parsing stays tolerant and the first run against a
 * real collection should be smoke tested (upsert one vector, search it back).
 */
export class VikingVectorStore implements VectorStore {
  private readonly primaryKey: string;
  private readonly vectorField: string;
  private readonly timeoutMs: number;
  private readonly credentials?: VolcengineCredentials;

  constructor(
    private options: VikingVectorStoreOptions,
    private logger: LoggingRepository,
  ) {
    this.primaryKey = options.primaryKey ?? 'assetId';
    this.vectorField = options.vectorField ?? 'embedding';
    this.timeoutMs = options.timeoutMs ?? 30_000;

    if (!options.apiKey) {
      if (!options.accessKeyId || !options.secretAccessKey) {
        throw new Error('VikingDB requires either VIKINGDB_API_KEY or VIKINGDB_ACCESS_KEY + VIKINGDB_SECRET_KEY');
      }

      this.credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        sessionToken: options.sessionToken,
        region: options.region,
        service: 'air',
      };
    }

    this.logger.setContext(VikingVectorStore.name);
    this.logger.log(`Using VikingDB vector store (${options.collection}/${options.index})`);
  }

  async upsert(assetId: string, vector: number[]): Promise<void> {
    await this.upsertMany([{ assetId, vector }]);
  }

  async upsertMany(entries: { assetId: string; vector: number[] }[]): Promise<void> {
    for (let i = 0; i < entries.length; i += UPSERT_BATCH_SIZE) {
      const batch = entries.slice(i, i + UPSERT_BATCH_SIZE);
      await this.post('/api/collection/upsert_data', {
        collection_name: this.options.collection,
        fields: batch.map((entry) => ({ [this.primaryKey]: entry.assetId, [this.vectorField]: entry.vector })),
        ttl: 0,
      });
    }
  }

  async delete(assetIds: string[]): Promise<void> {
    for (let i = 0; i < assetIds.length; i += DELETE_BATCH_SIZE) {
      const batch = assetIds.slice(i, i + DELETE_BATCH_SIZE);
      await this.post('/api/collection/del_data', {
        collection_name: this.options.collection,
        primary_keys: batch,
      });
    }
  }

  /**
   * VikingDB cannot return stored vectors through this client, so the caller
   * re-embeds the asset image instead (`SearchService.resolveEmbedding`).
   */
  get(assetId: string): Promise<number[] | undefined> {
    this.logger.debug(`VikingDB cannot return a stored vector for ${assetId}; the caller re-embeds instead`);
    return Promise.resolve(undefined);
  }

  async search(vector: number[], options: VectorSearchOptions): Promise<VectorMatch[]> {
    const search: Record<string, unknown> = {
      order_by_vector: { vectors: [vector] },
      limit: options.topK,
      output_fields: [],
    };

    if (options.assetIds) {
      search['primary_key_in'] = options.assetIds;
    }

    const payload = await this.post('/api/index/search', {
      collection_name: this.options.collection,
      index_name: this.options.index,
      search,
    });

    const matches: VectorMatch[] = [];
    for (const item of flattenSearchItems(payload)) {
      const assetId = item[this.primaryKey];
      if (typeof assetId !== 'string') {
        continue;
      }

      const distance = readDistance(item);
      if (distance === undefined) {
        continue;
      }

      if (options.maxDistance !== undefined && distance > options.maxDistance) {
        continue;
      }

      matches.push({ assetId, distance });
    }

    matches.sort((a, b) => a.distance - b.distance);
    return matches.slice(0, options.topK);
  }

  async clear(): Promise<void> {
    await this.post('/api/collection/del_data', {
      collection_name: this.options.collection,
      del_all: true,
    });
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const scheme = this.options.scheme ?? 'https';
    const payload = JSON.stringify(body);
    const headers: Record<string, string> = this.options.apiKey
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.apiKey}` }
      : signRequest({
          method: 'POST',
          host: this.options.host,
          path,
          body: payload,
          credentials: this.credentials as VolcengineCredentials,
        }).headers;

    const response = await fetch(`${scheme}://${this.options.host}${path}`, {
      method: 'POST',
      headers,
      body: payload,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`VikingDB request to ${path} failed with status ${response.status}: ${text.slice(0, 500)}`);
    }

    if (!text) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(text) as { code?: number; message?: string; data?: unknown };
      if (typeof parsed.code === 'number' && parsed.code !== 0) {
        throw new Error(`VikingDB returned code ${parsed.code}: ${parsed.message ?? 'unknown error'}`);
      }
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`VikingDB returned a non-JSON body: ${text.slice(0, 500)}`, { cause: error });
      }
      throw error;
    }
  }
}

/** VikingDB nests search hits as `data: [[hit, ...]]`; older responses are flat. */
const flattenSearchItems = (payload: unknown): Record<string, unknown>[] => {
  const data = (payload as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  const items: Record<string, unknown>[] = [];
  for (const entry of data) {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        if (item && typeof item === 'object') {
          items.push(item as Record<string, unknown>);
        }
      }
    } else if (entry && typeof entry === 'object') {
      items.push(entry as Record<string, unknown>);
    }
  }

  return items;
};

const readDistance = (item: Record<string, unknown>): number | undefined => {
  for (const key of ['dist', 'distance']) {
    const value = item[key];
    if (typeof value === 'number') {
      return value;
    }
  }

  // cosine similarity -> cosine distance
  if (typeof item['score'] === 'number') {
    return 1 - item['score'];
  }

  return undefined;
};
