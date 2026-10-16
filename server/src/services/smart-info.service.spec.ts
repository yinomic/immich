import { AssetVisibility, ImmichWorker, JobName, JobStatus, SystemMetadataKey } from 'src/enum.js';
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
    mocks.systemMetadata.get.mockResolvedValue({ model: 'mock-embedding', dimSize: 512 });
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('onConfigInit', () => {
    it('should do nothing if cloud search is disabled', async () => {
      mocks.embedding.isEnabled.mockReturnValue(false);

      await sut.onConfigInit();

      expect(mocks.systemMetadata.get).not.toHaveBeenCalled();
      expect(mocks.vectorStore.clear).not.toHaveBeenCalled();
    });

    it('should record the index state on first run', async () => {
      mocks.systemMetadata.get.mockResolvedValue(null);

      await sut.onConfigInit();

      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.CloudSearchIndex, {
        model: 'mock-embedding',
        dimSize: 512,
      });
      expect(mocks.vectorStore.clear).not.toHaveBeenCalled();
    });

    it('should keep the index when model and dimension are unchanged', async () => {
      await sut.onConfigInit();

      expect(mocks.vectorStore.clear).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should clear the index and queue a re-index when the model changed', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ model: 'ViT-B-32__openai', dimSize: 512 });

      await sut.onConfigInit();

      expect(mocks.vectorStore.clear).toHaveBeenCalled();
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.CloudSearchIndex, {
        model: 'mock-embedding',
        dimSize: 512,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SmartSearchQueueAll, data: { force: true } });
    });

    it('should clear the index and queue a re-index when the dimension changed', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ model: 'mock-embedding', dimSize: 768 });

      await sut.onConfigInit();

      expect(mocks.vectorStore.clear).toHaveBeenCalled();
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SmartSearchQueueAll, data: { force: true } });
    });
  });

  describe('handleQueueEncodeClip', () => {
    it('should do nothing if cloud search is disabled', async () => {
      mocks.embedding.isEnabled.mockReturnValue(false);

      expect(await sut.handleQueueEncodeClip({})).toEqual(JobStatus.Skipped);

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should queue the assets without embeddings', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForEncodeClip.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueueEncodeClip({ force: false })).toEqual(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.SmartSearch, data: { id: asset.id } }]);
      expect(mocks.vectorStore.clear).not.toHaveBeenCalled();
    });

    it('should discard the index when forcing a full re-index', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForEncodeClip.mockReturnValue(makeStream([asset]));

      expect(await sut.handleQueueEncodeClip({ force: true })).toEqual(JobStatus.Success);

      expect(mocks.vectorStore.clear).toHaveBeenCalled();
      expect(mocks.assetJob.streamForEncodeClip).toHaveBeenCalledWith(true);
    });
  });

  describe('handleEncodeClip', () => {
    it('should do nothing if cloud search is disabled', async () => {
      mocks.embedding.isEnabled.mockReturnValue(false);

      expect(await sut.handleEncodeClip({ id: '123' })).toEqual(JobStatus.Skipped);

      expect(mocks.assetJob.getForClipEncoding).not.toHaveBeenCalled();
    });

    it('should fail if the asset could not be found', async () => {
      mocks.assetJob.getForClipEncoding.mockResolvedValue(void 0);

      expect(await sut.handleEncodeClip({ id: 'non-existent' })).toEqual(JobStatus.Failed);

      expect(mocks.vectorStore.upsert).not.toHaveBeenCalled();
    });

    it('should skip invisible assets', async () => {
      const asset = AssetFactory.from({ visibility: AssetVisibility.Hidden }).build();
      mocks.assetJob.getForClipEncoding.mockResolvedValue(asset);

      expect(await sut.handleEncodeClip({ id: asset.id })).toEqual(JobStatus.Skipped);

      expect(mocks.vectorStore.upsert).not.toHaveBeenCalled();
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
      expect(mocks.vectorStore.upsert).toHaveBeenCalledWith(asset.id, [0.01, 0.02, 0.03]);
    });
  });
});
