import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { ObjectStorage, ObjectStorageError, normalizeKey } from 'src/repositories/object-storage/object-storage.js';

/**
 * Local filesystem backend (default). Keys are resolved inside the media
 * location, which reproduces the historical absolute-path behaviour.
 */
export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  isRemote(): boolean {
    return false;
  }

  async put(key: string, body: Buffer | Readable): Promise<void> {
    const path = this.localPath(key);
    await mkdir(dirname(path), { recursive: true });
    if (Buffer.isBuffer(body)) {
      await writeFile(path, body);
      return;
    }

    const { pipeline } = await import('node:stream/promises');
    const { createWriteStream } = await import('node:fs');
    await pipeline(body, createWriteStream(path));
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.localPath(key));
  }

  stream(key: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.localPath(key)));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.size(key)) !== undefined;
  }

  async size(key: string): Promise<number | undefined> {
    try {
      const stats = await stat(this.localPath(key));
      return stats.size;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async delete(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => rm(this.localPath(key), { force: true })));
  }

  presign(key: string): Promise<string> {
    return Promise.resolve(this.localPath(key));
  }

  localPath(key: string): string {
    if (!this.root) {
      throw new ObjectStorageError('No media location configured');
    }
    return join(this.root, normalizeKey(key));
  }

  async copy(source: string, target: string): Promise<void> {
    const target$ = this.localPath(target);
    await mkdir(dirname(target$), { recursive: true });
    await copyFile(this.localPath(source), target$);
  }
}
