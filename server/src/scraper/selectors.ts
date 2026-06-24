// SINGLE SOURCE OF TRUTH for Google Maps DOM selectors.
// When Google changes markup, fix here only.
export const SELECTORS = {
  consentAccept: 'button[aria-label*="Accept all"], form[action*="consent"] button',
  feed: 'div[role="feed"]',
  resultCard: 'div[role="feed"] > div > div[jsaction]',
  resultLink: 'a.hfpxzc',
  detailName: 'h1.DUwDvf',
  detailRatingAria: 'div.F7nice span[aria-label]',
  detailAddress: 'button[data-item-id="address"]',
  detailPhone: 'button[data-item-id^="phone:tel:"]',
  detailWebsite: 'a[data-item-id="authority"]',
  detailCategory: 'button[jsaction*="category"]',
  detailHours: 'div[jsaction*="openhours"], div.t39EBf',
  detailPriceLevel: 'span[aria-label*="Price"]',
} as const
