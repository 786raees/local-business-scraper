import { Country, State, City } from 'country-state-city'

export function listCountries() {
  return Country.getAllCountries().map((c) => ({ code: c.isoCode, name: c.name }))
}
export function listStates(countryCode: string) {
  return State.getStatesOfCountry(countryCode).map((s) => ({ code: s.isoCode, name: s.name }))
}
export function listCities(countryCode: string, stateCode: string) {
  return City.getCitiesOfState(countryCode, stateCode).map((c) => ({ name: c.name }))
}
