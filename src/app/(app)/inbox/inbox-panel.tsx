'use client';

import { useState } from 'react';
import { CaptureBox } from './capture-box';
import { type CategoryOption, type InboxItem, ReviewList } from './review-list';

/**
 * 收集箱页面的 client 外壳，唯一的存在理由是**托管那个分类选择**。
 *
 * 顶部的「存到」是一个总开关，管两件事：新存入的落在哪个分类、**确认时存到哪个分类**。
 * 所以它不能待在 `CaptureBox` 里面 —— 审核卡也要读它。
 *
 * 为什么是总开关而不是每条各选：同一件事问两遍是多余的，一批词通常本来就属于同一类。
 * 换开关时下面审核卡的「归类」会立刻跟着变，改错了一眼看得见。
 */
export function InboxPanel({
  categories,
  items,
  unprocessed,
}: {
  categories: CategoryOption[];
  items: InboxItem[];
  unprocessed: number;
}) {
  const [categoryId, setCategoryId] = useState<number | null>(
    // 初值取**第一条待审核条目存入时选的分类** —— 隔了一天回来接着审时，
    // 开关停在这批词当初被存进去的地方，而不是傻回默认分类。
    items.find((i) => i.categoryId && categories.some((c) => c.id === i.categoryId))?.categoryId ??
      categories.find((c) => c.isDefault)?.id ??
      categories[0]?.id ??
      null,
  );

  return (
    <>
      <CaptureBox
        categories={categories}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
      />
      <ReviewList
        items={items}
        unprocessed={unprocessed}
        categories={categories}
        categoryId={categoryId}
      />
    </>
  );
}
