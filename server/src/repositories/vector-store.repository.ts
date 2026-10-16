import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { FileVectorStore } from 'src/repositories/vector/file-vector-store.js';
import { VectorMatch, VectorSearchOptions, VectorStore } from 'src/repositories/vector/vector-store.js';

/**
 * The vector store used by the app.
 *
 * Default is the local file store, which needs no extra service. Cloud stores
 * (VikingDB / VDB) plug in here behind the same interface.
 */
@Injectable()
export class VectorStoreRepository implements VectorStore {
  private store?: VectorStore;
  private dimSize?: number;

  constructor(
    private configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(VectorStoreRepository.name);
  }

  upsert(assetId: string, vector: number[]): Promise<void> {
    this.dimSize ??= vector.length;
    return this.getStore().upsert(assetId, vector);
  }

  delete(assetIds: string[]): Promise<void> {
    return this.getStore().delete(assetIds);
  }

  get(assetId: string): Promise<number[] | undefined> {
    return this.getStore().get(assetId);
  }

  search(vector: number[], options: VectorSearchOptions): Promise<VectorMatch[]> {
    return this.getStore().search(vector, options);
  }

  clear(): Promise<void> {
    return this.getStore().clear();
  }

  private getStore(): VectorStore {
    if (this.store) {
      return this.store;
    }

    const { search, storage } = this.configRepository.getEnv();
    const file = search.vectorStorePath ?? join(storage.mediaLocation ?? '/data', 'vectors', 'immich-vectors.jsonl');

    this.logger.log(`Using file vector store at ${file}`);
    this.store = new FileVectorStore({ file, dimSize: search.dimSize }, this.logger);
    return this.store;
  }
}
