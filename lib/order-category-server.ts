import { db, HttpError, now, rows, sql, uid } from './server';
import { classifyOrder, type CategorySummary, type ProductEvidence } from './order-categories';
import type { Brand, FileCard, User } from './domain';

export async function addOrderCategories<T extends FileCard>(files: T[], brands: Brand[]): Promise<(T & {categories?:CategorySummary})[]> {
  const byBrand = new Map(brands.filter(brand=>brand.orderCategories?.rules.length).map(brand=>[brand.id,brand.orderCategories!]));
  const eligible = files.filter(file=>file.status==='ready' && byBrand.has(file.brand_id));
  if (!eligible.length) return files;
  const ids = JSON.stringify(eligible.map(file=>file.id));
  const [evidence, overrides] = await Promise.all([
    rows<{file_id:string;products:string|null;count:number}>(`SELECT o.file_id,p.products,count(*) AS count
      FROM (SELECT DISTINCT file_id,brand_id,ref FROM occurrences
        WHERE file_id IN (SELECT value FROM json_each(?)) AND page_role='label') o
      LEFT JOIN salla_order_products p ON p.brand_id=o.brand_id AND p.ref=o.ref AND p.expires_at>? GROUP BY o.file_id,p.products`,
      ids,Math.floor(Date.now()/1000)),
    rows<{file_id:string;brand_id:string;rule_id:string}>(`SELECT * FROM file_order_categories WHERE file_id IN (SELECT value FROM json_each(?))`,ids),
  ]);
  const summaries = new Map(eligible.map(file=>{
    const config = byBrand.get(file.brand_id)!;
    return [file.id,{config,brand:file.brand_id,summary:{counts:{},manual:null,unclassified:0} as CategorySummary}];
  }));
  for (const row of overrides) {
    const file = summaries.get(row.file_id);
    if (file?.brand===row.brand_id && file.config.rules.some(rule=>rule.id===row.rule_id)) file.summary.manual=row.rule_id;
  }
  for (const row of evidence) {
    const file = summaries.get(row.file_id)!;
    const category = row.products && classifyOrder(file.config,JSON.parse(row.products) as ProductEvidence[]);
    if (category) file.summary.counts[category] = (file.summary.counts[category]??0)+row.count;
    else file.summary.unclassified+=row.count;
  }
  return files.map(file=>{
    const summary = summaries.get(file.id)?.summary;
    return summary ? {...file,categories:summary} : file;
  });
}

export async function setFileCategory(file: FileCard, user: User, ruleId: string | null) {
  const timestamp = now();
  const active = "id=? AND brand_id=? AND status='ready' AND expires_at>?";
  const params = [file.id,file.brand_id,timestamp];
  const audit = sql(`INSERT INTO audit(id,brand_id,file_id,action,actor_id,actor_name,detail,created_at)
    SELECT ?,?,?,'order_category_changed',?,?,?,? WHERE changes()>0`,
    uid(),file.brand_id,file.id,user.id,user.name,JSON.stringify({ruleId}),timestamp);
  const change = ruleId ? sql(`INSERT INTO file_order_categories(file_id,brand_id,rule_id)
      SELECT id,brand_id,? FROM files WHERE ${active}
      AND EXISTS(SELECT 1 FROM brand_order_categories b,json_each(b.configuration,'$.rules') r
        WHERE b.brand_id=files.brand_id AND json_extract(r.value,'$.id')=?)
      ON CONFLICT(file_id) DO UPDATE SET brand_id=excluded.brand_id,rule_id=excluded.rule_id`,ruleId,...params,ruleId)
    : sql(`DELETE FROM file_order_categories WHERE file_id IN (SELECT id FROM files WHERE ${active})`,...params);
  const [result] = await db().batch([change,audit]);
  if (ruleId && !result.meta.changes) throw new HttpError(409,'التصنيف غير متاح لهذا الملف.');
}
