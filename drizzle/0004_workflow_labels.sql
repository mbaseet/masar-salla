ALTER TABLE `files` ADD `label_text` text;--> statement-breakpoint
ALTER TABLE `files` ADD `label_color` text;--> statement-breakpoint
DELETE FROM findings
WHERE status='open' AND kind='quantity_unknown'
  AND EXISTS (
    SELECT 1 FROM pages p
    WHERE p.file_id=findings.file_id AND p.page=findings.page
      AND json_extract(p.data,'$.carrier')='DHL'
  );
--> statement-breakpoint
DELETE FROM findings
WHERE status='open' AND kind='duplicate_order' AND related_file_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM findings same
    WHERE same.id=findings.file_id || '|hash|' || findings.related_file_id
      AND same.kind='duplicate_file'
  );
