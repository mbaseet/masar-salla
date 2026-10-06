Implementation plan - Salla waybill tool

Implementation authorized October 4, 2026. See PROJECT_CONTEXT.md for current progress.
Revision requested October 5: upload multiple PDFs in one action, retain an add-file button in occupied first columns, allow confirmed file deletion by operators/admins, accept one brand identifier anywhere in the file or filename, and keep dominant-group quantity exceptions visibly highlighted after resolution. These rules supersede conflicting original brand/filename assumptions below. Test operator scenarios and desktop/mobile UX before publishing.
Sample evidence reviewed September 30, 2026.

The user chose a standalone internal tool and asked to simplify the workflow for a small team. Operators can access every brand. Brand records and duplicate checks remain separate even though the same people can access all brands.

The user accepted the following defaults on October 4, 2026 and requested admin-editable brand identifier words in settings:

- Two roles initially: Admin and Operator. Both can operate across all brands. Admins additionally manage users, brands, matching rules, and columns. Defer the optional Viewer role.
- One card per original uploaded PDF. Preserve the original bytes for download and printing.
- Detect quantities, bucket, carrier, and brand automatically wherever the document provides reliable evidence. Do not require routine bucket selection.
- Add Awaiting print before Printed, Prepared, Shipped, and Archive. Record printing separately from column names and later card moves.
- Downloading or opening a print dialog does not prove printing occurred. Use an explicit Mark printed action.
- Let operators resolve findings and acknowledge changes themselves. Do not require a separate admin approval for routine review.
- Present a clear review step for flagged files before printing. Offer a move when a different brand is confidently detected; recheck the destination brand afterward. Keep manual confirmations visibly distinct from automatic verification.
- For an unknown brand or quantity, allow an operator to confirm the brand and intended bucket with an audit entry. Keep unknown per-order quantities unknown; bucket confirmation does not supply missing item counts.
- General notes belong to a file. An order-specific note follows the same brand and Ref across retained files.
- Keep late-change alerts until acknowledged. A later new or edited note triggers a new alert even if the card has moved beyond Printed.
- A cancelled-order note does not remove that page from the original PDF. Operators must handle the printed label; an optional attention sheet helps with this.
- Retain files and their active duplicate-check records for 30 days from upload, regardless of column or archive status. Moving, acknowledging, or archiving does not restart retention.
- Leave the optional 90-day minimal order index disabled initially. If enabled later, distinguish historical lookup from active duplicate checking.
- Start automatic archiving at seven days after entering Shipped, configurable per brand. Keep cards with unresolved issues or unacknowledged changes visible until reviewed. Retention expiry still applies.
- Use the store's business timezone for daily grouping; Saudi Arabia time is the proposed initial default.

Sample review

All 1,179 pages were text-extracted locally. Two independent extraction engines agreed on the extracted Ref values and domestic quantities. Representative pages were rendered and visually inspected, including both DHL document types and a two-item Aymakan label. No OCR was required for the fields extracted in these samples.

| File | Pages | Distinct orders | Carrier mix | Quantity result |
| --- | ---: | ---: | --- | --- |
| وسن حبة واحدة - ٢٩ سبتمبر.pdf | 226 | 226 | 22 Aymakan, 204 RedBox | All 1 |
| وسن حبة واحدة ٢٨ سبتمبر .pdf | 836 | 836 | 73 Aymakan, 763 RedBox | All 1 |
| وسن حبتين او اكثر - ٢٩ سبتمبر.pdf | 26 | 26 | 2 Aymakan, 24 RedBox | 24 x 2, 1 x 3, 1 x 4 |
| وسن حبتين او اكثر ٢٨ سبتمبر.pdf | 85 | 85 | 12 Aymakan, 73 RedBox | 77 x 2, 5 x 3, 2 x 4, 1 x 6 |
| وسن دولي حبة واحدة ٢٧ سبتمبر.pdf | 6 | 3 | DHL | Product quantity not supplied |

- There are 1,176 distinct order numbers across the five files, with no Ref shared between files.
- Each domestic page contains one identifiable Ref and tracking number. Domestic quantities agree with the named buckets. No order repeats within a domestic file.
- All five file hashes differ.
- The largest sample is 27,328,427 bytes, approximately 27.3 MB, and 836 pages. Keep the 50 MB upload limit and test beyond 250 pages.
- Aymakan exposes Ref, an AY-prefixed tracking number, Items, Pieces, and Date. The samples demonstrate that Items is product quantity while Pieces can remain 1 for a multi-item order. Wasn Saudi identifies the sender.
- RedBox exposes Ref, Trk, Quantity, and an explicit Order date. Its sender name is masked, but wasnbrand.com identifies the brand. Recognized brand domains should therefore supplement brand/product names in verification rules.
- A single PDF can contain multiple carriers. Detect and parse the layout separately for every page.
- DHL contains three label/courier-document pairs: pages 1-2, 3-4, and 5-6. Each pair shares its Ref and tracking number. These supporting pages should be recognized as one shipment, with both page locations searchable, rather than treated as duplicate labels.
- This DHL sample has neither a clear Wassan/product name nor a product quantity suitable for automatic bucket verification. The sender details and generic Electronics description do not establish those facts. Piece 1/1 is a parcel count, not an item count. The revised file-level rule verifies Wassan from this sample’s filename; product quantity still requires a visibly recorded manual confirmation.
- An unknown page must still be reported. Recognizing a DHL supporting document must not silently exempt an unknown layout or a repeated actual shipping label from checks.
- Dates have different meanings: RedBox explicitly labels an order date; Aymakan says Date; DHL shows a generated-label date. Preserve date type and source rather than silently treating all carrier dates as order dates. Filenames can be hints but are not authoritative.

Performance evidence

The PDFium-based local review took approximately 1.00 seconds for 226 pages and 3.54 seconds for 836 pages, including file hashing, text extraction, and basic field checks. The pypdf comparison took approximately 18.47 and 57.34 seconds respectively for text extraction and review checks. These are initial measurements on this Mac, not a controlled production benchmark.

Use a fast native extraction engine as the initial candidate. The under-10-second requirement must still be verified from completed upload through queueing, extraction, database duplicate checks, and visible results on the chosen hosting, including concurrent uploads. Scanned or unsupported layouts require an explicit policy; the supplied domestic files do not establish OCR performance.

Implementation sequence

1. Finalize the extraction contract and sample fixtures. Support Aymakan, RedBox, and DHL page roles, preserve Ref as a string, distinguish product quantity from parcels, and store extraction uncertainty. Add fixtures for a true repeated label, legitimate DHL support pages, mixed quantities, and an unknown layout. Obtain another brand's samples for the wrong-brand test.
2. Establish the application foundation. Build login, the two roles, brands and columns, durable records, private original-file storage, and an audit log. Both roles can access all brands, while all records, searches, notes, and duplicate comparisons retain their brand identity. The implemented Sites-compatible stack uses D1 SQLite and private R2, replacing the preliminary PostgreSQL choice.
3. Build the upload-to-result path. Accept up to 50 MB; hash and process all pages; detect brand, bucket, missing fields, and duplicates; save the original; and display a card plus page-specific findings. Processing retries and simultaneous uploads must not create duplicate cards or miss collisions. Rechecking a moved file must use the destination brand.
4. Build the Arabic RTL operating screens. Deliver brand boards, file details, partial Ref search across all brands, batch lookup, typed file/order notes, issue resolution, print confirmation, late-change acknowledgements, and daily brand summaries. Display physical page count separately from shipment/waybill count when supporting documents are present.
5. Complete retention and scheduled work. Apply 30-day expiry to files and associated operational records; clean temporary files and derived attention sheets; implement configurable shipped-card archiving. Define backup expiry consistently with the selected retention policy before launch. File-linked notes and audit details must not become an accidental indefinite order index.
6. Validate and pilot Wassan. Run the original acceptance cases and the sample-driven additions below. Test the real 836-page file, then a representative file near the 50 MB limit. Validate access, retry behavior, simultaneous uploads, and expiry. Pilot one brand before adding the others.
7. Add the other brands using confirmed identifiers and sample layouts. Phase 2 remains Salla API sync for missing-order detection and automatic batch creation.

Data and behavior rules

- Store only fields needed for the workflow: brand, Ref, tracking number, quantity when known, typed source date when known, carrier, file/page locations, findings, notes, users, and audit timestamps. Do not persist full extracted customer text, names, or phone numbers as searchable fields. The original PDF still contains customer data and stays private until expiry.
- Use separate records for PDF pages and logical shipment occurrences. A legitimate supporting page shares a shipment occurrence; a repeated shipping label remains a duplicate candidate.
- Keep processing state, card column, print history, and unresolved issues separate.
- Preserve every occurrence of an order so duplicate reports and search can show all locations. A unique constraint that rejects repeated Ref values would destroy the evidence the tool needs.
- Duplicate resolution applies to a specific finding. It does not permanently whitelist that order number or suppress a future conflicting upload.
- Audit downloads through the application and distinguish a served download or print request from a confirmed physical print.
- One selected-brand identifier anywhere in the file or filename verifies the file. If only another brand matches, offer a whole-file move and recheck. If multiple other brands match, flag the file for review. Never split or alter originals.

Acceptance additions and clarifications

- The original September 29 acceptance samples contain 226 and 26 shipments, with no findings in the reviewed checks.
- The September 28 samples contain 836 and 85 shipments, with no findings in the reviewed checks.
- The DHL sample shows 6 pages and 3 shipments. Its label/support-document pairs produce no false duplicate alert, while its filename verifies Wassan and its three unknown product quantities require operator confirmation.
- An actual repeated shipping-label page must still trigger a duplicate finding, including for DHL.
- Order searches must return both pages of a DHL shipment and every applicable retained file.
- Identical Ref values in different brands must not trigger a cross-brand duplicate finding. All operators can nevertheless search both brands.
- Uploading another brand's file to Wassan must show the detected mismatch and allow an operator to move it, then rerun destination checks. This cannot yet be validated from Wassan-only samples.
- A new cancellation after printing must alert even when the card is already Prepared or Shipped. A second change after acknowledgement must alert again.
- Expired files must become inaccessible and stop participating in active duplicate checks even if a cleanup job is briefly delayed. The scheduled cleanup then removes the stored objects and associated records.

Remaining inputs

- Names, known sender/product/domain identifiers, and representative waybills for the other brands before configuring and validating their uploads.
- Expected daily file volume and simultaneous operators for the hosted performance test.
- Hosting budget and any hosting-region requirement before deployment. These do not prevent defining the application workflow.

Application development is authorized using these defaults. Admin settings must support adding and editing brand identifier words, phrases, and domains without code changes.
