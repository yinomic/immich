import { Injectable } from '@nestjs/common';
import archiver from 'archiver';
import { ChokidarOptions, watch as chokidarWatch } from 'chokidar';
import fastGlob from 'fast-glob';
import {
  Dirent,
  ReadOptionsWithBuffer,
  Stats,
  constants,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  watch,
} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import picomatch from 'picomatch';
import { CrawlOptionsDto, WalkOptionsDto } from 'src/dtos/library.dto.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { ObjectStorageRepository } from 'src/repositories/object-storage.repository.js';
import { mimeTypes } from 'src/utils/mime-types.js';

export interface WatchEvents {
  onReady(): void;
  onAdd(path: string): void;
  onChange(path: string): void;
  onUnlink(path: string): void;
  onError(error: Error): void;
}

export type WatchOptions = Omit<ChokidarOptions, 'ignored'> & { ignored?: string[] };

export interface ImmichReadStream {
  stream: Readable;
  type?: string;
  disposition?: string | string[];
  length?: number;
}

export interface ImmichZipStream extends ImmichReadStream {
  addFile: (inputPath: string, filename: string) => void;
  finalize: () => Promise<void>;
}

export interface DiskUsage {
  available: number;
  free: number;
  total: number;
}

@Injectable()
export class StorageRepository {
  constructor(
    private logger: LoggingRepository,
    private objectStorage: ObjectStorageRepository,
  ) {
    this.logger.setContext(StorageRepository.name);
  }

  /** true when media lives in an object bucket (paths are then object keys) */
  isRemote(): boolean {
    return this.objectStorage.isRemote();
  }

  realpath(filepath: string) {
    return fs.realpath(filepath);
  }

  readdir(folder: string): Promise<string[]> {
    return fs.readdir(folder);
  }

  readdirWithTypes(folder: string): Promise<Dirent[]> {
    return fs.readdir(folder, { withFileTypes: true });
  }

  copyFile(source: string, target: string) {
    return fs.copyFile(source, target);
  }

  async stat(filepath: string): Promise<Stats> {
    if (this.isRemote()) {
      const size = await this.objectStorage.size(filepath);
      if (size === undefined) {
        throw new Error(`Object not found: ${filepath}`);
      }

      const timestamp = new Date();
      return {
        size,
        atime: timestamp,
        mtime: timestamp,
        ctime: timestamp,
        birthtime: timestamp,
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as Stats;
    }
    return fs.stat(filepath);
  }

  createFile(filepath: string, buffer: Buffer) {
    return fs.writeFile(filepath, buffer, { flag: 'wx' });
  }

  createWriteStream(filepath: string): Writable {
    return createWriteStream(filepath, { flags: 'w', flush: true });
  }

  createOrOverwriteFile(filepath: string, buffer: Buffer, contentType?: string) {
    if (this.isRemote()) {
      return this.objectStorage.put(filepath, buffer, contentType);
    }
    return fs.writeFile(filepath, buffer, { flag: 'w' });
  }

  overwriteFile(filepath: string, buffer: Buffer) {
    return fs.writeFile(filepath, buffer, { flag: 'r+' });
  }

  rename(source: string, target: string) {
    return fs.rename(source, target);
  }

  utimes(filepath: string, atime: Date, mtime: Date) {
    if (this.isRemote()) {
      // object storage has no timestamps; the DB keeps the dates instead
      return Promise.resolve();
    }
    return fs.utimes(filepath, atime, mtime);
  }

  /** presigned URL for serving a file straight from the bucket (remote only) */
  buildServeTarget(key: string, options?: { contentType?: string; fileName?: string }): Promise<string | undefined> {
    return this.isRemote() ? this.objectStorage.presign(key, options) : Promise.resolve(undefined);
  }

  /** remove a file that only exists locally (staged uploads, temp copies) */
  async removeLocalFile(filepath: string): Promise<void> {
    await fs.rm(filepath, { force: true });
  }

  /** run a callback against a real local file, downloading remote objects first */
  withLocalCopy<T>(
    key: string,
    callback: (path: string) => Promise<T>,
    options?: { uploadBack?: boolean; contentType?: string },
  ): Promise<T> {
    return this.objectStorage.withLocalCopy(key, callback, options);
  }

  createZipStream(): ImmichZipStream {
    const archive = archiver('zip', { store: true });

    const addFile = (input: string, filename: string) => {
      archive.file(input, { name: filename, mode: 0o644 });
    };

    const finalize = () => archive.finalize();

    return { stream: archive, addFile, finalize };
  }

  createGzip(): PassThrough {
    return createGzip();
  }

  createGunzip(): PassThrough {
    return createGunzip();
  }

  createPlainReadStream(filepath: string): Readable {
    return createReadStream(filepath);
  }

  async createReadStream(filepath: string, mimeType?: string | null): Promise<ImmichReadStream> {
    if (this.isRemote()) {
      const size = await this.objectStorage.size(filepath);
      if (size === undefined) {
        throw new Error(`Object not found: ${filepath}`);
      }
      return { stream: await this.objectStorage.stream(filepath), length: size, type: mimeType || undefined };
    }

    const { size } = await fs.stat(filepath);
    await fs.access(filepath, constants.R_OK);
    return {
      stream: createReadStream(filepath),
      length: size,
      type: mimeType || undefined,
    };
  }

  async readFile(filepath: string, options?: ReadOptionsWithBuffer<Buffer>): Promise<Buffer> {
    if (this.isRemote() && !options) {
      return this.objectStorage.get(filepath);
    }

    // read a slice
    if (options) {
      const file = await fs.open(filepath);
      try {
        const { buffer } = await file.read(options);
        return buffer as Buffer;
      } finally {
        await file.close();
      }
    }

    // read everything
    return fs.readFile(filepath);
  }

  async readJsonFile<T>(filepath: string): Promise<T> {
    const file = await fs.readFile(filepath, 'utf8');
    return JSON.parse(file) as T;
  }

  async checkFileExists(filepath: string, mode = constants.F_OK): Promise<boolean> {
    if (this.isRemote()) {
      return this.objectStorage.exists(filepath);
    }
    try {
      await fs.access(filepath, mode);
      return true;
    } catch {
      return false;
    }
  }

  /** local-only existence check (derived files always live in the local cache) */
  async checkLocalFileExists(filepath: string): Promise<boolean> {
    try {
      await fs.access(filepath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async unlink(file: string) {
    if (this.isRemote()) {
      await this.objectStorage.delete([file]);
      return;
    }
    try {
      await fs.unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.logger.warn(`File ${file} does not exist.`);
      } else {
        throw error;
      }
    }
  }

  async unlinkDir(folder: string, options: { recursive?: boolean; force?: boolean }) {
    await fs.rm(folder, { ...options, maxRetries: 5, retryDelay: 100 });
  }

  async removeEmptyDirs(directory: string, self: boolean = false) {
    // lstat does not follow symlinks (in contrast to stat)
    const stats = await fs.lstat(directory);
    if (!stats.isDirectory()) {
      return;
    }

    const files = await fs.readdir(directory);
    await Promise.all(files.map((file) => this.removeEmptyDirs(path.join(directory, file), true)));

    if (!self) {
      return;
    }

    const updated = await fs.readdir(directory);
    if (updated.length === 0) {
      try {
        await fs.rmdir(directory);
      } catch (error: Error | any) {
        if (error.code !== 'ENOTEMPTY') {
          this.logger.warn(`Attempted to remove directory, but failed: ${error}`);
        }
      }
    }
  }

  mkdirSync(filepath: string): void {
    if (!existsSync(filepath)) {
      mkdirSync(filepath, { recursive: true });
    }
  }

  existsSync(filepath: string) {
    return existsSync(filepath);
  }

  async checkDiskUsage(folder: string): Promise<DiskUsage> {
    const stats = await fs.statfs(folder);
    return {
      available: stats.bavail * stats.frsize,
      free: stats.bfree * stats.frsize,
      total: stats.blocks * stats.frsize,
    };
  }

  crawl(crawlOptions: CrawlOptionsDto): Promise<string[]> {
    const { pathsToCrawl, exclusionPatterns, includeHidden } = crawlOptions;
    if (pathsToCrawl.length === 0) {
      return Promise.resolve([]);
    }

    const globbedPaths = pathsToCrawl.map((path) => this.asGlob(path));

    // eslint-disable-next-line import-x/no-named-as-default-member
    return fastGlob.glob(globbedPaths, {
      absolute: true,
      caseSensitiveMatch: false,
      onlyFiles: true,
      dot: includeHidden,
      ignore: exclusionPatterns,
    });
  }

  async *walk(walkOptions: WalkOptionsDto): AsyncGenerator<string[]> {
    const { pathsToCrawl, exclusionPatterns, includeHidden } = walkOptions;
    if (pathsToCrawl.length === 0) {
      async function* emptyGenerator() {}
      return emptyGenerator();
    }

    const globbedPaths = pathsToCrawl.map((path) => this.asGlob(path));

    // eslint-disable-next-line import-x/no-named-as-default-member
    const stream = fastGlob.globStream(globbedPaths, {
      absolute: true,
      caseSensitiveMatch: false,
      onlyFiles: true,
      dot: includeHidden,
      ignore: exclusionPatterns,
    });

    let batch: string[] = [];
    for await (const value of stream) {
      batch.push(value.toString());
      if (batch.length !== walkOptions.take) {
        continue;
      }

      yield batch;
      batch = [];
    }

    if (batch.length > 0) {
      yield batch;
    }
  }

  watch(paths: string[], options: WatchOptions, events: Partial<WatchEvents>) {
    const matchesIgnoredPath = picomatch(options.ignored ?? [], {
      dot: true, // Match the behavior of fast-glob's micromatch by using these settings
      nocase: true,
      posix: true,
      strictSlashes: false,
    });

    const watcher = chokidarWatch(paths, { ...options, ignored: (path) => matchesIgnoredPath(path) });

    watcher.on('ready', () => events.onReady?.());
    watcher.on('add', (path) => events.onAdd?.(path));
    watcher.on('change', (path) => events.onChange?.(path));
    watcher.on('unlink', (path) => events.onUnlink?.(path));
    watcher.on('error', (error) => events.onError?.(error as Error));

    return () => watcher.close();
  }

  watchDir = watch; // Native fs.watch without chokidar overhead

  private asGlob(pathToCrawl: string): string {
    // eslint-disable-next-line import-x/no-named-as-default-member
    const escapedPath = fastGlob
      .escapePath(pathToCrawl)
      .replaceAll('"', '["]')
      .replaceAll("'", "[']")
      .replaceAll('`', '[`]');
    const extensions = `*{${mimeTypes.getSupportedFileExtensions().join(',')}}`;
    return `${escapedPath}/**/${extensions}`;
  }
}
