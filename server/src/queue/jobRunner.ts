import { TaskSpec, JobSettings, JobEvent, Business, LocationSpec } from '../types.js'

type ScrapeFn = (
  keyword: string, location: string, settings: JobSettings,
  onRow: (b: Business) => void, signal?: AbortSignal,
) => Promise<Business[]>

export function locationToQuery(loc: LocationSpec): string {
  const base = [loc.city, loc.state, loc.country].filter(Boolean).join(', ')
  return loc.zip ? `${base} ${loc.zip}` : base
}

export function expandTasks(keywords: string[], locations: LocationSpec[]): TaskSpec[] {
  const tasks: TaskSpec[] = []
  let i = 0
  for (const keyword of keywords) {
    for (const location of locations) {
      tasks.push({ id: String(i++), keyword, location })
    }
  }
  return tasks
}

export class JobRunner {
  private controller: AbortController | null = null
  constructor(private scrape: ScrapeFn) {}

  stop(): void { this.controller?.abort() }

  async run(
    keywords: string[], locations: LocationSpec[], settings: JobSettings,
    emit: (e: JobEvent) => void,
  ): Promise<void> {
    this.controller = new AbortController()
    const tasks = expandTasks(keywords, locations)
    let done = 0
    emit({ type: 'progress', done, total: tasks.length })
    for (const task of tasks) {
      if (this.controller.signal.aborted) break
      emit({ type: 'task-update', taskId: task.id, status: 'running' })
      const query = locationToQuery(task.location)
      try {
        const rows = await this.scrape(task.keyword, query, settings,
          (b) => emit({ type: 'row', business: b }), this.controller.signal)
        emit({ type: 'task-update', taskId: task.id, status: 'done', count: rows.length })
      } catch (err) {
        emit({ type: 'task-update', taskId: task.id, status: 'error', error: String(err) })
      }
      done++
      emit({ type: 'progress', done, total: tasks.length })
    }
    emit({ type: 'job-done' })
  }
}
