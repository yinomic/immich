#!/usr/bin/env node
/**
 * Smoke test for the configured object storage: verifies credentials, endpoint,
 * path-style addressing and presigned URLs before you trust the bucket.
 *
 *   S3_ENDPOINT=... S3_REGION=... S3_BUCKET=... \
 *   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *   node scripts/verify-object-storage.mjs
 *
 * It writes one small object under `_verify/`, reads it back, fetches a presigned
 * URL over the network, then deletes the object again.
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE, S3_PREFIX } =
  process.env;

const required = { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY };
const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missing.length > 0) {
  console.error(`Missing: ${missing.join(', ')}`);
  process.exit(2);
}

const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: (S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  // TOS/COS reject the `aws-chunked` transfer encoding that SDK v3 uses by default
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const prefix = (S3_PREFIX ?? '').replace(/\/?$/, (m) => (m ? '/' : ''));
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
  console.log(`endpoint ${S3_ENDPOINT}\nregion   ${S3_REGION}\nbucket   ${S3_BUCKET}\nkey      ${key}\n`);

  const results = [];
  results.push(
    await step('PUT object', async () => {
      await client.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: 'text/plain' }));
    }),
  );
  if (!results.at(-1)) {
    console.error('\nUpload failed, stopping here.');
    process.exit(1);
  }

  results.push(
    await step('HEAD object', async () => {
      const head = await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      return `${head.ContentLength} bytes, type ${head.ContentType ?? 'n/a'}`;
    }),
  );

  results.push(
    await step('GET object', async () => {
      const response = await client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      const received = Buffer.concat(chunks);
      if (!received.equals(body)) {
        throw new Error('content mismatch');
      }
      return `${received.length} bytes match`;
    }),
  );

  results.push(
    await step('presigned GET', async () => {
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn: 60 });
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
      await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
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
