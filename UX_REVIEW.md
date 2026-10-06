# UX verification — October 6, 2026

Verified locally in Chrome at 1440×1000 and 390×844, using real private samples and synthetic PDFs. No customer files were published as test data.

| Scenario | Result |
| --- | --- |
| Select two real PDFs with cards already in the first column | Two separate ready cards; Add files remains available |
| Drop damaged, transiently failing and valid PDFs together | Queue continues; retry retains card IDs and does not duplicate completed files |
| One brand match on one page, or only in the filename | Whole-file verification succeeds |
| Resolve a quantity-4 exception in a mostly single-item file | Ref, page and quantity stay highlighted after printing, reopening and reload; attention sheet includes it |
| Add a note after printing, then acknowledge | Late-change alert appears and clears correctly |
| Cancel deletion, then confirm | Cancel preserves the original; confirmation removes card, download access and search occurrences |
| Mobile upload, review, return and Escape close | Controls remain reachable; no full-page horizontal overflow |

Six browser scenarios passed with zero uncaught browser errors. Screenshots were inspected locally. Seventeen parser tests and 31 API/storage integration checks passed, including permissions, duplicate cleanup, shared-note preservation, all five real sample PDFs and unchanged downloads.

UX changes: persistent first-column Add files, per-file progress and retry, explicit Back to board, visible Delete beside print/download with confirmation, Arabic close labels, RTL dialog alignment, and persistent amber quantity indicators separate from resolved warnings.

Limits: these are local desktop Chrome and emulated-mobile checks, not physical-device or hosted load tests. The tab must remain open during processing; batches run sequentially to keep memory bounded. Older files use saved brand evidence until explicitly rechecked.

Cloudflare migration follow-up: the same six browser scenarios passed with the new local email identity path. Production-runtime tests separately verify the real JWT gate, initial-admin restriction, operator membership/deactivation and native cron. The local preview exempts Vite development scripts from Worker-first asset routing; production still requires Access authentication.
