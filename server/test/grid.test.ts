import { describe, it, expect } from 'vitest'
import { tileGrid, zoomForTileKm, haversineKm, type BBox } from '../src/geo/grid.js'

// Roughly Greater London.
const LONDON: BBox = { south: 51.28, west: -0.51, north: 51.69, east: 0.33 }

describe('tileGrid', () => {
  it('returns a single centred tile when the area is smaller than one tile', () => {
    const tiny: BBox = { south: 51.5, west: -0.13, north: 51.51, east: -0.12 }
    const tiles = tileGrid(tiny, 10)
    expect(tiles).toHaveLength(1)
    expect(tiles[0].lat).toBeCloseTo(51.505, 3)
    expect(tiles[0].lng).toBeCloseTo(-0.125, 3)
  })

  it('covers a 10km square with four 5km tiles', () => {
    // 10km tall: 10 / 110.574 degrees. 10km wide at the equator: 10 / 111.320.
    const box: BBox = { south: 0, west: 0, north: 10 / 110.574, east: 10 / 111.32 }
    expect(tileGrid(box, 5)).toHaveLength(4)
  })

  it('places every tile centre inside the bounding box', () => {
    for (const t of tileGrid(LONDON, 3)) {
      expect(t.lat).toBeGreaterThanOrEqual(LONDON.south)
      expect(t.lat).toBeLessThanOrEqual(LONDON.north)
      expect(t.lng).toBeGreaterThanOrEqual(LONDON.west)
      expect(t.lng).toBeLessThanOrEqual(LONDON.east)
    }
  })

  it('never leaves a gap wider than the tile size between neighbours', () => {
    const tiles = tileGrid(LONDON, 4)
    const lats = [...new Set(tiles.map((t) => t.lat))].sort((a, b) => a - b)
    for (let i = 1; i < lats.length; i++) {
      expect(haversineKm(lats[i - 1], 0, lats[i], 0)).toBeLessThanOrEqual(4.001)
    }
  })

  // The whole point: a degree of longitude is ~111km at the equator but ~55km at 60°N.
  // Spacing tiles by a fixed degree step would leave northern Europe badly under-covered.
  it('narrows longitude spacing at high latitude', () => {
    const oneDegWide = (south: number): number => {
      const box: BBox = { south, west: 0, north: south + 0.001, east: 1 }
      return tileGrid(box, 5).length
    }
    // One degree of longitude spans ~111km at the equator, ~56km at 60°N,
    // so the equatorial strip needs roughly twice as many 5km tiles.
    expect(oneDegWide(0)).toBeGreaterThan(oneDegWide(60) * 1.7)
  })

  it('covers Stockholm-latitude ground with tiles no wider than requested', () => {
    const box: BBox = { south: 59.3, west: 17.9, north: 59.4, east: 18.2 }
    const tiles = tileGrid(box, 2)
    const row = tiles.filter((t) => t.lat === tiles[0].lat).map((t) => t.lng).sort((a, b) => a - b)
    for (let i = 1; i < row.length; i++) {
      expect(haversineKm(59.35, row[i - 1], 59.35, row[i])).toBeLessThanOrEqual(2.001)
    }
  })

  it('rejects a nonsensical tile size rather than generating infinite tiles', () => {
    expect(() => tileGrid(LONDON, 0)).toThrow()
    expect(() => tileGrid(LONDON, -1)).toThrow()
  })

  it('caps the tile count so a whole-country box cannot explode the queue', () => {
    const usa: BBox = { south: 24.5, west: -125, north: 49.4, east: -66.9 }
    const tiles = tileGrid(usa, 1, { maxTiles: 500 })
    expect(tiles.length).toBeLessThanOrEqual(500)
    expect(tiles.length).toBeGreaterThan(100)   // still a real grid, not a token few
  })

  it('still spans the full country box when capped', () => {
    const usa: BBox = { south: 24.5, west: -125, north: 49.4, east: -66.9 }
    const tiles = tileGrid(usa, 1, { maxTiles: 500 })
    expect(Math.min(...tiles.map((t) => t.lng))).toBeLessThan(-120)
    expect(Math.max(...tiles.map((t) => t.lng))).toBeGreaterThan(-70)
  })

  // Truncating to the first N tiles returns the bounding box's south-west corner, not
  // the area the user asked for: capping a London grid at 3 returned Woking dentists.
  // The capped set must still span the whole box.
  it('spreads a capped grid across the whole area instead of taking a corner', () => {
    const tiles = tileGrid(LONDON, 2, { maxTiles: 6 })
    expect(tiles).toHaveLength(6)
    const lats = tiles.map((t) => t.lat)
    const lngs = tiles.map((t) => t.lng)
    // Should reach into the northern half and the eastern half of the box.
    const midLat = (LONDON.south + LONDON.north) / 2
    const midLng = (LONDON.west + LONDON.east) / 2
    expect(Math.max(...lats)).toBeGreaterThan(midLat)
    expect(Math.max(...lngs)).toBeGreaterThan(midLng)
    expect(Math.min(...lats)).toBeLessThan(midLat)
    expect(Math.min(...lngs)).toBeLessThan(midLng)
  })

  it('covers a meaningful fraction of the box span when capped hard', () => {
    const tiles = tileGrid(LONDON, 1, { maxTiles: 4 })
    const latSpread = Math.max(...tiles.map((t) => t.lat)) - Math.min(...tiles.map((t) => t.lat))
    expect(latSpread).toBeGreaterThan((LONDON.north - LONDON.south) * 0.4)
  })

  it('returns tiles unchanged when under the cap', () => {
    const uncapped = tileGrid(LONDON, 5)
    expect(tileGrid(LONDON, 5, { maxTiles: 10_000 })).toEqual(uncapped)
  })
})

describe('zoomForTileKm', () => {
  it('uses a higher zoom for smaller tiles', () => {
    expect(zoomForTileKm(1, 51.5)).toBeGreaterThan(zoomForTileKm(10, 51.5))
  })

  it('stays within Google Maps zoom bounds', () => {
    for (const km of [0.25, 1, 5, 50, 500, 5000]) {
      const z = zoomForTileKm(km, 51.5)
      expect(z).toBeGreaterThanOrEqual(3)
      expect(z).toBeLessThanOrEqual(20)
    }
  })

  it('returns an integer, since Maps URLs take whole zoom steps', () => {
    expect(Number.isInteger(zoomForTileKm(5, 51.5))).toBe(true)
  })
})

describe('haversineKm', () => {
  it('measures a known distance: London to Paris is ~344km', () => {
    expect(haversineKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeGreaterThan(330)
    expect(haversineKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeLessThan(360)
  })

  it('is zero for identical points', () => {
    expect(haversineKm(51.5, -0.1, 51.5, -0.1)).toBe(0)
  })
})
