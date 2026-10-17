import { Injectable, NotAcceptableException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { AuthService } from 'src/services/auth.service.js';

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

@Injectable()
export class ApiService {
  constructor(
    private authService: AuthService,
    private configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(ApiService.name);
  }

  ssr() {
    const { resourcePaths, storage } = this.configRepository.getEnv();

    let index = '';
    try {
      index = readFileSync(resourcePaths.web.indexHtml).toString();
    } catch {
      this.logger.warn(`Unable to open ${resourcePaths.web.indexHtml}, skipping SSR.`);
    }

    return (request: Request, res: Response, next: NextFunction) => {
      const method = request.method.toLowerCase();
      if (
        request.url.startsWith('/api') ||
        (method !== 'get' && method !== 'head') ||
        request.url.startsWith('/share')
      ) {
        return next();
      }

      const responseType = request.accepts('text/html');
      if (!responseType) {
        throw new NotAcceptableException(
          `The route ${request.path} was requested as ${request.header('accept')}, but only returns text/html`,
        );
      }

      // NOTE (family fork): shared links are gone, so the SSR handler no longer
      // renders OpenGraph tags. It now injects the ICP filing info instead, which the
      // auth pages read from the meta tags (no API or SDK change needed).
      res
        .status(200)
        .type(responseType)
        .header('Cache-Control', 'no-store')
        .send(this.injectFilingInfo(index, storage.filing));
    };
  }

  /** Inject the configured ICP filing info as meta tags into the served index.html */
  private injectFilingInfo(html: string, filing: { info?: string; url: string }): string {
    if (!filing.info) {
      return html;
    }

    const tags = [
      `<meta name="immich-filing-info" content="${escapeHtml(filing.info)}" />`,
      `<meta name="immich-filing-url" content="${escapeHtml(filing.url)}" />`,
    ].join('\n    ');

    const injection = `  ${tags}\n  </head>`;
    return html.includes('</head>') ? html.replace('</head>', () => injection) : `${tags}\n${html}`;
  }
}
