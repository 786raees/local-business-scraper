/**
 * Geographic tiling for segmented Maps scraping.
 *
 * A Google Maps text search returns at most ~120 results no matter how many businesses
 * exist in the area. The way past that ceiling is to run the same keyword against many
 * small map viewports and union the results. This module turns an area into that list
 * of viewport centres.
 */

export interface BBox {
  south: number
  west: number
  north: number
  east: number
}

export interface Viewport {
  lat: number
  lng: number
  zoom: number
}

const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LNG_EQUATOR = 111.320

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Width in km of one degree of longitude at a given latitude — shrinks toward the poles. */
export function kmPerDegLng(lat: number): number {
  return KM_PER_DEG_LNG_EQUATOR * Math.cos(toRad(lat))
}

/** Great-circle distance in km. Used to verify tile spacing. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Google Maps zoom level whose viewport is about `tileKm` wide.
 * Web-mercator ground resolution is 156543.03 * cos(lat) / 2^zoom metres per pixel;
 * assuming a ~1000px map pane, solve for the zoom that spans the requested width.
 */
export function zoomForTileKm(tileKm: number, lat: number): number {
  const VIEWPORT_PX = 1000
  const metresPerPixel = (tileKm * 1000) / VIEWPORT_PX
  const zoom = Math.log2((156543.03 * Math.cos(toRad(lat))) / metresPerPixel)
  return Math.max(3, Math.min(20, Math.round(zoom)))
}

export interface GridOptions {
  /** Safety valve: a country-sized box with small tiles would otherwise flood the queue. */
  maxTiles?: number
}

/**
 * Cover `bbox` with viewport centres spaced at most `tileKm` apart in both axes.
 *
 * Longitude spacing is computed per row from that row's latitude, because a fixed
 * degree step would under-cover northern latitudes — at 60°N a degree of longitude is
 * half the width it is at the equator, which would silently halve coverage across
 * northern Europe.
 */
export function tileGrid(bbox: BBox, tileKm: number, opts: GridOptions = {}): Viewport[] {
  if (!(tileKm > 0)) throw new Error(`tileKm must be positive, got ${tileKm}`)
  const maxTiles = opts.maxTiles ?? 2000

  // Over the cap, grow the tiles until the grid fits rather than cutting the list short.
  // Truncation would return only the south-west corner of the box — capping a London
  // grid at 3 tiles yielded Woking, 30km outside the city the user asked for.
  let km = tileKm
  for (let i = 0; i < 12; i++) {
    const n = countTiles(bbox, km)
    if (n <= maxTiles) break
    km *= Math.max(1.1, Math.sqrt(n / maxTiles))
  }
  return layout(bbox, km, maxTiles)
}

/** Tile count for a given size, without building the array. */
function countTiles(bbox: BBox, tileKm: number): number {
  const rows = Math.max(1, Math.ceil(((bbox.north - bbox.south) * KM_PER_DEG_LAT) / tileKm))
  const latStep = (bbox.north - bbox.south) / rows
  let total = 0
  for (let r = 0; r < rows; r++) {
    const lat = bbox.south + latStep * (r + 0.5)
    const lngKm = Math.max(kmPerDegLng(lat), 0.001)
    total += Math.max(1, Math.ceil(((bbox.east - bbox.west) * lngKm) / tileKm))
  }
  return total
}

function layout(bbox: BBox, tileKm: number, maxTiles: number): Viewport[] {
  const { south, west, north, east } = bbox
  const latSpanKm = (north - south) * KM_PER_DEG_LAT
  const rows = Math.max(1, Math.ceil(latSpanKm / tileKm))
  const latStep = (north - south) / rows

  const out: Viewport[] = []
  for (let r = 0; r < rows; r++) {
    // Centre of this row's band; longitude width is evaluated here.
    const lat = south + latStep * (r + 0.5)
    const lngKm = Math.max(kmPerDegLng(lat), 0.001)  // guard at the poles
    const lngSpanKm = (east - west) * lngKm
    const cols = Math.max(1, Math.ceil(lngSpanKm / tileKm))
    const lngStep = (east - west) / cols

    const zoom = zoomForTileKm(tileKm, lat)
    for (let c = 0; c < cols; c++) {
      if (out.length >= maxTiles) return out
      out.push({ lat, lng: west + lngStep * (c + 0.5), zoom })
    }
  }
  return out
}
