import { Kysely, sql } from 'kysely';

/**
 * Cloud semantic search is gone, so the column that tracked "already embedded"
 * is no longer needed.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN IF EXISTS "embeddedAt";`.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // the feature is gone; nothing to restore
}
