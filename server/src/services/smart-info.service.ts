import { Injectable } from '@nestjs/common';
import type { JobOf } from 'src/types.js';
import { OnEvent, OnJob } from 'src/decorators.js';

import { AssetVisibility, ImmichWorker, JobName, JobStatus, QueueName, SystemMetadataKey } from 'src/enum.js';
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
    await this.syncIndexState();
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate() {
    await this.syncIndexState();
  }

  /**
   * Stored vectors are only meaningful for one (model, dimension) pair. When
   * either changes, drop the index — the re-index job repopulates it, and
   * comparing against a stale vector space would silently return nonsense.
   */
  private async syncIndexState() {
    if (!this.embeddingRepository.isEnabled()) {
      return;
    }

    const model = this.embeddingRepository.getModelName();
    const dimSize = this.embeddingRepository.getDimSize();
    const stored = await this.systemMetadataRepository.get(SystemMetadataKey.CloudSearchIndex);

    if (!stored) {
      this.logger.log(`Cloud search index initialised with model '${model}'`);
      await this.systemMetadataRepository.set(SystemMetadataKey.CloudSearchIndex, { model, dimSize });
      return;
    }

    if (stored.model === model && stored.dimSize === dimSize) {
      return;
    }

    this.logger.warn(
      `Embedding model changed from '${stored.model}' (${stored.dimSize ?? '?'}d) to '${model}' ` +
        `(${dimSize ?? '?'}d): clearing the vector index, a full re-index is required.`,
    );
    await this.vectorStoreRepository.clear();
    await this.systemMetadataRepository.set(SystemMetadataKey.CloudSearchIndex, { model, dimSize });
    await this.jobRepository.queue({ name: JobName.SmartSearchQueueAll, data: { force: true } });
  }

  @OnJob({ name: JobName.SmartSearchQueueAll, queue: QueueName.SmartSearch })
  async handleQueueEncodeClip({ force }: JobOf<JobName.SmartSearchQueueAll>): Promise<JobStatus> {
    if (!this.embeddingRepository.isEnabled()) {
      return JobStatus.Skipped;
    }

    if (force) {
      // a forced re-index discards the whole index, including stale entries
      await this.vectorStoreRepository.clear();
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

    await this.vectorStoreRepository.upsert(asset.id, embedding);
    await this.assetRepository.upsertJobStatus({ assetId: asset.id, embeddedAt: new Date() });

    return JobStatus.Success;
  }
}
