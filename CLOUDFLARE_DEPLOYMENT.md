# Cloudflare deployment

Masar now runs independently on Cloudflare Workers, D1 and a private R2 bucket. Team members sign in using Cloudflare Access email codes. No ChatGPT account is required. The existing Sites publication is a separate deployment and is not updated by these commands.

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
