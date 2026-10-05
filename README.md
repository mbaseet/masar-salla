# مسار — Salla waybill operations

An Arabic RTL internal application for a small operations team. One card represents one original PDF. Operators work across all brands; duplicate checks and order notes stay within a brand. Admins manage brand identifier phrases/domains, columns, retention, and the email allowlist.

## First use

1. Open the private Site and sign in. The first owner login becomes the administrator.
2. In **الإعدادات → العلامات والتعريف**, edit Wassan's identifiers or add other brands. Put each sender name, product name, or domain on its own line.
3. Upload a PDF on its brand board. Keep the tab open until processing finishes. Review warnings and use the offered move if the file belongs to another brand.
4. Open/download the unchanged original, print, then explicitly confirm printing. New notes after printing raise an alert until acknowledged.
5. Add team emails and roles under **أعضاء الفريق**, and grant those people access through Site sharing. App membership alone does not change Site sharing.

## Architecture

React/Vinext and a Cloudflare Worker, D1 SQLite, private R2 originals, platform login. Browser PDFium WASM extracts text in a dedicated worker while upload runs. Only minimal detection fields reach the API; raw extracted customer text is not retained. The server streams, hashes and preserves original bytes, checks duplicates transactionally, and enforces roles and expiry.

Supported sample layouts: Aymakan, RedBox, and DHL label/support pairs. Unknown pages are flagged, not skipped. Product quantity is separate from parcel count; missing brand/quantity needs an audited operator confirmation. Scanned PDFs have no OCR in this version.

Defaults: 50 MiB maximum; 30 days from upload, archived or not; optional 90-day historical index off; archive clear Shipped cards after seven days. Expired originals are inaccessible immediately. Cleanup removes expired objects and operational records. The scheduled service endpoint requires a runtime secret and returns only counts.

## Local development

Use Node 22.13+ (24 recommended), `npm ci`, and `npm run build`. Generate schema changes with `npm run db:generate`; never rewrite a deployed migration. Initialize local D1:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_closed_lethal_legion.sql
npm run dev -- --host 127.0.0.1
```

Loopback development provides a local test sign-in. That mock is excluded from production. Runtime secrets belong in Sites settings; do not commit them.

## Verification

`npm run typecheck` and `npm test` run static and parser checks. `npm run test:samples` reads private PDFs from `../sample waybills/` and creates ignored minimal local fixtures. `node --experimental-strip-types tests/integration.ts` resets **only the local test database** and exercises API/storage acceptance cases against the running loopback server. Browser QA uses `tests/browser.mjs` and temporary Playwright tooling.

Sample PDFs, local database state, credentials, and QA screenshots must never enter source control, public assets, or deployment archives. The hosted app starts with no customer files. See `PROJECT_CONTEXT.md` for current evidence and deployment status.
