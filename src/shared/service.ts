// Search and compare-links, independent of where they run: the Node server
// calls these for the website, and the Android app calls them on the phone.

import { compareListings } from './compare.ts';
import { UserError } from './errors.ts';
import { extractListing } from './extract.ts';
import { groupListings } from './match.ts';
import type { Source } from './sources/source.ts';
import type { CompareLinksResponse, Listing, SearchResponse, SourceError } from './types.ts';

export const MAX_LINKS = 10;
const SEARCH_TIMEOUT_MS = 15_000;

/** Searches every source and returns one comparison per product found. */
export async function searchSources(sources: Source[], query: string): Promise<SearchResponse> {
  const errors: SourceError[] = [];
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        return await s.search(query, signal);
      } catch (e) {
        errors.push({ source: s.name, message: (e as Error).message });
        return [];
      }
    }),
  );
  const products = groupListings(results.flat())
    .map(compareListings)
    .filter((c) => c !== null);
  return { query, products, errors, sample: sources.some((s, i) => s.sample && results[i].length > 0) };
}

/** Downloads a page; returns the final URL after redirects and the HTML. */
export type PageFetcher = (url: string) => Promise<{ url: string; html: string }>;

/** Reads one product link into a listing. */
export async function readLink(fetchPage: PageFetcher, url: string): Promise<Listing> {
  const page = await fetchPage(url);
  return extractListing(page.html, page.url);
}

/**
 * Reads every link and compares them, with any offers added by hand, as one
 * product. A link that can't be read becomes an error entry, not a failure.
 */
export async function compareLinks(
  urls: string[],
  manual: Listing[],
  read: (url: string) => Promise<Listing>,
): Promise<CompareLinksResponse> {
  const errors: SourceError[] = [];
  const listings = await Promise.all(
    urls.map(async (url) => {
      try {
        return await read(url);
      } catch (e) {
        if (!(e instanceof UserError)) console.error(`reading ${url}:`, e);
        errors.push({ source: url, message: e instanceof UserError ? e.message : 'Something went wrong reading this page.' });
        return undefined;
      }
    }),
  );
  const all = [...listings.filter((l) => l !== undefined), ...manual];
  return { comparison: compareListings(all), errors, listings: all };
}
