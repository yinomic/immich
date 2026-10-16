import {
  EmbeddingError,
  EmbeddingInput,
  EmbeddingProvider,
  extractEmbedding,
} from 'src/repositories/embedding/embedding.provider.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

export interface ArkEmbeddingOptions {
  apiKey: string;
  /** default: https://ark.cn-beijing.volces.com/api/v3 */
  baseUrl?: string;
  /** e.g. doubao-embedding-vision-250615 */
  model: string;
  /** optional dimension override; when set, responses are validated against it */
  dimSize?: number;
  /** request timeout, default 30s */
  timeoutMs?: number;
  /** retries for 429/5xx/network errors, default 3 */
  retries?: number;
}

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

/**
 * Volcengine Ark (火山方舟) multimodal embedding.
 *
 * Sends text and images into the same vector space, which is what makes
 * "describe the photo" -> "find the photo" work without any local model.
 *
 * NOTE: the request/response field names below follow the documented
 * `/embeddings/multimodal` contract but have not been verified against a live
 * key yet — run `scripts/verify-cloud-search.mjs` with a real key first; the
 * response parsing is deliberately tolerant.
 */
export class ArkEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimSize: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    options: ArkEmbeddingOptions,
    private logger: LoggingRepository,
  ) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = options.model;
    this.dimSize = options.dimSize ?? 0;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 3;
    this.logger.setContext(ArkEmbeddingProvider.name);
  }

  async embedImage(input: EmbeddingInput): Promise<number[]> {
    if (!input.data && !input.url) {
      throw new EmbeddingError('embedImage requires either data or url');
    }

    const imageUrl =
      input.url ?? `data:${input.mimeType ?? 'image/jpeg'};base64,${(input.data as Buffer).toString('base64')}`;

    return this.request([{ type: 'image_url', image_url: { url: imageUrl } }]);
  }

  async embedText(text: string): Promise<number[]> {
    return this.request([{ type: 'text', text }]);
  }

  private async request(input: unknown[]): Promise<number[]> {
    const body = JSON.stringify({ model: this.model, input });
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 250, 4000)));
      }

      try {
        const response = await fetch(`${this.baseUrl}/embeddings/multimodal`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await response.text();

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          lastError = new EmbeddingError(
            `Ark embedding request failed with status ${response.status}: ${text.slice(0, 500)}`,
            { retryable, status: response.status },
          );
          this.logger.warn(`Ark embedding failed (status ${response.status}), attempt ${attempt + 1}`);
          continue;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new EmbeddingError(`Ark embedding returned a non-JSON body: ${text.slice(0, 500)}`);
        }

        const embedding = extractEmbedding(payload);
        if (!embedding) {
          throw new EmbeddingError(`Ark embedding response did not contain an embedding. Body: ${text.slice(0, 500)}`);
        }

        if (this.dimSize > 0 && embedding.length !== this.dimSize) {
          throw new EmbeddingError(
            `Ark embedding returned ${embedding.length} dimensions, expected ${this.dimSize}. ` +
              `Update the configured dimension and re-index if the model changed.`,
          );
        }

        return embedding;
      } catch (error) {
        if (error instanceof EmbeddingError && !error.retryable) {
          throw error;
        }
        lastError = error;
        this.logger.warn(`Ark embedding request error on attempt ${attempt + 1}: ${error}`);
      }
    }

    throw new EmbeddingError(`Ark embedding failed after ${this.retries + 1} attempts`, { cause: lastError });
  }
}
