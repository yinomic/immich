import { Injectable } from '@nestjs/common';
import type { JobOf } from 'src/types.js';
import { OnEvent, OnJob } from 'src/decorators.js';

import { AssetVisibility, DatabaseLock, ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { batched } from 'src/utils/misc.js';

/**
 * Cloud search indexing.
 *
 * This service used to talk to the local `machine-learning` container (CLIP).
 * It now delegates to `EmbeddingRepository`, which calls a cloud multimodal
 * embedding API: one vector per asset, stored in the vector store and queried
 * by `SearchService`.
 */
@Injectable()
export class SmartInfoService extends BaseService {
  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  async onConfigInit() {
    await this.syncIndexDimension();
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate() {
    await this.syncIndexDimension();
  }

  /**
   * The stored vectors are only meaningful for one (model, dimension) pair. If
   * the configured dimension no longer matches the table, rebuild the column
   * and drop the now-invalid vectors; the re-index job repopulates them.
   */
  private async syncIndexDimension() {
    if (!this.embeddingRepository.isEnabled()) {
      return;
    }

    const dimSize = this.embeddingRepository.getDimSize();
    if (!dimSize) {
      this.logger.log(
        `Cloud search is enabled with model '${this.embeddingRepository.getModelName()}'; ` +
          `using the dimension reported by the provider.`,
      );
      return;
    }

    await this.databaseRepository.withLock(DatabaseLock.CLIPDimSize, async () => {
      const dbDimSize = await this.databaseRepository.getDimensionSize('smart_search');
      if (dbDimSize === dimSize) {
        return;
      }

      this.logger.log(
        `Embedding dimension of model '${this.embeddingRepository.getModelName()}' is ${dimSize}, ` +
          `but the database expects ${dbDimSize}. Rebuilding the smart search index.`,
      );
      await this.databaseRepository.setDimensionSize(dimSize);
      this.logger.log(`Successfully updated smart search dimension from ${dbDimSize} to ${dimSize}.`);
    });
  }

  @OnJob({ name: JobName.SmartSearchQueueAll, queue: QueueName.SmartSearch })
  async handleQueueEncodeClip({ force }: JobOf<JobName.SmartSearchQueueAll>): Promise<JobStatus> {
    if (!this.embeddingRepository.isEnabled()) {
      return JobStatus.Skipped;
    }

    const dimSize = this.embeddingRepository.getDimSize();
    if (force && dimSize) {
      // in addition to deleting embeddings, update the dimension size in case it failed earlier
      await this.databaseRepository.setDimensionSize(dimSize);
    }

    for await (const assets of batched(this.assetJobRepository.streamForEncodeClip(force))) {
      await this.jobRepository.queueAll(assets.map((asset) => ({ name: JobName.SmartSearch, data: { id: asset.id } })));
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SmartSearch, queue: QueueName.SmartSearch })
  async handleEncodeClip({ id }: JobOf<JobName.SmartSearch>): Promise<JobStatus> {
    if (!this.embeddingRepository.isEnabled()) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForClipEncoding(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    const data = await this.storageRepository.readFile(asset.originalPath);
    const embedding = await this.embeddingRepository.embedImage({
      data,
      mimeType: mimeTypes.lookup(asset.originalPath),
    });

    if (this.databaseRepository.isBusy(DatabaseLock.CLIPDimSize)) {
      this.logger.verbose(`Waiting for embedding dimension size to be updated`);
      await this.databaseRepository.wait(DatabaseLock.CLIPDimSize);
    }

    await this.searchRepository.upsert(asset.id, JSON.stringify(embedding));

    return JobStatus.Success;
  }
}
