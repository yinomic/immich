import { Kysely, sql } from 'kysely';

/**
 * The family album fork has no likes/comments (activity) and no partner
 * sharing, and its asset job status no longer tracks face recognition or
 * duplicate detection. The tables and columns that only served those features
 * are dropped here.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "activity";`.execute(db);
  await sql`DROP TABLE IF EXISTS "partner";`.execute(db);
  await sql`DROP TABLE IF EXISTS "partner_audit";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS partner_delete_audit();`.execute(db);

  await sql`ALTER TABLE "album" DROP COLUMN IF EXISTS "isActivityEnabled";`.execute(db);
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN IF EXISTS "facesRecognizedAt";`.execute(db);
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN IF EXISTS "duplicatesDetectedAt";`.execute(db);

  // the override registry still lists the functions/indexes/triggers that only
  // existed for the dropped tables; without this the drift check keeps warning
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_partner_delete_audit',
    'index_activity_like_idx',
    'trigger_activity_updatedAt',
    'trigger_partner_delete_audit',
    'trigger_partner_updatedAt'
  );`.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // the features are gone; there is nothing to restore
}
