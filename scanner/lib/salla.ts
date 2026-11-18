import { scannerBrands, type ScannerBrand } from './brands';
import { hex, parseJson, query, randomToken, readText, ScannerError, seconds, utf8, type ScannerEnv } from './runtime';

const API = 'https://api.salla.dev/admin/v2';
const TOKEN_URL = 'https://accounts.salla.sa/oauth2/token';
export const SYNC_INTERVAL_SECONDS = 15 * 60;
const PAGE_SIZE = 50;
const INDEX_PAGES = 12;
const SHIPMENT_EVENT_LIFETIME = 14 * 86400;
type Row = Record<string,unknown>;
type Tokens = { access: string; refresh: string; expiresAt: number };
type Connection = {
  brand_id: string; merchant_id: string; credentials: string; expires_at: number;
  event_at: string; refresh_claim: string | null; indexed_at: number | null; index_complete: number;
};
type Shipment = { shipmentId: string; orderId: string; tracking: string };
export type Product = { productId: string | null; sku: string | null; quantity: number };

const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const label = (v: unknown) => typeof v==='string' ? v.trim().slice(0,200) : '';
const id = (v: unknown) => {
  const value = typeof v==='number' && Number.isSafeInteger(v) ? String(v) : typeof v==='string' ? v : '';
  return /^[0-9]{1,40}$/.test(value) && !/^0+$/.test(value) ? value : null;
};

export function trackingCode(value: unknown) {
  if (typeof value!=='string') return null;
  const tracking = value.trim().replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)<1776?1632:1776))).toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{3,79}$/.test(tracking) && !/^0+$/.test(tracking) ? tracking : null;
}

async function requestJson(url: string, init: RequestInit = {}) {
  let response: Response;
  try {
    // Workers requires manual redirect handling. The status check below rejects 3xx responses.
    response = await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(8000)});
  } catch {
    throw new ScannerError(503,'salla_unavailable','تعذّر الاتصال بسلة. حاول مجددًا.');
  }
  if (!response.ok) {
    throw new ScannerError(response.status===401 || response.status===403 ? 502 : 503,'salla_unavailable',
      response.status===429 ? 'طلبات كثيرة على سلة. حاول بعد قليل.' : 'تعذّر جلب البيانات من سلة.');
  }
  try {
    const data: Row = await response.json();
    if (data.success === false) throw new Error('Salla request failed');
    return data;
  } catch {
    throw new ScannerError(502,'salla_response','لم تكتمل بيانات الطلب من سلة.');
  }
}

function api(token: string, path: string, params: Record<string,string> = {}) {
  return requestJson(API+path+'?'+new URLSearchParams(params),{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
}

async function tokenKey(env: ScannerEnv) {
  if (!env.SALLA_TOKEN_KEY || !/^[a-f0-9]{64}$/i.test(env.SALLA_TOKEN_KEY)) {
    throw new ScannerError(503,'salla_unconfigured','ربط سلة غير مهيأ.');
  }
  return crypto.subtle.importKey('raw',decodeHex(env.SALLA_TOKEN_KEY),'AES-GCM',false,['encrypt','decrypt']);
}
const decodeHex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], pair=>Number.parseInt(pair,16));
const tokenContext = (brand: string, merchant: string) => utf8.encode(JSON.stringify([brand,merchant]));

async function lockTokens(env: ScannerEnv, brand: string, merchant: string, tokens: Tokens) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {name:'AES-GCM',iv,additionalData:tokenContext(brand,merchant)},
    await tokenKey(env),utf8.encode(JSON.stringify(tokens)));
  return hex(iv)+':'+hex(encrypted);
}

async function unlockTokens(env: ScannerEnv, connection: Connection): Promise<Tokens> {
  const [iv,encrypted] = connection.credentials.split(':');
  const decrypted = await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:decodeHex(iv),additionalData:tokenContext(connection.brand_id,connection.merchant_id)},
    await tokenKey(env),decodeHex(encrypted));
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export async function sallaConnection(env: ScannerEnv, brand: ScannerBrand) {
  if (!brand.merchantId) return null;
  return query(env,'SELECT * FROM salla_connections WHERE brand_id=? AND merchant_id=? AND credentials<>?',
    brand.id,brand.merchantId,'').first<Connection>();
}

function extractTokens(input: Row): Tokens {
  const {access_token,refresh_token} = input;
  const expiresAt = Number(input.expires ?? (seconds()+Number(input.expires_in)));
  if (typeof access_token!=='string' || !access_token || access_token.length>4096 ||
      typeof refresh_token!=='string' || !refresh_token || refresh_token.length>4096 ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= seconds()) {
    throw new ScannerError(400,'invalid_tokens','بيانات ربط سلة غير مكتملة.');
  }
  return {access:access_token,refresh:refresh_token,expiresAt};
}

async function accessToken(env: ScannerEnv, connection: Connection) {
  const tokens = await unlockTokens(env,connection);
  const at = seconds();
  if (tokens.expiresAt>at+300) return tokens.access;
  if (!connection.refresh_claim && env.SALLA_CLIENT_ID && env.SALLA_CLIENT_SECRET) {
    const claim = randomToken();
    const held = await query(env,`UPDATE salla_connections SET refresh_claim=?
      WHERE brand_id=? AND credentials=? AND refresh_claim IS NULL RETURNING brand_id`,
      claim,connection.brand_id,connection.credentials).first();
    if (held) {
      try {
        const payload = await requestJson(TOKEN_URL,{
          method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
          body:new URLSearchParams({grant_type:'refresh_token',client_id:env.SALLA_CLIENT_ID,
            client_secret:env.SALLA_CLIENT_SECRET,refresh_token:tokens.refresh}),
        });
        const updated = extractTokens(payload);
        const saved = await query(env,`UPDATE salla_connections SET credentials=?,expires_at=?,refresh_claim=NULL
          WHERE brand_id=? AND refresh_claim=? RETURNING brand_id`,await lockTokens(env,connection.brand_id,connection.merchant_id,updated),
          updated.expiresAt,connection.brand_id,claim).first();
        if (saved) return updated.access;
        throw new ScannerError(503,'salla_reconnect','تغيّر ربط سلة. أعد المحاولة.');
      } catch (error) {
        // The refresh token is single-use. Keep the claim after an ambiguous failure.
        // A fresh authorization event replaces the token and clears the claim.
        if (tokens.expiresAt<=at) throw error;
      }
    }
  }
  if (tokens.expiresAt>at) return tokens.access;
  throw new ScannerError(503,'salla_reconnect','انتهى ربط سلة. اطلب من المسؤول إعادة ربط المتجر.');
}

export async function sallaWebhook(request: Request, env: ScannerEnv) {
  if (!env.SALLA_WEBHOOK_SECRET) {
    throw new ScannerError(503,'salla_unconfigured','ربط سلة غير مهيأ.');
  }
  const signature = request.headers.get('x-salla-signature') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(signature)) throw new ScannerError(401,'invalid_signature','التوقيع غير صالح.');
  const body = await readText(request,1024*1024);
  const key = await crypto.subtle.importKey('raw',utf8.encode(env.SALLA_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if (!await crypto.subtle.verify('HMAC',key,decodeHex(signature),utf8.encode(body))) {
    throw new ScannerError(401,'invalid_signature','التوقيع غير صالح.');
  }
  const event = parseJson(body);
  const merchant = id(event.merchant);
  const brand = merchant && scannerBrands(env).find(item=>item.merchantId===merchant);
  if (!brand || !merchant) throw new ScannerError(403,'wrong_store','المتجر غير معتمد.');
  const shipmentEvent = brand.shipmentSource==='webhook' &&
    (event.event==='shipment.created' || event.event==='shipment.updated' || event.event==='shipment.cancelled');
  if (!shipmentEvent && event.event!=='app.store.authorize' && event.event!=='app.uninstalled') return null;
  const eventAt = label(event.created_at);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(eventAt)) {
    throw new ScannerError(400,'invalid_event','تاريخ ربط سلة غير صالح.');
  }
  const data = row(event.data);
  if (shipmentEvent) {
    await recordShipmentEvent(env,brand,eventAt,event.event as string,data);
    return null;
  }
  if (event.event==='app.store.authorize') {
    const scopes = new Set(label(data.scope).split(/\s+/));
    const usesShipmentEvents = brand.shipmentSource==='webhook';
    // Salla turns on this scope when shipment event subscriptions are saved.
    const unexpectedWrite = [...scopes].some(scope=>scope.endsWith('.read_write') &&
      !(usesShipmentEvents && scope==='webhooks.read_write'));
    if (!scopes.has('orders.read') || (!usesShipmentEvents && !scopes.has('shipping.read')) || unexpectedWrite) {
      throw new ScannerError(400,'invalid_scope',brand.shipmentSource==='webhook'
        ? 'يجب تفعيل قراءة الطلبات فقط.' : 'يجب تفعيل قراءة الطلبات والشحنات فقط.');
    }
    const tokens = extractTokens(data);
    const changed = await query(env,`INSERT INTO salla_connections(brand_id,merchant_id,credentials,expires_at,event_at)
      VALUES (?,?,?,?,?) ON CONFLICT(brand_id) DO UPDATE SET merchant_id=excluded.merchant_id,
      credentials=excluded.credentials,expires_at=excluded.expires_at,event_at=excluded.event_at,refresh_claim=NULL
      WHERE excluded.event_at>salla_connections.event_at
      AND excluded.merchant_id=salla_connections.merchant_id RETURNING brand_id`,
      brand.id,merchant,await lockTokens(env,brand.id,merchant,tokens),tokens.expiresAt,eventAt).first();
    return changed ? brand : null;
  }
  await env.DB.batch([
    query(env,`INSERT INTO salla_connections(brand_id,merchant_id,credentials,expires_at,event_at)
      VALUES (?,?,'',0,?) ON CONFLICT(brand_id) DO UPDATE SET credentials='',expires_at=0,
      event_at=excluded.event_at,refresh_claim=NULL,indexed_at=NULL,index_complete=0
      WHERE excluded.event_at>=salla_connections.event_at AND excluded.merchant_id=salla_connections.merchant_id`,
      brand.id,merchant,eventAt),
    ...['salla_shipments','salla_shipment_events','salla_order_products'].map(table=>query(env,`DELETE FROM ${table} WHERE brand_id=?
      AND EXISTS(SELECT 1 FROM salla_connections WHERE brand_id=? AND merchant_id=? AND credentials='')`,
      brand.id,brand.id,merchant)),
  ]);
  return null;
}

async function recordShipmentEvent(env: ScannerEnv, brand: ScannerBrand, eventAt: string, event: string, data: Row) {
  if (data.type==='return') return;
  const shipmentId = id(data.id);
  const orderId = id(data.order_id);
  const cancelled = event==='shipment.cancelled' || ['cancelled','canceled','returned'].includes(String(data.status));
  const eventRank = cancelled ? 3 : event==='shipment.updated' ? 2 : 1;
  const timestamp = Date.parse(eventAt.replace(' ','T')+'Z')/1000;
  if (!shipmentId || (!cancelled && (!orderId || data.type!=='shipment')) || !Number.isFinite(timestamp)) {
    throw new ScannerError(400,'invalid_shipment','بيانات الشحنة غير مكتملة.');
  }
  const expiresAt = timestamp+SHIPMENT_EVENT_LIFETIME;
  if (expiresAt<=seconds()) return;
  const active = await sallaConnection(env,brand);
  if (!active) throw new ScannerError(409,'salla_unconnected','ربط متجر سلة غير جاهز. راجع المسؤول.');
  if (eventAt<active.event_at) return;
  await query(env,`INSERT INTO salla_shipment_events
    (brand_id,shipment_id,order_id,tracking,shipping_number,event_at,event_rank,expires_at)
    SELECT brand_id,?,?,?,?,?,?,? FROM salla_connections
    WHERE brand_id=? AND merchant_id=? AND event_at=? AND credentials<>''
    ON CONFLICT(brand_id,shipment_id) DO UPDATE SET order_id=excluded.order_id,
      tracking=excluded.tracking,shipping_number=excluded.shipping_number,event_at=excluded.event_at,
      event_rank=excluded.event_rank,expires_at=excluded.expires_at
    WHERE salla_shipment_events.event_rank<3 AND (excluded.event_at>salla_shipment_events.event_at
      OR (excluded.event_at=salla_shipment_events.event_at AND excluded.event_rank>salla_shipment_events.event_rank))`,
    shipmentId,cancelled?null:orderId,cancelled?null:trackingCode(data.tracking_number),
    cancelled?null:trackingCode(data.shipping_number) ?? trackingCode(data.shipment_number),eventAt,eventRank,expiresAt,
    brand.id,active.merchant_id,active.event_at).run();
}

function shipments(data: Row): Shipment[] {
  if (!Array.isArray(data.data)) throw new ScannerError(502,'salla_response','بيانات الشحنات غير متاحة.');
  return data.data.flatMap(value=>{
    const s = row(value);
    const shipmentId = id(s.id), orderId = id(s.order_id);
    if (!shipmentId || !orderId || s.type==='return' || ['cancelled','canceled','returned'].includes(String(s.status))) return [];
    const codes = new Set([trackingCode(s.tracking_number),trackingCode(s.shipping_number)]);
    return [...codes].flatMap(tracking=>tracking ? [{shipmentId,orderId,tracking}] : []);
  });
}

function hasNext(result: Row, page: number) {
  const p = row(result.pagination);
  const links = row(p.links);
  if ('next' in links) return typeof links.next==='string' && links.next.length>0;
  if (Number(p.totalPages)>0) return page<Number(p.totalPages);
  return Array.isArray(result.data) && result.data.length>=PAGE_SIZE;
}

function recentDate() {
  return new Date(Date.now()-14*86400000+3*3600000).toISOString().slice(0,10);
}

export async function syncRecentShipments(env: ScannerEnv, selected: ScannerBrand) {
  if (selected.shipmentSource==='webhook') return;
  const connection = await sallaConnection(env,selected);
  if (!connection) return;
  const started = seconds();
  const token = await accessToken(env,connection);
  const records: Shipment[] = [];
  let complete = false;
  for (let page=1; page<=INDEX_PAGES;page++) {
    const response = await api(token,'/shipments',{
      from_date:recentDate(),shipment_type:'shipment',page:String(page),per_page:String(PAGE_SIZE),
    });
    records.push(...shipments(response));
    if (!hasNext(response,page)) { complete = true; break; }
  }
  const brand = connection.brand_id;
  const updateGate = `EXISTS(SELECT 1 FROM salla_connections WHERE brand_id=? AND merchant_id=?
    AND credentials<>'' AND event_at=? AND (indexed_at IS NULL OR indexed_at<=?))`;
  const guard = [brand,connection.merchant_id,connection.event_at,started];
  // Publish a new snapshot in a single transaction, keeping a newer sync intact.
  await env.DB.batch([
    query(env,`DELETE FROM salla_shipments WHERE brand_id=? AND ${updateGate}`,brand,...guard),
    query(env,`INSERT OR IGNORE INTO salla_shipments(brand_id,shipment_id,order_id,tracking)
      SELECT ?,json_extract(j.value,'$.shipmentId'),json_extract(j.value,'$.orderId'),json_extract(j.value,'$.tracking')
      FROM json_each(?) j WHERE ${updateGate}`,brand,JSON.stringify(records),...guard),
    query(env,`UPDATE salla_connections SET indexed_at=?,index_complete=? WHERE brand_id=? AND ${updateGate}`,
      started,Number(complete),brand,...guard),
  ]);
}

export function orderItems(result: Row) {
  if (!Array.isArray(result.data) || !result.data.length || hasNext(result,1)) {
    throw new ScannerError(502,'salla_items_incomplete','لم تكتمل قائمة المنتجات من سلة.');
  }
  return result.data.map(value=>{
    const item = row(value);
    const name = label(item.name), quantity = Number(item.quantity);
    if (!name || !Number.isSafeInteger(quantity) || quantity<1) {
      throw new ScannerError(502,'salla_items_incomplete','لم تكتمل قائمة المنتجات من سلة.');
    }
    const options = Array.isArray(item.options) ? item.options.flatMap(option=>{
      const o = row(option);
      const selected = label(row(o.value).name) || label(o.value);
      return selected ? [{name:label(o.name),value:selected}] : [];
    }) : [];
    return {name,quantity,options,sku:label(item.sku)||null,productId:id(item.product_id)??id(row(item.product).id)};
  });
}

async function orderIdForRef(token: string, ref: string) {
  const result = await api(token,'/orders',{reference_id:ref});
  if (!Array.isArray(result.data)) throw new ScannerError(502,'salla_response','بيانات الطلب غير متاحة.');
  const matches = result.data.map(row).filter(o=>id(o.reference_id)===ref).map(o=>id(o.id));
  if (matches.length!==1 || !matches[0]) throw new ScannerError(404,'order_not_found','لم نجد طلبًا مطابقًا بهذا الرقم.');
  return matches[0];
}

async function matchesTracking(token: string, orderId: string, tracking: string) {
  for (let page=1;page<=4;page++) {
    const response = await api(token,'/shipments',{order_id:orderId,shipment_type:'shipment',page:String(page),per_page:String(PAGE_SIZE)});
    if (shipments(response).some(s=>s.orderId===orderId && s.tracking===tracking)) return true;
    if (!hasNext(response,page)) return false;
  }
  throw new ScannerError(503,'shipment_verification','تعذّر التحقق من البوليصة. راجع الطلب في سلة.');
}

export async function lookupOrder(env: ScannerEnv, brand: ScannerBrand, tracking: string, reference: string | null, brandCount: number) {
  const connection = await sallaConnection(env,brand);
  const maxIndexAge = Math.max(30*60,brandCount*SYNC_INTERVAL_SECONDS+5*60);
  if (!connection) throw new ScannerError(503,'salla_unconnected','ربط متجر سلة غير جاهز. راجع المسؤول.');
  const token = await accessToken(env,connection);
  let orderId: string;
  const webhook = brand.shipmentSource==='webhook';
  const eventMatch = `brand_id=? AND (tracking=? OR shipping_number=?) AND expires_at>?`;
  const matchBindings = [brand.id,tracking,tracking] as const;
  if (webhook) {
    const matches = await query(env,`SELECT DISTINCT order_id FROM salla_shipment_events
      WHERE ${eventMatch} AND order_id IS NOT NULL LIMIT 2`,...matchBindings,seconds()).all<{order_id:string}>();
    if (matches.results.length>1) throw new ScannerError(409,'ambiguous_tracking','رقم التتبع يطابق أكثر من طلب في سلة.');
    if (!matches.results.length) throw new ScannerError(404,'shipment_event_missing','لم يصل تحديث شحنة لهذه البوليصة من سلة.');
    orderId = matches.results[0].order_id;
    if (reference && await orderIdForRef(token,reference)!==orderId) {
      throw new ScannerError(409,'tracking_changed','رقم التتبع لا يطابق شحنة حالية لهذا الطلب.');
    }
  } else if (reference) orderId = await orderIdForRef(token,reference);
  else {
    const result = await query(env,`SELECT DISTINCT order_id FROM salla_shipments WHERE brand_id=? AND tracking=? LIMIT 2`,
      connection.brand_id,tracking).all<{order_id:string}>();
    if (result.results.length>1) throw new ScannerError(409,'ambiguous_tracking','رقم التتبع يطابق أكثر من طلب. أدخل رقم الطلب من البوليصة.');
    if (!result.results.length || !connection.indexed_at || connection.indexed_at<seconds()-maxIndexAge) {
      // Existing PDFs can suggest a reference. Salla must still confirm the shipment.
      const refs = await query(env,`SELECT DISTINCT o.ref FROM occurrences o JOIN files f ON o.file_id=f.id
        WHERE o.brand_id=? AND o.tracking=? AND o.page_role='label' AND f.status='ready' AND f.expires_at>? LIMIT 2`,
        connection.brand_id,tracking,new Date().toISOString()).all<{ref:string}>();
      if (refs.results.length!==1) {
        throw new ScannerError(404,'tracking_not_indexed','لم نجد البوليصة في الشحنات المفهرسة. أدخل رقم الطلب من البوليصة.');
      }
      orderId = await orderIdForRef(token,refs.results[0].ref);
    } else orderId = result.results[0].order_id;
  }
  const [matches, info, itemResult] = await Promise.all([
    webhook ? true : matchesTracking(token,orderId,tracking),
    api(token,'/orders/'+orderId,{format:'light'}),
    api(token,'/orders/items',{order_id:orderId,per_page:String(PAGE_SIZE)}),
  ]);
  if (!matches) throw new ScannerError(409,'tracking_changed','رقم التتبع لا يطابق شحنة حالية لهذا الطلب.');
  const order = row(info.data);
  const ref = id(order.reference_id);
  const status = label(row(order.status).name);
  if (id(order.id)!==orderId || !ref || !status || (reference && ref!==reference)) {
    throw new ScannerError(502,'salla_response','لم تكتمل بيانات الطلب من سلة.');
  }
  const items = orderItems(itemResult);
  const products: Product[] = items.map(({productId,sku,quantity})=>({productId,sku,quantity}));
  const eventGate = webhook ? `AND (SELECT CASE WHEN COUNT(DISTINCT order_id)=1 THEN MIN(order_id) END
    FROM salla_shipment_events WHERE ${eventMatch})=?` : '';
  const stored = await query(env,`INSERT INTO salla_order_products(brand_id,ref,products,expires_at)
    SELECT brand_id,?,?,? FROM salla_connections WHERE brand_id=? AND merchant_id=? AND event_at=? AND credentials<>''
    ${eventGate}
    ON CONFLICT(brand_id,ref) DO UPDATE SET products=excluded.products,expires_at=excluded.expires_at`,
    ref,JSON.stringify(products),seconds()+86400,connection.brand_id,connection.merchant_id,connection.event_at,
    ...(webhook ? [...matchBindings,seconds(),orderId] : [])).run();
  if (!stored.meta.changes) throw new ScannerError(503,'salla_reconnect','تغيّر ربط سلة. أعد المحاولة.');
  return {ref,status,tracking,items,checkedAt:new Date().toISOString()};
}
