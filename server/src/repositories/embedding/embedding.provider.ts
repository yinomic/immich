/**
 * Cloud embedding provider abstraction.
 *
 * Replaces the local `machine-learning` service entirely: images and text are
 * embedded by a cloud API (Volcengine Ark `doubao-embedding-vision`, Tencent
 * Cloud TokenHub multimodal embedding, or any other provider).
 *
 * Contract notes (verify against the provider console before trusting them):
 *  - image and text embeddings MUST come from the same model / same vector space,
 *    otherwise image<->text search is meaningless.
 *  - the vector dimension is part of the identity of the stored vectors: if the
 *    model or dimension changes, every stored vector must be re-indexed.
 */
export interface EmbeddingInput {
  /** raw bytes; sent to the provider inline (data URL) when no `url` is given */
  data?: Buffer;
  mimeType?: string;
  /** pre-signed URL the provider can fetch itself — preferred for large originals */
  url?: string;
}

export interface EmbeddingProvider {
  /** model identifier, used as part of the "does the index need rebuilding" check */
  readonly model: string;
  /** vector dimension produced by this model */
  readonly dimSize: number;

  embedImage(input: EmbeddingInput): Promise<number[]>;
  embedText(text: string): Promise<number[]>;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly options?: { cause?: unknown; retryable?: boolean; status?: number },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = EmbeddingError.name;
  }

  get retryable(): boolean {
    return this.options?.retryable ?? false;
  }

  get status(): number | undefined {
    return this.options?.status;
  }
}

/** Extract an embedding from the response shapes the known providers use. */
export function extractEmbedding(payload: unknown): number[] | undefined {
  const candidates: unknown[] = [];
  const push = (value: unknown) => {
    if (value !== undefined && value !== null) {
      candidates.push(value);
    }
  };

  if (Array.isArray(payload)) {
    candidates.push(payload);
  } else if (payload && typeof payload === 'object') {
    const object = payload as Record<string, unknown>;
    push(object.embedding);
    const data = object.data;
    if (Array.isArray(data)) {
      for (const item of data) {
        push(item && typeof item === 'object' ? (item as Record<string, unknown>).embedding : item);
      }
    } else {
      push(data && typeof data === 'object' ? (data as Record<string, unknown>).embedding : data);
    }
    const result = object.result;
    if (result && typeof result === 'object') {
      push((result as Record<string, unknown>).embedding);
      const resultData = (result as Record<string, unknown>).data;
      if (Array.isArray(resultData)) {
        for (const item of resultData) {
          push(item && typeof item === 'object' ? (item as Record<string, unknown>).embedding : item);
        }
      }
    }
  }

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0 && candidate.every((value) => typeof value === 'number')) {
      return candidate as number[];
    }
  }

  return undefined;
}
