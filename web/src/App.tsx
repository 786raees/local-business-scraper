import { useEffect } from 'react'
import { useJobSocket } from './hooks/useJobSocket'
import { useStore } from './lib/store'
import { api } from './lib/api'
import { TopBar } from './components/TopBar'
import { KeywordList } from './components/KeywordList'
import { LocationSelector } from './components/LocationSelector'
import { LocationList } from './components/LocationList'
import { SettingsPanel } from './components/SettingsPanel'
import { QueuePanel } from './components/QueuePanel'
import { ResultsTable } from './components/ResultsTable'

export default function App() {
  useJobSocket()
  // Seed the live count from any data already in the DB so Export/Clear reflect it
  // even before a run starts this session.
  useEffect(() => {
    api.getResults(0, 1, {}).then((r) => useStore.getState().applyEvent({ type: 'count', total: r.total })).catch(() => {})
  }, [])
  return (
    <div className="flex h-screen flex-col bg-ink-800">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[340px] shrink-0 space-y-6 overflow-y-auto border-r border-line bg-ink-900/40 p-5">
          <KeywordList />
          <LocationSelector />
          <LocationList />
          <SettingsPanel />
        </aside>
        <main className="flex flex-1 flex-col overflow-hidden">
          <QueuePanel />
          <ResultsTable />
        </main>
      </div>
    </div>
  )
}
