// The HTTP API, plus the built web app from dist/.
//
//   GET  /api/search?q=…     search every source; one comparison per product
//   POST /api/compare-links  {urls, manual?} read each link and compare them as one product
//   GET  /api/health

import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { compareLinks, MAX_LINKS, readLink, searchSources } from '../shared/service.ts';
import type { Source } from '../shared/sources/source.ts';
import { siteFromUrl } from '../shared/text.ts';
import type { CompareLinksResponse, Listing } from '../shared/types.ts';
import { fetchPage, type FetchOptions } from './fetchPage.ts';
import { enabledSources } from './sources/index.ts';

const MAX_BODY = 64 * 1024;
const PAGE_CACHE_MS = 10 * 60_000;
/** Links each client may read per minute. Each link is one request to a shop. */
const LINKS_PER_MINUTE = 30;

export interface AppOptions {
  sources?: Source[];
  fetch?: FetchOptions;
  /** Replaces the page downloader; tests use it to serve saved pages. */
  fetchPage?: typeof fetchPage;
  /** Folder of the built web app; not served when absent. */
  staticDir?: string;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createApp(opts: AppOptions = {}): http.Server {
  const sources = opts.sources ?? enabledSources();
  const pageCache = new Map<string, { at: number; listing: Listing }>();
  const linkBudget = new Map<string, { minute: number; used: number }>();

  async function readCached(url: string): Promise<Listing> {
    const cached = pageCache.get(url);
    if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return cached.listing;
    const listing = await readLink((u) => (opts.fetchPage ?? fetchPage)(u, opts.fetch), url);
    pageCache.set(url, { at: Date.now(), listing });
    if (pageCache.size > 500) pageCache.delete(pageCache.keys().next().value!);
    return listing;
  }

  function spendLinkBudget(client: string, links: number) {
    const minute = Math.floor(Date.now() / 60_000);
    const entry = linkBudget.get(client);
    const used = entry?.minute === minute ? entry.used : 0;
    if (used + links > LINKS_PER_MINUTE) {
      throw new HttpError(429, 'Too many links in the last minute. Wait a moment and try again.');
    }
    linkBudget.set(client, { minute, used: used + links });
    if (linkBudget.size > 10_000) linkBudget.clear();
  }

  async function handleCompareLinks(body: unknown, client: string): Promise<CompareLinksResponse> {
    const { urls, manual } = validateCompareRequest(body);
    spendLinkBudget(client, urls.length);
    return compareLinks(urls, manual, readCached);
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true });
      if (url.pathname === '/api/search' && req.method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').slice(0, 200);
        return sendJson(res, 200, await searchSources(sources, q));
      }
      if (url.pathname === '/api/compare-links') {
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
        const client = req.socket.remoteAddress ?? 'unknown';
        return sendJson(res, 200, await handleCompareLinks(await readJson(req), client));
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
      if (opts.staticDir && (req.method === 'GET' || req.method === 'HEAD')) return await serveStatic(opts.staticDir, url.pathname, res);
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      console.error(e);
      return sendJson(res, 500, { error: 'Something went wrong.' });
    }
  });
}

function validateCompareRequest(body: unknown): { urls: string[]; manual: Listing[] } {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Send a JSON object.');
  const { urls = [], manual = [] } = body as { urls?: unknown; manual?: unknown };
  if (!Array.isArray(urls) || !urls.every((u) => typeof u === 'string')) throw new HttpError(400, '`urls` must be a list of links.');
  if (!Array.isArray(manual)) throw new HttpError(400, '`manual` must be a list of offers.');
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (unique.length + manual.length === 0) throw new HttpError(400, 'Add at least one product link.');
  if (unique.length > MAX_LINKS) throw new HttpError(400, `Compare at most ${MAX_LINKS} links at a time.`);
  if (manual.length > MAX_LINKS) throw new HttpError(400, `Add at most ${MAX_LINKS} offers by hand.`);
  return { urls: unique, manual: manual.map(validateManual) };
}

/** An offer typed in by hand. Only known fields are kept, with their types checked. */
function validateManual(raw: unknown, i: number): Listing {
  const bad = (what: string) => new HttpError(400, `Offer ${i + 1} added by hand: ${what}`);
  if (typeof raw !== 'object' || raw === null) throw bad('not an object.');
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);
  const price = num(o.price, 1e9);
  if (!price) throw bad('needs a price above 0.');
  const url = str(o.url, 2000);
  const safeUrl = url && /^https?:\/\//i.test(url) ? url : undefined;
  const fromUrl = safeUrl ? siteFromUrl(safeUrl) : undefined;
  const siteName = str(o.siteName, 60) ?? fromUrl?.siteName;
  if (!siteName) throw bad('needs a site name or a link.');
  const seller = typeof o.seller === 'object' && o.seller !== null ? (o.seller as Record<string, unknown>) : {};
  const sellerName = str(seller.name, 120);
  const currency = str(o.currency, 10)?.toUpperCase() ?? 'INR';
  if (!/^[A-Z]{3}$/.test(currency)) throw bad('currency must be a 3-letter code like INR.');
  return {
    site: fromUrl?.site ?? siteName.toLowerCase().replace(/[^a-z0-9.]+/g, '-'),
    siteName,
    title: str(o.title) ?? 'Added by hand',
    url: safeUrl ?? '',
    price,
    mrp: num(o.mrp, 1e9),
    shipping: num(o.shipping, 1e7),
    currency,
    inStock: typeof o.inStock === 'boolean' ? o.inStock : undefined,
    seller: sellerName ? { name: sellerName, rating: num(seller.rating, 5), fulfilledBySite: seller.fulfilledBySite === true } : undefined,
    rating: num(o.rating, 5),
    reviewCount: num(o.reviewCount, 1e9),
    deliveryDays: num(o.deliveryDays, 365),
  };
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'The request is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

async function serveStatic(dir: string, pathname: string, res: http.ServerResponse) {
  const root = resolve(dir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(404, 'Not found.');
  }
  let file = normalize(join(root, decoded));
  if (file !== root && !file.startsWith(root + sep)) throw new HttpError(404, 'Not found.');
  const info = await stat(file).catch(() => undefined);
  if (!info || info.isDirectory()) file = join(root, 'index.html'); // single-page app
  const body = await readFile(file).catch(() => undefined);
  if (!body) throw new HttpError(404, 'Not found. Run `npm run build` first.');
  const hashed = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}
