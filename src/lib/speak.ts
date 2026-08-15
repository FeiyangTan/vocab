/**
 * Speak English aloud. Web Speech API — built into the browser, costs nothing.
 *
 * The review page speaks the lemma, and confusables too — a lot of confusables are
 * confusable because they **sound** alike, which you can't feel from the spelling.
 * Being able to hear them is the point.
 */
export function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  // Tapping two words in a row: the second has to cut the first off
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
