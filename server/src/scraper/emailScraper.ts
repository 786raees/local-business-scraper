import { extractEmailFromHtml } from './listingParser.js'

export async function findEmailForWebsite(
  website: string,
  fetchHtml: (url: string) => Promise<string>,
): Promise<string> {
  if (!website) return ''
  try {
    const html = await fetchHtml(website)
    return extractEmailFromHtml(html)
  } catch {
    return ''
  }
}
