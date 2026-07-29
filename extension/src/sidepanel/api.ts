import type { PanelToBg, Result } from '../shared/messages'

/** Typed request/response to the background worker. */
export function send<T>(msg: PanelToBg): Promise<Result<T>> {
  return chrome.runtime.sendMessage<PanelToBg, Result<T>>(msg).catch((err: unknown) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : String(err),
  }))
}
