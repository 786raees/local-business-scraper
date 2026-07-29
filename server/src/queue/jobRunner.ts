import { TaskSpec, JobSettings, JobEvent, Business, LocationSpec, Viewport } from '../types.js'
import { areaFromLocation, GeoArea } from '../geo/geocode.js'
import { tileGrid } from '../geo/grid.js'

type ScrapeFn = (
  keyword: string, location: string, settings: JobSettings,
  onRow: (b: Business) => void, signal?: AbortSignal, viewport?: Viewport,
) => Promise<Business[]>

type GeocodeFn = (loc: LocationSpec) => Promise<GeoArea | null>

export function locationToQuery(loc: LocationSpec): string {
  const base = [loc.city, loc.state, loc.country].filter(Boolean).join(', ')
  return loc.zip ? `${base} ${loc.zip}` : base
}

/** Unsegmented expansion: one task per keyword × location. */
export function expandTasks(keywords: string[], locations: LocationSpec[]): TaskSpec[] {
  const tasks: TaskSpec[] = []
  let i = 0
  for (const keyword of keywords) {
    for (const location of locations) {
      tasks.push({
        id: String(i++), keyword, location,
        label: `${keyword} — ${location.city || location.state}`,
      })
    }
  }
  return tasks
}

/**
 * Expand keywords × locations into one task per map tile.
 *
 * A single Google Maps text search caps out around 120 results regardless of how many
 * businesses exist, so scraping a city as one query silently truncates. Geocoding the
 * location and running the keyword against a grid of small viewports lifts that ceiling:
 * measured on "dentist" in London, two 5km tiles returned 197 unique places against 67
 * for the plain text search.
 *
 * Locations that cannot be geocoded degrade to a single unsegmented task rather than
 * being dropped.
 */
export async function expandSegmentedTasks(
  keywords: string[],
  locations: LocationSpec[],
  settings: JobSettings,
  geocode: GeocodeFn = areaFromLocation,
): Promise<TaskSpec[]> {
  if (!settings.segment) return expandTasks(keywords, locations)

  const tasks: TaskSpec[] = []
  let i = 0
  for (const location of locations) {
    const area = await geocode(location)
    const name = location.city || location.state || location.country
    const tiles = area
      ? tileGrid(area.bbox, settings.tileKm, { maxTiles: settings.maxTiles })
      : []

    for (const keyword of keywords) {
      if (!tiles.length) {
        // Unknown area — still scrape it, just without segmentation.
        tasks.push({ id: String(i++), keyword, location, label: `${keyword} — ${name}` })
        continue
      }
      tiles.forEach((viewport, n) => {
        tasks.push({
          id: String(i++), keyword, location, viewport,
          label: `${keyword} — ${name} (${n + 1}/${tiles.length})`,
        })
      })
    }
  }
  return tasks
}

export class JobRunner {
  private controller: AbortController | null = null
  /** Rows emitted this run; the fallback budget counter when no unique count is injected. */
  private emitted = 0

  /**
   * @param uniqueCount reports how many rows have actually been *stored*. The budget is
   *   spent on unique places, not raw sightings — overlapping grid tiles re-report the
   *   same businesses, and counting those would end the job long before the user has the
   *   number of leads they asked for.
   */
  constructor(
    private scrape: ScrapeFn,
    private geocode: GeocodeFn = areaFromLocation,
    private uniqueCount?: () => number,
  ) {}

  stop(): void { this.controller?.abort() }

  private spent(): number {
    return this.uniqueCount ? this.uniqueCount() : this.emitted
  }

  async run(
    keywords: string[], locations: LocationSpec[], settings: JobSettings,
    emit: (e: JobEvent) => void,
  ): Promise<void> {
    this.controller = new AbortController()
    this.emitted = 0
    const tasks = await expandSegmentedTasks(keywords, locations, settings, this.geocode)
    const budget = settings.maxResults
    let done = 0
    emit({ type: 'progress', done, total: tasks.length })

    for (const task of tasks) {
      if (this.controller.signal.aborted) break
      const remaining = budget - this.spent()
      // Budget met — the job is finished even though tiles remain unvisited.
      if (remaining <= 0) {
        emit({ type: 'progress', done: tasks.length, total: tasks.length })
        break
      }

      emit({ type: 'task-update', taskId: task.id, status: 'running', label: task.label })
      const query = locationToQuery(task.location)
      // Hand each task only what is left, so the last one stops on the exact total
      // instead of overshooting by a whole tile.
      const taskSettings: JobSettings = { ...settings, maxResults: remaining }
      try {
        const rows = await this.scrape(task.keyword, query, taskSettings,
          (b) => { this.emitted++; emit({ type: 'row', business: b }) },
          this.controller.signal, task.viewport)
        emit({ type: 'task-update', taskId: task.id, status: 'done', count: rows.length, label: task.label })
      } catch (err) {
        emit({ type: 'task-update', taskId: task.id, status: 'error', error: String(err), label: task.label })
      }
      done++
      emit({ type: 'progress', done, total: tasks.length })
    }
    emit({ type: 'job-done' })
  }
}
