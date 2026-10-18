import { Kysely, sql } from 'kysely';

/**
 * Duplicate detection and multi-user album sharing are gone from this build, so
 * the duplicate id column is dropped and album_user.role defaults to the owner.
 *
 * The role enum itself is deliberately left alone: PostgreSQL cannot remove
 * enum values in place, and recreating the type makes postgres.js reuse the
 * stale type cache of the process that ran the migration, which makes every
 * later query with that enum fail ("malformed array literal") until a restart.
 * The API only ever writes 'owner' now; see schema/enums.ts.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "asset_duplicateId_idx";`.execute(db);
  await sql`ALTER TABLE "asset" DROP COLUMN IF EXISTS "duplicateId";`.execute(db);
  await sql`ALTER TABLE "album_user" ALTER COLUMN "role" SET DEFAULT 'owner';`.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // the features are gone; there is nothing to restore
}
