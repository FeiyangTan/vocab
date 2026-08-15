CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Turn the two previously hardcoded domains into real category rows. The next migration
-- backfills words.category_id by name, so these names must match the word_domain enum
-- literals exactly.
INSERT INTO "categories" ("name", "sort_order", "is_default") VALUES
	('work', 0, true),
	('daily', 1, false);
