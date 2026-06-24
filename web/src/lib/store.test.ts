import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store'

beforeEach(() => useStore.getState().reset())

describe('store', () => {
  it('adds unique keywords', () => {
    useStore.getState().addKeyword('plumber')
    useStore.getState().addKeyword('plumber')
    expect(useStore.getState().keywords).toEqual(['plumber'])
  })
  it('applyEvent row appends to results', () => {
    useStore.getState().applyEvent({ type: 'row', business: { name: 'X' } as any })
    expect(useStore.getState().results).toHaveLength(1)
  })
  it('applyEvent task-update upserts queue item', () => {
    useStore.getState().applyEvent({ type: 'task-update', taskId: '0', status: 'running' })
    useStore.getState().applyEvent({ type: 'task-update', taskId: '0', status: 'done', count: 3 })
    expect(useStore.getState().queue[0]).toMatchObject({ status: 'done', count: 3 })
  })
})
