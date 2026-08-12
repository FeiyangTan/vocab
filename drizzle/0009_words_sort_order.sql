-- drizzle 生成的是 `ADD COLUMN … NOT NULL DEFAULT 0`，那样 223 行会全部变成 0、
-- 现有的字母序当场丢掉。手工拆成「先可空 → 按字母序回填 → 再收紧」。
ALTER TABLE "words" ADD COLUMN "sort_order" integer;--> statement-breakpoint
UPDATE "words" w SET "sort_order" = s.rn
  FROM (SELECT id, row_number() OVER (ORDER BY lemma) AS rn FROM "words") s
  WHERE w.id = s.id;--> statement-breakpoint
ALTER TABLE "words" ALTER COLUMN "sort_order" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ALTER COLUMN "sort_order" SET DEFAULT 0;
