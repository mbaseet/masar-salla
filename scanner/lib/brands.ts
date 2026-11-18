import { query, ScannerError, type ScannerEnv } from './runtime';

export type ScannerBrand = {id:string; name:string; merchantId?:string; shipmentSource?:'api'|'webhook'};

const demoBrands = [
  {id:'wassan',name:'وسن'},
  {id:'demo-other',name:'متجر تجريبي'},
];

export function scannerBrands(env: ScannerEnv, demo = false): ScannerBrand[] {
  if (demo) return demoBrands;
  if (env.SCANNER_BRANDS === undefined) {
    return [{id:env.SCANNER_BRAND_ID,name:env.SCANNER_BRAND_NAME,merchantId:env.SALLA_MERCHANT_ID}];
  }
  try {
    const value: unknown = typeof env.SCANNER_BRANDS==='string' ? JSON.parse(env.SCANNER_BRANDS) : env.SCANNER_BRANDS;
    if (!Array.isArray(value) || !value.length) throw new Error('Missing brands');
    const brands: ScannerBrand[] = value.map(brand=>{
      if (!brand || typeof brand.id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(brand.id) ||
          typeof brand.name!=='string' || !brand.name.trim() || brand.name.length>100 ||
          typeof brand.merchantId!=='string' || !/^[1-9]\d{0,39}$/.test(brand.merchantId) ||
          (brand.shipmentSource!==undefined && brand.shipmentSource!=='api' && brand.shipmentSource!=='webhook')) {
        throw new Error('Malformed brand');
      }
      return {id:brand.id,name:brand.name.trim(),merchantId:brand.merchantId,shipmentSource:brand.shipmentSource};
    });
    if (new Set(brands.map(brand=>brand.id)).size!==brands.length ||
        new Set(brands.map(brand=>brand.merchantId)).size!==brands.length) throw new Error('Duplicate brands');
    return brands;
  } catch {
    throw new ScannerError(503,'scanner_brands_unconfigured','راجع إعداد العلامات مع المسؤول.');
  }
}

export function lookupBrand(brands: ScannerBrand[], requested: unknown) {
  if (requested===undefined && brands.length===1) return brands[0];
  if (typeof requested!=='string') throw new ScannerError(400,'brand_required','اختر العلامة أولًا.');
  const brand = brands.find(item=>item.id===requested);
  if (!brand) throw new ScannerError(403,'brand_not_allowed','هذه العلامة غير متاحة لهذا الدخول.');
  return brand;
}

export async function scannerBrandStatus(env: ScannerEnv, brands: ScannerBrand[], demo: boolean) {
  const ids = JSON.stringify(brands.map(brand=>brand.id));
  const matches = demo ? [] : (await query(env,`SELECT brand_id,merchant_id FROM salla_connections
    WHERE brand_id IN (SELECT value FROM json_each(?)) AND credentials<>''`,ids)
    .all<{brand_id:string;merchant_id:string}>()).results;
  const connected = new Map(matches.map(match=>[match.brand_id,match.merchant_id]));
  return brands.map(brand=>({
    id:brand.id,name:brand.name,connected:demo || (!!brand.merchantId && connected.get(brand.id)===brand.merchantId),
  }));
}
