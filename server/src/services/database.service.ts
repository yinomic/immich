import { Injectable } from '@nestjs/common';
import { coerce, satisfies } from 'semver';
import { ErrorMessages } from 'src/constants.js';
import { OnEvent } from 'src/decorators.js';
import { BootstrapEventPriority, DatabaseLock } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';

@Injectable()
export class DatabaseService extends BaseService {
  @OnEvent({ name: 'AppBootstrap', priority: BootstrapEventPriority.DatabaseService })
  async onBootstrap() {
    const version = await this.databaseRepository.getPostgresVersion();
    const current = coerce(version);
    const postgresRange = this.databaseRepository.getPostgresVersionRange();
    if (!current || !satisfies(current, postgresRange)) {
      throw new Error(
        `Invalid PostgreSQL version. Found ${version}, but needed ${postgresRange}. Please use a supported version.`,
      );
    }

    await this.databaseRepository.withLock(DatabaseLock.Migrations, async () => {
      const preparation = [];
      const { database } = this.configRepository.getEnv();
      if (!database.skipMigrations) {
        const migrationCount = await this.databaseRepository.runMigrations();
        preparation.push(this.checkSchemaDrift());
        if (migrationCount > 0) {
          preparation.push(this.databaseRepository.vacuum({ analyze: true }));
        }
      }
      await Promise.all(preparation);
    });
  }

  private async checkSchemaDrift() {
    this.logger.log('Checking for schema drift');
    const drift = await this.databaseRepository.getSchemaDrift();
    if (drift.items.length === 0) {
      this.logger.log('No schema drift detected');
    } else {
      this.logger.warn(`${ErrorMessages.SchemaDrift} or run \`immich-admin schema-check\``);
      for (const warning of drift.asHuman()) {
        this.logger.warn(`  - ${warning}`);
      }
    }
  }
}
