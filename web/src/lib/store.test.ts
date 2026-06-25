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
