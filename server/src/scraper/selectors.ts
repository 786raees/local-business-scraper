// SINGLE SOURCE OF TRUTH for Google Maps DOM selectors.
// When Google changes markup, fix here only.
export const SELECTORS = {
  // EU visitors get a GDPR interstitial before Maps loads, in the local language.
  // #L2AGLb is Google's long-standing "Accept all" button id and is language-neutral,
  // so it is tried first; the localized labels cover the newer consent layouts.
  consentAccept: [
    '#L2AGLb',
    'button[aria-label*="Accept all" i]',
    'button[aria-label*="Alle akzeptieren" i]',
    'button[aria-label*="Tout accepter" i]',
    'button[aria-label*="Aceptar todo" i]',
    'button[aria-label*="Accetta tutto" i]',
    'button[aria-label*="Alles accepteren" i]',
    'form[action*="consent"] button',
  ].join(', '),
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
