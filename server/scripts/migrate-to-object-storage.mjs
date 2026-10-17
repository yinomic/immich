#!/usr/bin/env node
/**
 * One-time migration: move an existing library from the local filesystem into a
 * Volcengine TOS bucket.
 *
 * The server stores the object key in the database once the library is remote, so
 * this script uploads every local file and rewrites the stored paths. Run it while
 * the server is stopped, i.e. before switching IMMICH_STORAGE_BACKEND to `tos`.
 *
 *   DB_URL=postgres://... IMMICH_MEDIA_LOCATION=/data \
 *   TOS_ENDPOINT=tos-cn-beijing.volces.com TOS_REGION=cn-beijing TOS_BUCKET=... \
 *   TOS_ACCESS_KEY_ID=... TOS_ACCESS_KEY_SECRET=... \
 *   node scripts/migrate-to-object-storage.mjs --dry-run
 *
 * Options:
 *   --dry-run        list what would be uploaded, change nothing
 *   --delete-local   remove the local file after a successful upload
 *   --limit <n>      only process the first n files (handy for a first test)
 */
import { TosClient } from '@volcengine/tos-sdk';
import { createReadStream } from 'node:fs';
import { access, stat, unlink } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const deleteLocal = args.includes('--delete-local');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex === -1 ? Number.POSITIVE_INFINITY : Number(args[limitIndex + 1]);

const dbUrl = process.env.DB_URL;
const mediaLocation = process.env.IMMICH_MEDIA_LOCATION;
const bucket = process.env.TOS_BUCKET;
const endpoint = process.env.TOS_ENDPOINT;
const region = process.env.TOS_REGION ?? 'cn-beijing';
const accessKeyId = process.env.TOS_ACCESS_KEY_ID;
const accessKeySecret = process.env.TOS_ACCESS_KEY_SECRET;
const prefix = (process.env.TOS_PREFIX ?? '').replace(/\/?$/, (m) => (m ? '/' : ''));

for (const [name, value] of Object.entries({ DB_URL: dbUrl, IMMICH_MEDIA_LOCATION: mediaLocation, TOS_BUCKET: bucket, TOS_ENDPOINT: endpoint })) {
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(2);
  }
}

// created lazily: a --dry-run must work without credentials
let tos;
const getClient = () => {
  if (!tos) {
    if (!accessKeyId || !accessKeySecret) {
      throw new Error('TOS_ACCESS_KEY_ID and TOS_ACCESS_KEY_SECRET are required to upload');
    }
    tos = new TosClient({ accessKeyId, accessKeySecret, endpoint, region, bucket });
  }
  return tos;
};

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.dng': 'image/x-adobe-dng',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.xmp': 'application/rdf+xml',
};

const keyFor = (absolutePath) => {
  const key = relative(mediaLocation, absolutePath).replaceAll('\\', '/');
  if (key.startsWith('..')) {
    throw new Error(`${absolutePath} is outside IMMICH_MEDIA_LOCATION (${mediaLocation})`);
  }
  return `${prefix}${key}`;
};

const run = async () => {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  const assets = await client.query(
    `select id, "originalPath" from asset
      where "originalPath" like '/%' and "deletedAt" is null
      order by "createdAt"`,
  );
  const files = await client.query(
    `select id, "assetId", type, path from asset_file where path like '/%' order by "assetId"`,
  );

  const work = [
    ...assets.rows.map((row) => ({ table: 'asset', id: row.id, path: row.originalPath, column: 'originalPath' })),
    ...files.rows.map((row) => ({ table: 'asset_file', id: row.id, path: row.path, column: 'path' })),
  ].slice(0, limit === Number.POSITIVE_INFINITY ? undefined : limit);

  console.log(`${work.length} local file(s) to migrate into ${endpoint}/${bucket}`);

  let uploaded = 0;
  let skipped = 0;
  let outside = 0;
  for (const item of work) {
    // Derived files (thumbnails, previews, transcodes) live in the local cache by
    // design and must stay there - only library files belong in the bucket.
    if (!item.path.startsWith(`${mediaLocation}/`)) {
      outside++;
      continue;
    }

    const key = keyFor(item.path);
    try {
      await access(item.path);
    } catch {
      console.warn(`skip ${item.path}: not readable`);
      skipped++;
      continue;
    }

    const { size } = await stat(item.path);
    if (dryRun) {
      console.log(`[dry-run] ${item.path} -> ${key} (${size} bytes)`);
      continue;
    }

    const contentType = CONTENT_TYPES[extname(item.path).toLowerCase()];
    const client = getClient();
    await client.putObject({ bucket, key, body: createReadStream(item.path), contentLength: size, contentType });
    const { data: head } = await client.headObject({ bucket, key });
    if (Number(head['content-length']) !== size) {
      throw new Error(`uploaded size mismatch for ${key}`);
    }

    await client.query(`update ${item.table} set "${item.column}" = $1 where id = $2`, [key, item.id]);

    if (deleteLocal) {
      await unlink(item.path);
    }

    uploaded++;
    if (uploaded % 100 === 0) {
      console.log(`uploaded ${uploaded}/${work.length}`);
    }
  }

  await client.end();

  if (dryRun) {
    console.log('Dry run finished, nothing was changed.');
    return;
  }

  if (outside > 0) {
    console.log(`Skipped ${outside} derived file(s) outside ${mediaLocation} (they stay in the local cache).`);
  }

  console.log(`Done: ${uploaded} file(s) migrated, ${skipped} skipped.`);
  console.log('Next step: set IMMICH_STORAGE_BACKEND=tos and restart the server.');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
