/**
 * The ONLY sanctioned home for colour values outside tokens.css: contexts CSS
 * can't reach (chrome.action badge in the service worker). Values mirror
 * tokens.css §2.3 — change both together.
 */
export const BADGE_COLORS = {
  ringing: '#ffbf00', // --state-ringing
  inCall: '#21c25e', // --state-incall
  error: '#d83333', // --state-error
} as const
