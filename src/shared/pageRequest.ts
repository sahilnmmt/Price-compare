// What both page downloaders (server and phone) send and accept.

import { UserError } from './errors.ts';

/** Many shops serve a bare page, or nothing, to clients that don't look like a browser. */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9',
};

export const MAX_REDIRECTS = 5;
export const PAGE_TIMEOUT_MS = 12_000;

/** Throws a shopper-friendly error for a final (non-redirect) response that isn't a usable page. */
export function checkPageResponse(status: number, contentType: string): void {
  if (status === 403 || status === 429 || status === 503) {
    throw new UserError(`The site refused the request (HTTP ${status}); it may block automatic reading.`);
  }
  if (status < 200 || status >= 300) throw new UserError(`The page could not be loaded (HTTP ${status}).`);
  if (contentType && !/html|xml/i.test(contentType)) {
    throw new UserError(`That link is not a web page (${contentType.split(';')[0]}).`);
  }
}
