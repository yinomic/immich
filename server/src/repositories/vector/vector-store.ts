/**
 * Vector store abstraction.
 *
 * Immich used to keep embeddings in Postgres (`smart_search`, pgvector /
 * vectorchord) and search them with `embedding <=> $1`. This fork instead keeps
 * them in a dedicated store so that:
 *   - the vector database can live in the cloud (VikingDB / VDB) as asked, and
 *   - Postgres can be a stock image (no vector extension, no custom image).
 *
 * Distances are **cosine distances** (0 = identical, 2 = opposite), matching
 * pgvector's `<=>` operator, so the ranking semantics of the search code do not
 * change when the backend is swapped.
 */
export interface VectorMatch {
  assetId: string;
  distance: number;
}

export interface VectorSearchOptions {
  /** maximum number of matches to return */
  topK: number;
  /** drop matches with a distance above this threshold */
  maxDistance?: number;
  /** restrict the search to these assets (used as a pre-filter) */
  assetIds?: string[];
}

export interface VectorStore {
  /** Insert or replace the vector for an asset. */
  upsert(assetId: string, vector: number[]): Promise<void>;

  /** Remove vectors for the given assets (deletions, trash, re-index). */
  delete(assetIds: string[]): Promise<void>;

  /** Read back a single vector (used by "search by image"). */
  get(assetId: string): Promise<number[] | undefined>;

  /** Nearest neighbours of `vector`, closest first. */
  search(vector: number[], options: VectorSearchOptions): Promise<VectorMatch[]>;

  /** Drop every vector (model or dimension change). */
  clear(): Promise<void>;
}

export const cosineDistance = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 1;
  }

  return 1 - dot / denominator;
};

export const vectorLiteral = (vector: number[]): string => `[${vector.join(',')}]`;
