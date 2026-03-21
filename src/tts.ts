/**
 * Text-to-Speech decoy: reads themed text aloud.
 *
 * Uses the browser SpeechSynthesis API. Tries to find a Russian voice;
 * falls back to default (which may mispronounce — arguably funnier).
 */

let russianVoice: SpeechSynthesisVoice | null = null;
// voicesLoaded tracked implicitly by russianVoice being non-null

function loadVoices(): void {
  const voices = speechSynthesis.getVoices();
  russianVoice = voices.find(v => v.lang.startsWith('ru')) ?? null;
}

// Voices may load asynchronously
if (typeof speechSynthesis !== 'undefined') {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

/** Speak text aloud. Returns true if speaking started. */
export function speak(text: string): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  if (russianVoice) utterance.voice = russianVoice;
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
  return true;
}

/** Stop speaking. */
export function stopSpeaking(): void {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel();
  }
}

/** Check if currently speaking. */
export function isSpeaking(): boolean {
  return typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking;
}
