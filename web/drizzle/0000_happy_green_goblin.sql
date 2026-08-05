CREATE TYPE "public"."inbox_status" AS ENUM('pending', 'processed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."word_domain" AS ENUM('work', 'daily');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"encounter_id" bigint NOT NULL,
	"cloze_text" text NOT NULL,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"ease" real DEFAULT 2.5 NOT NULL,
	"interval" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"word_id" bigint NOT NULL,
	"raw_text" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"raw_text" text NOT NULL,
	"source" text NOT NULL,
	"status" "inbox_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "words" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"lemma" text NOT NULL,
	"domain" "word_domain" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_due_idx" ON "cards" USING btree ("due");--> statement-breakpoint
CREATE INDEX "cards_encounter_id_idx" ON "cards" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "encounters_word_id_idx" ON "encounters" USING btree ("word_id");--> statement-breakpoint
CREATE INDEX "inbox_status_created_at_idx" ON "inbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "words_lemma_idx" ON "words" USING btree ("lemma");