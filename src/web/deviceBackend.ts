// The backend for the Android app: no server, everything runs on the phone.
// Pages are downloaded with the phone's native HTTP client, which, unlike the
// WebView's fetch, can read any shop's page (no CORS).

import { UserError } from '../shared/errors.ts';
import { BROWSER_HEADERS, checkPageResponse, MAX_REDIRECTS, PAGE_TIMEOUT_MS } from '../shared/pageRequest.ts';
import { compareLinks, MAX_LINKS, readLink, searchSources } from '../shared/service.ts';
import { sampleSource } from '../shared/sources/sample.ts';
import type { Listing } from '../shared/types.ts';
import type { Backend } from './backend.ts';

/** The subset of CapacitorHttp.get this needs, so tests can pass a fake. */
export type HttpGet = (options: {
  url: string;
  headers: Record<string, string>;
  responseType: 'text';
  connectTimeout: number;
  readTimeout: number;
  disableRedirects: boolean;
}) => Promise<{ status: number; headers: Record<string, string>; data: unknown; url: string }>;

const PAGE_CACHE_MS = 10 * 60_000;

const header = (headers: Record<string, string>, name: string) =>
  Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1] ?? '';

export function createDeviceBackend(get: HttpGet): Backend {
  const cache = new Map<string, { at: number; listing: Listing }>();

  async function fetchPage(url: string): Promise<{ url: string; html: string }> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let u: URL;
      try {
        u = new URL(current);
      } catch {
        throw new UserError('That is not a valid link.');
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UserError('Only http and https links are supported.');
      let res: Awaited<ReturnType<HttpGet>>;
      try {
        res = await get({
          url: current,
          headers: BROWSER_HEADERS,
          responseType: 'text',
          connectTimeout: PAGE_TIMEOUT_MS,
          readTimeout: PAGE_TIMEOUT_MS,
          disableRedirects: true, // followed here, so http→https redirects work too
        });
      } catch (e) {
        throw new UserError(`Could not reach ${u.hostname}. Check your internet connection. (${(e as Error).message})`);
      }
      const location = header(res.headers, 'location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, u).toString();
        continue;
      }
      checkPageResponse(res.status, header(res.headers, 'content-type'));
      return { url: current, html: typeof res.data === 'string' ? res.data : String(res.data ?? '') };
    }
    throw new UserError('Too many redirects.');
  }

  async function readCached(url: string): Promise<Listing> {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < PAGE_CACHE_MS) return hit.listing;
    const listing = await readLink(fetchPage, url);
    cache.set(url, { at: Date.now(), listing });
    return listing;
  }

  return {
    search: (query) => searchSources([sampleSource], query.slice(0, 200)),
    async compareLinks(urls, manual) {
      const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
      if (!unique.length && !manual.length) throw new Error('Add at least one product link.');
      if (unique.length > MAX_LINKS) throw new Error(`Compare at most ${MAX_LINKS} links at a time.`);
      return compareLinks(unique, manual, readCached);
    },
  };
}
