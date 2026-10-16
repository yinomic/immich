import { createHash } from 'node:crypto';
import { EmbeddingInput, EmbeddingProvider } from 'src/repositories/embedding/embedding.provider.js';

/**
 * Deterministic, dependency-free embedding provider used for development and
 * tests when no cloud API key is available.
 *
 * It deliberately has NO semantic meaning: "search quality" can only be judged
 * with a real provider (`ark` / `tencent`). What it does give you is a fully
 * working pipeline (upload -> embed -> index -> query -> results) plus stable
 * results across restarts, so plumbing and UI can be verified offline.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimSize: number;

  constructor(dimSize = 512, model = 'mock-embedding') {
    this.dimSize = dimSize;
    this.model = model;
  }

  embedImage(input: EmbeddingInput): Promise<number[]> {
    const seed = input.data ?? Buffer.from(input.url ?? '');
    return Promise.resolve(this.vector(seed));
  }

  embedText(text: string): Promise<number[]> {
    return Promise.resolve(this.vector(Buffer.from(text.trim().toLowerCase())));
  }

  private vector(seed: Buffer): number[] {
    const output: number[] = [];
    let counter = 0;

    while (output.length < this.dimSize) {
      const digest = createHash('sha256').update(seed).update(String(counter++)).digest();
      for (let i = 0; i < digest.length && output.length < this.dimSize; i += 2) {
        output.push(digest.readInt16BE(i) / 32_768);
      }
    }

    const norm = Math.sqrt(output.reduce((sum, value) => sum + value * value, 0)) || 1;
    return output.map((value) => value / norm);
  }
}
