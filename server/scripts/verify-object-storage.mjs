#!/usr/bin/env node
/**
 * Smoke test for the configured Volcengine TOS bucket: verifies credentials, endpoint
 * and presigned URLs before you trust it.
 *
 *   TOS_ENDPOINT=tos-cn-beijing.volces.com TOS_REGION=cn-beijing TOS_BUCKET=... \
 *   TOS_ACCESS_KEY_ID=... TOS_ACCESS_KEY_SECRET=... \
 *   node scripts/verify-object-storage.mjs
 *
 * It writes one small object under `_verify/`, reads it back, fetches a presigned
 * URL over the network, then deletes the object again.
 */
import { TosClient } from '@volcengine/tos-sdk';

const { TOS_ENDPOINT, TOS_REGION, TOS_BUCKET, TOS_ACCESS_KEY_ID, TOS_ACCESS_KEY_SECRET, TOS_PREFIX } = process.env;

const required = { TOS_ENDPOINT, TOS_REGION, TOS_BUCKET, TOS_ACCESS_KEY_ID, TOS_ACCESS_KEY_SECRET };
const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missing.length > 0) {
  console.error(`Missing: ${missing.join(', ')}`);
  process.exit(2);
}

const client = new TosClient({
  accessKeyId: TOS_ACCESS_KEY_ID,
  accessKeySecret: TOS_ACCESS_KEY_SECRET,
  endpoint: TOS_ENDPOINT,
  region: TOS_REGION,
  bucket: TOS_BUCKET,
});

const prefix = (TOS_PREFIX ?? '').replace(/\/?$/, (m) => (m ? '/' : ''));
const key = `${prefix}_verify/immich-storage-check.txt`;
const body = Buffer.from(`immich object storage check ${new Date().toISOString()}\n`);

const step = async (name, fn) => {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`ok   ${name} (${Date.now() - started}ms)${result ? ` ${result}` : ''}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}: ${error?.name ?? ''} ${error?.message ?? error}`);
    if (error?.$metadata?.httpStatusCode) {
      console.error(`     http ${error.$metadata.httpStatusCode}`);
    }
    return false;
  }
};

const main = async () => {
  console.log(`endpoint ${TOS_ENDPOINT}\nregion   ${TOS_REGION}\nbucket   ${TOS_BUCKET}\nkey      ${key}\n`);

  const results = [];
  results.push(
    await step('PUT object', async () => {
      await client.putObject({ bucket: TOS_BUCKET, key, body, contentType: 'text/plain' });
    }),
  );
  if (!results.at(-1)) {
    console.error('\nUpload failed, stopping here.');
    process.exit(1);
  }

  results.push(
    await step('HEAD object', async () => {
      const { data: head } = await client.headObject({ bucket: TOS_BUCKET, key });
      return `${head['content-length']} bytes`;
    }),
  );

  results.push(
    await step('GET object', async () => {
      const { data: received } = await client.getObject({ bucket: TOS_BUCKET, key });
      if (!received.equals(body)) {
        throw new Error('content mismatch');
      }
      return `${received.length} bytes match`;
    }),
  );

  results.push(
    await step('presigned GET', async () => {
      const url = client.getPreSignedUrl({ bucket: TOS_BUCKET, key, method: 'GET', expires: 60 });
      const response = await fetch(url);
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

  results.push(
    await step('DELETE object', async () => {
      await client.deleteObject({ bucket: TOS_BUCKET, key });
    }),
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
