import { vitest } from 'vitest';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { LocalObjectStorage } from 'src/repositories/object-storage/local-object-storage.js';
import { ObjectStorageRepository } from 'src/repositories/object-storage.repository.js';
import { mockEnvData } from 'test/repositories/config.repository.mock.js';
import { automock } from 'test/utils.js';

const setup = (softDeleteOnly: boolean) => {
  const config = { getEnv: () => mockEnvData({ storage: { ...mockEnvData({}).storage, softDeleteOnly } }) };
  // eslint-disable-next-line no-sparse-arrays
  const logger = automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false });
  const sut = new ObjectStorageRepository(config as never, logger);

  return { sut, logger };
};

describe(ObjectStorageRepository.name, () => {
  it('should keep the objects when soft delete only is on', async () => {
    const { sut, logger } = setup(true);
    const storage = sut as unknown as { storage?: LocalObjectStorage };
    const deleteSpy = vitest.fn();
    storage.storage = { delete: deleteSpy, isRemote: () => true } as never;

    await sut.delete(['upload/a.jpg', 'upload/b.jpg']);

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Soft delete only: keeping 2 object(s)'));
  });

  it('should delegate the deletion when the switch is off', async () => {
    const { sut } = setup(false);
    const storage = sut as unknown as { storage?: LocalObjectStorage };
    const deleteSpy = vitest.fn().mockResolvedValue(undefined);
    storage.storage = { delete: deleteSpy, isRemote: () => true } as never;

    await sut.delete(['upload/a.jpg']);

    expect(deleteSpy).toHaveBeenCalledWith(['upload/a.jpg']);
  });
});
