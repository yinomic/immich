import { Injectable } from '@nestjs/common';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { ArkEmbeddingProvider } from 'src/repositories/embedding/ark-embedding.provider.js';
import { EmbeddingInput, EmbeddingProvider } from 'src/repositories/embedding/embedding.provider.js';
import { MockEmbeddingProvider } from 'src/repositories/embedding/mock-embedding.provider.js';
import { TencentEmbeddingProvider } from 'src/repositories/embedding/tencent-embedding.provider.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

const DEFAULT_MODELS: Record<string, string> = {
  ark: 'doubao-embedding-vision-250615',
  tencent: 'kinfra-vl-embedding-2b',
  mock: 'mock-embedding',
};

/**
 * Single entry point for cloud embedding, replacing `MachineLearningRepository`.
 *
 * Nothing in the app talks to a model provider directly: services call
 * `embedImage` / `embedText` and get a vector back. Which provider is used is
 * decided by `IMMICH_CLOUD_SEARCH_*` environment variables.
 */
@Injectable()
export class EmbeddingRepository {
  private provider?: EmbeddingProvider;

  constructor(
    private configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(EmbeddingRepository.name);
  }

  isEnabled(): boolean {
    return this.configRepository.getEnv().search.enabled;
  }

  getModelName(): string {
    const { provider, model } = this.configRepository.getEnv().search;
    return model ?? DEFAULT_MODELS[provider] ?? provider;
  }

  /** Configured dimension, if any. `undefined` means "trust the provider response". */
  getDimSize(): number | undefined {
    return this.configRepository.getEnv().search.dimSize;
  }

  embedImage(input: EmbeddingInput): Promise<number[]> {
    return this.getProvider().embedImage(input);
  }

  embedText(text: string): Promise<number[]> {
    return this.getProvider().embedText(text);
  }

  private getProvider(): EmbeddingProvider {
    if (this.provider) {
      return this.provider;
    }

    const { provider, apiKey, baseUrl, dimSize, timeoutMs } = this.configRepository.getEnv().search;
    const model = this.getModelName();

    switch (provider) {
      case 'mock': {
        this.provider = new MockEmbeddingProvider(dimSize ?? 512, model);
        break;
      }
      case 'tencent': {
        if (!apiKey) {
          throw new Error('IMMICH_CLOUD_SEARCH_API_KEY is required for the tencent provider');
        }
        this.provider = new TencentEmbeddingProvider({ apiKey, baseUrl, model, dimSize, timeoutMs }, this.logger);
        break;
      }
      default: {
        if (!apiKey) {
          throw new Error('IMMICH_CLOUD_SEARCH_API_KEY is required for the ark provider');
        }
        this.provider = new ArkEmbeddingProvider({ apiKey, baseUrl, model, dimSize, timeoutMs }, this.logger);
      }
    }

    this.logger.log(`Using cloud embedding provider '${provider}' with model '${model}'`);
    return this.provider;
  }
}
