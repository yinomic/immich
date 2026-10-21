#!/usr/bin/env node
/**
 * Measures how fast *this* machine can push bytes into the configured bucket, and
 * compares a single whole-file PUT with a parallel multipart upload:
 *
 *   single     one request, one TCP stream — what a thin cross-region link turns
 *              into 80 KB/s (round 45: a 200 MiB video took 40 minutes)
 *   multipart  the file split into parts that travel at the same time
 *
 * Run it on the machine that actually serves uploads, so the number is the real path:
 *
 *   set -a; . docker/.env; set +a
 *   node server/scripts/bench-object-storage.mjs                 # 16 MiB
 *   BENCH_SIZE_MIB=64 BENCH_PART_MIB=8 node server/scripts/bench-object-storage.mjs
 *
 * Backend: `IMMICH_STORAGE_BACKEND` decides (defaults to `cos` when COS_BUCKET is
 * set, otherwise `tos`), so the same command measures the old bucket and the new one.
 * Objects are written under `_bench/` and deleted afterwards.
 */
import { TosClient } from '@volcengine/tos-sdk';
import COS from 'cos-nodejs-sdk-v5';
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIB = 1024 * 1024;
const sizeMib = Number(process.env.BENCH_SIZE_MIB ?? 16);
const partMib = Number(process.env.BENCH_PART_MIB ?? 8);
const tasks = Number(process.env.BENCH_TASKS ?? 3);
const backend = process.env.IMMICH_STORAGE_BACKEND ?? (process.env.COS_BUCKET ? 'cos' : 'tos');

const requireEnv = (names) => {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(', ')}`);
    process.exit(2);
  }
};

const buildBackend = () => {
  if (backend === 'cos') {
    requireEnv(['COS_BUCKET', 'COS_REGION', 'COS_SECRET_ID', 'COS_SECRET_KEY']);
    const Bucket = process.env.COS_BUCKET;
    const Region = process.env.COS_REGION;
    const client = new COS({
      SecretId: process.env.COS_SECRET_ID,
      SecretKey: process.env.COS_SECRET_KEY,
      Protocol: 'https:',
      Domain: process.env.COS_DOMAIN,
      ChunkSize: partMib * MIB,
      SliceSize: partMib * MIB,
      ChunkParallelLimit: tasks,
    });

    return {
      label: `Tencent COS ${Bucket} (${Region})`,
      single: (key, path) =>
        // SliceSize above the file size: the SDK does one simple PUT
        client.uploadFile({ Bucket, Region, Key: key, FilePath: path, SliceSize: (sizeMib + 1) * MIB }),
      multipart: (key, path) => client.uploadFile({ Bucket, Region, Key: key, FilePath: path }),
      remove: (keys) => client.deleteMultipleObject({ Bucket, Region, Objects: keys.map((Key) => ({ Key })) }),
    };
  }

  requireEnv(['TOS_ENDPOINT', 'TOS_REGION', 'TOS_BUCKET', 'TOS_ACCESS_KEY_ID', 'TOS_ACCESS_KEY_SECRET']);
  const bucket = process.env.TOS_BUCKET;
  const client = new TosClient({
    accessKeyId: process.env.TOS_ACCESS_KEY_ID,
    accessKeySecret: process.env.TOS_ACCESS_KEY_SECRET,
    endpoint: process.env.TOS_ENDPOINT,
    region: process.env.TOS_REGION,
    bucket,
  });

  return {
    label: `Volcengine TOS ${bucket} (${process.env.TOS_REGION})`,
    single: (key, path) => client.putObjectFromFile({ bucket, key, filePath: path }),
    multipart: (key, path) => client.uploadFile({ bucket, key, file: path, partSize: partMib * MIB, taskNum: tasks }),
    remove: (keys) => client.deleteMultiObjects({ bucket, objects: keys.map((key) => ({ key })) }),
  };
};

const { label, single, multipart, remove } = buildBackend();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const prefix = `_bench/${stamp}`;
const local = join(tmpdir(), `bench-object-storage-${stamp}.bin`);

const run = async (name, fn) => {
  const started = Date.now();
  try {
    await fn();
    const seconds = (Date.now() - started) / 1000;
    const mibPerSecond = sizeMib / seconds;
    console.log(
      `${name.padEnd(10)} ${sizeMib} MiB in ${seconds.toFixed(1)}s → ${mibPerSecond.toFixed(2)} MiB/s (${(mibPerSecond * 8).toFixed(1)} Mbps)`,
    );
  } catch (error) {
    console.error(`${name.padEnd(10)} FAILED after ${((Date.now() - started) / 1000).toFixed(1)}s: ${error?.message ?? error}`);
  }
};

console.log(`backend  ${label}\nfile     ${local} (${sizeMib} MiB)\n`);

const keys = [`${prefix}/single.bin`, `${prefix}/multipart.bin`];
await writeFile(local, randomBytes(sizeMib * MIB));
try {
  await run('single', () => single(keys[0], local));
  await run('multipart', () => multipart(keys[1], local));
} finally {
  await remove(keys).catch(() => {});
  await rm(local, { force: true });
}
