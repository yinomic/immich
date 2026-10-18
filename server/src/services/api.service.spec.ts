import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { excludePaths } from 'src/constants.js';
import { ApiService } from 'src/services/api.service.js';

/**
 * The HTML fallback must let the paths in `excludePaths` through, otherwise
 * `/.well-known/immich` is answered with the web app and the mobile app cannot
 * discover the "/api" prefix of the API (every request it makes then 404s).
 */
const request = (url: string, method = 'GET', accept = 'text/html') =>
  ({
    url,
    path: url,
    method,
    header: () => accept,
    accepts: () => (accept === 'text/html' && 'text/html') as string | false,
    host: 'example.test',
    protocol: 'https',
  }) as never;

describe(ApiService.name, () => {
  const directory = mkdtempSync(join(tmpdir(), 'immich-ssr-'));
  const indexHtml = join(directory, 'index.html');
  writeFileSync(indexHtml, '<html><head></head><body>app</body></html>');

  const setup = (filingInfo?: string) => {
    const configRepository = {
      getEnv: () => ({ resourcePaths: { web: { indexHtml } }, storage: { filing: { info: filingInfo, url: '' } } }),
    };
    const sut = new ApiService({} as never, configRepository as never, { setContext: () => {} } as never);
    return sut.ssr(excludePaths);
  };

  it('steps aside for the well-known endpoint so the api route can answer it', () => {
    const next = vi.fn();
    const res = { status: vi.fn(), type: vi.fn(), header: vi.fn(), send: vi.fn() };
    setup()(request('/.well-known/immich'), res as never, next);
    expect(next).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('steps aside for every other excluded path', () => {
    for (const path of excludePaths) {
      const next = vi.fn();
      setup()(request(path), { status: vi.fn(), type: vi.fn(), header: vi.fn(), send: vi.fn() } as never, next);
      expect(next, path).toHaveBeenCalled();
    }
  });

  it('steps aside for api requests and non-html methods', () => {
    const next = vi.fn();
    setup()(
      request('/api/server/ping'),
      { status: vi.fn(), type: vi.fn(), header: vi.fn(), send: vi.fn() } as never,
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('still serves the web app for normal routes and injects the filing info', () => {
    const next = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    setup('京ICP备00000000号')(request('/photos'), res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('immich-filing-info'));
  });
});
