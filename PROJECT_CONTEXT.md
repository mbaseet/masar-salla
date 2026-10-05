Project context - Salla Orders

Last updated: 2026-10-05.

Current task: Build the standalone internal Arabic RTL waybill tool. The user explicitly approved the recommended simple defaults and requested admin-editable brand identifier words in settings. Keep this file updated for continuity.

Confirmed decisions:
- Standalone application, not Trello.
- Admin and Operator roles; every operator can access every brand.
- Brand data, notes, and duplicate checks remain scoped to the brand.
- Admins configure brands, identifier words/phrases/domains, users, and board columns.
- One card per original PDF. Whole-file download/print only.
- Awaiting print, Printed, Prepared, Shipped, Archive by default; explicit print confirmation.
- Automatic bucket detection, operator review/acknowledgement without extra admin approval.
- Order notes follow Ref within the same brand, including changed-after-print alerts.
- 30-day retention, optional 90-day minimal index disabled initially, seven-day configurable shipped auto-archive.
- 50 MB uploads; must handle the real 836-page sample. Full hosted processing target is under 10 seconds after upload.

Evidence from the completed sample review:
- Five Wassan PDFs in sample waybills/, 1,179 physical pages and 1,176 distinct orders.
- Domestic sample counts: 226 and 836 single-item pages; 26 and 85 multi-item pages. All extracted buckets matched, with no repeated Ref within or across the domestic files.
- Carrier totals: Aymakan 109 pages, RedBox 1,064 pages, DHL 6 pages.
- DHL: three label/courier-document pairs, not six shipments; brand and product quantity cannot be verified from this sample and need a recorded operator confirmation.
- Useful initial identifiers: Wasn Saudi, wasnbrand.com, وسن, اليقاظة. Admin manages these, rather than hard-coded brand logic.
- Aymakan Items is product count, Pieces is parcel count. RedBox Quantity is product count. DHL Piece is not product quantity.
- Dates are carrier-specific: RedBox Order date, Aymakan Date, DHL label date. Do not mislabel unknown order dates.
- Local PDFium review took about 3.54 seconds on 836 pages. This is not a production end-to-end benchmark.

Implementation status:
- Application development authorized on 2026-10-04.
- Sites building/hosting workflow and portable runtime references read.
- Application is implemented in app/: Arabic RTL boards, upload/PDF checks, global/batch search, notes, issue review, explicit print confirmation, attention sheet, audit, admin identifier/user/column settings, and retention/archiving rules.
- Private Site registered: appgprj_6ac228daf7c48191a7d214780d594c14. Not published yet. Reuse app/.openai/hosting.json; do not register another Site.
- Hosting-compatible architecture: React/Vinext, Cloudflare Worker, D1 SQLite and private R2 originals. This replaces the initial PostgreSQL proposal.
- Browser PDFium WASM extracts every page while upload runs; only minimal fields reach the API. Full extracted customer text is transient, not stored. The tab must stay open through processing; saved PDFs can be rechecked after interruption.
- Platform login with an application email allowlist; first owner-private login becomes admin. Team members need platform access as well as an app role.
- Initial D1 schema generated and applied to isolated local QA storage. Production build, typecheck, and all 12 focused parser tests pass; final publication build remains.
- The app's actual WASM parser passes all five real samples: domestic 226/836/26/85 pages with zero findings; DHL six pages/three shipments with exactly six expected brand/quantity findings. Local parsing: 836 pages in 4.44 seconds, not hosted end-to-end.
- Local integration suite passes 24 checks: five real uploads and byte-identical downloads, hash/cross-file/in-file duplicates, stable rechecks and resolutions, concurrent uploads, wrong-brand move, editable identifiers, search, late notes/versioned acknowledgments, roles, immediate expiry, index deletion, archiving, and stale upload/processing recovery.
- Fixed newline-only sender headings, R2's known-length stream requirement, duplicate mirror fingerprints, expired duplicate alerts, and interrupted-operation leases.
- Chrome QA passed RTL boards/settings/review, real 836-page PDF worker upload, mobile page width, and no uncaught errors. Upload-to-result total 13.8 seconds; after upload completion 7.22 seconds locally. This is not a hosted/concurrent performance guarantee.
- Maintenance service secret configured in Sites (never recorded here); deployment and nightly schedule not yet completed.
- Bundled Node cannot load native dependencies due to macOS library validation. Official Node v24.14.0 downloaded into /private/tmp/node-v24.14.0-darwin-x64 for builds/tests.
- Background retention/archiving will use an authenticated maintenance endpoint and a private Site schedule; scheduling is not complete yet.
- Node is not on shell PATH; available bundled binary found at /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node.

Next steps:
1. Run final typecheck/build and push the app-only source through the Sites workflow; publish privately.
2. Validate the authenticated maintenance service against the published Site, then schedule nightly expiry/archiving at 03:00 Africa/Cairo.
3. Record URL, deployment and schedule status; sync app/PROJECT_CONTEXT.md and clean private local QA artifacts before handoff.

Open validation limits:
- Other brands' sample PDFs have not been provided. Admin-configured matching and synthetic wrong-brand tests can be validated now; real layouts require their samples.
- Hosted load/performance still needs verification.
- OCR is not implemented; scanned/unknown pages are explicitly flagged. Browser extraction requires an open tab. No native server-side parser is deployed.
- The optional WebMCP search tool was added but no supported model-context session was available to verify it.
- Provider-managed backup retention/region has not been independently verified. Application expiry/access controls and original-object deletion are implemented/tested.
- No credentials or customer text belong in these context files.
