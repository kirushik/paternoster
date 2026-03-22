/**
 * Text-to-Speech decoy: reads themed text aloud.
 *
 * Uses the browser SpeechSynthesis API. Picks a voice matching the
 * theme's language; if none found, leaves voice unset so the browser
 * resolves via utterance.lang (may use cloud voices not in getVoices()).
 */

function loadVoices(): void {
  // Trigger eager caching — some browsers only populate getVoices() after the first call.
  speechSynthesis.getVoices();
}

// Voices may load asynchronously
if (typeof speechSynthesis !== 'undefined') {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

/** Speak text aloud. Returns true if speaking started. */
export function speak(text: string, lang = 'ru-RU'): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voices = speechSynthesis.getVoices();
  const langPrefix = lang.split('-')[0];
  const voice = voices.find(v => v.lang.startsWith(langPrefix));
  if (voice) utterance.voice = voice;
  // If no matching voice found, utterance.lang alone guides synthesis —
  // the browser may still resolve it via cloud/system voices.
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
  return true;
}

/** Check if a voice is available for the given language. */
export function hasVoiceForLang(lang: string): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  const prefix = lang.split('-')[0];
  return speechSynthesis.getVoices().some(v => v.lang.startsWith(prefix));
}

/** Register a callback for when available voices change (they load asynchronously). */
export function onVoicesChanged(cb: () => void): void {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.addEventListener('voiceschanged', cb);
  }
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
