import { createHash, createHmac } from 'node:crypto';

export interface VolcengineCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  /** `air` for VikingDB (see the official SDK's Credentials(ak, sk, 'air', region)) */
  service: string;
}

export interface SignedRequest {
  headers: Record<string, string>;
}

const sha256Hex = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex');

const hmac = (key: Buffer | string, content: string): Buffer => createHmac('sha256', key).update(content).digest();

/** Volcengine uses RFC3986 quoting, keeping `/` in paths. */
const quote = (value: string, keepSlash = false): string => {
  let encoded = encodeURIComponent(value);
  // encodeURIComponent leaves !'()* unescaped, Volcengine escapes them
  encoded = encoded.replaceAll(/[!'()*]/g, (char) => `%${char.codePointAt(0)!.toString(16).toUpperCase()}`);
  if (keepSlash) {
    encoded = encoded.replaceAll('%2F', '/');
  }
  return encoded;
};

const normalizeUri = (path: string): string => quote(path, true).replaceAll('+', '%20');

const normalizeQuery = (params: Record<string, string | string[]>): string => {
  const pairs: string[] = [];
  for (const key of Object.keys(params).toSorted()) {
    const value = params[key];
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      pairs.push(`${encodeURIComponent(key)}%3D${encodeURIComponent(item)}`);
    }
  }

  return pairs.join('%26').replaceAll('+', '%20');
};

const signingKey = (secretAccessKey: string, date: string, region: string, service: string): Buffer => {
  const kDate = hmac(secretAccessKey, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'request');
};

const formatDate = (date: Date): string => date.toISOString().replaceAll(/[:-]|\.\d{3}/g, '');

/**
 * Sign a request the way Volcengine's SignerV4 does (HMAC-SHA256, service
 * `air` for VikingDB). Ported from the official Python SDK so the cloud vector
 * store can be called over plain HTTP without pulling in an SDK.
 */
export const signRequest = (request: {
  method: string;
  host: string;
  path: string;
  query?: Record<string, string | string[]>;
  body?: string;
  credentials: VolcengineCredentials;
  date?: Date;
}): SignedRequest => {
  const { method, host, path, credentials } = request;
  const body = request.body ?? '';
  const formatDateValue = formatDate(request.date ?? new Date());
  const date = formatDateValue.slice(0, 8);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Host: host,
    'X-Date': formatDateValue,
    'X-Content-Sha256': sha256Hex(body),
  };

  if (credentials.sessionToken) {
    headers['X-Security-Token'] = credentials.sessionToken;
  }

  const signedHeaders = Object.keys(headers)
    .map((key) => key.toLowerCase())
    .toSorted()
    .join(';');

  const signedHeadersString = Object.keys(headers)
    .toSorted((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => `${key.toLowerCase()}:${headers[key]}\n`)
    .join('');

  const canonicalRequest = [
    method,
    normalizeUri(path),
    normalizeQuery(request.query ?? {}),
    signedHeadersString,
    signedHeaders,
    headers['X-Content-Sha256'],
  ].join('\n');

  const credentialScope = `${date}/${credentials.region}/${credentials.service}/request`;
  const stringToSign = ['HMAC-SHA256', formatDateValue, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(
    signingKey(credentials.secretAccessKey, date, credentials.region, credentials.service),
    stringToSign,
  ).toString('hex');

  headers.Authorization = `HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers };
};
