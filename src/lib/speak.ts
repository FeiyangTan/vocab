/**
 * 朗读英文。Web Speech API，浏览器自带，不花钱。
 *
 * 复习页读 lemma，也读对比词 —— 对比词很多是**读音**相近才容易混，
 * 光看拼写体会不出来，必须能听。
 */
export function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  // 连点两个词时，后一个要能打断前一个
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
