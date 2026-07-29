import { useEffect, useState } from 'react'
import { keyStore, selectionStore } from '../shared/storage'
import type { BgToPanel } from '../shared/messages'
import type { Selection } from '../shared/storage'
import { SessionHome } from './components/SessionHome'
import { SpreadsheetPicker } from './components/SpreadsheetPicker'
import { TabPicker } from './components/TabPicker'
import './panel.css'

type Screen =
  | { name: 'boot' }
  | { name: 'connect' }
  | { name: 'pick-sheet'; recentId?: string }
  | { name: 'pick-tab'; spreadsheetId: string; spreadsheetName: string }
  | { name: 'selected'; selection: Required<Selection> }

/**
 * Screen routing (UX §1): S1/S2 are skipped whenever a full selection is
 * remembered — a returning user goes toolbar icon → session home in one click.
 */
export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'boot' })
  const [tint, setTint] = useState('')
  const [sessionActive, setSessionActive] = useState(false)
  const [confirmSwitch, setConfirmSwitch] = useState(false)

  // Header bottom border takes the call-state colour (DESIGN §7).
  useEffect(() => {
    const onMsg = (msg: BgToPanel) => {
      if (msg.kind !== 'state') return
      const s = msg.snapshot
      setTint(
        s.phase === 'error' ? 'tint-error'
        : s.callState === 'in-call' ? 'tint-incall'
        : s.callState === 'ringing' ? 'tint-ringing'
        : '',
      )
      setSessionActive(
        ['dialing', 'in-call', 'between-calls', 'awaiting-outcome'].includes(s.phase),
      )
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [])

  useEffect(() => {
    void (async () => {
      const key = await keyStore.get()
      if (!key) { setScreen({ name: 'connect' }); return }
      const selection = await selectionStore.get()
      if (selection?.tabTitle) {
        setScreen({ name: 'selected', selection: selection as Required<Selection> })
      } else {
        setScreen({ name: 'pick-sheet', recentId: selection?.spreadsheetId })
      }
    })()
    keyStore.onChanged((key) => {
      if (!key) setScreen({ name: 'connect' })
      else setScreen((s) => (s.name === 'connect' ? { name: 'pick-sheet' } : s))
    })
  }, [])

  async function pickSheet(id: string, name: string) {
    await selectionStore.set({ spreadsheetId: id, spreadsheetName: name })
    setScreen({ name: 'pick-tab', spreadsheetId: id, spreadsheetName: name })
  }

  async function pickTab(tabTitle: string) {
    if (screen.name !== 'pick-tab') return
    const selection: Selection = {
      spreadsheetId: screen.spreadsheetId,
      spreadsheetName: screen.spreadsheetName,
      tabTitle,
    }
    await selectionStore.set(selection)
    setScreen({ name: 'selected', selection: selection as Required<Selection> })
  }

  async function changeLists() {
    // Mid-session switching pauses first — and asks (UX §4.4).
    if (sessionActive) {
      setConfirmSwitch(true)
      return
    }
    const current = await selectionStore.get()
    setScreen({ name: 'pick-sheet', recentId: current?.spreadsheetId })
  }

  async function confirmSwitchLists() {
    setConfirmSwitch(false)
    await chrome.runtime.sendMessage({ kind: 'session/stop', hard: true }).catch(() => {})
    setSessionActive(false)
    const current = await selectionStore.get()
    setScreen({ name: 'pick-sheet', recentId: current?.spreadsheetId })
  }

  if (screen.name === 'boot') return null

  return (
    <div className="panel">
      <Header
        screen={screen}
        tint={tint}
        onBack={() => void changeLists()}
        onChange={() => void changeLists()}
      />
      <div className="panel-content">
        {screen.name === 'connect' && <ConnectCard />}
        {screen.name === 'pick-sheet' && (
          <SpreadsheetPicker
            recentId={screen.recentId}
            onPick={(s) => void pickSheet(s.id, s.name)}
          />
        )}
        {screen.name === 'pick-tab' && (
          <TabPicker spreadsheetId={screen.spreadsheetId} onPick={(t) => void pickTab(t.title)} />
        )}
        {screen.name === 'selected' && (
          <SessionHome
            spreadsheetId={screen.selection.spreadsheetId}
            tabTitle={screen.selection.tabTitle}
            onChangeList={() => void changeLists()}
          />
        )}
      </div>

      {confirmSwitch && (
        <div className="dialog-scrim" role="dialog" aria-modal="true">
          <div className="dialog">
            <div className="card-title">Pause and switch lists?</div>
            <p>The current call will be hung up. Your place is saved per tab.</p>
            <div className="start-from-actions">
              <button className="btn primary" onClick={() => void confirmSwitchLists()}>
                Pause &amp; switch
              </button>
              <button className="btn secondary" onClick={() => setConfirmSwitch(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Header({
  screen,
  tint,
  onBack,
  onChange,
}: {
  screen: Screen
  tint: string
  onBack: () => void
  onChange: () => void
}) {
  const title =
    screen.name === 'pick-sheet' ? 'Choose spreadsheet'
    : screen.name === 'pick-tab' ? screen.spreadsheetName
    : screen.name === 'selected' ? screen.selection.tabTitle
    : 'Google Voice Quick Dial'

  return (
    <div className={`panel-header ${tint}`.trim()}>
      {screen.name === 'pick-tab' && (
        <button className="icon-btn" aria-label="Back" onClick={onBack}>‹</button>
      )}
      <div className="title">{title}</div>
      {screen.name === 'selected' && (
        <button className="icon-btn" aria-label="Change list" title="Change list" onClick={onChange}>
          ⇄
        </button>
      )}
      <button
        className="icon-btn"
        aria-label="Settings"
        title="Settings"
        onClick={() => void chrome.runtime.openOptionsPage()}
      >
        ⚙
      </button>
    </div>
  )
}

function ConnectCard() {
  return (
    <div className="center-card">
      <div className="card-title">Connect Google Sheets</div>
      <p>Add your service-account key to read leads and log call outcomes.</p>
      <button className="btn primary" onClick={() => void chrome.runtime.openOptionsPage()}>
        Open setup
      </button>
    </div>
  )
}
