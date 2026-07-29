/**
 * ALL Google Voice DOM selectors live here — the single source of truth,
 * the analogue of Atlas's scraper/selectors.ts. If dialing or call-state
 * detection breaks after a Voice markup change, fix ONLY this file.
 *
 * Verified against the live product (2026-07, /u/N/calls layout):
 * - The dial input is `gv-call-sidebar input` with placeholder
 *   "Enter a name or number" and NO aria-label.
 * - The place-call button's aria-label is "No contact selected" while empty
 *   and becomes "Call + 1 3 0 5 …" once a number is entered — so we match
 *   aria-label^="Call" and require it enabled.
 * - `gv-in-call` is ALWAYS present (it hosts the whole sidebar), so it is
 *   NOT an active-call signal. Active call = end-call button present.
 */
export const SEL = {
  /** The dial input ("Enter a name or number"). */
  dialpadInput: [
    'gv-call-sidebar input[placeholder*="name or number" i]',
    'gv-make-call-panel input[placeholder*="name or number" i]',
    'gv-in-call input[placeholder*="number" i]',
  ].join(', '),

  /** The place-call button once a number is entered (enabled-check in code). */
  callButton: [
    'gv-call-sidebar button[aria-label^="Call" i]',
    'gv-make-call-panel button[aria-label^="Call" i]',
  ].join(', '),

  /** Present ONLY during an active (connecting/ringing/live) call. */
  activeCallMarker: [
    'button[aria-label*="end call" i]',
    'button[aria-label*="hang up" i]',
  ].join(', '),

  /** Ancestor of the active-call UI whose text carries the m:ss timer. */
  activeCallContainer: 'gv-in-call, gv-call-sidebar',

  /** Present when the page is signed out / bounced to login. */
  loginMarker: [
    'a[href*="accounts.google.com/ServiceLogin"]',
    'a[href*="accounts.google.com/signin"]',
  ].join(', '),
}

/**
 * Deep link that opens Voice with a number pre-loaded for a new call.
 * MUST be account-aware: hardcoding /u/0/ logs out users whose Voice session
 * is a different account index (observed live at /u/9/).
 */
export const newCallUrl = (e164: string): string => {
  const account = /\/u\/\d+\//.exec(location.pathname)?.[0] ?? '/'
  return `https://voice.google.com${account}calls?a=nc,${encodeURIComponent(e164)}`
}
