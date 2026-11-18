import { Badge } from '@/components/ui/badge';
import { n } from '@/lib/client';
import type { Brand, FileCard } from '@/lib/domain';

export default function OrderCategoryBadges({brand,file}:{brand?:Brand;file:FileCard}) {
  const rules = brand?.orderCategories?.rules;
  const summary = file.categories;
  if (!rules?.length || !summary) return null;
  const manual = rules.find(rule=>rule.id===summary.manual);
  return <div className="order-category-badges">
    {manual && <Badge variant="outline">{manual.name} · يدوي</Badge>}
    {rules.filter(rule=>summary.counts[rule.id]>0).map(rule=><Badge variant="outline" key={rule.id}>{rule.name} · {n(summary.counts[rule.id])}</Badge>)}
    {summary.unclassified>0 && !manual && <Badge variant="outline">بانتظار التصنيف · {n(summary.unclassified)}</Badge>}
  </div>;
}
