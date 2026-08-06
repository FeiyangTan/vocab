-- drizzle 生成的是 `ADD COLUMN "category_id" integer NOT NULL`，在已有 34 行数据上会直接失败。
-- 手工拆成「先可空 → 回填 → 再收紧」，末尾状态和 snapshot 一致。
ALTER TABLE "words" ADD COLUMN "category_id" integer;--> statement-breakpoint
UPDATE "words" SET "category_id" = c."id" FROM "categories" c WHERE c."name" = "words"."domain"::text;--> statement-breakpoint
ALTER TABLE "words" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;
