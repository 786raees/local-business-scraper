import { describe, expect, it } from 'vitest'
import { buildSnapshot, clearState, loadState, persistState } from '../src/background/state'
import type { KVStore, WorkerState } from '../src/background/state'
import { buildMapping } from '../src/sheets/mapping'

function fakeKV(): KVStore {
  const map = new Map<string, unknown>()
  return {
    async get(key) { return map.get(key) },
    async set(key, value) { map.set(key, JSON.parse(JSON.stringify(value))) },
    async remove(key) { map.delete(key) },
  }
}

const STATE: WorkerState = {
  selection: { spreadsheetId: 'sid', spreadsheetName: 'Atlas Leads', tabTitle: 'Miami' },
  mapping: buildMapping(['name', 'phone', 'Call Status', 'Notes']),
  leads: [
    { rowIndex: 2, name: 'A', phone: '+1' },
    { rowIndex: 3, name: 'B', phone: '' },
    { rowIndex: 4, name: 'C', phone: '+3', callStatus: 'No Answer' },
    { rowIndex: 5, name: 'D', phone: '+4' },
  ],
  skippedNoPhone: 1,
  cursor: 5,
  phase: 'ready',
  callState: 'idle',
  autoRun: 0,
  pendingStop: false,
  preselectedNoAnswer: false,
  atEnd: false,
}

describe('buildSnapshot', () => {
  it('maps worker state to the wire snapshot with filtered dialable counts', () => {
    const snap = buildSnapshot(STATE, { status: 'uncalled' })
    expect(snap).toMatchObject({
      phase: 'ready',
      spreadsheet: { id: 'sid', name: 'Atlas Leads' },
      tab: { title: 'Miami', rowCount: 4 },
      leads: { total: 4, skippedNoPhone: 1, dialable: 2 }, // A and D (C has a status, B no phone)
      criteria: { status: 'uncalled' },
    })
    // Cursor 5 clamps into the 2-lead dialable list and resolves the current lead.
    expect(snap.cursor).toBe(1)
    expect(snap.currentLead?.name).toBe('D')
  })

  it('computes dialable per filter', () => {
    expect(buildSnapshot(STATE, { status: 'all' }).leads.dialable).toBe(3)
    expect(buildSnapshot(STATE, { status: 'retry' }).leads.dialable).toBe(1)
    expect(buildSnapshot(STATE, { status: 'retry' }).currentLead?.name).toBe('C')
  })

  it('surfaces blank-data exclusions only when a blank-sensitive axis is active', () => {
    expect(buildSnapshot(STATE, { status: 'all' }).leads.excludedBlank).toBeUndefined()
    const snap = buildSnapshot(STATE, { status: 'all', rating: { op: 'gte', value: 4 } })
    expect(snap.leads.excludedBlank?.rating).toBe(3) // no lead has a rating
  })

  it('yields the pick-sheet phase when no state exists', () => {
    expect(buildSnapshot(null).phase).toBe('pick-sheet')
    expect(buildSnapshot(null).leads.dialable).toBe(0)
  })
})

describe('state round-trip (worker-restart path)', () => {
  it('persist → load reproduces the state through JSON serialization', async () => {
    const kv = fakeKV()
    await persistState(kv, STATE)
    const loaded = await loadState(kv)
    expect(loaded).toEqual(STATE)
    expect(buildSnapshot(loaded)).toEqual(buildSnapshot(STATE))
  })

  it('loads null from an empty store and after clear', async () => {
    const kv = fakeKV()
    expect(await loadState(kv)).toBeNull()
    await persistState(kv, STATE)
    await clearState(kv)
    expect(await loadState(kv)).toBeNull()
  })
})
