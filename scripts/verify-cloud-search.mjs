#!/usr/bin/env node
/**
 * Verify a cloud embedding provider before wiring it into Immich.
 *
 * Usage:
 *   ARK_API_KEY=xxx ARK_MODEL=doubao-embedding-vision-250615 \
 *     node scripts/verify-cloud-search.mjs --image /path/to/baby.jpg
 *
 *   TENCENT_API_KEY=xxx TENCENT_MODEL=kinfra-vl-embedding-2b \
 *     node scripts/verify-cloud-search.mjs --image /path/to/baby.jpg
 *
 * It prints, for text and image inputs: HTTP status, vector dimension, latency,
 * the raw response head, and a similarity matrix. Use it to answer:
 *   1. does the provider put text and images in ONE vector space?
 *   2. what dimension comes back (must match the DB / vector store)?
 *   3. how long does one image cost in latency?
 */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const imagePath = argOf('--image');
const timeoutMs = Number(argOf('--timeout') ?? 60_000);

function resolveProvider() {
  if (process.env.ARK_API_KEY) {
    return {
      name: 'volcengine-ark',
      apiKey: process.env.ARK_API_KEY,
      model: process.env.ARK_MODEL ?? 'doubao-embedding-vision-250615',
      baseUrl: (process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, ''),
      path: '/embeddings/multimodal',
      buildBody: (input) => ({ model: undefined, input }),
    };
  }

  if (process.env.TENCENT_API_KEY) {
    return {
      name: 'tencent-tokenhub',
      apiKey: process.env.TENCENT_API_KEY,
      model: process.env.TENCENT_MODEL ?? 'kinfra-vl-embedding-2b',
      baseUrl: (process.env.TENCENT_BASE_URL ?? 'https://tokenhub-intl.tencentcloudmaas.com/v1').replace(/\/+$/, ''),
      path: '/embeddings',
      buildBody: (input) => ({ model: undefined, input, encoding_format: 'float' }),
    };
  }

  console.error('No credentials found. Set ARK_API_KEY or TENCENT_API_KEY.');
  process.exit(2);
}

function extractEmbedding(payload) {
  const candidates = [];
  const push = (value) => value !== undefined && value !== null && candidates.push(value);

  if (Array.isArray(payload)) {
    candidates.push(payload);
  } else if (payload && typeof payload === 'object') {
    push(payload.embedding);
    const { data, result } = payload;
    if (Array.isArray(data)) {
      for (const item of data) push(item?.embedding ?? item);
    } else {
      push(data?.embedding ?? data);
    }
    if (result && typeof result === 'object') {
      push(result.embedding);
      if (Array.isArray(result.data)) for (const item of result.data) push(item?.embedding ?? item);
    }
  }

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0 && candidate.every((v) => typeof v === 'number')) {
      return candidate;
    }
  }
  return undefined;
}

function cosine(a, b) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

async function embed(provider, input, label) {
  const started = Date.now();
  const response = await fetch(`${provider.baseUrl}${provider.path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...provider.buildBody(input), model: provider.model }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const elapsed = Date.now() - started;

  console.log(`\n--- ${label}`);
  console.log(`status: ${response.status} ${response.statusText}  latency: ${elapsed}ms  bytes: ${text.length}`);
  console.log(`raw head: ${text.slice(0, 400)}`);

  if (!response.ok) return undefined;

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    console.log('body was not JSON');
    return undefined;
  }

  const embedding = extractEmbedding(payload);
  if (!embedding) {
    console.log('!! no embedding found in response — adjust extractEmbedding()/the provider adapter');
    return undefined;
  }

  const usage = payload?.usage ?? payload?.result?.usage;
  console.log(`dimension: ${embedding.length}  first5: [${embedding.slice(0, 5).map((v) => v.toFixed(4)).join(', ')}]`);
  if (usage) console.log(`usage: ${JSON.stringify(usage)}`);
  return embedding;
}

const provider = resolveProvider();
console.log(`provider: ${provider.name}`);
console.log(`model:    ${provider.model}`);
console.log(`baseUrl:  ${provider.baseUrl}${provider.path}`);

const vectors = {};
vectors['text:baby playing'] = await embed(provider, [{ type: 'text', text: '宝宝在玩积木' }], 'text (宝宝在玩积木)');
vectors['text:baby sleeping'] = await embed(provider, [{ type: 'text', text: '宝宝睡觉' }], 'text (宝宝睡觉)');
vectors['text:unrelated'] = await embed(provider, [{ type: 'text', text: '汽车发动机维修手册' }], 'text (汽车发动机维修手册)');

if (imagePath) {
  const data = await readFile(imagePath);
  const mimeType = MIME[extname(imagePath).toLowerCase()] ?? 'image/jpeg';
  console.log(`\nimage: ${basename(imagePath)} (${(data.length / 1024 / 1024).toFixed(2)} MiB, ${mimeType})`);
  vectors['image'] = await embed(
    provider,
    [{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${data.toString('base64')}` } }],
    `image (${basename(imagePath)})`,
  );
}

console.log('\n--- similarity matrix');
const keys = Object.keys(vectors).filter((key) => vectors[key]);
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    console.log(`  ${keys[i]} <-> ${keys[j]}: ${cosine(vectors[keys[i]], vectors[keys[j]]).toFixed(4)}`);
  }
}

console.log(`
Interpretation:
  * image <-> a matching caption should score clearly higher than image <-> unrelated text.
    If every pair scores ~0.9+, the texts/images are NOT in a shared space.
  * remember the reported dimension: it must match the vector store and triggers a re-index
    when it changes.
`);
