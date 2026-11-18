'use client';

import { ArrowDown, ArrowUp, Plus, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Picker } from './controls';
import { type OrderCategories } from '@/lib/order-categories';

type ProductGroup = OrderCategories['products'][number];
type Rule = OrderCategories['rules'][number];

export default function OrderCategorySettings({value,onChange}:{
  value:OrderCategories;
  onChange:(next:OrderCategories)=>void;
}) {
  const products = value.products;
  const updateProduct = (id:string, patch:Partial<ProductGroup>) =>
    onChange({...value,products:products.map(product=>product.id===id ? {...product,...patch} : product)});
  const updateRule = (id:string, patch:Partial<Rule>) =>
    onChange({...value,rules:value.rules.map(rule=>rule.id===id ? {...rule,...patch} : rule)});
  function moveRule(index:number, offset:number) {
    const rules = [...value.rules];
    [rules[index],rules[index+offset]] = [rules[index+offset],rules[index]];
    onChange({...value,rules});
  }
  function toggleProduct(rule:Rule, productId:string, checked:boolean) {
    const selected = checked ? [...rule.products,productId] : rule.products.filter(id=>id!==productId);
    updateRule(rule.id,{products:selected,quantity:selected.length===1 ? rule.quantity : 'any'});
  }
  return <section className="order-category-settings" aria-labelledby="order-category-heading">
    <div className="field-heading">
      <span className="field-icon"><Tag size={20}/></span>
      <div><h3 id="order-category-heading">تصنيفات الطلبات</h3><p>خصص أسماء الكميات وأضف قواعد حسب المنتجات.</p></div>
    </div>
    <div className="form-row">
      {(['single','multiple'] as const).map(bucket=><label key={bucket}>
        {bucket==='single'?'اسم تصنيف القطعة الواحدة':'اسم تصنيف قطعتين أو أكثر'}
        <Input required maxLength={60} value={value.labels[bucket]}
          onChange={event=>onChange({...value,labels:{...value.labels,[bucket]:event.target.value}})}/>
      </label>)}
    </div>

    <h4>مجموعات المنتجات</h4>
    <p className="microcopy">أدخل معرفات منتجات سلة أو رموز SKU مفصولة بفاصلة. يمكن إضافة حتى ثلاث مجموعات.</p>
    {products.map((product,index)=><div key={product.id} className="category-product">
      <div className="form-row">
        <label>اسم المجموعة <Input required value={product.name} maxLength={60} onChange={event=>updateProduct(product.id,{name:event.target.value})}/></label>
        <label>معرّفات مجموعة {index+1}
          <Input key={product.id} dir="ltr" maxLength={1200} defaultValue={product.keys.join(', ')}
            onChange={event=>updateProduct(product.id,{keys:event.target.value.split(/[,،]/).map(key=>key.trim()).filter(Boolean)})}/>
        </label>
      </div>
      <Button type="button" variant="ghost" size="sm" aria-label={`حذف مجموعة ${product.name}`}
        disabled={value.rules.some(rule=>rule.products.includes(product.id))}
        onClick={()=>onChange({...value,products:products.filter(group=>group.id!==product.id)})}><X size={15}/> حذف</Button>
    </div>)}
    <Button type="button" variant="outline" size="sm" disabled={products.length===3}
      onClick={()=>onChange({...value,products:[...products,{id:crypto.randomUUID(),name:'',keys:[]}]})}><Plus size={15}/> إضافة مجموعة منتجات</Button>

    <h4>قواعد التصنيف</h4>
    <p className="microcopy">تطابق القاعدة جميع مجموعات الطلب بالضبط. عند تطابق أكثر من قاعدة، تُستخدم القاعدة الأولى.</p>
    {value.rules.map((rule,index)=><fieldset className="category-rule" key={rule.id}>
      <legend>القاعدة {index+1}</legend>
      <label>اسم التصنيف <Input required maxLength={60} value={rule.name} onChange={event=>updateRule(rule.id,{name:event.target.value})}/></label>
      <div className="category-group-options">
        {products.map(product=><label key={product.id}>
          <input type="checkbox" checked={rule.products.includes(product.id)} onChange={event=>toggleProduct(rule,product.id,event.target.checked)}/>
          {product.name || 'مجموعة جديدة'}
        </label>)}
      </div>
      {!rule.products.length && <small className="microcopy">اختر مجموعة واحدة على الأقل.</small>}
      {rule.products.length===1 && <Picker label="الكمية" value={rule.quantity}
        options={[{value:'any',label:'أي كمية'},{value:'one',label:'قطعة واحدة'},{value:'multiple',label:'قطعتان أو أكثر'}]}
        onChange={quantity=>updateRule(rule.id,{quantity:quantity as Rule['quantity']})}/>}
      <div className="category-rule-actions">
        <Button type="button" variant="ghost" size="sm" disabled={index===0} onClick={()=>moveRule(index,-1)}><ArrowUp size={15}/> تقديم</Button>
        <Button type="button" variant="ghost" size="sm" disabled={index===value.rules.length-1} onClick={()=>moveRule(index,1)}><ArrowDown size={15}/> تأخير</Button>
        <Button type="button" variant="ghost" size="sm" onClick={()=>onChange({...value,rules:value.rules.filter(item=>item.id!==rule.id)})}><X size={15}/> حذف</Button>
      </div>
    </fieldset>)}
    <Button type="button" variant="outline" size="sm" disabled={!products.length || value.rules.length===15}
      onClick={()=>onChange({...value,rules:[...value.rules,{id:crypto.randomUUID(),name:'',products:[products[0].id],quantity:'any'}]})}>
      <Plus size={15}/> إضافة تصنيف
    </Button>
  </section>;
}
