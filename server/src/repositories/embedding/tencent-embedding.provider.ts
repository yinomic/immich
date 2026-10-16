import {
  EmbeddingError,
  EmbeddingInput,
  EmbeddingProvider,
  extractEmbedding,
} from 'src/repositories/embedding/embedding.provider.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

export interface TencentEmbeddingOptions {
  apiKey: string;
  /** default: https://tokenhub-intl.tencentcloudmaas.com/v1 (mainland: TokenHub 国内站域名) */
  baseUrl?: string;
  /** e.g. kinfra-vl-embedding-2b (2048 dims) or kinfra-vl-embedding-8b (4096 dims) */
  model: string;
  dimSize?: number;
  timeoutMs?: number;
  retries?: number;
}

const DEFAULT_BASE_URL = 'https://tokenhub-intl.tencentcloudmaas.com/v1';

/**
 * Tencent Cloud TokenHub embedding (OpenAI-compatible `/embeddings` endpoint).
 *
 * Multimodal models (`kinfra-vl-embedding-*`) embed text and images into one
 * space. Text requests are plain OpenAI style; image requests send an
 * OpenAI-style content array and fall back to a plain string if the service
 * rejects the array form.
 *
 * NOTE: verify the multimodal request shape with `scripts/verify-cloud-search.mjs`
 * before relying on it — it is the least documented part of the contract.
 */
export class TencentEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimSize: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    options: TencentEmbeddingOptions,
    private logger: LoggingRepository,
  ) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = options.model;
    this.dimSize = options.dimSize ?? 0;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 3;
    this.logger.setContext(TencentEmbeddingProvider.name);
  }

  async embedImage(input: EmbeddingInput): Promise<number[]> {
    if (!input.data && !input.url) {
      throw new EmbeddingError('embedImage requires either data or url');
    }

    const url =
      input.url ?? `data:${input.mimeType ?? 'image/jpeg'};base64,${(input.data as Buffer).toString('base64')}`;
    return this.request([{ type: 'image_url', image_url: { url } }]);
  }

  async embedText(text: string): Promise<number[]> {
    return this.request(text);
  }

  private async request(input: string | unknown[]): Promise<number[]> {
    const body = JSON.stringify({ model: this.model, input, encoding_format: 'float' });
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 250, 4000)));
      }

      try {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await response.text();

        if (!response.ok) {
          lastError = new EmbeddingError(
            `Tencent embedding request failed with status ${response.status}: ${text.slice(0, 500)}`,
            { retryable: response.status === 429 || response.status >= 500, status: response.status },
          );
          this.logger.warn(`Tencent embedding failed (status ${response.status}), attempt ${attempt + 1}`);
          continue;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new EmbeddingError(`Tencent embedding returned a non-JSON body: ${text.slice(0, 500)}`);
        }

        const embedding = extractEmbedding(payload);
        if (!embedding) {
          throw new EmbeddingError(
            `Tencent embedding response did not contain an embedding. Body: ${text.slice(0, 500)}`,
          );
        }

        if (this.dimSize > 0 && embedding.length !== this.dimSize) {
          throw new EmbeddingError(
            `Tencent embedding returned ${embedding.length} dimensions, expected ${this.dimSize}.`,
          );
        }

        return embedding;
      } catch (error) {
        if (error instanceof EmbeddingError && !error.retryable) {
          throw error;
        }
        lastError = error;
        this.logger.warn(`Tencent embedding request error on attempt ${attempt + 1}: ${error}`);
      }
    }

    throw new EmbeddingError(`Tencent embedding failed after ${this.retries + 1} attempts`, { cause: lastError });
  }
}
