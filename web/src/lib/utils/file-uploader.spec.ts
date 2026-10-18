import {
  AssetMediaStatus,
  AssetUploadAction,
  checkBulkUpload,
  restoreAssets,
  type AssetMediaResponseDto,
  type UserAdminResponseDto,
} from '@immich/sdk';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { uploadManager } from '$lib/managers/upload-manager.svelte';
import { uploadAssetsStore } from '$lib/stores/upload';
import { UploadState } from '$lib/types';
import * as utils from '$lib/utils';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { fileUploadHandler } from './file-uploader';
import { hashFile } from './hash-file';

vi.mock('@immich/sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...original,
    checkBulkUpload: vi.fn().mockResolvedValue({ results: [{ id: 'test.jpg', action: 'accept' }] }),
    restoreAssets: vi.fn().mockResolvedValue({ count: 0 }),
  };
});

vi.mock('./hash-file', () => ({ hashFile: vi.fn().mockResolvedValue('a'.repeat(40)) }));

describe('fileUploader error handling', () => {
  const mockFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
  const mockUserObject = { id: 'user-123', email: 'test@example.com' } as UserAdminResponseDto;
  const mockError = new Error('Upload failed');
  const mockUploadResponse = { id: 'mock-id', status: AssetMediaStatus.Created } as AssetMediaResponseDto;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(uploadManager, 'getExtensions').mockReturnValue(['.jpg']);
    uploadAssetsStore.reset();
    authManager.reset();
  });

  for (const [name, mockUser] of [
    ['logged-in users', true],
    ['anonymous users', false],
  ] as const) {
    describe(`for ${name}`, () => {
      beforeEach(() => {
        if (mockUser) {
          authManager.setUser(mockUserObject);
        }
      });

      it(`should transition successful uploads to done`, async () => {
        vi.spyOn(utils, 'uploadRequest').mockResolvedValue({ status: 200, data: mockUploadResponse });

        await fileUploadHandler({ files: [mockFile] });

        const items = get(uploadAssetsStore);
        expect(items.length).toBe(1);
        expect(items[0].state).toBe(UploadState.DONE);
      });

      it('should capture errors', async () => {
        vi.spyOn(utils, 'uploadRequest').mockRejectedValue(mockError);

        await fileUploadHandler({ files: [mockFile] });

        const items = get(uploadAssetsStore);
        expect(items.length).toBe(1);
        expect(items[0].state).toBe(UploadState.ERROR);
      });
    });
  }

  it('should suppress errors on logout', async () => {
    authManager.setUser(mockUserObject);
    authManager.setPreferences(preferencesFactory.build());
    vi.spyOn(utils, 'uploadRequest').mockImplementationOnce(() => {
      authManager.reset();
      return Promise.reject(mockError);
    });

    await fileUploadHandler({ files: [mockFile] });

    const items = get(uploadAssetsStore);
    expect(items.length).toBe(1);
    expect(items[0].state).toBe(UploadState.STARTED);
  });

  describe('duplicate handling', () => {
    beforeEach(() => {
      authManager.setUser(mockUserObject);
      authManager.setPreferences(preferencesFactory.build());
      vi.mocked(hashFile).mockResolvedValue('a'.repeat(40));
    });

    it('should skip an asset that is already on the server', async () => {
      vi.mocked(checkBulkUpload).mockResolvedValue({
        results: [
          { id: 'test.jpg', action: AssetUploadAction.Reject, reason: 'duplicate' as never, assetId: 'asset-1' },
        ],
      });

      await fileUploadHandler({ files: [mockFile] });

      const items = get(uploadAssetsStore);
      expect(items[0].state).toBe(UploadState.DUPLICATED);
      expect(items[0].restored).toBeFalsy();
      expect(vi.mocked(restoreAssets)).not.toHaveBeenCalled();
      expect(vi.mocked(utils.uploadRequest)).not.toHaveBeenCalled();
    });

    it('should restore the asset when the duplicate is only in the trash', async () => {
      vi.mocked(checkBulkUpload).mockResolvedValue({
        results: [
          {
            id: 'test.jpg',
            action: AssetUploadAction.Reject,
            reason: 'duplicate' as never,
            assetId: 'asset-1',
            isTrashed: true,
          },
        ],
      });
      vi.mocked(restoreAssets).mockResolvedValue({ count: 1 });

      await fileUploadHandler({ files: [mockFile] });

      expect(vi.mocked(restoreAssets)).toHaveBeenCalledWith({ bulkIdsDto: { ids: ['asset-1'] } });

      const items = get(uploadAssetsStore);
      expect(items[0].state).toBe(UploadState.DUPLICATED);
      expect(items[0].restored).toBe(true);
      expect(items[0].isTrashed).toBe(false);
      expect(get(uploadAssetsStore.stats).restored).toBe(1);
      expect(vi.mocked(utils.uploadRequest)).not.toHaveBeenCalled();
    });

    it('should keep the duplicate in the trash when restoring fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(checkBulkUpload).mockResolvedValue({
        results: [
          {
            id: 'test.jpg',
            action: AssetUploadAction.Reject,
            reason: 'duplicate' as never,
            assetId: 'asset-1',
            isTrashed: true,
          },
        ],
      });
      vi.mocked(restoreAssets).mockRejectedValue(mockError);

      await fileUploadHandler({ files: [mockFile] });

      const items = get(uploadAssetsStore);
      expect(items[0].state).toBe(UploadState.DUPLICATED);
      expect(items[0].restored).toBeFalsy();
      expect(items[0].isTrashed).toBe(true);
    });
  });
});
