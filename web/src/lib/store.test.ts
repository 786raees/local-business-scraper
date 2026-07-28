import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store'

beforeEach(() => useStore.getState().reset())

describe('store', () => {
  it('adds unique keywords', () => {
    useStore.getState().addKeyword('plumber')
    useStore.getState().addKeyword('plumber')
    expect(useStore.getState().keywords).toEqual(['plumber'])
  })
  it('applyEvent count updates total', () => {
    useStore.getState().applyEvent({ type: 'count', total: 4200 })
    expect(useStore.getState().total).toBe(4200)
  })
  it('applyEvent task-update upserts queue item', () => {
    useStore.getState().applyEvent({ type: 'task-update', taskId: '0', status: 'running' })
    useStore.getState().applyEvent({ type: 'task-update', taskId: '0', status: 'done', count: 3 })
    expect(useStore.getState().queue[0]).toMatchObject({ status: 'done', count: 3 })
  })
})

describe('store segmentation support', () => {
  it('defaults segmentation off with a usable tile size', () => {
    const s = useStore.getState().settings
    expect(s.segment).toBe(false)
    expect(s.tileKm).toBeGreaterThan(0)
    expect(s.maxTiles).toBeGreaterThan(0)
  })

  it('tracks duplicates skipped separately from unique rows', () => {
    useStore.getState().applyEvent({ type: 'count', total: 120, duplicates: 340 })
    expect(useStore.getState().total).toBe(120)
    expect(useStore.getState().duplicates).toBe(340)
  })

  it('leaves duplicates at zero when the server omits the field', () => {
    useStore.getState().applyEvent({ type: 'count', total: 10 })
    expect(useStore.getState().duplicates).toBe(0)
  })

  it('keeps the tile label from task-update so the queue is readable', () => {
    useStore.getState().applyEvent({
      type: 'task-update', taskId: '7', status: 'running', label: 'dentist — London (7/108)',
    })
    expect(useStore.getState().queue[0].label).toBe('dentist — London (7/108)')
  })

  it('clears duplicates on reset', () => {
    useStore.getState().applyEvent({ type: 'count', total: 5, duplicates: 9 })
    useStore.getState().reset()
    expect(useStore.getState().duplicates).toBe(0)
  })
})

describe('row selection', () => {
  it('toggles a single row and records the anchor index', () => {
    useStore.getState().clearSelection()
    useStore.getState().toggleOne('p1', 4)
    expect(useStore.getState().selected.has('p1')).toBe(true)
    expect(useStore.getState().lastClickedIndex).toBe(4)
    useStore.getState().toggleOne('p1', 4)
    expect(useStore.getState().selected.has('p1')).toBe(false)
  })

  it('setSelected applies a range on or off', () => {
    useStore.getState().clearSelection()
    useStore.getState().setSelected(['a', 'b', 'c'], true, 9)
    expect(useStore.getState().selected.size).toBe(3)
    expect(useStore.getState().lastClickedIndex).toBe(9)
    useStore.getState().setSelected(['b', 'c'], false)
    expect([...useStore.getState().selected]).toEqual(['a'])
  })

  it('reset clears the selection', () => {
    useStore.getState().setSelected(['a'], true)
    useStore.getState().reset()
    expect(useStore.getState().selected.size).toBe(0)
    expect(useStore.getState().lastClickedIndex).toBe(null)
  })
})
