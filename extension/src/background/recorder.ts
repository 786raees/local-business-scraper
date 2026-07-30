import type { BgToOffscreen, OffscreenReply } from '../shared/messages'

/**
 * Call-recording controller (story 15). Media APIs are unavailable in an MV3
 * worker, so capture runs in a chrome.offscreen document (src/offscreen/);
 * this module owns the offscreen lifecycle, the tab-capture stream id, and
 * saving the finished blob via chrome.downloads. Every entry point is
 * fire-and-forget from the interpreter's perspective — a lost recording is
 * recoverable, a stalled dialing session is not.
 */

export type RecorderError = 'mic-denied' | 'capture-failed' | 'save-failed'

export class RecorderFailure extends Error {
  constructor(readonly reason: RecorderError) {
    super(reason)
  }
}

/** Path-hostile characters stripped; whitespace collapsed to single dashes. */
export function slugify(s: string): string {
  return s
    .trim()
    .replace(/[/\\:*?"<>|#%&{}$!'@+`=]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled'
}

/**
 * Deterministic download path: Downloads/gv-quick-dial/<tab>/<file>.webm.
 * The basename (minus the folders) is exactly what lands in the Notes cell,
 * so the file and the sheet can never disagree (story 15 decision 5).
 */
export function recordingFileName(
  tabTitle: string,
  lead: { rowIndex: number; name: string },
  tsIso: string,
): string {
  const ts = tsIso.slice(0, 16).replace(/:/g, '-')
  return `gv-quick-dial/${slugify(tabTitle)}/row-${lead.rowIndex}_${slugify(lead.name)}_${ts}.webm`
}

export const recordingBasename = (path: string): string => path.split('/').pop() ?? path

/**
 * Story 16 auto-discard gate: calls shorter than the minimum never surface.
 * 0 = keep everything. Evaluated on the interpreter's clock (callStartedAt) —
 * the same one the panel timer shows, so gate and UI can never disagree.
 */
export function shouldAutoDiscard(durationMs: number, minSeconds: number): boolean {
  return minSeconds > 0 && durationMs < minSeconds * 1000
}

/**
 * Delete a recording this session created (story 16 decision 5: by download id
 * only — never a filename lookup, so a user's unrelated file is undeletable by
 * construction). removeFile deletes from disk, erase drops the Downloads-UI
 * entry; failures are swallowed — the caller drops the reference regardless,
 * because a Notes line pointing at a missing file is worse than a lost file.
 */
export async function discardRecording(downloadId: number): Promise<void> {
  try { await chrome.downloads.removeFile(downloadId) } catch { /* already gone */ }
  try { await chrome.downloads.erase({ id: downloadId }) } catch { /* ui entry only */ }
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return
  await chrome.offscreen.createDocument({
    url: 'src/offscreen/index.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification:
      'Record call audio (Voice tab + microphone) during an opted-in dialing session.',
  })
}

async function toOffscreen(msg: BgToOffscreen): Promise<OffscreenReply> {
  return chrome.runtime.sendMessage<BgToOffscreen, OffscreenReply>(msg)
}

/**
 * The in-flight recording's target path. Worker-local by design: a killed
 * worker also kills the offscreen document, so the recording it tracked is
 * gone either way — nothing worth checkpointing.
 */
let activePath: string | null = null

export async function startRecording(voiceTabId: number, path: string): Promise<void> {
  await ensureOffscreen()
  // @types/chrome only declares the callback overload for getMediaStreamId.
  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: voiceTabId }, (id) => {
      if (chrome.runtime.lastError || !id) {
        reject(new RecorderFailure('capture-failed'))
      } else {
        resolve(id)
      }
    })
  })
  const reply = await toOffscreen({ kind: 'rec/start', streamId })
  if (!reply.ok) throw new RecorderFailure(reply.error)
  activePath = path
}

/**
 * Stop, save to Downloads, and return the saved basename plus its download id
 * — the id is the only handle that can later delete the file (story 16).
 * null = nothing was recording.
 */
export async function stopRecording(): Promise<{ file: string; downloadId: number } | null> {
  if (!activePath) return null
  const path = activePath
  activePath = null
  const reply = await toOffscreen({ kind: 'rec/stop' })
  if (!reply.ok) throw new RecorderFailure(reply.error)
  if (!reply.url) throw new RecorderFailure('capture-failed')
  try {
    const downloadId = await chrome.downloads.download({
      url: reply.url,
      filename: path,
      conflictAction: 'uniquify',
    })
    return { file: recordingBasename(path), downloadId }
  } catch {
    throw new RecorderFailure('save-failed')
  }
}
