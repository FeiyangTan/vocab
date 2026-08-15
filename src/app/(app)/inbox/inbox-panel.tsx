'use client';

import { useState } from 'react';
import { CaptureBox } from './capture-box';
import { type CategoryOption, type InboxItem, ReviewList } from './review-list';

/**
 * The inbox page's client shell. Its only reason to exist is **holding the category
 * selection**.
 *
 * The "Save to" control at the top governs two things: which category new captures land in,
 * and **which category confirming files them into**. So it can't live inside `CaptureBox` —
 * the review cards read it too.
 *
 * Why one master control rather than a picker per item: asking the same question twice is
 * redundant, and a batch of words usually belongs to one category anyway. Switching it updates
 * the review cards' filing immediately, so a wrong choice is visible at a glance.
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
    // The initial value is **the category the first pending item was captured into** — coming
    // back a day later to continue reviewing, the control sits where this batch was actually
    // filed rather than snapping back to the default.
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
