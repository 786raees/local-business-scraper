import { Country, State, City } from 'country-state-city'

// country-state-city maps cities onto only a handful of subdivisions for most non-US
// countries (GB: 3871 cities spread over 4 of its 247 states). Listing the unmapped ones
// hands the UI a state whose City dropdown is permanently empty, which also starves the
// zip lookup — it only fires once a city is picked.
function hasCities(countryCode: string, stateCode: string): boolean {
  return City.getCitiesOfState(countryCode, stateCode).length > 0
}

// The package files Northern Ireland's towns (Antrim, Ahoghill, Annalong…) under GB-NYK.
const STATE_NAME_OVERRIDES: Record<string, string> = {
  'GB:NYK': 'Northern Ireland',
}

export function listCountries() {
  return Country.getAllCountries().map((c) => ({ code: c.isoCode, name: c.name }))
}

// Filtering costs one city-table scan per subdivision — ~3s for GB's 247. The dataset is
// static, so compute each country once.
const statesCache = new Map<string, Array<{ code: string; name: string }>>()

export function listStates(countryCode: string) {
  const cached = statesCache.get(countryCode)
  if (cached) return cached

  const all = State.getStatesOfCountry(countryCode)
  const populated = all.filter((s) => hasCities(countryCode, s.isoCode))
  // Never strip a country down to nothing — some have no city data at all.
  const use = populated.length ? populated : all
  const out = use.map((s) => ({
    code: s.isoCode,
    name: STATE_NAME_OVERRIDES[`${countryCode}:${s.isoCode}`] ?? s.name,
  }))
  statesCache.set(countryCode, out)
  return out
}

export function listCities(countryCode: string, stateCode: string) {
  return City.getCitiesOfState(countryCode, stateCode).map((c) => ({ name: c.name }))
}
