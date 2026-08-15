-- drizzle generated `ADD COLUMN … NOT NULL DEFAULT 0`, which would set all 223 rows to 0 and
-- destroy the existing alphabetical order on the spot. Split by hand into nullable → backfill
-- alphabetically → tighten.
ALTER TABLE "words" ADD COLUMN "sort_order" integer;--> statement-breakpoint
UPDATE "words" w SET "sort_order" = s.rn
  FROM (SELECT id, row_number() OVER (ORDER BY lemma) AS rn FROM "words") s
  WHERE w.id = s.id;--> statement-breakpoint
ALTER TABLE "words" ALTER COLUMN "sort_order" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ALTER COLUMN "sort_order" SET DEFAULT 0;
