const get = id => document.getElementById(id);
const views = ['loading','login-view','mode-view','scan-view','order-view'];
const video = get('video');
const trackingInput = get('tracking');
const referenceInput = get('reference');
const startButton = get('start-camera');
const brandPicker = get('brand-picker');
const lastBrandKey = 'masar.scanner.brand';
const rotatedFrame = document.createElement('canvas');
// Numeric hint keys exported by the ZXing core bundled with this release.
const POSSIBLE_FORMATS = 2;
const TRY_HARDER = 3;
let scannerState = null;
let activeBrand = null;
let pendingLookup = null;
let cameraEpoch = 0;
let cameraSource = false;
let browserDecoder;
let mode = null;
let returnedOrder = null;
const demoReceipts = new Set();

function show(view) {
  for (const id of views) get(id).hidden = id !== view;
}
function error(message = '') {
  get('error').textContent = message;
  get('error').hidden = !message;
}
async function api(path, data, signal) {
  const options = data === undefined ? {} : {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(data),
    signal,
  };
  const response = await fetch('/api/'+path,options);
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message),{status:response.status,code:result.code});
  return result;
}
function showReference() {
  get('ref-field').hidden = false;
  get('show-reference').hidden = true;
}
function scannerReady() {
  error();
  get('brand').textContent = activeBrand.name;
  get('brand').hidden = scannerState.brands.length>1;
  brandPicker.hidden = scannerState.brands.length===1;
  brandPicker.value = activeBrand.id;
  get('signed-in').hidden = false;
  get('change-mode').hidden = !scannerState.demo || !mode;
  if (scannerState.demo && !mode) {
    show('mode-view');
    return;
  }
  get('scan-title').textContent = mode==='return' ? 'مسح بوليصة مرتجع' : 'مسح بوليصة';
  const notice = get('connection');
  notice.textContent = scannerState.demo
    ? (mode==='return' ? 'عرض تجريبي. جرّب رقم المرتجع RT0000001234.' : 'عرض تجريبي. جرّب رقم التتبع AY0000001234.')
    : 'ربط سلة في انتظار الإعداد. أعد تحميل الصفحة بعد تثبيت التطبيق.';
  notice.hidden = activeBrand.connected && !scannerState.demo;
  get('search').disabled = startButton.disabled = !activeBrand.connected;
  get('search').textContent = 'عرض الطلب';
  show('scan-view');
}
function cancelLookup() {
  pendingLookup?.abort();
  pendingLookup = null;
}
function clearScan() {
  cameraSource = false;
  returnedOrder = null;
  for (const id of ['start-return','confirm-return','return-recorded']) get(id).hidden = true;
  trackingInput.value = referenceInput.value = '';
  get('ref-field').hidden = true;
  get('show-reference').hidden = false;
  for (const id of ['order-ref','order-status','order-tracking','checked']) get(id).textContent = '';
  get('items').replaceChildren();
}
function chooseBrand(brand) {
  cancelLookup();
  stopCamera();
  clearScan();
  activeBrand = brand;
  try { localStorage.setItem(lastBrandKey,brand.id); } catch { /* Storage is optional. */ }
  scannerReady();
}
function signIn() {
  cancelLookup();
  stopCamera();
  clearScan();
  activeBrand = scannerState = mode = null;
  demoReceipts.clear();
  get('signed-in').hidden = true;
  show('login-view');
}
async function loadSession() {
  try {
    scannerState = await api('session');
    const {brands} = scannerState;
    brandPicker.replaceChildren(...brands.map(brand=>new Option(brand.name,brand.id)));
    let lastBrandId;
    try { lastBrandId = localStorage.getItem(lastBrandKey); } catch { /* Storage is optional. */ }
    chooseBrand(brands.find(brand=>brand.id===lastBrandId) ?? brands.find(brand=>brand.connected) ?? brands[0]);
  } catch (reason) {
    signIn();
    if (reason.status!==401) error(reason.message);
  }
}
function stopCamera() {
  cameraEpoch++;
  if (video.srcObject) {
    for (const track of video.srcObject.getTracks()) track.stop();
    video.srcObject = null;
  }
  get('camera').hidden = true;
  startButton.textContent = 'فتح الكاميرا';
  startButton.disabled = !activeBrand?.connected || !!pendingLookup;
}
function loadDecoder() {
  browserDecoder ??= new Promise((resolve,reject)=>{
    const script = document.createElement('script');
    script.src = '/zxing-browser-0.2.1.min.js';
    script.onload = () => {
      const library = globalThis.ZXingBrowser;
      if (!library) return reject(new Error('Decoder unavailable'));
      const formats = ['CODE_128','CODE_39','CODE_93','EAN_13','EAN_8','ITF','QR_CODE','DATA_MATRIX','PDF_417']
        .map(name=>library.BarcodeFormat[name]).filter(value=>typeof value==='number');
      resolve(new library.BrowserMultiFormatReader(new Map([[POSSIBLE_FORMATS,formats],[TRY_HARDER,true]])));
    };
    script.onerror = () => reject(new Error('Decoder unavailable'));
    document.head.append(script);
  }).catch(reason=>{ browserDecoder=undefined; throw reason; });
  return browserDecoder;
}
function scanValue(raw) {
  const normalized = raw.trim().replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)<1776?1632:1776)));
  return /^[A-Z0-9][A-Z0-9-]{3,79}$/i.test(normalized) ? normalized : null;
}
function decodeFrame(decoder, rotated) {
  if (!rotated) return decoder.decode(video);
  rotatedFrame.width = video.videoHeight;
  rotatedFrame.height = video.videoWidth;
  const context = rotatedFrame.getContext('2d');
  context.setTransform(0,1,-1,0,rotatedFrame.width,0);
  context.drawImage(video,0,0);
  return decoder.decodeFromCanvas(rotatedFrame);
}
async function watchFrames(epoch, decoder, rotated = false) {
  if (epoch!==cameraEpoch) return;
  if (video.readyState >= 2) {
    try {
      const result = decodeFrame(decoder,rotated);
      const value = scanValue(result.getText());
      if (value) {
        trackingInput.value = value;
        stopCamera();
        await lookup(true);
        return;
      }
      error('هذا الرمز لا يحتوي على رقم تتبع مباشر. جرّب الباركود الآخر أو أدخل الرقم المطبوع.');
    } catch {
      // An empty or partial camera frame is normal while lining up the barcode.
    }
  }
  window.setTimeout(()=>void watchFrames(epoch,decoder,!rotated),240);
}
async function startCamera() {
  if (startButton.disabled) return;
  error();
  if (!navigator.mediaDevices?.getUserMedia) {
    error('الكاميرا غير متاحة هنا. افتح الماسح عبر HTTPS أو أدخل رقم التتبع.');
    return;
  }
  const epoch = ++cameraEpoch;
  startButton.disabled = true;
  try {
    const decoder = await loadDecoder();
    if (epoch!==cameraEpoch) return;
    const stream = await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
    if (epoch!==cameraEpoch) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    video.srcObject = stream;
    get('camera').hidden = false;
    await video.play();
    if (epoch!==cameraEpoch) return;
    startButton.textContent = 'إيقاف الكاميرا';
    void watchFrames(epoch,decoder);
  } catch {
    if (epoch===cameraEpoch) {
      stopCamera();
      error('تعذّر فتح الكاميرا أو قارئ الباركود. أدخل رقم التتبع يدويًا.');
    }
  } finally {
    if (epoch===cameraEpoch) startButton.disabled = !activeBrand?.connected || !!pendingLookup;
  }
}
function renderOrder(order) {
  get('order-ref').textContent = order.ref;
  get('order-status').textContent = order.status;
  get('order-tracking').textContent = order.tracking;
  const list = get('items');
  list.replaceChildren();
  for (const item of order.items) {
    const element = document.createElement('li');
    const title = document.createElement('strong');
    const quantity = document.createElement('span');
    title.textContent = item.name;
    quantity.className = 'quantity';
    quantity.textContent = '× '+new Intl.NumberFormat('ar-SA').format(item.quantity);
    element.append(title,quantity);
    const options = item.options.map(option=>[option.name,option.value].filter(Boolean).join(' — '));
    if (item.sku) options.push(item.sku);
    for (const option of options) {
      const line = document.createElement('small');
      line.dir = 'auto';
      line.textContent = option;
      element.append(line);
    }
    list.append(element);
  }
  get('checked').textContent = 'آخر قراءة '+new Intl.DateTimeFormat('ar-SA',{timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(order.checkedAt));
  if (scannerState.demo && mode==='return') {
    returnedOrder = order.brandId + ':' + order.tracking;
    showReturnReceipt();
  }
  show('order-view');
  get('order-title').focus();
}
async function lookup(fromCamera) {
  if (!activeBrand?.connected || get('search').disabled) return;
  cameraSource = fromCamera;
  stopCamera();
  error();
  const search = get('search');
  const controller = new AbortController();
  const brandId = activeBrand.id;
  pendingLookup = controller;
  search.disabled = startButton.disabled = true;
  search.textContent = 'جارٍ جلب الطلب…';
  try {
    const order = await api('lookup',{brandId,tracking:trackingInput.value,reference:referenceInput.value,...(mode==='return'?{mode}:{})},controller.signal);
    if (pendingLookup!==controller) return;
    if (order.brandId!==brandId) throw new Error('تعذّر التحقق من العلامة. أعد البحث.');
    renderOrder(order);
  } catch (reason) {
    if (pendingLookup!==controller) return;
    if (reason.status===401) signIn();
    if (['tracking_not_indexed','ambiguous_tracking'].includes(reason.code)) showReference();
    error(reason.message);
  } finally {
    if (pendingLookup===controller) {
      pendingLookup = null;
      search.disabled = startButton.disabled = !activeBrand?.connected;
      search.textContent = 'عرض الطلب';
    }
  }
}

function chooseMode(nextMode) {
  if (!scannerState?.demo) return;
  cancelLookup();
  stopCamera();
  clearScan();
  mode = nextMode;
  scannerReady();
  if (mode) startButton.focus();
  else get('shipping-mode').focus();
}
function showReturnReceipt() {
  const recorded = demoReceipts.has(returnedOrder);
  get('start-return').hidden = recorded;
  get('confirm-return').hidden = true;
  get('return-recorded').hidden = !recorded;
  if (recorded) get('order-status').textContent = 'تم استلام المرتجع · تجريبي';
}
get('shipping-mode').addEventListener('click',()=>chooseMode('shipping'));
get('return-mode').addEventListener('click',()=>chooseMode('return'));
get('change-mode').addEventListener('click',()=>chooseMode(null));
get('start-return').addEventListener('click',()=>{
  get('start-return').hidden = true;
  get('confirm-return').hidden = false;
  get('save-return').focus();
});
get('cancel-return').addEventListener('click',()=>{
  showReturnReceipt();
  get('start-return').focus();
});
get('save-return').addEventListener('click',()=>{
  if (!scannerState?.demo || !returnedOrder) return;
  demoReceipts.add(returnedOrder);
  showReturnReceipt();
  get('next').focus();
});

get('login-form').addEventListener('submit', async event=>{
  event.preventDefault();
  const form = event.currentTarget;
  const code = get('access-code');
  const button = form.querySelector('button');
  button.disabled = true;
  error();
  try {
    await api('login',{code:code.value});
    code.value = '';
    await loadSession();
  } catch (reason) {
    error(reason.message);
  } finally {
    button.disabled = false;
  }
});
get('logout').addEventListener('click', async event=>{
  const button = event.currentTarget;
  button.disabled = brandPicker.disabled = true;
  cancelLookup();
  stopCamera();
  clearScan();
  show('loading');
  try {
    await api('logout',{});
    error();
    signIn();
  } catch (reason) {
    scannerReady();
    error(reason.message);
  } finally {
    button.disabled = brandPicker.disabled = false;
  }
});
brandPicker.addEventListener('change',()=>{
  const brand = scannerState?.brands.find(brand=>brand.id===brandPicker.value);
  if (brand && brand!==activeBrand) chooseBrand(brand);
});
get('lookup-form').addEventListener('submit',event=>{event.preventDefault(); void lookup(false);});
startButton.addEventListener('click',()=>{
  if (video.srcObject) stopCamera();
  else void startCamera();
});
get('show-reference').addEventListener('click',()=>{showReference(); referenceInput.focus();});
get('next').addEventListener('click',()=>{
  const reopenCamera = cameraSource;
  clearScan();
  scannerReady();
  if (reopenCamera) void startCamera();
  else trackingInput.focus();
});
window.addEventListener('pagehide',stopCamera);
document.addEventListener('visibilitychange',()=>{ if(document.hidden) stopCamera(); });
void loadSession();
