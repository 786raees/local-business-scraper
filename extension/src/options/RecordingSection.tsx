import { useEffect, useState } from 'react'
import { SETTINGS_BOUNDS } from '../shared/storage'
import type { Settings } from '../shared/storage'
import { OptionsCard } from './OptionsCard'
import { Switch } from './Switch'

export type MicState = 'granted' | 'denied' | 'prompt'

export interface RecordingStep {
  key: 'consent' | 'mic' | 'enable' | 'duration'
  /** Prerequisites unmet — rendered muted and inert, never hidden (decision 2). */
  locked: boolean
  done: boolean
}

/**
 * The recording dependency chain as data (story 17 decision 2): consent
 * unlocks mic, mic unlocks enable, enable unlocks duration. Pure so the lock
 * logic is unit-testable without a DOM rig. Locked steps stay VISIBLE — a
 * user who can't find the record toggle files "recording is broken", not
 * "I haven't consented".
 */
export function recordingSteps(
  settings: Pick<Settings, 'recordingConsentAt' | 'recordingEnabled'>,
  mic: MicState | null,
): RecordingStep[] {
  const consent = !!settings.recordingConsentAt
  const micOk = mic === 'granted'
  return [
    { key: 'consent', locked: false, done: consent },
    { key: 'mic', locked: !consent, done: micOk },
    { key: 'enable', locked: !consent || !micOk, done: settings.recordingEnabled },
    { key: 'duration', locked: !settings.recordingEnabled, done: false },
  ]
}

interface Props {
  settings: Settings
  save: (patch: Partial<Settings>) => void
}

/** Story 17 — the Recording card: the story-15/16 controls as a stepped chain. */
export function RecordingSection({ settings, save }: Props) {
  const [mic, setMic] = useState<MicState | null>(null)

  useEffect(() => {
    // The offscreen recorder CANNOT show a permission prompt — getUserMedia
    // auto-rejects there unless mic access was already granted from a visible
    // extension page. This page is where that one-time grant happens.
    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((p) => {
        setMic(p.state as MicState)
        p.onchange = () => setMic(p.state as MicState)
      })
      .catch(() => setMic('prompt'))
  }, [])

  async function grantMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMic('granted')
    } catch {
      setMic('denied')
    }
  }

  const steps = recordingSteps(settings, mic)
  const locked = Object.fromEntries(steps.map((s) => [s.key, s.locked])) as
    Record<RecordingStep['key'], boolean>

  return (
    <OptionsCard
      title="Recording"
      description="Each step unlocks the next. Recordings save to Downloads/gv-quick-dial; the filename is logged into the row's Notes."
    >
      <div className={`step${locked.consent ? ' locked' : ''}`}>
        <span className="step-num">1</span>
        <label className="setting-row">
          <span>
            I am responsible for complying with call recording laws in my
            jurisdiction (many require all-party consent). The extension records
            silently — announcing the recording is my obligation.
          </span>
          <Switch
            label="Consent acknowledgement"
            checked={!!settings.recordingConsentAt}
            onChange={(next) => save(
              next
                ? { recordingConsentAt: new Date().toISOString() }
                // Withdrawing consent also forces recording off (clampSettings).
                : { recordingConsentAt: undefined, recordingEnabled: false },
            )}
          />
        </label>
      </div>

      <div className={`step${locked.mic ? ' locked' : ''}`}>
        <span className="step-num">2</span>
        <div className="setting-row">
          <span>
            Microphone access — required once, from this page (Chrome cannot ask
            during a call; without it every recording fails)
          </span>
          {mic === 'granted' ? (
            <span className="status-line ok">✓ Granted</span>
          ) : (
            <button
              className="btn secondary"
              disabled={locked.mic}
              onClick={() => void grantMic()}
            >
              {mic === 'denied' ? 'Blocked — retry' : 'Enable microphone'}
            </button>
          )}
        </div>
        {mic === 'denied' && !locked.mic && (
          <p className="error-text">
            Chrome has the microphone blocked for this extension. Click the
            camera/mic icon in the address bar (or Site settings) to allow it,
            then retry.
          </p>
        )}
      </div>

      <div className={`step${locked.enable ? ' locked' : ''}`}>
        <span className="step-num">3</span>
        <label className="setting-row">
          <span>Record calls</span>
          <Switch
            label="Record calls"
            checked={settings.recordingEnabled}
            disabled={locked.enable}
            onChange={(next) => save({ recordingEnabled: next })}
          />
        </label>
      </div>

      <div className={`step${locked.duration ? ' locked' : ''}`}>
        <span className="step-num">4</span>
        <label className="setting-row">
          <span>Discard recordings shorter than (0 keeps everything)</span>
          <span className="setting-control">
            <input
              className="keyinput num"
              type="number"
              disabled={locked.duration}
              min={SETTINGS_BOUNDS.recordingMinSeconds.min}
              max={SETTINGS_BOUNDS.recordingMinSeconds.max}
              value={settings.recordingMinSeconds}
              onChange={(e) => save({ recordingMinSeconds: Number(e.target.value) })}
            />
            <span className="unit">s</span>
          </span>
        </label>
      </div>
    </OptionsCard>
  )
}
