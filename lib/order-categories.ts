import { z } from 'zod';

const name = z.string().trim().min(1).max(60);
const key = z.string().regex(/^[a-z0-9_-]{1,48}$/);
const ruleKey = key.refine(value=>!['all','automatic','__proto__','constructor','prototype'].includes(value));
const identifier = z.string().trim().min(1).max(120);

export const orderCategoriesSchema = z.object({
  labels:z.object({single:name,multiple:name}),
  products:z.array(z.object({id:key,name,keys:z.array(identifier).max(24)})).max(3),
  rules:z.array(z.object({
    id:ruleKey,name,products:z.array(key).min(1).max(3),quantity:z.enum(['any','one','multiple']),
  })).max(15),
}).superRefine((config, context)=>{
  const groups = new Set(config.products.map(product=>product.id));
  const identifiers = config.products.flatMap(product=>product.keys.map(normalizeKey));
  const ruleIds = new Set(config.rules.map(rule=>rule.id));
  const validRules = config.rules.every(rule=>new Set(rule.products).size===rule.products.length &&
    rule.products.every(product=>groups.has(product)) && (rule.products.length===1 || rule.quantity==='any'));
  if (groups.size!==config.products.length || new Set(identifiers).size!==identifiers.length ||
      ruleIds.size!==config.rules.length || !validRules) {
    context.addIssue({code:'custom',message:'تحقق من مجموعات المنتجات وقواعد التصنيف.'});
  }
});

export type OrderCategories = z.infer<typeof orderCategoriesSchema>;
export type ProductEvidence = {productId:string|null;sku:string|null;quantity:number};
export type CategorySummary = {counts:Record<string,number>;manual:string|null;unclassified:number};

export const defaultCategories: OrderCategories = {
  labels:{single:'حبة واحدة',multiple:'حبتان أو أكثر'},
  products:[],
  rules:[],
};

function normalizeKey(value: string) { return value.trim().toUpperCase(); }

export function classifyOrder(config: OrderCategories, items: ProductEvidence[]) {
  if (!items.length) return null;
  const groups = new Map(config.products.flatMap(product=>product.keys.map(key=>[normalizeKey(key),product.id] as const)));
  const counts = new Map<string,number>();
  for (const item of items) {
    const product = item.productId && groups.get(normalizeKey(item.productId));
    const sku = item.sku && groups.get(normalizeKey(item.sku));
    if (product && sku && product!==sku) return null;
    const group = product || sku;
    if (!group || !Number.isSafeInteger(item.quantity) || item.quantity<1) return null;
    counts.set(group,(counts.get(group)??0)+item.quantity);
  }
  return config.rules.find(rule=>{
    if (rule.products.length!==counts.size || !rule.products.every(group=>counts.has(group))) return false;
    const quantity = counts.get(rule.products[0]) ?? 0;
    return rule.quantity==='any' || (rule.quantity==='one' ? quantity===1 : quantity>=2);
  })?.id ?? null;
}
