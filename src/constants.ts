/** Max stego output characters (Unicode codepoints). Keeps output within
 *  high-limit messenger caps (e.g. WhatsApp ~65K) and ensures fast decoding
 *  on slow devices. */
export const MAX_STEGO_CHARS = 50_000;

/** Platform fit thresholds for the status bar color coding.
 *  Ordered smallest-first so `.find(t => chars <= t.limit)` picks the tightest fit. */
export const OUTPUT_THRESHOLDS = [
  { limit: 280, color: '#34c759' },    // tweet
  { limit: 4096, color: '#8e8e93' },   // Telegram
  { limit: 50_000, color: '#d97706' }, // WhatsApp-only
] as const;
