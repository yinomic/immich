import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import sanitize from 'sanitize-filename';
import type { UploadFile, UploadRequest } from 'src/types.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { Asset } from 'src/database.js';
import {
  AssetBulkUploadCheckResponseDto,
  AssetMediaResponseDto,
  AssetMediaStatus,
  AssetRejectReason,
  AssetUploadAction,
} from 'src/dtos/asset-media-response.dto.js';
import {
  AssetBulkUploadCheckDto,
  AssetMediaCreateDto,
  AssetMediaOptionsDto,
  AssetMediaSize,
  UploadFieldName,
} from 'src/dtos/asset-media.dto.js';
import { AssetDownloadOriginalDto } from 'src/dtos/asset.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  AssetFileType,
  AssetType,
  AssetVisibility,
  CacheControl,
  ChecksumAlgorithm,
  JobName,
  Permission,
  StorageFolder,
} from 'src/enum.js';
import { AuthRequest } from 'src/middleware/auth.guard.js';
import { BaseService } from 'src/services/base.service.js';
import { requireUploadAccess } from 'src/utils/access.js';
import { asUploadRequest, onBeforeLink } from 'src/utils/asset.util.js';
import { isAssetChecksumConstraint } from 'src/utils/database.js';
import { ImmichFileResponse, getFileNameWithoutExtension, getFilenameExtension } from 'src/utils/file.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { fromChecksum } from 'src/utils/request.js';

export interface AssetMediaRedirectResponse {
  targetSize: AssetMediaSize | 'original';
}

/** a single push into the bucket that takes longer than this is worth a warning */
const SLOW_PUSH_MS = 10_000;

/** a whole POST /api/assets that takes longer than this is worth a warning */
const SLOW_UPLOAD_MS = 30_000;

const toMib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

@Injectable()
export class AssetMediaService extends BaseService {
  async getUploadAssetIdByChecksum(auth: AuthDto, checksum?: string): Promise<AssetMediaResponseDto | undefined> {
    if (!checksum) {
      return;
    }

    const assetId = await this.assetRepository.getUploadAssetIdByChecksum(auth.user.id, fromChecksum(checksum));
    if (!assetId) {
      return;
    }

    await this.restoreTrashedDuplicate(auth.user.id, assetId);

    return { id: assetId, status: AssetMediaStatus.DUPLICATE };
  }

  /**
   * NOTE (family fork): uploading a file that is already on the server means "I want
   * this asset in my library". When the only copy is hidden — in the trash, or with the
   * trash already emptied — put it back instead of leaving the user with an invisible
   * asset. `restoreAll` only touches assets that are not active, so this is a no-op for
   * regular duplicates.
   */
  private async restoreTrashedDuplicate(userId: string, assetId: string) {
    const restored = await this.trashRepository.restoreAll([assetId]);
    if (!restored) {
      return;
    }

    await this.eventRepository.emit('AssetRestoreAll', { assetIds: [assetId], userId });

    this.logger.log(`Restored asset ${assetId} (trashed or deleted), the same file was uploaded again`);
  }

  canUploadFile({ auth, fieldName, file, body }: UploadRequest): true {
    requireUploadAccess(auth);

    const filename = body.filename || file.originalName;

    switch (fieldName) {
      case UploadFieldName.ASSET_DATA: {
        if (mimeTypes.isAsset(filename)) {
          return true;
        }
        break;
      }

      case UploadFieldName.SIDECAR_DATA: {
        if (mimeTypes.isSidecar(filename)) {
          return true;
        }
        break;
      }

      case UploadFieldName.PROFILE_DATA: {
        if (mimeTypes.isProfile(filename)) {
          return true;
        }
        break;
      }
    }

    this.logger.error(`Unsupported file type ${filename}`);
    throw new BadRequestException(`Unsupported file type ${filename}`);
  }

  getUploadFilename({ auth, fieldName, file, body }: UploadRequest): string {
    requireUploadAccess(auth);

    const extension = getFilenameExtension(body.filename || file.originalName);
    const lookup = {
      [UploadFieldName.ASSET_DATA]: extension,
      [UploadFieldName.SIDECAR_DATA]: '.xmp',
      [UploadFieldName.PROFILE_DATA]: extension,
    };

    return sanitize(`${file.uuid}${lookup[fieldName]}`);
  }

  getUploadFolder({ auth, fieldName, file }: UploadRequest): string {
    auth = requireUploadAccess(auth);

    let folder = StorageCore.getNestedFolder(StorageFolder.Upload, auth.user.id, file.uuid);
    if (fieldName === UploadFieldName.PROFILE_DATA) {
      folder = StorageCore.getFolderLocation(StorageFolder.Profile, auth.user.id);
    }

    this.storageRepository.mkdirSync(folder);

    return folder;
  }

  async onUploadError(request: AuthRequest, file: Express.Multer.File) {
    const uploadFilename = this.getUploadFilename(asUploadRequest(request, file));
    const uploadFolder = this.getUploadFolder(asUploadRequest(request, file));
    const uploadPath = `${uploadFolder}/${uploadFilename}`;

    if (this.storageRepository.isRemote()) {
      await this.storageRepository.removeLocalFile(uploadPath);
      return;
    }

    await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [uploadPath] } });
  }

  /**
   * With object storage the file interceptor writes to a local staging folder;
   * push it into the bucket, then hand back the object key.
   *
   * The staged file is seeded into the local originals cache instead of being
   * deleted, so the jobs queued below (metadata extraction, thumbnail
   * generation) read the bytes from disk rather than downloading back what we
   * have only just uploaded.
   */
  private async stageUpload<T extends UploadFile>(upload: T): Promise<T> {
    if (!this.storageRepository.isRemote()) {
      return upload;
    }

    const key = StorageCore.toObjectKey(upload.originalPath);
    const started = performance.now();
    await this.storageRepository.putFile(key, upload.originalPath, {
      contentType: mimeTypes.lookup(upload.originalPath),
    });

    // NOTE (family fork): this push happens inside the request, so a slow bucket
    // shows up as a slow POST /api/assets — and, on the client, as a socket
    // timeout. Log it so the next such report can be answered from the logs.
    const pushMs = Math.round(performance.now() - started);
    const message = `pushed ${key} (${toMib(upload.size)}) to the bucket in ${pushMs}ms`;
    if (pushMs > SLOW_PUSH_MS) {
      this.logger.warn(`Slow upload: ${message}`);
    } else {
      this.logger.debug(`Upload: ${message}`);
    }

    await this.storageRepository.seedLocalCopy(key, upload.originalPath);

    return { ...upload, originalPath: key };
  }

  async uploadAsset(
    auth: AuthDto,
    dto: AssetMediaCreateDto,
    upload: UploadFile,
    uploadSidecar?: UploadFile,
  ): Promise<AssetMediaResponseDto> {
    let asset: Asset | undefined;
    let file = upload;
    let sidecarFile = uploadSidecar;
    const startedAt = performance.now();
    try {
      file = await this.stageUpload(upload);
      sidecarFile = uploadSidecar ? await this.stageUpload(uploadSidecar) : undefined;
      await this.requireAccess({
        auth,
        permission: Permission.AssetUpload,
        // do not need an id here, but the interface requires it
        ids: [auth.user.id],
      });

      this.requireQuota(auth, file.size);

      if (dto.livePhotoVideoId) {
        await onBeforeLink(
          { asset: this.assetRepository, event: this.eventRepository },
          { userId: auth.user.id, livePhotoVideoId: dto.livePhotoVideoId },
        );
      }

      asset = await this.assetRepository.create({
        ownerId: auth.user.id,
        libraryId: null,

        checksum: file.checksum,
        checksumAlgorithm: ChecksumAlgorithm.sha1File,
        originalPath: file.originalPath,

        fileCreatedAt: dto.fileCreatedAt,
        fileModifiedAt: dto.fileModifiedAt,
        localDateTime: dto.fileCreatedAt,

        type: mimeTypes.assetType(file.originalPath),
        isFavorite: dto.isFavorite,
        duration: dto.duration || null,
        visibility: dto.visibility ?? AssetVisibility.Timeline,
        livePhotoVideoId: dto.livePhotoVideoId,
        originalFileName: dto.filename || file.originalName,
      });

      if (dto.metadata?.length) {
        await this.assetRepository.upsertMetadata(asset.id, dto.metadata);
      }

      if (sidecarFile) {
        await this.assetRepository.upsertFile({
          assetId: asset.id,
          path: sidecarFile.originalPath,
          type: AssetFileType.Sidecar,
        });
        await this.storageRepository.utimes(sidecarFile.originalPath, new Date(), new Date(dto.fileModifiedAt));
      }
      await this.storageRepository.utimes(file.originalPath, new Date(), new Date(dto.fileModifiedAt));
      await this.assetRepository.upsertExif({
        exif: { assetId: asset.id, fileSizeInByte: file.size },
        lockedPropertiesBehavior: 'override',
      });

      await this.jobRepository.queue({ name: JobName.AssetExtractMetadata, data: { id: asset.id, source: 'upload' } });

      await this.eventRepository.emit('AssetCreate', { asset, file });

      // NOTE (family fork): the client's socket timeout is 60s, so anything
      // approaching that has to be visible in the log.
      const totalMs = Math.round(performance.now() - startedAt);
      if (totalMs > SLOW_UPLOAD_MS) {
        this.logger.warn(`Slow upload: ${file.originalName} (${toMib(file.size)}) took ${totalMs}ms`);
      } else {
        this.logger.debug(`Upload: ${file.originalName} (${toMib(file.size)}) took ${totalMs}ms`);
      }

      return { id: asset.id, status: AssetMediaStatus.CREATED };
    } catch (error: any) {
      // clean up files
      await this.jobRepository.queue({
        name: JobName.FileDelete,
        data: { files: [file.originalPath, sidecarFile?.originalPath] },
      });

      // handle duplicates with a success response
      if (isAssetChecksumConstraint(error)) {
        const duplicateId = await this.assetRepository.getUploadAssetIdByChecksum(auth.user.id, file.checksum);
        if (!duplicateId) {
          this.logger.error(`Error locating duplicate for checksum constraint`);
          throw new InternalServerErrorException();
        }

        this.logger.debug(`Duplicate asset upload rejected: existing asset ${duplicateId}`);
        await this.restoreTrashedDuplicate(auth.user.id, duplicateId);
        return { status: AssetMediaStatus.DUPLICATE, id: duplicateId };
      }

      // clean up the asset row if one was created
      if (asset) {
        await this.assetRepository.remove({ id: asset.id });
      }

      this.logger.error(`Error uploading file ${error}`, error?.stack);
      throw error;
    }
  }

  async downloadOriginal(auth: AuthDto, id: string, dto: AssetDownloadOriginalDto): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: [id] });

    const { originalPath, originalFileName, editedPath } = await this.assetRepository.getForOriginal(
      id,
      dto.edited ?? false,
    );

    const path = editedPath ?? originalPath!;

    const contentType = mimeTypes.lookup(path);
    return new ImmichFileResponse({
      path,
      fileName: getFileNameWithoutExtension(originalFileName) + getFilenameExtension(path),
      contentType,
      serveTarget: await this.storageRepository.buildServeTarget(path, { contentType }),
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async viewThumbnail(
    auth: AuthDto,
    id: string,
    dto: AssetMediaOptionsDto,
  ): Promise<ImmichFileResponse | AssetMediaRedirectResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });

    if (dto.size === AssetMediaSize.Original) {
      throw new BadRequestException('May not request original file');
    }

    const size = (dto.size ?? AssetMediaSize.THUMBNAIL) as unknown as AssetFileType;
    const { originalPath, originalFileName, type, path } = await this.assetRepository.getForThumbnail(
      id,
      size,
      dto.edited ?? false,
    );

    if (size === AssetFileType.FullSize && mimeTypes.isWebSupportedImage(originalPath) && !dto.edited) {
      // use original file for web supported images
      return { targetSize: 'original' };
    }

    if (dto.size === AssetMediaSize.FULLSIZE && !path) {
      // downgrade to preview if fullsize is not available.
      // e.g. disabled or not yet (re)generated
      return { targetSize: AssetMediaSize.PREVIEW };
    }

    // NOTE (family fork): derived images are a disposable local cache, never part
    // of the stored library. When they are disabled (IMMICH_THUMBNAILS=off) or not
    // generated yet, serve the original instead of failing, and let the
    // background job fill the cache for the next request.
    const { storage } = this.configRepository.getEnv();
    const isCached = !!path && (await this.storageRepository.checkLocalFileExists(path));
    if (!isCached || storage.thumbnails === 'off') {
      await this.jobRepository.queue({ name: JobName.AssetGenerateThumbnails, data: { id } });

      if (type === AssetType.Image) {
        // the original is an image, so it can stand in for the thumbnail
        return { targetSize: 'original' };
      }

      throw new NotFoundException('Asset thumbnail not generated yet');
    }

    const fileNameBase = getFileNameWithoutExtension(originalFileName);
    const fileName = `${fileNameBase}_${size}${getFilenameExtension(path)}`;

    const contentType = mimeTypes.lookup(path);
    return new ImmichFileResponse({
      fileName,
      path,
      contentType,
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async playbackVideo(auth: AuthDto, id: string): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });

    const asset = await this.assetRepository.getForVideo(id);

    if (!asset) {
      throw new NotFoundException('Asset not found or asset is not a video');
    }

    const filepath = asset.encodedVideoPath || asset.originalPath;
    const contentType = mimeTypes.lookup(filepath);

    return new ImmichFileResponse({
      path: filepath,
      contentType,
      // an encoded video lives in the local cache and is streamed by the server; with
      // object storage the fallback is the original, which is served via a presigned URL
      serveTarget:
        filepath === asset.originalPath
          ? await this.storageRepository.buildServeTarget(filepath, { contentType })
          : undefined,
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async bulkUploadCheck(auth: AuthDto, dto: AssetBulkUploadCheckDto): Promise<AssetBulkUploadCheckResponseDto> {
    const checksums: Buffer[] = dto.assets.map((asset) => fromChecksum(asset.checksum));
    const results = await this.assetRepository.getByChecksums(auth.user.id, checksums);
    const checksumMap: Record<string, { id: string; isTrashed: boolean }> = {};

    for (const { id, deletedAt, checksum } of results) {
      checksumMap[checksum.toString('hex')] = { id, isTrashed: !!deletedAt };
    }

    return {
      results: dto.assets.map(({ id, checksum }) => {
        const duplicate = checksumMap[fromChecksum(checksum).toString('hex')];
        if (duplicate) {
          return {
            id,
            action: AssetUploadAction.REJECT,
            reason: AssetRejectReason.DUPLICATE,
            assetId: duplicate.id,
            isTrashed: duplicate.isTrashed,
          };
        }

        return {
          id,
          action: AssetUploadAction.ACCEPT,
        };
      }),
    };
  }

  private requireQuota(auth: AuthDto, size: number) {
    if (auth.user.quotaSizeInBytes !== null && auth.user.quotaSizeInBytes < auth.user.quotaUsageInBytes + size) {
      throw new BadRequestException('Quota has been exceeded!');
    }
  }
}
