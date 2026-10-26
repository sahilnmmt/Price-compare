import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDeviceBackend, type HttpGet } from '../src/web/deviceBackend.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const html: Record<string, string> = { 'Content-Type': 'text/html; charset=UTF-8' };

// Stands in for the phone's native HTTP client.
const requests: string[] = [];
const fakeGet: HttpGet = async ({ url, headers, disableRedirects }) => {
  requests.push(url);
  assert.equal(disableRedirects, true);
  assert.match(headers['User-Agent'], /Mozilla/);
  switch (url) {
    case 'http://amzn.in/d/short':
      return { status: 301, headers: { location: 'https://www.amazon.in/dp/B0CS5XW6TN' } as Record<string, string>, data: '', url };
    case 'https://www.amazon.in/dp/B0CS5XW6TN':
      return { status: 200, headers: html, data: fixture('amazon.html'), url };
    case 'https://www.flipkart.com/samsung-galaxy-s24/p/itm123':
      return { status: 200, headers: { 'content-type': 'text/html' }, data: fixture('flipkart-jsonld.html'), url };
    case 'https://www.amazon.in/dp/CAPTCHA':
      return { status: 503, headers: html, data: fixture('captcha.html'), url };
    case 'https://offline.example/':
      throw new Error('UnknownHostException');
    default:
      return { status: 404, headers: html, data: 'Not found', url };
  }
};

test('search works on the phone without a server', async () => {
  const backend = createDeviceBackend(fakeGet);
  const r = await backend.search('wh-1000xm5');
  assert.equal(r.sample, true);
  assert.equal(r.products.length, 1);
  assert.equal(r.products[0].offers.length, 5);
});

test('compare links follows redirects, reads pages and reports failures', async () => {
  const backend = createDeviceBackend(fakeGet);
  const r = await backend.compareLinks(
    ['http://amzn.in/d/short', 'https://www.flipkart.com/samsung-galaxy-s24/p/itm123', 'https://www.amazon.in/dp/CAPTCHA', 'https://offline.example/', 'ftp://x.example/'],
    [],
  );
  assert.deepEqual(
    r.comparison!.offers.map((o) => [o.siteName, o.total]),
    [['Flipkart', 62999], ['Amazon', 64999]],
  );
  assert.equal(r.comparison!.offers[1].url, 'https://www.amazon.in/dp/B0CS5XW6TN');
  const messages = Object.fromEntries(r.errors.map((e) => [e.source, e.message]));
  assert.match(messages['https://www.amazon.in/dp/CAPTCHA'], /refused the request \(HTTP 503\)/);
  assert.match(messages['https://offline.example/'], /Could not reach offline\.example/);
  assert.match(messages['ftp://x.example/'], /Only http and https/);
});

test('pages are cached for a while', async () => {
  const backend = createDeviceBackend(fakeGet);
  const url = 'https://www.flipkart.com/samsung-galaxy-s24/p/itm123';
  const before = requests.filter((u) => u === url).length;
  await backend.compareLinks([url], []);
  await backend.compareLinks([url], []);
  assert.equal(requests.filter((u) => u === url).length - before, 1);
});

test('compare links checks its input', async () => {
  const backend = createDeviceBackend(fakeGet);
  await assert.rejects(backend.compareLinks([], []), /at least one product link/);
  await assert.rejects(backend.compareLinks(Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`), []), /at most 10/);
});
