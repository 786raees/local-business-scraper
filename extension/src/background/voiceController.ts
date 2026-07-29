import type { BgToContent } from '../shared/messages'

/**
 * Voice tab management (ARCHITECTURE §7.2): find-or-create the Voice tab,
 * message its content script, and inject the script first when messaging
 * finds no receiver (tab predates install/reload).
 */

const VOICE_URL = 'https://voice.google.com/'

export async function ensureVoiceTab(focus = false): Promise<chrome.tabs.Tab> {
  const existing = await chrome.tabs.query({ url: 'https://voice.google.com/*' })
  const tab = existing[0] ?? (await chrome.tabs.create({ url: VOICE_URL, active: focus }))
  if (focus && tab.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true })
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
  }
  return tab
}

async function inject(tabId: number): Promise<void> {
  // Resolve the built content-script files from the manifest — the bundler
  // hashes filenames, so a hardcoded source path would miss in dist/.
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
  if (files.length === 0) throw new Error('No content script declared in manifest.')
  await chrome.scripting.executeScript({ target: { tabId }, files })
}

/**
 * Send to the Voice content script, injecting it on a no-receiver failure.
 * Focuses the tab on dial so the user can talk (UX S4).
 */
export async function sendToVoice<T>(msg: BgToContent): Promise<T> {
  const tab = await ensureVoiceTab(msg.kind === 'voice/dial')
  if (tab.id === undefined) throw new Error('Voice tab has no id.')
  try {
    return await chrome.tabs.sendMessage<BgToContent, T>(tab.id, msg)
  } catch {
    await inject(tab.id)
    return chrome.tabs.sendMessage<BgToContent, T>(tab.id, msg)
  }
}
