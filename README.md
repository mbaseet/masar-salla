# مسار — Salla waybill operations

An Arabic RTL internal application for a small operations team. One card represents one original PDF. Operators work across all brands; duplicate checks and order notes stay within a brand. Admins manage brand identifier phrases/domains, columns, retention, and the email allowlist.

## First use

1. Open the Cloudflare-protected app and sign in with an email code. Only the configured administrator email can initialize the first admin.
2. In **الإعدادات → العلامات والتعريف**, edit Wassan's identifiers or add other brands. Put each sender name, product name, or domain on its own line.
3. Select or drop one or more PDFs on the brand board. Each file gets its own card, with progress and retry controls. **إضافة ملفات** stays visible in the first column. Keep the tab open until the queue finishes. Review warnings and use the offered move if a file belongs to another brand.
4. Open **طباعة الدفعة** or download **تنزيل نسخة الطباعة**, then explicitly confirm printing. New notes or exclusions after printing can require a review of papers already printed.
5. Add team emails and roles under **أعضاء الفريق**, and allow their emails in Cloudflare Access. App roles and the login gate are separate.

Drag a checked file from **بانتظار الطباعة** to the destination and confirm the move. Use **تأكيد الطباعة** in file details to record physical printing. Set a team-visible text and color with **تمييز الكارت**. Finding resolution notes are optional and appear under **تنبيهات تمت معالجتها**.

Identical PDFs and complete matches of verified waybill pages produce a file-level duplicate warning for each matching file. Partial matches still show individual orders. DHL labels with no printed item count retain an unknown quantity and can be used without a quantity warning.

One configured brand identifier anywhere in the PDF or filename verifies the entire file. Files without a matching identifier still need review. Existing cards upgrade using their saved evidence; use **إعادة الفحص** if an older card needs the new full-text check.

Mixed single-item/2+ files show the minority orders with their Ref, page and actual quantity. Equal groups highlight both. These highlights stay on the card, in file review and on the attention sheet even after the warnings are resolved.

For a mistaken upload, open its card and choose **حذف الملف**, then confirm. Admins and operators can delete. This removes the original, search occurrences and associated duplicate alerts; order notes shared with another retained file remain there. The deletion is recorded in activity.

## Early shipments and page exclusions

Open **معاينة الصفحات** or select a page from the order table. **شحن منفصل** reserves the shipment before opening its individual label, including any linked supporting pages. Confirm dispatch after handoff. If the shipment never left, release the reservation after discarding the earlier copy. Use **تم شحنها بالفعل** for a shipment dispatched outside Masar.

Use **استبعاد الصفحة من الطباعة** to skip a page and **إعادة الصفحة للطباعة** to restore it. The batch always uses the current eligible pages. If a label was already in a copy issued by Masar, reconcile the older copy before printing separately. Changed tracking for an already reserved or shipped order needs a review before the new label can join a batch. Admins can export the unchanged source for reference.

## Architecture

React/Vinext and a Cloudflare Worker, D1 SQLite, private R2 originals, Cloudflare Access email-code login. Browser PDFium WASM extracts text in a dedicated worker while upload runs. Only minimal detection fields reach the API; raw extracted customer text is not retained. The server streams, hashes and preserves original bytes, checks duplicates transactionally, and enforces roles and expiry.

Supported sample layouts: Aymakan, RedBox, and DHL label/support pairs. Unknown pages are flagged, not skipped. Product quantity is separate from parcel count; missing brand/quantity needs an audited operator confirmation. Scanned PDFs have no OCR in this version.

Defaults: 50 MiB maximum; 30 days from upload, archived or not; optional 90-day historical index off; archive clear Shipped cards after seven days. Expired originals are inaccessible immediately. Cleanup removes expired objects and operational records. A native Worker cron runs cleanup at 03:00 Africa/Cairo.

## Local development

The source repository is [mbaseet/masar-salla](https://github.com/mbaseet/masar-salla). Its root corresponds to the original workspace's `app/` directory. Clone it with `git clone https://github.com/mbaseet/masar-salla.git`, then `cd masar-salla`. The implementation plan and project context are included; private sample waybills are intentionally excluded.

Use Node 22.13+ (24 recommended), `npm ci`, and `npm run build`. Generate schema changes with `npm run db:generate`; never rewrite a deployed migration. Initialize local D1:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --persist-to .wrangler/state
npm run dev -- --host 127.0.0.1
```

Loopback development provides a local test sign-in at `/auth/login`. That mock is excluded from production. Runtime secrets belong in Cloudflare settings; do not commit them. See [Cloudflare deployment](CLOUDFLARE_DEPLOYMENT.md) for resource setup, login, administrator initialization, and publication.

Apply pending D1 migrations, including **0004_workflow_labels.sql**, before releasing this version. The ordinary download endpoint returns an operational print copy. The original export and private recheck use separate routes.

## Order categories

Open **الإعدادات → العلامات → تصنيفات الطلبات** to rename the two quantity tags and define up to three product groups per brand. Enter the relevant Salla product IDs or SKUs for each group. Rules match the exact set of groups in the order. When two rules match, the first rule in settings wins.

The board shows a file's category counts using recent item data verified by the scanner. An operator can also choose a manual category in the file details and switch back to automatic classification. Category filters narrow the board view. The print workflow continues to use the file's print plan.

## Scanner pilot

The Arabic scanner is a Worker with static assets at `/scan`. Staff sign in once with the temporary shared access code. For a single configured brand the scanner selects it automatically. With multiple brands, staff can switch via the brand menu at the top of the scanner and order views. It remembers the last available brand on that device and clears the current scan when the brand changes. It verifies the shipment in the selected Salla store before showing order status, items, quantities, and selected options. Staff can add the order number printed on the label if the tracking number is missing from the recent index.

```sh
npx wrangler d1 migrations apply DB --config wrangler.scanner.jsonc --local --persist-to .wrangler/scanner-demo
npx wrangler dev --config wrangler.scanner.jsonc --local --persist-to .wrangler/scanner-demo --port 5174 --var SCANNER_DEMO:true
node tests/scanner-runtime.mjs
```

The loopback demo is at `http://127.0.0.1:5174/scan`. Use `demo-masar` and synthetic tracking `AY0000001234`. Wasan displays order `100001` and the second demo brand displays order `200001` for that tracking number. Select **تسجيل المرتجعات · تجريبي** and use the synthetic tracking number `RT0000001234` to test receipt confirmation. Demo receipts are kept for the current session in the page. See [Cloudflare deployment](CLOUDFLARE_DEPLOYMENT.md#scanner-pilot) for Salla setup.

## Verification

`npm run typecheck` and `npm test` run static and parser checks. `npm run test:samples` reads private PDFs from `../sample waybills/` and creates ignored minimal local fixtures. `node --experimental-strip-types tests/integration.ts` resets **only the local test database** and exercises API/storage acceptance cases against the running loopback server. Browser QA uses `tests/browser.mjs` and temporary Playwright tooling. On Node 24, `npm run test:printing` verifies the API, PDF output, exclusions, and races using an in-memory SQLite database. Set `TEST_PRIVATE_WAYBILLS="../sample waybills"` to include read-only render comparisons against the local private samples.

Sample PDFs, local database state, credentials, and QA screenshots must never enter source control, public assets, or deployment archives. A new Cloudflare deployment starts with no customer files; existing hosted data requires a separate private migration. See `PROJECT_CONTEXT.md` for current evidence and deployment status.
