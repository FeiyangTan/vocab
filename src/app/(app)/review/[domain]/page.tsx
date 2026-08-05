import { notFound } from 'next/navigation';
import { ReviewSession } from './review-session';

export const dynamic = 'force-dynamic';

export default async function DomainReviewPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  if (domain !== 'work' && domain !== 'daily') notFound();

  return <ReviewSession domain={domain} />;
}
