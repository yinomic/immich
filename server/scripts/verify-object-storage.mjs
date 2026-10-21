#!/usr/bin/env node
/**
 * Smoke test for the configured bucket: verifies credentials, endpoint and
 * presigned URLs before you trust it.
 *
 *   # Volcengine TOS
 *   TOS_ENDPOINT=tos-cn-beijing.volces.com TOS_REGION=cn-beijing TOS_BUCKET=... \
 *   TOS_ACCESS_KEY_ID=... TOS_ACCESS_KEY_SECRET=... \
 *   node scripts/verify-object-storage.mjs
 *
 *   # Tencent COS
 *   IMMICH_STORAGE_BACKEND=cos COS_BUCKET=name-1250000000 COS_REGION=ap-guangzhou \
 *   COS_SECRET_ID=... COS_SECRET_KEY=... \
 *   node scripts/verify-object-storage.mjs
 *
 * It writes one small object under `_verify/`, reads it back, fetches a presigned
 * URL over the network, then deletes the object again.
 */
import { TosClient } from '@volcengine/tos-sdk';
import COS from 'cos-nodejs-sdk-v5';

const backend = process.env.IMMICH_STORAGE_BACKEND ?? (process.env.COS_BUCKET ? 'cos' : 'tos');
const prefix = (process.env.TOS_PREFIX ?? process.env.COS_PREFIX ?? '').replace(/\/?$/, (m) => (m ? '/' : ''));
const key = `${prefix}_verify/immich-storage-check.txt`;
const body = Buffer.from(`immich object storage check ${new Date().toISOString()}\n`);

const requireEnv = (names) => {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(', ')}`);
    process.exit(2);
  }
};

const buildTos = () => {
  const { TOS_ENDPOINT, TOS_REGION, TOS_BUCKET, TOS_ACCESS_KEY_ID, TOS_ACCESS_KEY_SECRET } = process.env;
  requireEnv(['TOS_ENDPOINT', 'TOS_REGION', 'TOS_BUCKET', 'TOS_ACCESS_KEY_ID', 'TOS_ACCESS_KEY_SECRET']);
  const client = new TosClient({
    accessKeyId: TOS_ACCESS_KEY_ID,
    accessKeySecret: TOS_ACCESS_KEY_SECRET,
    endpoint: TOS_ENDPOINT,
    region: TOS_REGION,
    bucket: TOS_BUCKET,
  });

  return {
    label: `Volcengine TOS ${TOS_BUCKET} (${TOS_ENDPOINT})`,
    put: async () => {
      await client.putObject({ bucket: TOS_BUCKET, key, body, contentType: 'text/plain' });
    },
    head: async () => {
      const { data } = await client.headObject({ bucket: TOS_BUCKET, key });
      return data['content-length'];
    },
    get: async () => (await client.getObject({ bucket: TOS_BUCKET, key })).data,
    presign: () => client.getPreSignedUrl({ bucket: TOS_BUCKET, key, method: 'GET', expires: 60 }),
    remove: async () => {
      await client.deleteObject({ bucket: TOS_BUCKET, key });
    },
  };
};

const buildCos = () => {
  const { COS_BUCKET, COS_REGION, COS_SECRET_ID, COS_SECRET_KEY, COS_DOMAIN } = process.env;
  requireEnv(['COS_BUCKET', 'COS_REGION', 'COS_SECRET_ID', 'COS_SECRET_KEY']);
  const client = new COS({
    SecretId: COS_SECRET_ID,
    SecretKey: COS_SECRET_KEY,
    Protocol: 'https:',
    Domain: COS_DOMAIN,
  });

  return {
    label: `Tencent COS ${COS_BUCKET} (${COS_REGION})`,
    put: async () => {
      await client.putObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: 'text/plain',
      });
    },
    head: async () => {
      const { headers } = await client.headObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key });
      return headers?.['content-length'];
    },
    get: async () => (await client.getObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key })).Body,
    presign: () =>
      client.getObjectUrl({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key, Sign: true, Method: 'GET', Expires: 60 }),
    remove: async () => {
      await client.deleteObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key });
    },
  };
};

const storage = backend === 'cos' ? buildCos() : buildTos();

const step = async (name, fn) => {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`ok   ${name} (${Date.now() - started}ms)${result ? ` ${result}` : ''}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}: ${error?.name ?? ''} ${error?.message ?? error}`);
    if (error?.statusCode) {
      console.error(`     http ${error.statusCode}`);
    }
    return false;
  }
};

const main = async () => {
  console.log(`backend  ${storage.label}\nkey      ${key}\n`);

  const results = [];
  results.push(await step('PUT object', () => storage.put()));
  if (!results.at(-1)) {
    console.error('\nUpload failed, stopping here.');
    process.exit(1);
  }

  results.push(await step('HEAD object', async () => `${await storage.head()} bytes`));

  results.push(
    await step('GET object', async () => {
      const received = await storage.get();
      if (!received.equals(body)) {
        throw new Error('content mismatch');
      }
      return `${received.length} bytes match`;
    }),
  );

  results.push(
    await step('presigned GET', async () => {
      const response = await fetch(storage.presign());
      if (!response.ok) {
        throw new Error(`http ${response.status}`);
      }
      const text = await response.text();
      if (text !== body.toString()) {
        throw new Error('content mismatch');
      }
      return 'fetched without auth headers';
    }),
  );

  results.push(await step('DELETE object', () => storage.remove()));

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
