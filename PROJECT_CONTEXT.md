Project context — Salla Orders / مسار

Last updated: 2026-10-06, GitHub source publication.

Current outcome
- Revision is published from app/: multi-file queue with per-file progress/retry, visible first-column add button, explicit back-to-board action, confirmed file deletion for both roles, file/filename brand matching, persistent quantity exception summary/table/card/attention-sheet highlighting. Legacy brand warnings upgrade using saved evidence.
- Revised typecheck and 17 parser tests pass. All five original sample PDFs pass: domestic zero findings; DHL now has three quantity-only findings because its filename identifies Wassan. All 31 local integration checks and six browser UX scenarios pass. Desktop/mobile screenshots inspected; zero uncaught browser errors. Production build passed and private publication succeeded.
- Verified revision scope: batch PDF selection/drop, persistent add-file control in Awaiting print, confirmed deletion of mistaken uploads, file-wide brand matching including filename, and quantity exceptions highlighted even after resolution. Browser UX/scenario testing is complete. Existing private audience and nightly schedule must be preserved.
- New brand rule supersedes the original sender-only/per-page policy: one occurrence for the selected brand anywhere in the PDF or filename is sufficient. Quantity exceptions will be based on the dominant single vs 2+ group (ties highlight both groups), with Ref/page/actual quantity retained independently of warning resolution.
- Phase 1 implementation is published privately: https://salla-waybill-operations.youssef5537rblh.chatgpt.site
- Site ID: appgprj_6ac228daf7c48191a7d214780d594c14. Reuse app/.openai/hosting.json; never register a replacement.
- Deployed source: 0b3c04ab76adbbae54b603fad7d4ed6b3c7f8b60.
- Deployment: appgdep_6ac4c54fa25881918816687556ebe846, succeeded. Environment revision 1.
- Version: appgprj_6ac228daf7c48191a7d214780d594c14~appgver_b7b05f66b5b88191a66fe230a56de2aa.
- Private audience unchanged, owner only. No customer PDFs or local test records were uploaded to production.
- Nightly cleanup/auto-archive schedule saved and enabled at 03:00 Africa/Cairo, starting October 6. ID: Automation_752ab481a7108191b0479eda116e1fbb. The first scheduled run has not been independently observed.
- Hosted POST /api/maintenance/run was verified with service authentication: HTTP 200, zero expired/archived records. Never record credentials here.

User decisions
- Standalone app, not Trello. Small-team workflows; two roles: Admin and Operator.
- Operators access every brand. Data, duplicate checks, and order notes stay brand-scoped.
- Admins edit brand identifier words/phrases/domains, users, column names/order, and retention settings.
- One card per unchanged PDF; whole-file printing/download. Default columns: Awaiting print → Printed → Prepared → Shipped → Archive.
- Explicit print confirmation. Operators resolve findings and acknowledge late changes without an extra admin gate.
- Order notes follow the same brand and Ref across retained files. Later notes raise a new versioned alert after printing, even in Prepared/Shipped.
- 30-day expiry from upload regardless of status; optional 90-day historical index off; seven-day shipped auto-archive when issues and late alerts are clear.
- 50 MiB upload maximum; Ref is a string and primary business key, tracking secondary.
- Keep this file current after meaningful milestones and before every handoff.

Implementation
- Code in app/. Root planning/context documents and private sample PDFs stay separate.
- React/Vinext, Cloudflare Worker, D1 SQLite, private R2. D1 replaces the preliminary PostgreSQL proposal.
- Arabic RTL responsive board, file review, upload, per-page parsing/checks, duplicates, bucket/brand mismatch, global partial and batch search, typed file/order notes, print confirmation, attention sheet, audit, admin settings.
- Browser PDFium WASM worker reads every page while upload runs. Only minimal detection fields reach the API; raw extracted text is transient. The browser tab must remain open until processing finishes. Saved PDFs can be rechecked; stale receiving/processing leases can recover.
- The server streams original bytes through validation/hash to R2 without buffering a whole 50 MiB upload. D1 batches make duplicate insertion and mirrors consistent across concurrent uploads. Resolved findings remain resolved on recheck.
- Expiry blocks access and removes active duplicate alerts immediately, even before cleanup. Cleanup removes originals, occurrences, file-linked notes/audit and expired index entries. Disabling the historical index deletes its existing entries.
- Platform login plus app email allowlist. First owner-private login initializes admin. Team members need both Site sharing access and an app role; adding a member in the app does not change Site sharing.
- Maintenance endpoint uses a configured runtime secret. The linked schedule retrieves the existing Site service token in memory. If it is rotated later, update the maintenance secret through Sites and redeploy; never persist the token in source or context.

Verified evidence
- All five original PDFs remain unchanged. Totals: 1,179 physical pages and 1,176 distinct orders.
- Domestic files: 226 and 836 single-item shipments; 26 and 85 multi-item shipments. Actual app parser produces correct counts/buckets and zero findings for all four.
- Carrier totals: Aymakan 109 pages, RedBox 1,064, DHL 6.
- DHL: three label/support-document pairs, six pages and three shipments; three expected quantity-only findings, no false duplicate. Its Wassan filename now verifies the brand. Parcel count must not be treated as product count.
- Initial admin-editable Wassan identifiers: Wasn Saudi, wasnbrand.com, وسن, اليقاظة. The revised user policy accepts a configured identifier anywhere in extracted file text or the filename; only matching terms/brand IDs, not raw customer text, are retained. RedBox sender headings can use a newline rather than a colon.
- Source dates retain meaning: RedBox order date, Aymakan carrier date, DHL label date.
- Production build and TypeScript check pass. All 17 revised parser tests pass.
- Local integration suite passes 31 checks: all five real uploads and byte-identical downloads, duplicate hash/Refs and mirrors, within-file repetition, resolution persistence, two-order repeat report, unknown layout, mixed bucket, brand settings/move/isolation, simultaneous uploads, late notes/acknowledgment races, search, roles, expiry/index/archiving, interrupted-operation recovery, file-level brand migration, filename-only matching, permanent quantity highlights, and deletion/access/search/duplicate/note cleanup.
- Chrome QA passed RTL board/settings/review, real 836-page worker upload, mobile width, and no uncaught browser errors. 836-page local parse: 4.44 seconds. Browser upload-to-result: 13.8 seconds total, 7.22 seconds after upload completion. These are local measurements, not a hosted performance guarantee.
- Revised Chrome UX: batch-select real 226/26-page PDFs in an occupied first column; drop several files; damaged-file continuation; retry without duplicate cards; minority quantity highlight after resolution/printing/reopening/reload and attention-sheet inclusion; late-note acknowledgment; delete cancel/confirm; filename-only matching; 390×844 mobile layout and Escape dismissal. Six scenarios passed, no uncaught browser errors. Dialog animation waits were corrected in the test harness.
- Source audit: zero PDFs, local SQLite databases, or QA screenshots tracked. Revised 200-entry deployment archive verified: no customer PDFs, local databases, QA state or environment files.

GitHub source
- User-selected repository: https://github.com/mbaseet/masar-salla. It is public; preserve its existing visibility.
- Initial push succeeded. GitHub API confirmed commit 1e9a79fddb899b7b6ffb0fa36777ac615e63240f matches local source and main is the default branch. This verification is recorded in the following documentation commit. No application behavior or live deployment changed during this task.
- The app checkout uses the additional remote github and branch main. GitHub repository root corresponds to the original workspace app/ directory. Preserve the Sites project binding and source workflow.
- IMPLEMENTATION_PLAN.md is copied into the application repository for GitHub continuity; the original workspace root remains canonical for planning and context. Keep these copies synchronized on future changes.
- Both existing source commits were inspected before pushing: no customer PDFs, local databases, extracted QA data, environment files, or detected credential patterns. Ignore rules explicitly exclude PDFs, SQLite databases and TypeScript build caches.
- GitHub pushes store source only; production publication and its private audience remain managed through the existing Sites workflow.

Local tooling and continuity
- app/README.md documents setup and first use; app/AGENTS.md documents app-specific rules.
- Local build runtime: /private/tmp/node-v24.14.0-darwin-x64/bin. Bundled ChatGPT Node has macOS library-validation restrictions that prevent native build plugins from loading.
- Use npm run typecheck, npm test, npm run test:samples. Integration tests require the local server and deliberately reset only local QA storage. Browser tests use temporary Playwright tooling; no production test records are needed.
- Generated initial migration: app/drizzle/0000_closed_lethal_legion.sql. It is deployed; never rewrite it.
- Root PROJECT_CONTEXT.md is canonical. app/PROJECT_CONTEXT.md is a synchronized local copy; its post-publication documentation update does not change the deployed app behavior.
- Local preview server stopped after publication. Local QA database/object storage, extracted sample records and screenshots removed; original sample PDFs preserved. UX evidence and reproducible scenarios are documented in app/UX_REVIEW.md and app/tests/.

Limits and next steps
- Hosting discussion (2026-10-05): user asked about the stack and free independent/private hosting. No migration requested or performed. Closest fit is an own-account Cloudflare deployment, but its free 10 ms CPU/request allowance needs benchmarking; the paid Workers base is $5/month. Oracle Always Free VM or existing office hardware are alternatives requiring more backend adaptation. Moving off Sites requires replacing platform login and the linked scheduler; moving off Cloudflare also requires D1/R2 adapters. Provider pricing was checked against official docs on this date.
- Next pilot step: refresh the private app, select multiple daily files on Wassan’s board, and review quantity exceptions. Existing cards upgrade from saved brand evidence; use Recheck if an older card requires the new anywhere-in-file match.
- Add other brands and their identifiers in settings. Real samples for those brands are still needed to validate their layouts; synthetic wrong-brand behavior already passes.
- Scanned PDFs have no OCR; unknown/unreadable pages are flagged for operator review.
- Hosted/concurrent performance and a near-50 MiB real-world browser file have not been benchmarked. Optional WebMCP search registration has no supported-session verification yet.
- Provider-managed backup retention/region has not been independently verified. Application expiry and deletion behavior are implemented and tested.
- The first scheduled nightly run still needs observation. Phase 2 Salla API sync/missing-order detection is intentionally deferred.
