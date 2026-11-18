# Cloudflare deployment

This guide covers the implemented Cloudflare Workers deployment path, which uses D1, private R2 and Cloudflare Access email-code login. Independent publication is still pending in the project record. The current configuration requires R2 activation and a configured Access application, and the project records a no-billing constraint. See [project context](PROJECT_CONTEXT.md) for current status and the proposed alternative. The existing ChatGPT Site is a separate deployment.

## Configuration

`wrangler.jsonc` names the Worker, account, D1 database and R2 bucket. It is safe to commit resource IDs, the Access team domain and audience; they are identifiers, not credentials. Never commit API tokens, JWTs, customer PDFs or database exports.

Required runtime values:

| Value | Purpose |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Exact HTTPS team domain, such as `https://your-team.cloudflareaccess.com` |
| `ACCESS_AUD` | The Access application's audience tag |
| `INITIAL_ADMIN_EMAIL` | Explicit initial administrator email; set as a Worker secret |

The app rejects requests if Access is unconfigured, the token is invalid, or the email has no active app membership. Only the configured initial email can create the first administrator in an empty users table. Existing user IDs are preserved by looking up verified email addresses.

## First deployment

1. Sign into the intended Cloudflare account with `npx wrangler login`. Enable R2 and complete Zero Trust Free setup in Cloudflare's dashboard if those products are not active.
2. Create the dedicated D1 database and private R2 bucket. Keep R2's public access disabled. Update their identifiers in `wrangler.jsonc`.
3. Apply the existing schema: `npm run db:migrate`. Never recreate or rewrite a shipped migration.
4. Create a self-hosted Access application for the exact Worker hostname (and every custom hostname, if added). Start with an Allow policy containing only the administrator email. Use the One-time PIN identity provider. Do not use a Bypass policy. Copy the team domain and audience into `wrangler.jsonc`.
5. Build with `npm run build`, then deploy with `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --config dist/server/wrangler.json`. Initial deployment remains closed to app membership until the administrator secret is set.
6. Set the initial administrator using `npx wrangler secret put INITIAL_ADMIN_EMAIL`. Enter the email at the prompt. Do not put credentials in shell commands. Sign in to the Worker URL using that inbox and verify the brand board and settings.
7. For later releases use `npm run deploy`. It builds the current source and deploys the generated Worker configuration. The deploy script refuses empty Access configuration.

Use Node 24 (22.13+ minimum). This repository uses its pinned Vinext/Vite/Workers versions; a framework upgrade is not required for deployment.

## Scanner pilot

`wrangler.scanner.jsonc` packages the Wasan scanner and its public information page. It uses Workers, Static Assets, and D1. The intended host is `masar-salla.mint-meow.workers.dev`. Verify the account, hostname, and existing Worker deployments before publishing. This is a separate deployment profile for the same planned hostname.

1. Validate the scanner with `node tests/scanner-runtime.mjs` and `npx wrangler deploy --dry-run --config wrangler.scanner.jsonc`. Sign in with `npx wrangler login`, verify the account and Worker with `npx wrangler deployments list --config wrangler.scanner.jsonc`, and check migration status with `npx wrangler d1 migrations list DB --remote --config wrangler.scanner.jsonc`. Apply pending D1 migrations including `0002_scanner_pilot.sql` and `0003_salla_shipment_events.sql` before enabling the scanner. Publish with `npx wrangler deploy --config wrangler.scanner.jsonc` once the Worker name is confirmed for the pilot.
2. Set `SCANNER_ACCESS_CODE` as a Worker secret using a randomly generated hexadecimal code of at least 32 characters. Rotation invalidates existing sessions. Staff supply the code at `/scan`.
3. Register [the Masar app website](https://masar.mintmeow.com/) with Salla Partners, select Easy Mode, and enable `orders.read` and `shipping.read`. Set the authorization webhook to `https://masar-salla.mint-meow.workers.dev/webhooks/salla` using Salla's signature strategy.
4. Set `SALLA_MERCHANT_ID`, `SALLA_WEBHOOK_SECRET`, `SALLA_CLIENT_ID`, `SALLA_CLIENT_SECRET`, and `SALLA_TOKEN_KEY` as Worker secrets. The token key is a randomly generated 32-byte value encoded as 64 hexadecimal characters. Keep it available for existing encrypted credentials. Install the app in the intended store to receive the authorization event.
5. Verify the correct tracking, order reference, quantities, and selected options on a real label. Check phone camera behavior, Salla response fields, and Worker CPU usage before rolling out to staff. The recent shipment index is bounded to 600 shipment records per sync. Older or unindexed labels can be resolved by entering the order reference alongside the tracking number.

See [Salla authorization](https://docs.salla.dev/421118m0) and [Salla app events](https://docs.salla.dev/421413m0).

### Salla app website

`wrangler.scanner-site.jsonc` deploys the public website to `masar.mintmeow.com` in the Mint Meow Cloudflare account. It serves the public landing page and stylesheet from the scanner assets and redirects staff to the scanner's `/scan` URL. Use a Cloudflare login with access to the Mint Meow zone for website deployments. Store scanner credentials and Salla secrets on the `masar-salla` Worker in the scanner account.

### Additional scanner brands

For a single store, the Worker uses `SCANNER_BRAND_ID`, `SCANNER_BRAND_NAME`, and `SALLA_MERCHANT_ID`. To enable more stores, set `SCANNER_BRANDS` to a JSON array of objects with `id`, `name`, and `merchantId`. Include Wasan in the array and use each brand’s existing Masar ID. Each merchant ID is a numeric string and appears once. The shared scanner login grants access to the configured brands. Each store owner installs the same Salla app to authorize their own connection.

The Worker rotates through the configured brands, syncing one on each 15-minute trigger. For two brands, each receives a scheduled sync every 30 minutes.

For a brand whose Salla app lacks the shipping API read scope, set `shipmentSource` to `webhook` in its `SCANNER_BRANDS` entry. Authorize the app with Orders read access in this mode. Enable `shipment.created`, `shipment.updated`, and `shipment.cancelled` in Salla. The Partners portal enables `webhooks.read_write` when you save the subscriptions. In webhook mode the scanner accepts that scope and rejects Orders write access. It reads current status and items from the Orders API and resolves tracking numbers from the signed shipment events it has received in the past 14 days. Issue a fresh test waybill after authorizing the demo store and enabling its events.

## Team management

Add the same staff email in Settings → Team and the Cloudflare Access Allow policy. The app controls Admin/Operator roles, all-brand access, and active status. Disabling a user in the app blocks subsequent API requests even if their Access session still exists. Access policy changes manage the login gate. No app-managed passwords or password reset workflow is needed.

## Cleanup schedule

The Worker has a scheduled handler. An hourly UTC trigger checks the Africa/Cairo hour and runs maintenance at 03:00 local time, including daylight-saving changes. It removes expired originals/records and archives eligible shipped cards. No external scheduler or bearer secret is needed for cron. The old Sites schedule must only be retired as part of a deliberate cutover, after any needed data migration.

## Existing data and cutover

GitHub contains source only. New D1/R2 resources start empty. If the old Site contains files to retain, export its operational database and transfer original PDFs privately with matching object keys, preserving upload/expiry timestamps and user IDs. Do not upload customer data through GitHub. Keep the old Site available until transfer and login are verified.

## Verification

- `npm run typecheck` and `npm test` include JWT verification and request-isolation tests.
- After building, `npm run test:worker` exercises the compiled production Worker with isolated synthetic data: signed-email membership, administrator bootstrap, rejected development cookies, operator deactivation, and native cron. It calls the scheduled handler directly because the pinned local simulator has a known static-assets cron routing issue ([workers-sdk #9882](https://github.com/cloudflare/workers-sdk/issues/9882)).
- `npm run test:samples` reads the private sibling `sample waybills/` directory, if available.
- Apply migrations locally with `npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state`, then `npm run dev`.
- Local preview has a loopback-only `/auth/login` test login. Its middleware strips identity headers; production builds exclude that login.
- `node --experimental-strip-types tests/integration.ts` deliberately resets only the local QA database. Never point it at production.
- Browser scenarios are in `tests/browser.mjs`.
- On the hosted app, verify the email-code login, rejection without Access, operator restrictions, private original downloads, uploads, and scheduled cleanup. Local timing is not a hosted performance guarantee.

Cloudflare Access Free covers up to 50 users. Workers/D1/R2 have separate usage allowances. Large requests and SSR must be measured before assuming the Workers Free CPU allowance is sufficient.

Official references: [Access email codes](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/), [JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Worker Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
