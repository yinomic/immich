import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { VectorMatch, VectorSearchOptions, VectorStore, cosineDistance } from 'src/repositories/vector/vector-store.js';

type JournalEntry = { t: 'u'; id: string; v: number[] } | { t: 'd'; id: string };

export interface FileVectorStoreOptions {
  /** append-only journal; compacted once on startup */
  file: string;
  /** expected dimension; mismatched vectors are rejected */
  dimSize?: number;
}

/**
 * Local vector store for development and single-node setups.
 *
 * Vectors are kept in memory (Float32Array) and persisted to an append-only
 * JSONL journal that is compacted on startup. That is plenty for a family
 * album (tens of thousands of assets) and, more importantly, it lets the whole
 * pipeline run without Postgres extensions or cloud credentials.
 *
 * Production deployments should use the cloud store (`vikingdb`).
 */
export class FileVectorStore implements VectorStore {
  private vectors = new Map<string, Float32Array>();
  private loaded?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private options: FileVectorStoreOptions,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(FileVectorStore.name);
  }

  async upsert(assetId: string, vector: number[]): Promise<void> {
    await this.ensureLoaded();
    this.assertDimension(vector);

    this.vectors.set(assetId, Float32Array.from(vector));
    await this.append({ t: 'u', id: assetId, v: vector });
  }

  async delete(assetIds: string[]): Promise<void> {
    await this.ensureLoaded();
    let changed = false;

    for (const assetId of assetIds) {
      changed = this.vectors.delete(assetId) || changed;
    }

    if (changed) {
      await this.appendMany(assetIds.map((id) => ({ t: 'd' as const, id })));
    }
  }

  async get(assetId: string): Promise<number[] | undefined> {
    await this.ensureLoaded();
    const vector = this.vectors.get(assetId);
    return vector ? [...vector] : undefined;
  }

  async search(vector: number[], options: VectorSearchOptions): Promise<VectorMatch[]> {
    await this.ensureLoaded();
    this.assertDimension(vector);

    const allowed = options.assetIds ? new Set(options.assetIds) : undefined;
    const matches: VectorMatch[] = [];

    for (const [assetId, candidate] of this.vectors) {
      if (allowed && !allowed.has(assetId)) {
        continue;
      }

      const distance = cosineDistance(vector, candidate);
      if (options.maxDistance !== undefined && distance > options.maxDistance) {
        continue;
      }

      matches.push({ assetId, distance });
    }

    matches.sort((a, b) => a.distance - b.distance || a.assetId.localeCompare(b.assetId));
    return matches.slice(0, options.maxDistance === undefined ? options.topK : Math.max(options.topK, 1));
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    this.vectors.clear();

    await this.enqueue(async () => {
      await mkdir(dirname(this.options.file), { recursive: true });
      await writeFile(this.options.file, '');
    });
  }

  get count(): number {
    return this.vectors.size;
  }

  private ensureLoaded(): Promise<void> {
    this.loaded ??= this.load();
    return this.loaded;
  }

  private async load(): Promise<void> {
    if (!existsSync(this.options.file)) {
      return;
    }

    const content = await readFile(this.options.file, 'utf8');
    let applied = 0;

    for (const line of content.split('\n')) {
      if (!line.trim()) {
        continue;
      }

      let entry: JournalEntry;
      try {
        entry = JSON.parse(line) as JournalEntry;
      } catch {
        this.logger.warn(`Skipping corrupt vector journal line: ${line.slice(0, 80)}`);
        continue;
      }

      if (entry.t === 'u') {
        this.vectors.set(entry.id, Float32Array.from(entry.v));
        applied++;
      } else if (entry.t === 'd') {
        this.vectors.delete(entry.id);
      }
    }

    this.logger.log(`Loaded ${this.vectors.size} vectors (${applied} records) from ${this.options.file}`);
    await this.compact();
  }

  /** Rewrite the journal so it only contains live vectors. */
  private async compact(): Promise<void> {
    const temporary = `${this.options.file}.tmp`;
    const lines: string[] = [];

    for (const [id, vector] of this.vectors) {
      lines.push(JSON.stringify({ t: 'u', id, v: [...vector] } satisfies JournalEntry));
    }

    await this.enqueue(async () => {
      await mkdir(dirname(this.options.file), { recursive: true });
      await writeFile(temporary, lines.length > 0 ? lines.join('\n') + '\n' : '');
      await rename(temporary, this.options.file);
    });
  }

  private append(entry: JournalEntry): Promise<void> {
    return this.appendMany([entry]);
  }

  private appendMany(entries: JournalEntry[]): Promise<void> {
    if (entries.length === 0) {
      return Promise.resolve();
    }

    const payload = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    return this.enqueue(async () => {
      await mkdir(dirname(this.options.file), { recursive: true });
      await appendFile(this.options.file, payload);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => {});
    return next;
  }

  private assertDimension(vector: number[]): void {
    if (this.options.dimSize && vector.length !== this.options.dimSize) {
      throw new Error(
        `Vector has ${vector.length} dimensions but the store expects ${this.options.dimSize}; ` +
          `update IMMICH_CLOUD_SEARCH_DIM and re-index if the model changed.`,
      );
    }
  }
}
