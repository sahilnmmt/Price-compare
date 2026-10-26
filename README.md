# Price Compare

Compare one product across shopping sites. The app shows, side by side:
- **Price difference:** each shop's price plus delivery, how much more it costs
  than the cheapest (₹ and %), the MRP discount, and how much you save by
  buying at the cheapest shop.
- **Seller:** the seller's name and rating, and whether the shop ships it
  itself (Fulfilled by Amazon, Flipkart Assured and so on).
- **Ratings:** the product rating and number of reviews on each shop. Ratings
  are also adjusted for review count, so 4.9★ from 4 reviews does not beat
  4.5★ from 5,000.

Every offer gets badges (**Cheapest**, **Top rated**, **Best value**,
**Trusted seller**, **Out of stock**) and a 0–100 **value score**. The score is
60% price, 30% adjusted rating and 10% seller trust. The app also warns you
when:
- a listing may be a different variant (128 GB vs 256 GB, 55" vs 65", another colour);
- a listing may be a different product;
- a price is suspiciously far below the others, which can mean a fake or grey-market item;
- a shop's delivery charge is unknown.

## Two ways to compare
1. **Search products:** type a product name. Every source is searched, matching
   listings from different shops are grouped into one product, and each product
   gets a comparison table. Out of the box the only source is a **sample
   catalogue** (made-up prices for Amazon, Flipkart, Croma, Reliance Digital,
   Tata CLiQ and Myntra), clearly marked as sample data. See *Adding live
   sources* below.
2. **Compare my links (live prices):** paste the same product's link from each
   shop. The server opens each page and reads the title, price, MRP, seller,
   rating and stock. It reads the schema.org product data most shops publish,
   plus Open Graph tags, and has a dedicated reader for Amazon. If a shop shows
   a captcha, you can add that offer by hand and it is still compared.

## Android app
**Download:** on your phone, open
https://github.com/sahilnmmt/Price-compare/releases/tag/app-latest and tap
`price-compare.apk`. Open the downloaded file. Android asks once to allow
installs from your browser; allow it, then tap **Install**. Every push to `main`
builds a new APK there.

The app needs no server: search and link reading run on the phone. It reads
shop pages with the phone's own HTTP client, so links work even where a
website's browser security would block them.

### Building it yourself
Needs Node.js 22.18+, JDK 21 and the Android SDK (or Android Studio).
```sh
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease   # app/build/outputs/apk/release/app-release.apk
```
To edit or run it from Android Studio, use `npx cap open android`. Run
`node tools/android-assets.mjs` after changing the icon design.

### Release signing key (recommended, one-time)
Until you add a key, CI signs the APK with a debug key that it keeps in its
cache. If that cache is cleared (after 7 days without a build), the next APK
has a different signature, so you have to uninstall the old app before
installing it. To sign with your own permanent key:
1. Create a key on your computer (keep the file and the passwords safe):
   ```sh
   keytool -genkeypair -v -keystore release.jks -alias pricecompare -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 release.jks > release.jks.b64     # macOS: base64 -i release.jks -o release.jks.b64
   ```
2. In the GitHub repository, open *Settings → Secrets and variables → Actions*
   and add four **secrets**:
   - `ANDROID_KEYSTORE_BASE64`: the contents of `release.jks.b64`;
   - `ANDROID_KEYSTORE_PASSWORD`;
   - `ANDROID_KEY_ALIAS`: `pricecompare`;
   - `ANDROID_KEY_PASSWORD`: the same as the keystore password unless you chose another.

   Changing to this key changes the signature, so uninstall the app once before
   installing the first APK signed with it.

## Run the website
Needs Node.js 22.18 or newer. The server is plain TypeScript, run directly by Node.

```sh
git clone https://github.com/sahilnmmt/Price-compare.git
cd Price-compare
npm install
npm run build      # build the web app into dist/
npm start          # http://127.0.0.1:8787
```

For development, run `npm run dev`. It starts the API with auto-reload, plus
Vite at http://127.0.0.1:5174.

Settings (environment variables):
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on. |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to use it from your phone on the same Wi-Fi. |
| `PRICECOMPARE_SAMPLE` | on | Set to `0` to hide the sample catalogue. |

## Tests
```sh
npm test           # price/title parsing, matching, comparison maths, page reading, API
npm run test:e2e   # drives the app in Chromium; screenshots in test-results/e2e
```
CI runs both (`.github/workflows/ci.yml`).

## How it works
- `src/shared/`: code used by the server, the website and the Android app.
  - `text.ts`: parses prices, ratings and counts in Indian, US and European formats, and reads variants from titles.
  - `match.ts`: decides when two listings are the same product. It uses model
    numbers first. It then compares titles, with words near the start counting
    more. Listings that differ in storage, size or model line (Pro, Max,
    Ultra…) are never grouped.
  - `service.ts`: search and compare-links, used by both the server and the phone.
  - `extract.ts`: reads product pages (JSON-LD, microdata, Open Graph and Amazon).
  - `sources/`: searchable sources. Only the sample catalogue ships today.
  - `compare.ts`: works out the price differences, the review-adjusted rating, the value score, the badges and the warnings.
- `src/server/`
  - `app.ts`: the HTTP API (`GET /api/search?q=`, `POST /api/compare-links`) and serves the built web app.
  - `fetchPage.ts`: downloads pasted links safely. It allows only public
    addresses (checked at connect time, so DNS tricks can't reach your network)
    and limits redirects, page size and time. Each client may read at most 30
    links a minute, and pages are cached for 10 minutes.
- `src/web/`: the browser app (no framework). It works on phones and in dark mode.
  `backend.ts` talks to the server; `deviceBackend.ts` does the same work on the phone.
- `android/`: the Android project (Capacitor), which wraps the web app.

## Adding live sources
Shops don't allow scraping their search results, and they block it quickly.
Live search should therefore use official APIs:
- **Amazon:** Product Advertising API 5.0. You need an Amazon Associates account.
- **Flipkart:** the Flipkart Affiliate API.
- **Other shops:** an affiliate network's product feed (for example Cuelinks, EarnKaro or Admitad).

To add one, write a `Source` (`src/shared/sources/source.ts`) whose `search()`
returns `Listing`s. Add it in `src/server/sources/index.ts` for the website,
and in `src/web/deviceBackend.ts` for the app. Grouping, comparison and
the UI work unchanged.

## Limits
- Reading pasted links depends on each shop's page. A shop can change its page
  or show a captcha at any time; when that happens, add the offer by hand.
- Prices change often, and some depend on bank offers, coupons or your PIN code.
  Always check the final price on the shop's own page before you buy.
