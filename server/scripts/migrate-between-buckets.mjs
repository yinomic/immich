#!/usr/bin/env node
/**
 * Copies every object the library uses from the current Volcengine TOS bucket into
 * a Tencent COS bucket, keeping the keys identical — that is what makes the switch
 * work: the database stores object keys (the bucket prefix is added at request
 * time), so once the bytes are on the other side you only change
 * IMMICH_STORAGE_BACKEND and restart.
 *
 * The key list comes from Postgres, not from listing the bucket: the family-scoped
 * TOS key has no ListObjects permission, and the database knows exactly which
 * objects the library needs.
 *
 *   set -a; . docker/.env; set +a          # DB_URL, TOS_* (source), COS_* (target)
 *   node scripts/migrate-between-buckets.mjs --dry-run
 *   node scripts/migrate-between-buckets.mjs              # copies
 *
 * Options:
 *   --dry-run     list what would be copied, change nothing
 *   --limit <n>   only process the first n keys (handy for a first try)
 *   --force       copy even when the target already has an object of the same size
 *   --keys <file> copy the keys listed in a file (one per line) instead of the
 *                 ones found in the database
 *
 * Objects are streamed to a temporary file and pushed with the multipart uploader,
 * so a 4 GB video neither sits in memory nor travels as one thin stream. Running it
 * twice is harmless: objects already present at the same size are skipped.
 */
import { TosClient } from '@volcengine/tos-sdk';
import COS from 'cos-nodejs-sdk-v5';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const MIB = 1024 * 1024;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex === -1 ? Number.POSITIVE_INFINITY : Number(args[limitIndex + 1]);
const keysIndex = args.indexOf('--keys');
const keysFile = keysIndex === -1 ? undefined : args[keysIndex + 1];

const {
  DB_URL,
  TOS_ENDPOINT,
  TOS_REGION,
  TOS_BUCKET,
  TOS_ACCESS_KEY_ID,
  TOS_ACCESS_KEY_SECRET,
  TOS_PREFIX,
  COS_BUCKET,
  COS_REGION,
  COS_SECRET_ID,
  COS_SECRET_KEY,
  COS_PREFIX,
  COS_CHUNK_SIZE_MB,
  COS_CONCURRENCY,
} = process.env;

const missing = Object.entries({
  DB_URL,
  TOS_ENDPOINT,
  TOS_REGION,
  TOS_BUCKET,
  COS_BUCKET,
  COS_REGION,
}).filter(([, value]) => !value);
if (missing.length > 0) {
  console.error(`Missing: ${missing.map(([name]) => name).join(', ')}`);
  process.exit(2);
}

const normalisePrefix = (value) => (value ? `${value.replace(/^\/+/, '').replace(/\/$/, '')}/` : '');
const sourcePrefix = normalisePrefix(TOS_PREFIX);
const targetPrefix = normalisePrefix(COS_PREFIX);

const tos = new TosClient({
  accessKeyId: TOS_ACCESS_KEY_ID,
  accessKeySecret: TOS_ACCESS_KEY_SECRET,
  endpoint: TOS_ENDPOINT,
  region: TOS_REGION,
  bucket: TOS_BUCKET,
});

const cos = new COS({
  SecretId: COS_SECRET_ID,
  SecretKey: COS_SECRET_KEY,
  Protocol: 'https:',
  ChunkSize: (Number(COS_CHUNK_SIZE_MB) || 8) * MIB,
  SliceSize: (Number(COS_CHUNK_SIZE_MB) || 8) * MIB,
  ChunkParallelLimit: Number(COS_CONCURRENCY) || 4,
});

const nullableSize = async (read) => {
  try {
    return await read();
  } catch (error) {
    if (error?.statusCode === 404 || /NoSuchKey|NotFound/i.test(error?.message ?? '')) {
      return undefined;
    }
    throw error;
  }
};

const sourceSize = (key) =>
  nullableSize(async () => {
    const { data } = await tos.headObject({ bucket: TOS_BUCKET, key: `${sourcePrefix}${key}` });
    return Number(data['content-length']);
  });

const targetSize = (key) =>
  nullableSize(async () => {
    const { headers } = await cos.headObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: `${targetPrefix}${key}` });
    return headers?.['content-length'] === undefined ? undefined : Number(headers['content-length']);
  });

const toMib = (bytes) => `${(Number(bytes) / MIB).toFixed(1)} MiB`;

const keysFromDatabase = async () => {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    // '/'-prefixed rows are still local paths (nothing migrated them); keys never
    // start with a slash
    const { rows } = await client.query(
      `select "originalPath" as path from asset where "originalPath" not like '/%'
        union
       select path from asset_file where path not like '/%'
       order by 1`,
    );
    return rows.map((row) => row.path);
  } finally {
    await client.end();
  }
};

const keys = (keysFile ? (await readFile(keysFile, 'utf8')).split('\n').filter(Boolean) : await keysFromDatabase()).slice(0, limit === Number.POSITIVE_INFINITY ? undefined : limit);
console.log(
  `${keys.length} object(s) in ${TOS_BUCKET}${sourcePrefix ? `/${sourcePrefix.replace(/\/$/, '')}` : ''} → ` +
    `${COS_BUCKET}${targetPrefix ? `/${targetPrefix.replace(/\/$/, '')}` : ''}${dryRun ? ' (dry run)' : ''}\n`,
);

const work = await mkdtemp(join(tmpdir(), 'immich-bucket-move-'));
const failures = [];
let copied = 0;
let skipped = 0;

try {
  for (const key of keys) {
    const size = await sourceSize(key);
    if (size === undefined) {
      console.warn(`miss  ${key} (not in the source bucket)`);
      continue;
    }

    if (!force) {
      const existing = await targetSize(key).catch(() => undefined);
      if (existing === size) {
        skipped++;
        console.log(`skip  ${key} (${toMib(size)} already there)`);
        continue;
      }
    }

    if (dryRun) {
      console.log(`would copy ${key} (${toMib(size)})`);
      continue;
    }

    const local = join(work, `${copied}-${Date.now()}.bin`);
    const started = Date.now();
    try {
      await tos.getObjectToFile({ bucket: TOS_BUCKET, key: `${sourcePrefix}${key}`, filePath: local });
      const { size: localSize } = await stat(local);
      if (localSize !== size) {
        throw new Error(`downloaded ${localSize} bytes, expected ${size}`);
      }

      await cos.uploadFile({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: `${targetPrefix}${key}`,
        FilePath: local,
      });

      const uploaded = await targetSize(key);
      if (uploaded !== size) {
        throw new Error(`uploaded ${uploaded} bytes, expected ${size}`);
      }

      copied++;
      console.log(`ok    ${key} (${toMib(size)} in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (error) {
      failures.push({ key, message: error?.message ?? String(error) });
      console.error(`FAIL  ${key}: ${error?.message ?? error}`);
    } finally {
      await rm(local, { force: true });
    }
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

console.log(`\n${copied} copied, ${skipped} skipped, ${failures.length} failed (of ${keys.length} keys)`);
if (failures.length > 0) {
  console.log('failed keys:\n' + failures.map(({ key, message }) => `  ${key}: ${message}`).join('\n'));
  process.exit(1);
}
