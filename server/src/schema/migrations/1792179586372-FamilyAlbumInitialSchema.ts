import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS "unaccent";`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS "cube";`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS "earthdistance";`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS "pg_trgm";`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION immich_uuid_v7(p_timestamp timestamp with time zone default clock_timestamp())
  RETURNS uuid
  VOLATILE LANGUAGE SQL
  AS $$
    SELECT encode(
      set_bit(
        set_bit(
          overlay(uuid_send(gen_random_uuid())
                  placing substring(int8send(floor(extract(epoch from p_timestamp) * 1000)::bigint) from 3)
                  from 1 for 6
          ),
          52, 1
        ),
        53, 1
      ),
      'hex')::uuid;
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION album_user_after_insert()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      UPDATE album SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT "albumId" FROM inserted_rows)
        AND NOT EXISTS (SELECT FROM inserted_rows WHERE role = 'owner');
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION updated_at()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    DECLARE
        clock_timestamp TIMESTAMP := clock_timestamp();
    BEGIN
        new."updatedAt" = clock_timestamp;
        new."updateId" = immich_uuid_v7(clock_timestamp);
        return new;
    END;
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION f_concat_ws(text, text[])
  RETURNS text
  PARALLEL SAFE IMMUTABLE LANGUAGE SQL
  AS $$SELECT array_to_string($2, $1)$$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  PARALLEL SAFE STRICT IMMUTABLE LANGUAGE SQL
    RETURN unaccent('unaccent', $1)`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION ll_to_earth_public(latitude double precision, longitude double precision)
  RETURNS public.earth
  PARALLEL SAFE STRICT IMMUTABLE LANGUAGE SQL
  AS $$SELECT public.cube(public.cube(public.cube(public.earth()*cos(radians(latitude))*cos(radians(longitude))),public.earth()*cos(radians(latitude))*sin(radians(longitude))),public.earth()*sin(radians(latitude)))::public.earth$$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION user_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO user_audit ("userId")
      SELECT "id"
      FROM OLD;
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION partner_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO partner_audit ("sharedById", "sharedWithId")
      SELECT "sharedById", "sharedWithId"
      FROM OLD;
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION asset_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO asset_audit ("assetId", "ownerId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION album_asset_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO album_asset_audit ("albumId", "assetId")
      SELECT "albumId", "assetId" FROM OLD
      WHERE "albumId" IN (SELECT "id" FROM album WHERE "id" IN (SELECT "albumId" FROM OLD));
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION album_user_delete()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      DELETE FROM "album"
      WHERE "album"."id" = OLD."albumId"
      AND NOT EXISTS (SELECT "albumId" FROM "album_user" WHERE "album_user"."albumId" = "album"."id" AND "album_user"."role" = 'owner');

      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION album_user_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO album_audit ("albumId", "userId")
      SELECT "albumId", "userId"
      FROM OLD;

      IF pg_trigger_depth() = 1 THEN
        INSERT INTO album_user_audit ("albumId", "userId")
        SELECT "albumId", "userId"
        FROM OLD;
      END IF;

      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION memory_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO memory_audit ("memoryId", "userId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION memory_asset_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO memory_asset_audit ("memoryId", "assetId")
      SELECT "memoriesId", "assetId" FROM OLD
      WHERE "memoriesId" IN (SELECT "id" FROM memory WHERE "id" IN (SELECT "memoriesId" FROM OLD));
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION stack_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO stack_audit ("stackId", "userId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION user_metadata_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO user_metadata_audit ("userId", "key")
      SELECT "userId", "key"
      FROM OLD;
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION asset_metadata_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO asset_metadata_audit ("assetId", "key")
      SELECT "assetId", "key"
      FROM OLD;
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION asset_edit_insert()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      UPDATE asset
      SET "isEdited" = true
      FROM inserted_edit
      WHERE asset.id = inserted_edit."assetId" AND NOT asset."isEdited";
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION asset_edit_delete()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      UPDATE asset
      SET "isEdited" = false
      FROM deleted_edit
      WHERE asset.id = deleted_edit."assetId" AND asset."isEdited"
        AND NOT EXISTS (SELECT FROM asset_edit edit WHERE edit."assetId" = asset.id);
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION asset_edit_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO asset_edit_audit ("editId", "assetId")
      SELECT "id", "assetId"
      FROM OLD;
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE TYPE "album_user_role_enum" AS ENUM ('owner','editor','viewer');`.execute(db);
  await sql`CREATE TYPE "assets_status_enum" AS ENUM ('active','trashed','deleted');`.execute(db);
  await sql`CREATE TYPE "asset_visibility_enum" AS ENUM ('archive','timeline','hidden','locked');`.execute(db);
  await sql`CREATE TYPE "asset_checksum_algorithm_enum" AS ENUM ('sha1','sha1-path');`.execute(db);
  await sql`CREATE TYPE "video_stream_variant_codec_enum" AS ENUM ('av1','hevc','h264');`.execute(db);
  await sql`CREATE TABLE "user" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "email" character varying NOT NULL,
  "password" character varying,
  "pinCode" character varying,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "profileImagePath" character varying NOT NULL DEFAULT '',
  "isAdmin" boolean NOT NULL DEFAULT false,
  "shouldChangePassword" boolean NOT NULL DEFAULT true,
  "avatarColor" character varying,
  "deletedAt" timestamp with time zone,
  "oauthId" character varying,
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "storageLabel" character varying,
  "name" character varying NOT NULL DEFAULT '',
  "quotaSizeInBytes" bigint,
  "quotaUsageInBytes" bigint NOT NULL DEFAULT 0,
  "status" character varying NOT NULL DEFAULT 'active',
  "profileChangedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "user_email_uq" UNIQUE ("email"),
  CONSTRAINT "user_storageLabel_uq" UNIQUE ("storageLabel"),
  CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "user_updatedAt_id_idx" ON "user" ("updatedAt", "id");`.execute(db);
  await sql`CREATE INDEX "user_updateId_idx" ON "user" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "user_delete_audit"
  AFTER DELETE ON "user"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION user_delete_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "user_updatedAt"
  BEFORE UPDATE ON "user"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "library" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "name" character varying NOT NULL,
  "ownerId" uuid NOT NULL,
  "importPaths" text[] NOT NULL,
  "exclusionPatterns" text[] NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "deletedAt" timestamp with time zone,
  "refreshedAt" timestamp with time zone,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "library_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "library_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "library_ownerId_idx" ON "library" ("ownerId");`.execute(db);
  await sql`CREATE INDEX "library_updateId_idx" ON "library" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "library_updatedAt"
  BEFORE UPDATE ON "library"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "stack" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "primaryAssetId" uuid NOT NULL,
  "ownerId" uuid NOT NULL,
  CONSTRAINT "stack_primaryAssetId_uq" UNIQUE ("primaryAssetId"),
  CONSTRAINT "stack_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "stack_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "stack_primaryAssetId_idx" ON "stack" ("primaryAssetId");`.execute(db);
  await sql`CREATE INDEX "stack_ownerId_idx" ON "stack" ("ownerId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "stack_delete_audit"
  AFTER DELETE ON "stack"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION stack_delete_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "stack_updatedAt"
  BEFORE UPDATE ON "stack"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "asset" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "type" character varying NOT NULL,
  "originalPath" character varying NOT NULL,
  "fileCreatedAt" timestamp with time zone NOT NULL,
  "fileModifiedAt" timestamp with time zone NOT NULL,
  "isFavorite" boolean NOT NULL DEFAULT false,
  "duration" integer,
  "checksum" bytea NOT NULL,
  "checksumAlgorithm" asset_checksum_algorithm_enum NOT NULL,
  "livePhotoVideoId" uuid,
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "originalFileName" character varying NOT NULL,
  "thumbhash" bytea,
  "isOffline" boolean NOT NULL DEFAULT false,
  "libraryId" uuid,
  "isExternal" boolean NOT NULL DEFAULT false,
  "deletedAt" timestamp with time zone,
  "localDateTime" timestamp with time zone NOT NULL,
  "stackId" uuid,
  "duplicateId" uuid,
  "status" assets_status_enum NOT NULL DEFAULT 'active',
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "visibility" asset_visibility_enum NOT NULL DEFAULT 'timeline',
  "width" integer,
  "height" integer,
  "isEdited" boolean NOT NULL DEFAULT false,
  CONSTRAINT "asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "library" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "stack" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`ALTER TABLE "stack" ADD CONSTRAINT "stack_primaryAssetId_fkey" FOREIGN KEY ("primaryAssetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;`.execute(db);
  await sql`CREATE INDEX "asset_id_timeline_notDeleted_idx" ON "asset" ("id") WHERE (visibility = 'timeline' AND "deletedAt" IS NULL);`.execute(db);
  await sql`CREATE INDEX "asset_originalFilename_trigram_idx" ON "asset" USING gin (f_unaccent("originalFileName") gin_trgm_ops);`.execute(db);
  await sql`CREATE INDEX "asset_id_stackId_idx" ON "asset" ("id", "stackId");`.execute(db);
  await sql`CREATE INDEX "asset_originalPath_libraryId_idx" ON "asset" ("originalPath", "libraryId");`.execute(db);
  await sql`CREATE INDEX "asset_localDateTime_month_idx" ON "asset" ((date_trunc('MONTH'::text, ("localDateTime" AT TIME ZONE 'UTC'::text)) AT TIME ZONE 'UTC'::text));`.execute(db);
  await sql`CREATE INDEX "asset_localDateTime_idx" ON "asset" ((("localDateTime" at time zone 'UTC')::date));`.execute(db);
  await sql`CREATE UNIQUE INDEX "asset_ownerId_libraryId_checksum_idx" ON "asset" ("ownerId", "libraryId", "checksum") WHERE ("libraryId" IS NOT NULL);`.execute(db);
  await sql`CREATE UNIQUE INDEX "UQ_assets_owner_checksum" ON "asset" ("ownerId", "checksum") WHERE ("libraryId" IS NULL);`.execute(db);
  await sql`CREATE INDEX "asset_ownerId_idx" ON "asset" ("ownerId");`.execute(db);
  await sql`CREATE INDEX "asset_fileCreatedAt_idx" ON "asset" ("fileCreatedAt");`.execute(db);
  await sql`CREATE INDEX "asset_checksum_idx" ON "asset" ("checksum");`.execute(db);
  await sql`CREATE INDEX "asset_livePhotoVideoId_idx" ON "asset" ("livePhotoVideoId");`.execute(db);
  await sql`CREATE INDEX "asset_createdAt_idx" ON "asset" ("createdAt");`.execute(db);
  await sql`CREATE INDEX "asset_originalFileName_idx" ON "asset" ("originalFileName");`.execute(db);
  await sql`CREATE INDEX "asset_libraryId_idx" ON "asset" ("libraryId");`.execute(db);
  await sql`CREATE INDEX "asset_stackId_idx" ON "asset" ("stackId");`.execute(db);
  await sql`CREATE INDEX "asset_duplicateId_idx" ON "asset" ("duplicateId");`.execute(db);
  await sql`CREATE INDEX "asset_updateId_idx" ON "asset" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_delete_audit"
  AFTER DELETE ON "asset"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION asset_delete_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_updatedAt"
  BEFORE UPDATE ON "asset"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`ALTER TABLE "asset" ADD CONSTRAINT "asset_livePhotoVideoId_fkey" FOREIGN KEY ("livePhotoVideoId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL;`.execute(db);
  await sql`CREATE TABLE "album" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "albumName" character varying NOT NULL DEFAULT 'Untitled Album',
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "albumThumbnailAssetId" uuid,
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "description" text,
  "deletedAt" timestamp with time zone,
  "isActivityEnabled" boolean NOT NULL DEFAULT true,
  "order" character varying NOT NULL DEFAULT 'desc',
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "album_albumThumbnailAssetId_fkey" FOREIGN KEY ("albumThumbnailAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "album_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`COMMENT ON COLUMN "album"."albumThumbnailAssetId" IS 'Asset ID to be used as thumbnail';`.execute(db);
  await sql`CREATE INDEX "album_albumThumbnailAssetId_idx" ON "album" ("albumThumbnailAssetId");`.execute(db);
  await sql`CREATE INDEX "album_updateId_idx" ON "album" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "album_updatedAt"
  BEFORE UPDATE ON "album"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "album_asset" (
  "albumId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "album_asset_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "album_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "album_asset_pkey" PRIMARY KEY ("albumId", "assetId")
);`.execute(db);
  await sql`CREATE INDEX "album_asset_albumId_idx" ON "album_asset" ("albumId");`.execute(db);
  await sql`CREATE INDEX "album_asset_assetId_idx" ON "album_asset" ("assetId");`.execute(db);
  await sql`CREATE INDEX "album_asset_updateId_idx" ON "album_asset" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "album_asset_delete_audit"
  AFTER DELETE ON "album_asset"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() <= 1)
  EXECUTE FUNCTION album_asset_delete_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "album_asset_updatedAt"
  BEFORE UPDATE ON "album_asset"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "activity" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "albumId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "assetId" uuid,
  "comment" text,
  "isLiked" boolean NOT NULL DEFAULT false,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "activity_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "activity_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "activity_albumId_assetId_fkey" FOREIGN KEY ("albumId", "assetId") REFERENCES "album_asset" ("albumId", "assetId") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "activity_like_check" CHECK ((comment IS NULL AND "isLiked" = true) OR (comment IS NOT NULL AND "isLiked" = false)),
  CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "activity_albumId_assetId_idx" ON "activity" ("albumId", "assetId");`.execute(db);
  await sql`CREATE UNIQUE INDEX "activity_like_idx" ON "activity" ("assetId", "userId", "albumId") WHERE (("isLiked" = true));`.execute(db);
  await sql`CREATE INDEX "activity_albumId_idx" ON "activity" ("albumId");`.execute(db);
  await sql`CREATE INDEX "activity_userId_idx" ON "activity" ("userId");`.execute(db);
  await sql`CREATE INDEX "activity_assetId_idx" ON "activity" ("assetId");`.execute(db);
  await sql`CREATE INDEX "activity_updateId_idx" ON "activity" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "activity_updatedAt"
  BEFORE UPDATE ON "activity"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "album_asset_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "albumId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "album_asset_audit_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "album_asset_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "album_asset_audit_albumId_idx" ON "album_asset_audit" ("albumId");`.execute(db);
  await sql`CREATE INDEX "album_asset_audit_assetId_idx" ON "album_asset_audit" ("assetId");`.execute(db);
  await sql`CREATE INDEX "album_asset_audit_deletedAt_idx" ON "album_asset_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "album_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "albumId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "album_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "album_audit_albumId_idx" ON "album_audit" ("albumId");`.execute(db);
  await sql`CREATE INDEX "album_audit_userId_idx" ON "album_audit" ("userId");`.execute(db);
  await sql`CREATE INDEX "album_audit_deletedAt_idx" ON "album_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "album_user_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "albumId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "album_user_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "album_user_audit_albumId_idx" ON "album_user_audit" ("albumId");`.execute(db);
  await sql`CREATE INDEX "album_user_audit_userId_idx" ON "album_user_audit" ("userId");`.execute(db);
  await sql`CREATE INDEX "album_user_audit_deletedAt_idx" ON "album_user_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "album_user" (
  "albumId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "role" album_user_role_enum NOT NULL DEFAULT 'editor',
  "createId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "album_user_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "album_user_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "album_user_pkey" PRIMARY KEY ("albumId", "userId")
);`.execute(db);
  await sql`CREATE UNIQUE INDEX "album_user_unique_owner" ON "album_user" ("albumId") WHERE (role = 'owner');`.execute(db);
  await sql`CREATE INDEX "album_user_albumId_idx" ON "album_user" ("albumId");`.execute(db);
  await sql`CREATE INDEX "album_user_userId_idx" ON "album_user" ("userId");`.execute(db);
  await sql`CREATE INDEX "album_user_createId_idx" ON "album_user" ("createId");`.execute(db);
  await sql`CREATE INDEX "album_user_updateId_idx" ON "album_user" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "album_user_delete"
  AFTER DELETE ON "album_user"
  REFERENCING OLD TABLE AS "old"
  FOR EACH ROW
  EXECUTE FUNCTION album_user_delete();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "album_user_delete_audit"
  AFTER DELETE ON "album_user"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() <= 1)
  EXECUTE FUNCTION album_user_delete_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "album_user_after_insert"
  AFTER INSERT ON "album_user"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION album_user_after_insert();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "album_user_updatedAt"
  BEFORE UPDATE ON "album_user"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "api_key" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "name" character varying NOT NULL,
  "key" bytea NOT NULL,
  "userId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "permissions" character varying[] NOT NULL,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "api_key_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "api_key_key_idx" ON "api_key" ("key");`.execute(db);
  await sql`CREATE INDEX "api_key_userId_idx" ON "api_key" ("userId");`.execute(db);
  await sql`CREATE INDEX "api_key_updateId_idx" ON "api_key" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "api_key_updatedAt"
  BEFORE UPDATE ON "api_key"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "asset_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "assetId" uuid NOT NULL,
  "ownerId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "asset_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "asset_audit_assetId_idx" ON "asset_audit" ("assetId");`.execute(db);
  await sql`CREATE INDEX "asset_audit_ownerId_idx" ON "asset_audit" ("ownerId");`.execute(db);
  await sql`CREATE INDEX "asset_audit_deletedAt_idx" ON "asset_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "asset_edit_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "editId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "asset_edit_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "asset_edit_audit_assetId_idx" ON "asset_edit_audit" ("assetId");`.execute(db);
  await sql`CREATE INDEX "asset_edit_audit_deletedAt_idx" ON "asset_edit_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "asset_edit" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "assetId" uuid NOT NULL,
  "action" character varying NOT NULL,
  "parameters" jsonb NOT NULL,
  "sequence" integer NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "asset_edit_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_edit_assetId_sequence_uq" UNIQUE ("assetId", "sequence"),
  CONSTRAINT "asset_edit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "asset_edit_assetId_idx" ON "asset_edit" ("assetId");`.execute(db);
  await sql`CREATE INDEX "asset_edit_updateId_idx" ON "asset_edit" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_edit_audit"
  AFTER DELETE ON "asset_edit"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION asset_edit_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_edit_delete"
  AFTER DELETE ON "asset_edit"
  REFERENCING OLD TABLE AS "deleted_edit"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION asset_edit_delete();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_edit_insert"
  AFTER INSERT ON "asset_edit"
  REFERENCING NEW TABLE AS "inserted_edit"
  FOR EACH STATEMENT
  EXECUTE FUNCTION asset_edit_insert();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_edit_updatedAt"
  BEFORE UPDATE ON "asset_edit"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "asset_exif" (
  "assetId" uuid NOT NULL,
  "make" character varying,
  "model" character varying,
  "exifImageWidth" integer,
  "exifImageHeight" integer,
  "fileSizeInByte" bigint,
  "orientation" character varying,
  "dateTimeOriginal" timestamp with time zone,
  "modifyDate" timestamp with time zone,
  "lensModel" character varying,
  "fNumber" double precision,
  "focalLength" double precision,
  "iso" integer,
  "latitude" double precision,
  "longitude" double precision,
  "city" character varying,
  "state" character varying,
  "country" character varying,
  "description" text NOT NULL DEFAULT '',
  "fps" double precision,
  "exposureTime" character varying,
  "livePhotoCID" character varying,
  "timeZone" character varying,
  "projectionType" character varying,
  "profileDescription" character varying,
  "colorspace" character varying,
  "bitsPerSample" integer,
  "autoStackId" character varying,
  "rating" integer,
  "tags" character varying[],
  "updatedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "lockedProperties" character varying[],
  CONSTRAINT "asset_exif_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "asset_exif_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`CREATE INDEX "IDX_asset_exif_gist_earthcoord" ON "asset_exif" USING gist (ll_to_earth_public(latitude, longitude));`.execute(db);
  await sql`CREATE INDEX "asset_exif_city_idx" ON "asset_exif" ("city");`.execute(db);
  await sql`CREATE INDEX "asset_exif_livePhotoCID_idx" ON "asset_exif" ("livePhotoCID");`.execute(db);
  await sql`CREATE INDEX "asset_exif_autoStackId_idx" ON "asset_exif" ("autoStackId");`.execute(db);
  await sql`CREATE INDEX "asset_exif_updateId_idx" ON "asset_exif" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_exif_updatedAt"
  BEFORE UPDATE ON "asset_exif"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "asset_file" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "assetId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "type" character varying NOT NULL,
  "path" character varying NOT NULL,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "isEdited" boolean NOT NULL DEFAULT false,
  "isProgressive" boolean NOT NULL DEFAULT false,
  "isTransparent" boolean NOT NULL DEFAULT false,
  CONSTRAINT "asset_file_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_file_assetId_type_isEdited_uq" UNIQUE ("assetId", "type", "isEdited"),
  CONSTRAINT "asset_file_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "asset_file_assetId_idx" ON "asset_file" ("assetId");`.execute(db);
  await sql`CREATE INDEX "asset_file_updateId_idx" ON "asset_file" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_file_updatedAt"
  BEFORE UPDATE ON "asset_file"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "asset_job_status" (
  "assetId" uuid NOT NULL,
  "facesRecognizedAt" timestamp with time zone,
  "metadataExtractedAt" timestamp with time zone,
  "duplicatesDetectedAt" timestamp with time zone,
  "embeddedAt" timestamp with time zone,
  CONSTRAINT "asset_job_status_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_job_status_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`CREATE TABLE "asset_metadata_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "assetId" uuid NOT NULL,
  "key" character varying NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "asset_metadata_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "asset_metadata_audit_assetId_idx" ON "asset_metadata_audit" ("assetId");`.execute(db);
  await sql`CREATE INDEX "asset_metadata_audit_key_idx" ON "asset_metadata_audit" ("key");`.execute(db);
  await sql`CREATE INDEX "asset_metadata_audit_deletedAt_idx" ON "asset_metadata_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "asset_metadata" (
  "assetId" uuid NOT NULL,
  "key" character varying NOT NULL,
  "value" jsonb NOT NULL,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "asset_metadata_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_metadata_pkey" PRIMARY KEY ("assetId", "key")
);`.execute(db);
  await sql`CREATE INDEX "asset_metadata_updateId_idx" ON "asset_metadata" ("updateId");`.execute(db);
  await sql`CREATE INDEX "asset_metadata_updatedAt_idx" ON "asset_metadata" ("updatedAt");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_metadata_audit"
  AFTER DELETE ON "asset_metadata"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION asset_metadata_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_metadata_updated_at"
  BEFORE UPDATE ON "asset_metadata"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "geodata_places" (
  "id" integer NOT NULL,
  "name" character varying(200) NOT NULL,
  "longitude" double precision NOT NULL,
  "latitude" double precision NOT NULL,
  "countryCode" character(2) NOT NULL,
  "admin1Code" character varying(20),
  "admin2Code" character varying(80),
  "modificationDate" date NOT NULL,
  "admin1Name" character varying,
  "admin2Name" character varying,
  "alternateNames" character varying,
  CONSTRAINT "geodata_places_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "IDX_geodata_gist_earthcoord" ON "geodata_places" (ll_to_earth_public(latitude, longitude));`.execute(db);
  await sql`CREATE INDEX "idx_geodata_places_name" ON "geodata_places" USING gin (f_unaccent("name") gin_trgm_ops);`.execute(db);
  await sql`CREATE INDEX "idx_geodata_places_admin2_name" ON "geodata_places" USING gin (f_unaccent("admin2Name") gin_trgm_ops);`.execute(db);
  await sql`CREATE INDEX "idx_geodata_places_admin1_name" ON "geodata_places" USING gin (f_unaccent("admin1Name") gin_trgm_ops);`.execute(db);
  await sql`CREATE INDEX "idx_geodata_places_alternate_names" ON "geodata_places" USING gin (f_unaccent("alternateNames") gin_trgm_ops);`.execute(db);
  await sql`CREATE TABLE "integrity_report" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "type" character varying NOT NULL,
  "path" character varying NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "assetId" uuid,
  "fileAssetId" uuid,
  CONSTRAINT "integrity_report_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "integrity_report_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "asset_file" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "integrity_report_type_path_uq" UNIQUE ("type", "path"),
  CONSTRAINT "integrity_report_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "integrity_report_assetId_idx" ON "integrity_report" ("assetId");`.execute(db);
  await sql`CREATE INDEX "integrity_report_fileAssetId_idx" ON "integrity_report" ("fileAssetId");`.execute(db);
  await sql`CREATE TABLE "memory" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "deletedAt" timestamp with time zone,
  "ownerId" uuid NOT NULL,
  "type" character varying NOT NULL,
  "data" jsonb NOT NULL,
  "isSaved" boolean NOT NULL DEFAULT false,
  "memoryAt" timestamp with time zone NOT NULL,
  "seenAt" timestamp with time zone,
  "showAt" timestamp with time zone,
  "hideAt" timestamp with time zone,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "memory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "memory_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "memory_ownerId_idx" ON "memory" ("ownerId");`.execute(db);
  await sql`CREATE INDEX "memory_updateId_idx" ON "memory" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "memory_delete_audit"
  AFTER DELETE ON "memory"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION memory_delete_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "memory_updatedAt"
  BEFORE UPDATE ON "memory"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "memory_asset_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "memoryId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "memory_asset_audit_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memory" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "memory_asset_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "memory_asset_audit_memoryId_idx" ON "memory_asset_audit" ("memoryId");`.execute(db);
  await sql`CREATE INDEX "memory_asset_audit_assetId_idx" ON "memory_asset_audit" ("assetId");`.execute(db);
  await sql`CREATE INDEX "memory_asset_audit_deletedAt_idx" ON "memory_asset_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "memory_asset" (
  "memoriesId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "memory_asset_memoriesId_fkey" FOREIGN KEY ("memoriesId") REFERENCES "memory" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "memory_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "memory_asset_pkey" PRIMARY KEY ("memoriesId", "assetId")
);`.execute(db);
  await sql`CREATE INDEX "memory_asset_memoriesId_idx" ON "memory_asset" ("memoriesId");`.execute(db);
  await sql`CREATE INDEX "memory_asset_assetId_idx" ON "memory_asset" ("assetId");`.execute(db);
  await sql`CREATE INDEX "memory_asset_updateId_idx" ON "memory_asset" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "memory_asset_delete_audit"
  AFTER DELETE ON "memory_asset"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() <= 1)
  EXECUTE FUNCTION memory_asset_delete_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "memory_asset_updatedAt"
  BEFORE UPDATE ON "memory_asset"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "memory_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "memoryId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "memory_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "memory_audit_memoryId_idx" ON "memory_audit" ("memoryId");`.execute(db);
  await sql`CREATE INDEX "memory_audit_userId_idx" ON "memory_audit" ("userId");`.execute(db);
  await sql`CREATE INDEX "memory_audit_deletedAt_idx" ON "memory_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "move_history" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "entityId" uuid NOT NULL,
  "pathType" character varying NOT NULL,
  "oldPath" character varying NOT NULL,
  "newPath" character varying NOT NULL,
  CONSTRAINT "UQ_newPath" UNIQUE ("newPath"),
  CONSTRAINT "UQ_entityId_pathType" UNIQUE ("entityId", "pathType"),
  CONSTRAINT "move_history_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE TABLE "naturalearth_countries" (
  "id" integer NOT NULL GENERATED ALWAYS AS IDENTITY,
  "admin" character varying(50) NOT NULL,
  "admin_a3" character varying(3) NOT NULL,
  "type" character varying(50) NOT NULL,
  "coordinates" polygon NOT NULL,
  CONSTRAINT "naturalearth_countries_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE TABLE "notification" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "deletedAt" timestamp with time zone,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "userId" uuid,
  "level" character varying NOT NULL DEFAULT 'info',
  "type" character varying NOT NULL DEFAULT 'info',
  "data" jsonb,
  "title" character varying NOT NULL,
  "description" text,
  "readAt" timestamp with time zone,
  CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "notification_updateId_idx" ON "notification" ("updateId");`.execute(db);
  await sql`CREATE INDEX "notification_userId_idx" ON "notification" ("userId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "notification_updatedAt"
  BEFORE UPDATE ON "notification"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "partner_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "sharedById" uuid NOT NULL,
  "sharedWithId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "partner_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "partner_audit_sharedById_idx" ON "partner_audit" ("sharedById");`.execute(db);
  await sql`CREATE INDEX "partner_audit_sharedWithId_idx" ON "partner_audit" ("sharedWithId");`.execute(db);
  await sql`CREATE INDEX "partner_audit_deletedAt_idx" ON "partner_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "partner" (
  "sharedById" uuid NOT NULL,
  "sharedWithId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "createId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "inTimeline" boolean NOT NULL DEFAULT false,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "partner_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "partner_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "partner_pkey" PRIMARY KEY ("sharedById", "sharedWithId")
);`.execute(db);
  await sql`CREATE INDEX "partner_sharedWithId_idx" ON "partner" ("sharedWithId");`.execute(db);
  await sql`CREATE INDEX "partner_createId_idx" ON "partner" ("createId");`.execute(db);
  await sql`CREATE INDEX "partner_updateId_idx" ON "partner" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "partner_delete_audit"
  AFTER DELETE ON "partner"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION partner_delete_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "partner_updatedAt"
  BEFORE UPDATE ON "partner"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "plugin" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "enabled" boolean NOT NULL DEFAULT true,
  "name" character varying NOT NULL,
  "version" character varying NOT NULL,
  "title" character varying NOT NULL,
  "description" character varying NOT NULL,
  "author" character varying NOT NULL,
  "wasmBytes" bytea NOT NULL,
  "templates" jsonb NOT NULL,
  "sha256hash" bytea NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_name_version_uq" UNIQUE ("name", "version"),
  CONSTRAINT "plugin_name_uq" UNIQUE ("name"),
  CONSTRAINT "plugin_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "plugin_name_idx" ON "plugin" ("name");`.execute(db);
  await sql`CREATE TABLE "plugin_method" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "pluginId" uuid NOT NULL,
  "name" character varying NOT NULL,
  "title" character varying NOT NULL,
  "description" character varying NOT NULL,
  "types" character varying[] NOT NULL,
  "hostFunctions" boolean NOT NULL DEFAULT false,
  "allowedHosts" character varying[] NOT NULL DEFAULT '{}',
  "schema" jsonb,
  "uiHints" character varying[] NOT NULL DEFAULT '{}',
  CONSTRAINT "plugin_method_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "plugin" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "plugin_method_pluginId_name_uq" UNIQUE ("pluginId", "name"),
  CONSTRAINT "plugin_method_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "plugin_method_pluginId_idx" ON "plugin_method" ("pluginId");`.execute(db);
  await sql`CREATE TABLE "session" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "token" bytea NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "expiresAt" timestamp with time zone,
  "userId" uuid NOT NULL,
  "parentId" uuid,
  "deviceType" character varying NOT NULL DEFAULT '',
  "deviceOS" character varying NOT NULL DEFAULT '',
  "appVersion" character varying,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "isPendingSyncReset" boolean NOT NULL DEFAULT false,
  "pinExpiresAt" timestamp with time zone,
  "oauthSid" character varying,
  "oauthBearerToken" character varying,
  CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "session_token_idx" ON "session" ("token");`.execute(db);
  await sql`CREATE INDEX "session_userId_idx" ON "session" ("userId");`.execute(db);
  await sql`CREATE INDEX "session_parentId_idx" ON "session" ("parentId");`.execute(db);
  await sql`CREATE INDEX "session_updateId_idx" ON "session" ("updateId");`.execute(db);
  await sql`CREATE INDEX "session_oauthSid_idx" ON "session" ("oauthSid");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "session_updatedAt"
  BEFORE UPDATE ON "session"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`ALTER TABLE "session" ADD CONSTRAINT "session_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "session" ("id") ON UPDATE CASCADE ON DELETE CASCADE;`.execute(db);
  await sql`CREATE TABLE "shared_link" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "description" character varying,
  "userId" uuid NOT NULL,
  "key" bytea NOT NULL,
  "type" character varying NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "expiresAt" timestamp with time zone,
  "allowUpload" boolean NOT NULL DEFAULT false,
  "albumId" uuid,
  "allowDownload" boolean NOT NULL DEFAULT true,
  "showExif" boolean NOT NULL DEFAULT true,
  "password" character varying,
  "slug" character varying,
  CONSTRAINT "shared_link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "shared_link_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "shared_link_key_uq" UNIQUE ("key"),
  CONSTRAINT "shared_link_slug_uq" UNIQUE ("slug"),
  CONSTRAINT "shared_link_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "shared_link_userId_idx" ON "shared_link" ("userId");`.execute(db);
  await sql`CREATE INDEX "shared_link_key_idx" ON "shared_link" ("key");`.execute(db);
  await sql`CREATE INDEX "shared_link_albumId_idx" ON "shared_link" ("albumId");`.execute(db);
  await sql`CREATE TABLE "shared_link_asset" (
  "assetId" uuid NOT NULL,
  "sharedLinkId" uuid NOT NULL,
  CONSTRAINT "shared_link_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "shared_link_asset_sharedLinkId_fkey" FOREIGN KEY ("sharedLinkId") REFERENCES "shared_link" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "shared_link_asset_pkey" PRIMARY KEY ("assetId", "sharedLinkId")
);`.execute(db);
  await sql`CREATE INDEX "shared_link_asset_assetId_idx" ON "shared_link_asset" ("assetId");`.execute(db);
  await sql`CREATE INDEX "shared_link_asset_sharedLinkId_idx" ON "shared_link_asset" ("sharedLinkId");`.execute(db);
  await sql`CREATE TABLE "stack_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "stackId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "stack_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "stack_audit_deletedAt_idx" ON "stack_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "session_sync_checkpoint" (
  "sessionId" uuid NOT NULL,
  "type" character varying NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "ack" character varying NOT NULL,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "session_sync_checkpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "session_sync_checkpoint_pkey" PRIMARY KEY ("sessionId", "type")
);`.execute(db);
  await sql`CREATE INDEX "session_sync_checkpoint_sessionId_idx" ON "session_sync_checkpoint" ("sessionId");`.execute(db);
  await sql`CREATE INDEX "session_sync_checkpoint_updateId_idx" ON "session_sync_checkpoint" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "session_sync_checkpoint_updatedAt"
  BEFORE UPDATE ON "session_sync_checkpoint"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "system_metadata" (
  "key" character varying NOT NULL,
  "value" jsonb NOT NULL,
  CONSTRAINT "system_metadata_pkey" PRIMARY KEY ("key")
);`.execute(db);
  await sql`CREATE TABLE "tag" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "userId" uuid NOT NULL,
  "value" character varying NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "color" character varying,
  "parentId" uuid,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "tag_userId_value_uq" UNIQUE ("userId", "value"),
  CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "tag_parentId_idx" ON "tag" ("parentId");`.execute(db);
  await sql`CREATE INDEX "tag_updateId_idx" ON "tag" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "tag_updatedAt"
  BEFORE UPDATE ON "tag"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`ALTER TABLE "tag" ADD CONSTRAINT "tag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tag" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;`.execute(db);
  await sql`CREATE TABLE "tag_asset" (
  "assetId" uuid NOT NULL,
  "tagId" uuid NOT NULL,
  CONSTRAINT "tag_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "tag_asset_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "tag_asset_pkey" PRIMARY KEY ("assetId", "tagId")
);`.execute(db);
  await sql`CREATE INDEX "tag_asset_assetId_tagId_idx" ON "tag_asset" ("assetId", "tagId");`.execute(db);
  await sql`CREATE INDEX "tag_asset_assetId_idx" ON "tag_asset" ("assetId");`.execute(db);
  await sql`CREATE INDEX "tag_asset_tagId_idx" ON "tag_asset" ("tagId");`.execute(db);
  await sql`CREATE TABLE "tag_closure" (
  "id_ancestor" uuid NOT NULL,
  "id_descendant" uuid NOT NULL,
  CONSTRAINT "tag_closure_id_ancestor_fkey" FOREIGN KEY ("id_ancestor") REFERENCES "tag" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "tag_closure_id_descendant_fkey" FOREIGN KEY ("id_descendant") REFERENCES "tag" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "tag_closure_pkey" PRIMARY KEY ("id_ancestor", "id_descendant")
);`.execute(db);
  await sql`CREATE INDEX "tag_closure_id_ancestor_idx" ON "tag_closure" ("id_ancestor");`.execute(db);
  await sql`CREATE INDEX "tag_closure_id_descendant_idx" ON "tag_closure" ("id_descendant");`.execute(db);
  await sql`CREATE TABLE "user_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "userId" uuid NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "user_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "user_audit_deletedAt_idx" ON "user_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "user_metadata_audit" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "userId" uuid NOT NULL,
  "key" character varying NOT NULL,
  "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "user_metadata_audit_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "IDX_user_metadata_audit_user_id" ON "user_metadata_audit" ("userId");`.execute(db);
  await sql`CREATE INDEX "IDX_user_metadata_audit_key" ON "user_metadata_audit" ("key");`.execute(db);
  await sql`CREATE INDEX "IDX_user_metadata_audit_deleted_at" ON "user_metadata_audit" ("deletedAt");`.execute(db);
  await sql`CREATE TABLE "user_metadata" (
  "userId" uuid NOT NULL,
  "key" character varying NOT NULL,
  "value" jsonb NOT NULL,
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_metadata_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "user_metadata_pkey" PRIMARY KEY ("userId", "key")
);`.execute(db);
  await sql`CREATE INDEX "IDX_user_metadata_update_id" ON "user_metadata" ("updateId");`.execute(db);
  await sql`CREATE INDEX "IDX_user_metadata_updated_at" ON "user_metadata" ("updatedAt");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "user_metadata_audit"
  AFTER DELETE ON "user_metadata"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION user_metadata_audit();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "user_metadata_updated_at"
  BEFORE UPDATE ON "user_metadata"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "version_history" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" character varying NOT NULL,
  CONSTRAINT "version_history_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE TABLE "video_stream_session" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "assetId" uuid NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "video_stream_session_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "video_stream_session_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "video_stream_session_assetId_idx" ON "video_stream_session" ("assetId");`.execute(db);
  await sql`CREATE INDEX "video_stream_session_expiresAt_idx" ON "video_stream_session" ("expiresAt");`.execute(db);
  await sql`CREATE TABLE "video_stream_variant" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "sessionId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "bitrate" integer NOT NULL,
  "codec" video_stream_variant_codec_enum NOT NULL,
  "resolution" smallint NOT NULL,
  CONSTRAINT "video_stream_variant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "video_stream_session" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "video_stream_variant_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE UNIQUE INDEX "video_stream_variant_sessionId_bitrate_resolution_codec_idx" ON "video_stream_variant" ("sessionId", "bitrate", "resolution", "codec");`.execute(db);
  await sql`CREATE TABLE "video_stream_segment" (
  "variantId" uuid NOT NULL,
  "index" integer NOT NULL,
  "durationUs" integer NOT NULL,
  CONSTRAINT "video_stream_segment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "video_stream_variant" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "video_stream_segment_pkey" PRIMARY KEY ("variantId", "index")
);`.execute(db);
  await sql`CREATE TABLE "workflow" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "trigger" character varying NOT NULL,
  "name" character varying,
  "description" character varying,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "enabled" boolean NOT NULL DEFAULT true,
  "logging" boolean NOT NULL DEFAULT false,
  CONSTRAINT "workflow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "workflow_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "workflow_ownerId_idx" ON "workflow" ("ownerId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "workflow_updatedAt"
  BEFORE UPDATE ON "workflow"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "workflow_step" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "enabled" boolean NOT NULL DEFAULT true,
  "workflowId" uuid NOT NULL,
  "pluginMethodId" uuid NOT NULL,
  "config" jsonb,
  "order" integer NOT NULL,
  CONSTRAINT "workflow_step_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "workflow_step_pluginMethodId_fkey" FOREIGN KEY ("pluginMethodId") REFERENCES "plugin_method" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "workflow_step_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "workflow_step_workflowId_idx" ON "workflow_step" ("workflowId");`.execute(db);
  await sql`CREATE INDEX "workflow_step_pluginMethodId_idx" ON "workflow_step" ("pluginMethodId");`.execute(db);
  await sql`CREATE TABLE "asset_audio" (
  "assetId" uuid NOT NULL,
  "bitrate" integer NOT NULL,
  "index" smallint NOT NULL,
  "profile" smallint,
  "codecName" text NOT NULL,
  CONSTRAINT "asset_audio_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "asset_audio_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`CREATE TABLE "asset_video" (
  "assetId" uuid NOT NULL,
  "bitrate" integer NOT NULL,
  "frameCount" integer NOT NULL,
  "timeBase" integer NOT NULL,
  "index" smallint NOT NULL,
  "profile" smallint,
  "level" smallint,
  "colorPrimaries" smallint NOT NULL,
  "colorTransfer" smallint NOT NULL,
  "colorMatrix" smallint NOT NULL,
  "dvProfile" smallint,
  "dvLevel" smallint,
  "dvBlSignalCompatibilityId" smallint,
  "codecName" text NOT NULL,
  "formatName" text NOT NULL,
  "formatLongName" text NOT NULL,
  "pixelFormat" text NOT NULL,
  CONSTRAINT "asset_video_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "asset_video_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`CREATE TABLE "asset_keyframe" (
  "assetId" uuid NOT NULL,
  "pts" integer[] NOT NULL,
  "accDuration" integer[] NOT NULL,
  "ownDuration" integer[] NOT NULL,
  "totalDuration" integer NOT NULL,
  "packetCount" integer NOT NULL,
  "outputFrames" integer NOT NULL,
  CONSTRAINT "asset_keyframe_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "asset_keyframe_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`CREATE TABLE "workflow_log" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "workflowId" uuid NOT NULL,
  "result" character varying NOT NULL,
  "workflowStepId" uuid,
  "triggerDataId" uuid,
  "runId" uuid NOT NULL,
  CONSTRAINT "workflow_log_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "workflow_log_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "workflow_step" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "workflow_log_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "workflow_log_workflowId_idx" ON "workflow_log" ("workflowId");`.execute(db);
  await sql`CREATE INDEX "workflow_log_workflowStepId_idx" ON "workflow_log" ("workflowStepId");`.execute(db);
  await sql`CREATE TABLE "migration_overrides" (
  "name" character varying NOT NULL,
  "value" jsonb NOT NULL,
  CONSTRAINT "migration_overrides_pkey" PRIMARY KEY ("name")
);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_immich_uuid_v7', '{"type":"function","name":"immich_uuid_v7","sql":"CREATE OR REPLACE FUNCTION immich_uuid_v7(p_timestamp timestamp with time zone default clock_timestamp())\\n  RETURNS uuid\\n  VOLATILE LANGUAGE SQL\\n  AS $$\\n    SELECT encode(\\n      set_bit(\\n        set_bit(\\n          overlay(uuid_send(gen_random_uuid())\\n                  placing substring(int8send(floor(extract(epoch from p_timestamp) * 1000)::bigint) from 3)\\n                  from 1 for 6\\n          ),\\n          52, 1\\n        ),\\n        53, 1\\n      ),\\n      ''hex'')::uuid;\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_user_after_insert', '{"type":"function","name":"album_user_after_insert","sql":"CREATE OR REPLACE FUNCTION album_user_after_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE album SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (SELECT \\"albumId\\" FROM inserted_rows)\\n        AND NOT EXISTS (SELECT FROM inserted_rows WHERE role = ''owner'');\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_updated_at', '{"type":"function","name":"updated_at","sql":"CREATE OR REPLACE FUNCTION updated_at()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    DECLARE\\n        clock_timestamp TIMESTAMP := clock_timestamp();\\n    BEGIN\\n        new.\\"updatedAt\\" = clock_timestamp;\\n        new.\\"updateId\\" = immich_uuid_v7(clock_timestamp);\\n        return new;\\n    END;\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_f_concat_ws', '{"type":"function","name":"f_concat_ws","sql":"CREATE OR REPLACE FUNCTION f_concat_ws(text, text[])\\n  RETURNS text\\n  PARALLEL SAFE IMMUTABLE LANGUAGE SQL\\n  AS $$SELECT array_to_string($2, $1)$$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_f_unaccent', '{"type":"function","name":"f_unaccent","sql":"CREATE OR REPLACE FUNCTION f_unaccent(text)\\n  RETURNS text\\n  PARALLEL SAFE STRICT IMMUTABLE LANGUAGE SQL\\n    RETURN unaccent(''unaccent'', $1)"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_ll_to_earth_public', '{"type":"function","name":"ll_to_earth_public","sql":"CREATE OR REPLACE FUNCTION ll_to_earth_public(latitude double precision, longitude double precision)\\n  RETURNS public.earth\\n  PARALLEL SAFE STRICT IMMUTABLE LANGUAGE SQL\\n  AS $$SELECT public.cube(public.cube(public.cube(public.earth()*cos(radians(latitude))*cos(radians(longitude))),public.earth()*cos(radians(latitude))*sin(radians(longitude))),public.earth()*sin(radians(latitude)))::public.earth$$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_user_delete_audit', '{"type":"function","name":"user_delete_audit","sql":"CREATE OR REPLACE FUNCTION user_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO user_audit (\\"userId\\")\\n      SELECT \\"id\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_partner_delete_audit', '{"type":"function","name":"partner_delete_audit","sql":"CREATE OR REPLACE FUNCTION partner_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO partner_audit (\\"sharedById\\", \\"sharedWithId\\")\\n      SELECT \\"sharedById\\", \\"sharedWithId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_delete_audit', '{"type":"function","name":"asset_delete_audit","sql":"CREATE OR REPLACE FUNCTION asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO asset_audit (\\"assetId\\", \\"ownerId\\")\\n      SELECT \\"id\\", \\"ownerId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_asset_delete_audit', '{"type":"function","name":"album_asset_delete_audit","sql":"CREATE OR REPLACE FUNCTION album_asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO album_asset_audit (\\"albumId\\", \\"assetId\\")\\n      SELECT \\"albumId\\", \\"assetId\\" FROM OLD\\n      WHERE \\"albumId\\" IN (SELECT \\"id\\" FROM album WHERE \\"id\\" IN (SELECT \\"albumId\\" FROM OLD));\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_user_delete', '{"type":"function","name":"album_user_delete","sql":"CREATE OR REPLACE FUNCTION album_user_delete()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      DELETE FROM \\"album\\"\\n      WHERE \\"album\\".\\"id\\" = OLD.\\"albumId\\"\\n      AND NOT EXISTS (SELECT \\"albumId\\" FROM \\"album_user\\" WHERE \\"album_user\\".\\"albumId\\" = \\"album\\".\\"id\\" AND \\"album_user\\".\\"role\\" = ''owner'');\\n\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_user_delete_audit', '{"type":"function","name":"album_user_delete_audit","sql":"CREATE OR REPLACE FUNCTION album_user_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO album_audit (\\"albumId\\", \\"userId\\")\\n      SELECT \\"albumId\\", \\"userId\\"\\n      FROM OLD;\\n\\n      IF pg_trigger_depth() = 1 THEN\\n        INSERT INTO album_user_audit (\\"albumId\\", \\"userId\\")\\n        SELECT \\"albumId\\", \\"userId\\"\\n        FROM OLD;\\n      END IF;\\n\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_memory_delete_audit', '{"type":"function","name":"memory_delete_audit","sql":"CREATE OR REPLACE FUNCTION memory_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO memory_audit (\\"memoryId\\", \\"userId\\")\\n      SELECT \\"id\\", \\"ownerId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_memory_asset_delete_audit', '{"type":"function","name":"memory_asset_delete_audit","sql":"CREATE OR REPLACE FUNCTION memory_asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO memory_asset_audit (\\"memoryId\\", \\"assetId\\")\\n      SELECT \\"memoriesId\\", \\"assetId\\" FROM OLD\\n      WHERE \\"memoriesId\\" IN (SELECT \\"id\\" FROM memory WHERE \\"id\\" IN (SELECT \\"memoriesId\\" FROM OLD));\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_stack_delete_audit', '{"type":"function","name":"stack_delete_audit","sql":"CREATE OR REPLACE FUNCTION stack_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO stack_audit (\\"stackId\\", \\"userId\\")\\n      SELECT \\"id\\", \\"ownerId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_user_metadata_audit', '{"type":"function","name":"user_metadata_audit","sql":"CREATE OR REPLACE FUNCTION user_metadata_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO user_metadata_audit (\\"userId\\", \\"key\\")\\n      SELECT \\"userId\\", \\"key\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_metadata_audit', '{"type":"function","name":"asset_metadata_audit","sql":"CREATE OR REPLACE FUNCTION asset_metadata_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO asset_metadata_audit (\\"assetId\\", \\"key\\")\\n      SELECT \\"assetId\\", \\"key\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_edit_insert', '{"type":"function","name":"asset_edit_insert","sql":"CREATE OR REPLACE FUNCTION asset_edit_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE asset\\n      SET \\"isEdited\\" = true\\n      FROM inserted_edit\\n      WHERE asset.id = inserted_edit.\\"assetId\\" AND NOT asset.\\"isEdited\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_edit_delete', '{"type":"function","name":"asset_edit_delete","sql":"CREATE OR REPLACE FUNCTION asset_edit_delete()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE asset\\n      SET \\"isEdited\\" = false\\n      FROM deleted_edit\\n      WHERE asset.id = deleted_edit.\\"assetId\\" AND asset.\\"isEdited\\"\\n        AND NOT EXISTS (SELECT FROM asset_edit edit WHERE edit.\\"assetId\\" = asset.id);\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_edit_audit', '{"type":"function","name":"asset_edit_audit","sql":"CREATE OR REPLACE FUNCTION asset_edit_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO asset_edit_audit (\\"editId\\", \\"assetId\\")\\n      SELECT \\"id\\", \\"assetId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_user_delete_audit', '{"type":"trigger","name":"user_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"user_delete_audit\\"\\n  AFTER DELETE ON \\"user\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION user_delete_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_user_updatedAt', '{"type":"trigger","name":"user_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"user_updatedAt\\"\\n  BEFORE UPDATE ON \\"user\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_library_updatedAt', '{"type":"trigger","name":"library_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"library_updatedAt\\"\\n  BEFORE UPDATE ON \\"library\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_stack_delete_audit', '{"type":"trigger","name":"stack_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"stack_delete_audit\\"\\n  AFTER DELETE ON \\"stack\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION stack_delete_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_stack_updatedAt', '{"type":"trigger","name":"stack_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"stack_updatedAt\\"\\n  BEFORE UPDATE ON \\"stack\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_delete_audit', '{"type":"trigger","name":"asset_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"asset_delete_audit\\"\\n  AFTER DELETE ON \\"asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_delete_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_updatedAt', '{"type":"trigger","name":"asset_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"asset_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_id_timeline_notDeleted_idx', '{"type":"index","name":"asset_id_timeline_notDeleted_idx","sql":"CREATE INDEX \\"asset_id_timeline_notDeleted_idx\\" ON \\"asset\\" (\\"id\\") WHERE (visibility = ''timeline'' AND \\"deletedAt\\" IS NULL);"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_originalFilename_trigram_idx', '{"type":"index","name":"asset_originalFilename_trigram_idx","sql":"CREATE INDEX \\"asset_originalFilename_trigram_idx\\" ON \\"asset\\" USING gin (f_unaccent(\\"originalFileName\\") gin_trgm_ops);"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_localDateTime_month_idx', '{"type":"index","name":"asset_localDateTime_month_idx","sql":"CREATE INDEX \\"asset_localDateTime_month_idx\\" ON \\"asset\\" ((date_trunc(''MONTH''::text, (\\"localDateTime\\" AT TIME ZONE ''UTC''::text)) AT TIME ZONE ''UTC''::text));"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_localDateTime_idx', '{"type":"index","name":"asset_localDateTime_idx","sql":"CREATE INDEX \\"asset_localDateTime_idx\\" ON \\"asset\\" (((\\"localDateTime\\" at time zone ''UTC'')::date));"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_ownerId_libraryId_checksum_idx', '{"type":"index","name":"asset_ownerId_libraryId_checksum_idx","sql":"CREATE UNIQUE INDEX \\"asset_ownerId_libraryId_checksum_idx\\" ON \\"asset\\" (\\"ownerId\\", \\"libraryId\\", \\"checksum\\") WHERE (\\"libraryId\\" IS NOT NULL);"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_UQ_assets_owner_checksum', '{"type":"index","name":"UQ_assets_owner_checksum","sql":"CREATE UNIQUE INDEX \\"UQ_assets_owner_checksum\\" ON \\"asset\\" (\\"ownerId\\", \\"checksum\\") WHERE (\\"libraryId\\" IS NULL);"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_updatedAt', '{"type":"trigger","name":"album_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"album_updatedAt\\"\\n  BEFORE UPDATE ON \\"album\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_asset_delete_audit', '{"type":"trigger","name":"album_asset_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"album_asset_delete_audit\\"\\n  AFTER DELETE ON \\"album_asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() <= 1)\\n  EXECUTE FUNCTION album_asset_delete_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_asset_updatedAt', '{"type":"trigger","name":"album_asset_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"album_asset_updatedAt\\"\\n  BEFORE UPDATE ON \\"album_asset\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_activity_updatedAt', '{"type":"trigger","name":"activity_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"activity_updatedAt\\"\\n  BEFORE UPDATE ON \\"activity\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_activity_like_idx', '{"type":"index","name":"activity_like_idx","sql":"CREATE UNIQUE INDEX \\"activity_like_idx\\" ON \\"activity\\" (\\"assetId\\", \\"userId\\", \\"albumId\\") WHERE ((\\"isLiked\\" = true));"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_user_delete', '{"type":"trigger","name":"album_user_delete","sql":"CREATE OR REPLACE TRIGGER \\"album_user_delete\\"\\n  AFTER DELETE ON \\"album_user\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION album_user_delete();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_user_delete_audit', '{"type":"trigger","name":"album_user_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"album_user_delete_audit\\"\\n  AFTER DELETE ON \\"album_user\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() <= 1)\\n  EXECUTE FUNCTION album_user_delete_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_user_after_insert', '{"type":"trigger","name":"album_user_after_insert","sql":"CREATE OR REPLACE TRIGGER \\"album_user_after_insert\\"\\n  AFTER INSERT ON \\"album_user\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION album_user_after_insert();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_user_updatedAt', '{"type":"trigger","name":"album_user_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"album_user_updatedAt\\"\\n  BEFORE UPDATE ON \\"album_user\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_album_user_unique_owner', '{"type":"index","name":"album_user_unique_owner","sql":"CREATE UNIQUE INDEX \\"album_user_unique_owner\\" ON \\"album_user\\" (\\"albumId\\") WHERE (role = ''owner'');"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_api_key_updatedAt', '{"type":"trigger","name":"api_key_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"api_key_updatedAt\\"\\n  BEFORE UPDATE ON \\"api_key\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_edit_audit', '{"type":"trigger","name":"asset_edit_audit","sql":"CREATE OR REPLACE TRIGGER \\"asset_edit_audit\\"\\n  AFTER DELETE ON \\"asset_edit\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_edit_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_edit_delete', '{"type":"trigger","name":"asset_edit_delete","sql":"CREATE OR REPLACE TRIGGER \\"asset_edit_delete\\"\\n  AFTER DELETE ON \\"asset_edit\\"\\n  REFERENCING OLD TABLE AS \\"deleted_edit\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_edit_delete();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_edit_insert', '{"type":"trigger","name":"asset_edit_insert","sql":"CREATE OR REPLACE TRIGGER \\"asset_edit_insert\\"\\n  AFTER INSERT ON \\"asset_edit\\"\\n  REFERENCING NEW TABLE AS \\"inserted_edit\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION asset_edit_insert();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_edit_updatedAt', '{"type":"trigger","name":"asset_edit_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"asset_edit_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_edit\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_exif_updatedAt', '{"type":"trigger","name":"asset_exif_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"asset_exif_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_exif\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_IDX_asset_exif_gist_earthcoord', '{"type":"index","name":"IDX_asset_exif_gist_earthcoord","sql":"CREATE INDEX \\"IDX_asset_exif_gist_earthcoord\\" ON \\"asset_exif\\" USING gist (ll_to_earth_public(latitude, longitude));"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_file_updatedAt', '{"type":"trigger","name":"asset_file_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"asset_file_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_file\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_metadata_audit', '{"type":"trigger","name":"asset_metadata_audit","sql":"CREATE OR REPLACE TRIGGER \\"asset_metadata_audit\\"\\n  AFTER DELETE ON \\"asset_metadata\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_metadata_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_metadata_updated_at', '{"type":"trigger","name":"asset_metadata_updated_at","sql":"CREATE OR REPLACE TRIGGER \\"asset_metadata_updated_at\\"\\n  BEFORE UPDATE ON \\"asset_metadata\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_IDX_geodata_gist_earthcoord', '{"type":"index","name":"IDX_geodata_gist_earthcoord","sql":"CREATE INDEX \\"IDX_geodata_gist_earthcoord\\" ON \\"geodata_places\\" (ll_to_earth_public(latitude, longitude));"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_idx_geodata_places_name', '{"type":"index","name":"idx_geodata_places_name","sql":"CREATE INDEX \\"idx_geodata_places_name\\" ON \\"geodata_places\\" USING gin (f_unaccent(\\"name\\") gin_trgm_ops);"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_idx_geodata_places_admin2_name', '{"type":"index","name":"idx_geodata_places_admin2_name","sql":"CREATE INDEX \\"idx_geodata_places_admin2_name\\" ON \\"geodata_places\\" USING gin (f_unaccent(\\"admin2Name\\") gin_trgm_ops);"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_idx_geodata_places_admin1_name', '{"type":"index","name":"idx_geodata_places_admin1_name","sql":"CREATE INDEX \\"idx_geodata_places_admin1_name\\" ON \\"geodata_places\\" USING gin (f_unaccent(\\"admin1Name\\") gin_trgm_ops);"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_idx_geodata_places_alternate_names', '{"type":"index","name":"idx_geodata_places_alternate_names","sql":"CREATE INDEX \\"idx_geodata_places_alternate_names\\" ON \\"geodata_places\\" USING gin (f_unaccent(\\"alternateNames\\") gin_trgm_ops);"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_memory_delete_audit', '{"type":"trigger","name":"memory_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"memory_delete_audit\\"\\n  AFTER DELETE ON \\"memory\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION memory_delete_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_memory_updatedAt', '{"type":"trigger","name":"memory_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"memory_updatedAt\\"\\n  BEFORE UPDATE ON \\"memory\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_memory_asset_delete_audit', '{"type":"trigger","name":"memory_asset_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"memory_asset_delete_audit\\"\\n  AFTER DELETE ON \\"memory_asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() <= 1)\\n  EXECUTE FUNCTION memory_asset_delete_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_memory_asset_updatedAt', '{"type":"trigger","name":"memory_asset_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"memory_asset_updatedAt\\"\\n  BEFORE UPDATE ON \\"memory_asset\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_notification_updatedAt', '{"type":"trigger","name":"notification_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"notification_updatedAt\\"\\n  BEFORE UPDATE ON \\"notification\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_partner_delete_audit', '{"type":"trigger","name":"partner_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"partner_delete_audit\\"\\n  AFTER DELETE ON \\"partner\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION partner_delete_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_partner_updatedAt', '{"type":"trigger","name":"partner_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"partner_updatedAt\\"\\n  BEFORE UPDATE ON \\"partner\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_session_updatedAt', '{"type":"trigger","name":"session_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"session_updatedAt\\"\\n  BEFORE UPDATE ON \\"session\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_session_sync_checkpoint_updatedAt', '{"type":"trigger","name":"session_sync_checkpoint_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"session_sync_checkpoint_updatedAt\\"\\n  BEFORE UPDATE ON \\"session_sync_checkpoint\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_tag_updatedAt', '{"type":"trigger","name":"tag_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"tag_updatedAt\\"\\n  BEFORE UPDATE ON \\"tag\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_user_metadata_audit', '{"type":"trigger","name":"user_metadata_audit","sql":"CREATE OR REPLACE TRIGGER \\"user_metadata_audit\\"\\n  AFTER DELETE ON \\"user_metadata\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION user_metadata_audit();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_user_metadata_updated_at', '{"type":"trigger","name":"user_metadata_updated_at","sql":"CREATE OR REPLACE TRIGGER \\"user_metadata_updated_at\\"\\n  BEFORE UPDATE ON \\"user_metadata\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_workflow_updatedAt', '{"type":"trigger","name":"workflow_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"workflow_updatedAt\\"\\n  BEFORE UPDATE ON \\"workflow\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP EXTENSION "uuid-ossp";`.execute(db);
  await sql`DROP EXTENSION "unaccent";`.execute(db);
  await sql`DROP EXTENSION "cube";`.execute(db);
  await sql`DROP EXTENSION "earthdistance";`.execute(db);
  await sql`DROP EXTENSION "pg_trgm";`.execute(db);
  await sql`DROP FUNCTION immich_uuid_v7;`.execute(db);
  await sql`DROP TRIGGER "album_user_after_insert" ON "album_user";`.execute(db);
  await sql`DROP FUNCTION album_user_after_insert;`.execute(db);
  await sql`DROP TRIGGER "user_updatedAt" ON "user";`.execute(db);
  await sql`DROP TRIGGER "library_updatedAt" ON "library";`.execute(db);
  await sql`DROP TRIGGER "stack_updatedAt" ON "stack";`.execute(db);
  await sql`DROP TRIGGER "asset_updatedAt" ON "asset";`.execute(db);
  await sql`DROP TRIGGER "album_updatedAt" ON "album";`.execute(db);
  await sql`DROP TRIGGER "album_asset_updatedAt" ON "album_asset";`.execute(db);
  await sql`DROP TRIGGER "activity_updatedAt" ON "activity";`.execute(db);
  await sql`DROP TRIGGER "album_user_updatedAt" ON "album_user";`.execute(db);
  await sql`DROP TRIGGER "api_key_updatedAt" ON "api_key";`.execute(db);
  await sql`DROP TRIGGER "asset_edit_updatedAt" ON "asset_edit";`.execute(db);
  await sql`DROP TRIGGER "asset_exif_updatedAt" ON "asset_exif";`.execute(db);
  await sql`DROP TRIGGER "asset_file_updatedAt" ON "asset_file";`.execute(db);
  await sql`DROP TRIGGER "asset_metadata_updated_at" ON "asset_metadata";`.execute(db);
  await sql`DROP TRIGGER "memory_updatedAt" ON "memory";`.execute(db);
  await sql`DROP TRIGGER "memory_asset_updatedAt" ON "memory_asset";`.execute(db);
  await sql`DROP TRIGGER "notification_updatedAt" ON "notification";`.execute(db);
  await sql`DROP TRIGGER "partner_updatedAt" ON "partner";`.execute(db);
  await sql`DROP TRIGGER "session_updatedAt" ON "session";`.execute(db);
  await sql`DROP TRIGGER "session_sync_checkpoint_updatedAt" ON "session_sync_checkpoint";`.execute(db);
  await sql`DROP TRIGGER "tag_updatedAt" ON "tag";`.execute(db);
  await sql`DROP TRIGGER "user_metadata_updated_at" ON "user_metadata";`.execute(db);
  await sql`DROP TRIGGER "workflow_updatedAt" ON "workflow";`.execute(db);
  await sql`DROP FUNCTION updated_at;`.execute(db);
  await sql`DROP FUNCTION f_concat_ws;`.execute(db);
  await sql`DROP FUNCTION f_unaccent;`.execute(db);
  await sql`DROP FUNCTION ll_to_earth_public;`.execute(db);
  await sql`DROP TRIGGER "user_delete_audit" ON "user";`.execute(db);
  await sql`DROP FUNCTION user_delete_audit;`.execute(db);
  await sql`DROP TRIGGER "partner_delete_audit" ON "partner";`.execute(db);
  await sql`DROP FUNCTION partner_delete_audit;`.execute(db);
  await sql`DROP TRIGGER "asset_delete_audit" ON "asset";`.execute(db);
  await sql`DROP FUNCTION asset_delete_audit;`.execute(db);
  await sql`DROP TRIGGER "album_asset_delete_audit" ON "album_asset";`.execute(db);
  await sql`DROP FUNCTION album_asset_delete_audit;`.execute(db);
  await sql`DROP TRIGGER "album_user_delete" ON "album_user";`.execute(db);
  await sql`DROP FUNCTION album_user_delete;`.execute(db);
  await sql`DROP TRIGGER "album_user_delete_audit" ON "album_user";`.execute(db);
  await sql`DROP FUNCTION album_user_delete_audit;`.execute(db);
  await sql`DROP TRIGGER "memory_delete_audit" ON "memory";`.execute(db);
  await sql`DROP FUNCTION memory_delete_audit;`.execute(db);
  await sql`DROP TRIGGER "memory_asset_delete_audit" ON "memory_asset";`.execute(db);
  await sql`DROP FUNCTION memory_asset_delete_audit;`.execute(db);
  await sql`DROP TRIGGER "stack_delete_audit" ON "stack";`.execute(db);
  await sql`DROP FUNCTION stack_delete_audit;`.execute(db);
  await sql`DROP TRIGGER "user_metadata_audit" ON "user_metadata";`.execute(db);
  await sql`DROP FUNCTION user_metadata_audit;`.execute(db);
  await sql`DROP TRIGGER "asset_metadata_audit" ON "asset_metadata";`.execute(db);
  await sql`DROP FUNCTION asset_metadata_audit;`.execute(db);
  await sql`DROP TRIGGER "asset_edit_insert" ON "asset_edit";`.execute(db);
  await sql`DROP FUNCTION asset_edit_insert;`.execute(db);
  await sql`DROP TRIGGER "asset_edit_delete" ON "asset_edit";`.execute(db);
  await sql`DROP FUNCTION asset_edit_delete;`.execute(db);
  await sql`DROP TRIGGER "asset_edit_audit" ON "asset_edit";`.execute(db);
  await sql`DROP FUNCTION asset_edit_audit;`.execute(db);
  await sql`ALTER TABLE "stack" DROP CONSTRAINT "stack_primaryAssetId_fkey";`.execute(db);
  await sql`ALTER TABLE "asset" DROP CONSTRAINT "asset_livePhotoVideoId_fkey";`.execute(db);
  await sql`ALTER TABLE "session" DROP CONSTRAINT "session_parentId_fkey";`.execute(db);
  await sql`ALTER TABLE "tag" DROP CONSTRAINT "tag_parentId_fkey";`.execute(db);
  await sql`DROP TABLE "album_user";`.execute(db);
  await sql`DROP TYPE "album_user_role_enum";`.execute(db);
  await sql`DROP TABLE "activity";`.execute(db);
  await sql`DROP TABLE "album_asset";`.execute(db);
  await sql`DROP TABLE "album_asset_audit";`.execute(db);
  await sql`DROP TABLE "shared_link_asset";`.execute(db);
  await sql`DROP TABLE "shared_link";`.execute(db);
  await sql`DROP TABLE "album";`.execute(db);
  await sql`DROP TABLE "asset_edit";`.execute(db);
  await sql`DROP TABLE "asset_exif";`.execute(db);
  await sql`DROP TABLE "integrity_report";`.execute(db);
  await sql`DROP TABLE "asset_file";`.execute(db);
  await sql`DROP TABLE "asset_job_status";`.execute(db);
  await sql`DROP TABLE "asset_metadata";`.execute(db);
  await sql`DROP TABLE "memory_asset";`.execute(db);
  await sql`DROP TABLE "tag_asset";`.execute(db);
  await sql`DROP TABLE "video_stream_segment";`.execute(db);
  await sql`DROP TABLE "video_stream_variant";`.execute(db);
  await sql`DROP TABLE "video_stream_session";`.execute(db);
  await sql`DROP TABLE "asset_audio";`.execute(db);
  await sql`DROP TABLE "asset_video";`.execute(db);
  await sql`DROP TABLE "asset_keyframe";`.execute(db);
  await sql`DROP TABLE "asset";`.execute(db);
  await sql`DROP TYPE "assets_status_enum";`.execute(db);
  await sql`DROP TYPE "asset_visibility_enum";`.execute(db);
  await sql`DROP TYPE "asset_checksum_algorithm_enum";`.execute(db);
  await sql`DROP TYPE "video_stream_variant_codec_enum";`.execute(db);
  await sql`DROP TABLE "library";`.execute(db);
  await sql`DROP TABLE "stack";`.execute(db);
  await sql`DROP TABLE "api_key";`.execute(db);
  await sql`DROP TABLE "memory_asset_audit";`.execute(db);
  await sql`DROP TABLE "memory";`.execute(db);
  await sql`DROP TABLE "notification";`.execute(db);
  await sql`DROP TABLE "partner";`.execute(db);
  await sql`DROP TABLE "session_sync_checkpoint";`.execute(db);
  await sql`DROP TABLE "session";`.execute(db);
  await sql`DROP TABLE "tag_closure";`.execute(db);
  await sql`DROP TABLE "tag";`.execute(db);
  await sql`DROP TABLE "user_metadata";`.execute(db);
  await sql`DROP TABLE "workflow_log";`.execute(db);
  await sql`DROP TABLE "workflow_step";`.execute(db);
  await sql`DROP TABLE "workflow";`.execute(db);
  await sql`DROP TABLE "user";`.execute(db);
  await sql`DROP TABLE "album_audit";`.execute(db);
  await sql`DROP TABLE "album_user_audit";`.execute(db);
  await sql`DROP TABLE "asset_audit";`.execute(db);
  await sql`DROP TABLE "asset_edit_audit";`.execute(db);
  await sql`DROP TABLE "asset_metadata_audit";`.execute(db);
  await sql`DROP TABLE "geodata_places";`.execute(db);
  await sql`DROP TABLE "memory_audit";`.execute(db);
  await sql`DROP TABLE "move_history";`.execute(db);
  await sql`DROP TABLE "naturalearth_countries";`.execute(db);
  await sql`DROP TABLE "partner_audit";`.execute(db);
  await sql`DROP TABLE "plugin_method";`.execute(db);
  await sql`DROP TABLE "plugin";`.execute(db);
  await sql`DROP TABLE "stack_audit";`.execute(db);
  await sql`DROP TABLE "system_metadata";`.execute(db);
  await sql`DROP TABLE "user_audit";`.execute(db);
  await sql`DROP TABLE "user_metadata_audit";`.execute(db);
  await sql`DROP TABLE "version_history";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_immich_uuid_v7';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_album_user_after_insert';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_updated_at';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_f_concat_ws';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_f_unaccent';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_ll_to_earth_public';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_user_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_partner_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_asset_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_album_asset_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_album_user_delete';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_album_user_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_memory_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_memory_asset_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_stack_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_user_metadata_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_asset_metadata_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_asset_edit_insert';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_asset_edit_delete';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_asset_edit_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_user_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_user_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_library_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_stack_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_stack_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_id_timeline_notDeleted_idx';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_originalFilename_trigram_idx';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_localDateTime_month_idx';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_localDateTime_idx';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_ownerId_libraryId_checksum_idx';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_UQ_assets_owner_checksum';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_album_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_album_asset_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_album_asset_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_activity_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_activity_like_idx';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_album_user_delete';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_album_user_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_album_user_after_insert';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_album_user_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_album_user_unique_owner';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_api_key_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_edit_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_edit_delete';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_edit_insert';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_edit_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_exif_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_IDX_asset_exif_gist_earthcoord';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_file_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_metadata_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_metadata_updated_at';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_IDX_geodata_gist_earthcoord';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_geodata_places_name';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_geodata_places_admin2_name';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_geodata_places_admin1_name';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_geodata_places_alternate_names';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_memory_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_memory_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_memory_asset_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_memory_asset_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_notification_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_partner_delete_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_partner_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_session_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_session_sync_checkpoint_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_tag_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_user_metadata_audit';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_user_metadata_updated_at';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_workflow_updatedAt';`.execute(db);
  await sql`DROP TABLE "migration_overrides";`.execute(db);
}
