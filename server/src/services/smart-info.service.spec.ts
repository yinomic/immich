import { AssetVisibility, ImmichWorker, JobName, JobStatus } from 'src/enum.js';
import { SmartInfoService } from 'src/services/smart-info.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

describe(SmartInfoService.name, () => {
  let sut: SmartInfoService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SmartInfoService));

    mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
    mocks.embedding.isEnabled.mockReturnValue(true);
    mocks.embedding.getModelName.mockReturnValue('mock-embedding');
    mocks.embedding.getDimSize.mockReturnValue(512);
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('onConfigInit', () => {
    it('should return if cloud search is disabled', async () => {
      mocks.embedding.isEnabled.mockReturnValue(false);

      await sut.onConfigInit();

      expect(mocks.database.getDimensionSize).not.toHaveBeenCalled();
      expect(mocks.database.setDimensionSize).not.toHaveBeenCalled();
    });

    it('should not touch the database if the provider reports the dimension itself', async () => {
      mocks.embedding.getDimSize.mockReturnValue(undefined);

      await sut.onConfigInit();

      expect(mocks.database.getDimensionSize).not.toHaveBeenCalled();
      expect(mocks.database.setDimensionSize).not.toHaveBeenCalled();
    });

    it('should return if the configured and stored dimension size are equal', async () => {
      mocks.database.getDimensionSize.mockResolvedValue(512);

      await sut.onConfigInit();

      expect(mocks.database.getDimensionSize).toHaveBeenCalledTimes(1);
      expect(mocks.database.setDimensionSize).not.toHaveBeenCalled();
    });

    it('should rebuild the index if the dimension changed', async () => {
      mocks.database.getDimensionSize.mockResolvedValue(768);

      await sut.onConfigInit();

      expect(mocks.database.setDimensionSize).toHaveBeenCalledWith(512);
    });
  });

  describe('onConfigUpdate', () => {
    it('should return if cloud search is disabled', async () => {
      mocks.embedding.isEnabled.mockReturnValue(false);

      await sut.onConfigUpdate();

      expect(mocks.database.getDimensionSize).not.toHaveBeenCalled();
      expect(mocks.database.setDimensionSize).not.toHaveBeenCalled();
    });

    it('should rebuild the index if the dimension changed', async () => {
      mocks.database.getDimensionSize.mockResolvedValue(512);
      mocks.embedding.getDimSize.mockReturnValue(2048);

      await sut.onConfigUpdate();

      expect(mocks.database.setDimensionSize).toHaveBeenCalledWith(2048);
    });
  });

  describe('handleQueueEncodeClip', () => {
    it('should do nothing if cloud search is disabled', async () => {
      mocks.embedding.isEnabled.mockReturnValue(false);

      expect(await sut.handleQueueEncodeClip({})).toEqual(JobStatus.Skipped);

      expect(mocks.database.setDimensionSize).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should queue the assets without embeddings', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForEncodeClip.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueueEncodeClip({ force: false })).toEqual(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.SmartSearch, data: { id: asset.id } }]);
      expect(mocks.assetJob.streamForEncodeClip).toHaveBeenCalledWith(false);
      expect(mocks.database.setDimensionSize).not.toHaveBeenCalled();
    });

    it('should reset the dimension when forcing a full re-index', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForEncodeClip.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueueEncodeClip({ force: true })).toEqual(JobStatus.Success);

      expect(mocks.assetJob.streamForEncodeClip).toHaveBeenCalledWith(true);
      expect(mocks.database.setDimensionSize).toHaveBeenCalledExactlyOnceWith(512);
    });
  });

  describe('handleEncodeClip', () => {
    it('should do nothing if cloud search is disabled', async () => {
      mocks.embedding.isEnabled.mockReturnValue(false);

      expect(await sut.handleEncodeClip({ id: '123' })).toEqual(JobStatus.Skipped);

      expect(mocks.assetJob.getForClipEncoding).not.toHaveBeenCalled();
      expect(mocks.embedding.embedImage).not.toHaveBeenCalled();
    });

    it('should fail if the asset could not be found', async () => {
      mocks.assetJob.getForClipEncoding.mockResolvedValue(void 0);

      expect(await sut.handleEncodeClip({ id: 'non-existent' })).toEqual(JobStatus.Failed);

      expect(mocks.embedding.embedImage).not.toHaveBeenCalled();
      expect(mocks.search.upsert).not.toHaveBeenCalled();
    });

    it('should skip invisible assets', async () => {
      const asset = AssetFactory.from({ visibility: AssetVisibility.Hidden }).build();
      mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);

      expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Skipped);

      expect(mocks.embedding.embedImage).not.toHaveBeenCalled();
      expect(mocks.search.upsert).not.toHaveBeenCalled();
    });

    it('should embed the original file and store the vector', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);
      mocks.storage.readFile.mockResolvedValue(Buffer.from('original-bytes'));
      mocks.embedding.embedImage.mockResolvedValue([0.01, 0.02, 0.03]);

      expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.storage.readFile).toHaveBeenCalledWith(asset.originalPath);
      expect(mocks.embedding.embedImage).toHaveBeenCalledWith({
        data: Buffer.from('original-bytes'),
        mimeType: 'image/jpeg',
      });
      expect(mocks.search.upsert).toHaveBeenCalledWith(asset.id, '[0.01,0.02,0.03]');
    });

    it('should wait for the dimension lock before writing', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);
      mocks.storage.readFile.mockResolvedValue(Buffer.from('original-bytes'));
      mocks.embedding.embedImage.mockResolvedValue([0.01, 0.02, 0.03]);
      mocks.database.isBusy.mockReturnValue(true);

      expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.database.wait).toHaveBeenCalled();
      expect(mocks.search.upsert).toHaveBeenCalledWith(asset.id, '[0.01,0.02,0.03]');
    });
  });
});
