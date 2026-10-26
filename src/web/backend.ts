// Where the app gets its answers. The website asks the Node server; the
// Android app does the same work on the phone (see deviceBackend.ts).

import type { CompareLinksResponse, Listing, SearchResponse } from '../shared/types.ts';

export interface Backend {
  search(query: string): Promise<SearchResponse>;
  compareLinks(urls: string[], manual: Listing[]): Promise<CompareLinksResponse>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
  return body as T;
}

export const serverBackend: Backend = {
  search: (query) => api<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`),
  compareLinks: (urls, manual) =>
    api<CompareLinksResponse>('/api/compare-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, manual }),
    }),
};
