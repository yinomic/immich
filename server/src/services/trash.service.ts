import { Injectable } from '@nestjs/common';
import { OnEvent, OnJob } from 'src/decorators.js';
import { BulkIdsDto } from 'src/dtos/asset-ids.response.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { TrashResponseDto } from 'src/dtos/trash.dto.js';
import { JobName, JobStatus, Permission, QueueName } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { batched } from 'src/utils/misc.js';

@Injectable()
export class TrashService extends BaseService {
  async restoreAssets(auth: AuthDto, dto: BulkIdsDto): Promise<TrashResponseDto> {
    const { ids } = dto;
    if (ids.length === 0) {
      return { count: 0 };
    }

    await this.requireAccess({ auth, permission: Permission.AssetDelete, ids });
    const count = await this.trashRepository.restoreAll(ids);
    await this.eventRepository.emit('AssetRestoreAll', { assetIds: ids, userId: auth.user.id });

    this.logger.log(`Restored ${count} asset(s) from trash`);

    // NOTE (family fork): report what was actually brought back, not what was asked for, so
    // clients can tell "restored" from "there was nothing to restore".
    return { count };
  }

  async restore(auth: AuthDto): Promise<TrashResponseDto> {
    const count = await this.trashRepository.restore(auth.user.id);
    if (count > 0) {
      this.logger.log(`Restored ${count} asset(s) from trash`);
    }
    return { count };
  }

  async empty(auth: AuthDto): Promise<TrashResponseDto> {
    const count = await this.trashRepository.empty(auth.user.id);
    if (count > 0) {
      await this.jobRepository.queue({ name: JobName.AssetEmptyTrash, data: {} });
    }
    return { count };
  }

  @OnEvent({ name: 'AssetDeleteAll' })
  async onAssetsDelete() {
    await this.jobRepository.queue({ name: JobName.AssetEmptyTrash, data: {} });
  }

  @OnJob({ name: JobName.AssetEmptyTrash, queue: QueueName.BackgroundTask })
  async handleEmptyTrash() {
    if (this.configRepository.getEnv().storage.softDeleteOnly) {
      // NOTE (family fork): emptying the trash would remove the assets for good
      this.logger.log('Soft delete only: skipping trash cleanup, nothing is ever removed');
      return JobStatus.Skipped;
    }

    let count = 0;
    for await (const assets of batched(this.trashRepository.getDeletedIds())) {
      await this.jobRepository.queueAll(
        assets.map(({ id }) => ({ name: JobName.AssetDelete, data: { id, deleteOnDisk: true } })),
      );
      count += assets.length;
    }

    this.logger.log(`Queued ${count} asset(s) for deletion from the trash`);

    return JobStatus.Success;
  }
}
