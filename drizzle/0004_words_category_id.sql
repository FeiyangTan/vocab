-- drizzle generated `ADD COLUMN "category_id" integer NOT NULL`, which fails outright against
-- the 34 existing rows. Split by hand into nullable → backfill → tighten; the end state
-- matches the snapshot.
ALTER TABLE "words" ADD COLUMN "category_id" integer;--> statement-breakpoint
UPDATE "words" SET "category_id" = c."id" FROM "categories" c WHERE c."name" = "words"."domain"::text;--> statement-breakpoint
ALTER TABLE "words" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;
