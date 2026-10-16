import { Kysely, sql } from 'kysely';

/**
 * The family fork has no sharing features any more, so the shared link tables
 * are dropped instead of being carried along.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "shared_link_asset";`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_link";`.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // the feature is gone; there is nothing to restore
}
