import { redirect } from 'next/navigation';

/**
 * This used to be a "three entry points" splash. Now that all three live permanently on the
 * menu with their own count badges, this layer is just an extra tap — so it goes straight to
 * review, which is what opening the app is usually for.
 */
export default function Home() {
  redirect('/review');
}
