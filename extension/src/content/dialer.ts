import { SEL, newCallUrl } from './selectors'

/**
 * Dial / hang up against the Voice DOM (ARCHITECTURE §6.2). All DOM shape
 * knowledge stays in selectors.ts; this file only acts on it.
 */

const q = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor<T extends Element>(sel: string, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const el = q<T>(sel)
    if (el) return el
    if (Date.now() > deadline) return null
    await sleep(250)
  }
}

export type DialResult = 'ok' | 'dialer-not-found' | 'not-logged-in' | 'dial-failed'

/**
 * Angular only sees input set through the native value setter + an `input`
 * event — a bare `.value =` is invisible to it.
 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export async function dial(phone: string): Promise<DialResult> {
  if (q(SEL.loginMarker)) return 'not-logged-in'

  const input = await waitFor<HTMLInputElement>(SEL.dialpadInput, 5000)
  if (!input) {
    // Dialpad not mounted — fall back to Voice's new-call deep link.
    const digits = phone.replace(/[^\d+]/g, '')
    if (digits) {
      location.href = newCallUrl(digits.startsWith('+') ? digits : `+${digits}`)
      return 'ok'
    }
    return q(SEL.loginMarker) ? 'not-logged-in' : 'dialer-not-found'
  }

  input.focus()
  setInputValue(input, phone)

  // The call button only gains its "Call …" aria-label (and enables) after
  // Angular digests the input — poll for the enabled state, not mere presence.
  const deadline = Date.now() + 3000
  for (;;) {
    const button = q<HTMLButtonElement>(SEL.callButton)
    if (button && !button.disabled) {
      button.click()
      return 'ok'
    }
    if (Date.now() > deadline) return 'dial-failed'
    await sleep(250)
  }
}

export function hangUp(): boolean {
  const button = q<HTMLButtonElement>(SEL.activeCallMarker)
  button?.click()
  return button !== null
}
