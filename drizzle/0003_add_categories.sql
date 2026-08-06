CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 把原来写死的两个 domain 变成真正的分类行。下一个迁移靠 name 回填 words.category_id，
-- 所以这里的 name 必须和 word_domain 枚举的字面量一字不差。
INSERT INTO "categories" ("name", "sort_order", "is_default") VALUES
	('work', 0, true),
	('daily', 1, false);
