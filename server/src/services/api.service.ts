import { Injectable, NotAcceptableException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { AuthService } from 'src/services/auth.service.js';

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
    const { resourcePaths } = this.configRepository.getEnv();

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
      // renders OpenGraph tags for /share and /s routes.
      res.status(200).type(responseType).header('Cache-Control', 'no-store').send(index);
    };
  }
}
