import type { BgToOffscreen, OffscreenReply } from '../shared/messages'

/**
 * Offscreen capture document (story 15 decision 3). MV3 workers cannot touch
 * media APIs, so this page owns the streams: the Voice tab's audio (remote
 * party, via the worker-supplied tabCapture stream id) mixed with the
 * microphone (the caller) into one MediaRecorder. Capturing only the tab
 * would silently record half the conversation — mic denial is a hard error,
 * never a tab-only recording.
 */

interface Active {
  ctx: AudioContext
  recorder: MediaRecorder
  chunks: Blob[]
  streams: MediaStream[]
}

let active: Active | null = null

function cleanup(): void {
  if (!active) return
  for (const s of active.streams) s.getTracks().forEach((t) => t.stop())
  void active.ctx.close().catch(() => {})
  active = null
}

async function start(streamId: string): Promise<OffscreenReply> {
  cleanup()
  let tab: MediaStream
  try {
    // Chrome's tab-capture constraint shape predates the TS lib types.
    tab = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
      },
    } as unknown as MediaStreamConstraints)
  } catch {
    return { ok: false, error: 'capture-failed' }
  }

  const ctx = new AudioContext()
  const tabSrc = ctx.createMediaStreamSource(tab)
  // tabCapture mutes the captured tab — loop it back to the speakers or the
  // caller goes deaf mid-call (story 15 decision 3 trap).
  tabSrc.connect(ctx.destination)

  let mic: MediaStream
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    tab.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
    return { ok: false, error: 'mic-denied' }
  }

  const mix = ctx.createMediaStreamDestination()
  tabSrc.connect(mix)
  ctx.createMediaStreamSource(mic).connect(mix)

  const recorder = new MediaRecorder(mix.stream, { mimeType: 'audio/webm;codecs=opus' })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.start()
  active = { ctx, recorder, chunks, streams: [tab, mic] }
  return { ok: true }
}

async function stop(): Promise<OffscreenReply> {
  if (!active) return { ok: false, error: 'capture-failed' }
  const { recorder, chunks } = active
  const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
  recorder.stop()
  await done
  cleanup()
  const blob = new Blob(chunks, { type: 'audio/webm' })
  if (blob.size === 0) return { ok: false, error: 'capture-failed' }
  // The blob URL is same-extension-origin, so the worker can hand it straight
  // to chrome.downloads (offscreen documents may only use chrome.runtime).
  return { ok: true, url: URL.createObjectURL(blob) }
}

chrome.runtime.onMessage.addListener(
  (msg: BgToOffscreen, _sender, sendResponse: (r: OffscreenReply) => void) => {
    // Panel/worker broadcasts also land here — only rec/* is ours.
    if (msg.kind !== 'rec/start' && msg.kind !== 'rec/stop') return false
    const work = msg.kind === 'rec/start' ? start(msg.streamId) : stop()
    work.then(sendResponse, () => sendResponse({ ok: false, error: 'capture-failed' }))
    return true
  },
)
