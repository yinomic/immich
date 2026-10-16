import { Injectable } from '@nestjs/common';
import { coerce, eq, gt, lt, satisfies } from 'semver';
import { ErrorMessages } from 'src/constants.js';
import { OnEvent } from 'src/decorators.js';
import { BootstrapEventPriority, DatabaseLock } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';

type CreateFailedArgs = { name: string; extension: string };
type UpdateFailedArgs = { name: string; extension: string; availableVersion: string };
type DropFailedArgs = { name: string; extension: string };
type NightlyVersionArgs = { name: string; extension: string; version: string };
type OutOfRangeArgs = { name: string; extension: string; version: string; range: string };
type InvalidDowngradeArgs = { name: string; extension: string; installedVersion: string; availableVersion: string };

const messages = {
  notInstalled: (name: string) =>
    `The ${name} extension is not available in this Postgres instance.
    If using a container image, ensure the image has the extension installed.`,
  nightlyVersion: ({ name, extension, version }: NightlyVersionArgs) => `
    The ${name} extension version is ${version}, which means it is a nightly release.

    Please run 'DROP EXTENSION IF EXISTS ${extension}' and switch to a release version.
    See https://docs.immich.app/guides/database-queries for how to query the database.`,
  outOfRange: ({ name, version, range }: OutOfRangeArgs) =>
    `The ${name} extension version is ${version}, but Immich only supports ${range}.
    Please change ${name} to a compatible version in the Postgres instance.`,
  createFailed: ({ name, extension }: CreateFailedArgs) =>
    `Failed to activate ${name} extension.
    Please ensure the Postgres instance has ${name} installed.

    If the Postgres instance already has ${name} installed, Immich may not have the necessary permissions to activate it.
    In this case, please run 'CREATE EXTENSION IF NOT EXISTS ${extension} CASCADE' manually as a superuser.
    See https://docs.immich.app/guides/database-queries for how to query the database.`,
  updateFailed: ({ name, extension, availableVersion }: UpdateFailedArgs) =>
    `The ${name} extension can be updated to ${availableVersion}.
    Immich attempted to update the extension, but failed to do so.
    This may be because Immich does not have the necessary permissions to update the extension.

    Please run 'ALTER EXTENSION ${extension} UPDATE' manually as a superuser.
    See https://docs.immich.app/guides/database-queries for how to query the database.`,
  dropFailed: ({ name, extension }: DropFailedArgs) =>
    `The ${name} extension is no longer needed, but could not be dropped.
    This may be because Immich does not have the necessary permissions to drop the extension.

    Please run 'DROP EXTENSION ${extension};' manually as a superuser.
    See https://docs.immich.app/guides/database-queries for how to query the database.`,
  invalidDowngrade: ({ name, installedVersion, availableVersion }: InvalidDowngradeArgs) =>
    `The database currently has ${name} ${installedVersion} activated, but the Postgres instance only has ${availableVersion} available.
    This most likely means the extension was downgraded.
    If ${name} ${installedVersion} is compatible with Immich, please ensure the Postgres instance has this available.`,
};

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
