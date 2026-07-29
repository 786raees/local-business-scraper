import { CallStateTracker } from './callState'
import { dial, hangUp } from './dialer'
import { SEL } from './selectors'
import type { BgToContent, ContentToBg } from '../shared/messages'
import type { CallState } from '../shared/types'

/**
 * Content script for voice.google.com — the session's hands (dial/hangUp) and
 * eyes (call-state observer). Inert unless a dial was requested; the user
 * browsing Voice manually produces zero events (ARCHITECTURE §6.3/§6.4).
 */

const tracker = new CallStateTracker()
let observer: MutationObserver | null = null
let timerPoll: ReturnType<typeof setInterval> | null = null

function emit(msg: ContentToBg): void {
  chrome.runtime.sendMessage(msg).catch(() => {})
}

function observeOnce(): void {
  // Active call = end-call button present (gv-in-call itself is always mounted).
  const endBtn = document.querySelector(SEL.activeCallMarker)
  const container = endBtn?.closest(SEL.activeCallContainer) ?? endBtn?.parentElement
  const next = tracker.update({
    widgetPresent: endBtn !== null,
    timerText: container?.textContent ?? null,
  })
  if (next) {
    emit({ kind: 'voice/callState', state: next })
    if (next === 'ended') disconnect()
  }
}

function connect(): void {
  if (observer) return
  observer = new MutationObserver(observeOnce)
  observer.observe(document.body, { childList: true, subtree: true })
  // Timer digits advance without structural mutations — poll while active.
  timerPoll = setInterval(observeOnce, 1000)
}

function disconnect(): void {
  observer?.disconnect()
  observer = null
  if (timerPoll !== null) clearInterval(timerPoll)
  timerPoll = null
  tracker.reset()
}

chrome.runtime.onMessage.addListener(
  (msg: BgToContent, _sender, sendResponse: (r: unknown) => void) => {
    switch (msg.kind) {
      case 'voice/dial': {
        void (async () => {
          emit({ kind: 'voice/callState', state: tracker.dialRequested() })
          connect()
          const result = await dial(msg.phone)
          if (result !== 'ok') {
            disconnect()
            emit({ kind: 'voice/error', reason: result })
          }
          sendResponse({ ok: result === 'ok', result })
        })()
        return true
      }
      case 'voice/hangUp': {
        sendResponse({ ok: hangUp() })
        return false
      }
      case 'voice/probe': {
        const state: CallState = tracker.current
        sendResponse({ state, loggedOut: document.querySelector(SEL.loginMarker) !== null })
        return false
      }
      default:
        // Snapshot broadcasts and panel traffic also land here — ignore them.
        return false
    }
  },
)

console.log('[gv-quick-dial] content script alive on', location.host)
