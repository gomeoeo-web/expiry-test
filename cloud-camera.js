// 1.9.18 — public endpoint only; no API key or developer password in the app.
const ENDPOINT = 'https://expiry-ai.gomeoeo.workers.dev/api/recognize';
const CONSENT_KEY = 'expiry_cloud_photo_consent_v1';

let activeRecognitionController = null;
let isRecognizing = false;
// Session-only exact-image cache. Never stores photographs or uses fuzzy matches
// which might confuse identical packaging with a different expiry date.
const recognitionCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
let cacheGeneration = 0;
export function clearRecognitionCache() {
  recognitionCache.clear();
  cacheGeneration++;
}
async function imageFingerprint(blob) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function isCloudCameraBusy() {
  return isRecognizing || !!activeRecognitionController;
}

export function setCloudCameraBusy(busy) {
  if (typeof document === 'undefined') return;
  const shutterBtn = document.getElementById('btnCameraShutter');
  const albumBtn = document.getElementById('btnCameraAlbum');
  const confirmBtn = document.getElementById('btnApplyNlpConfirm');
  const consentAcceptBtn = document.querySelector('[data-accept]');

  const targets = [shutterBtn, albumBtn, confirmBtn, consentAcceptBtn].filter(Boolean);
  targets.forEach(btn => {
    btn.disabled = !!busy;
    btn.classList.toggle('disabled', !!busy);
    btn.classList.toggle('loading', !!busy);
    if (busy) {
      btn.setAttribute('aria-disabled', 'true');
    } else {
      btn.removeAttribute('aria-disabled');
    }
  });
}

export function cancelCurrentRecognition() {
  if (activeRecognitionController) {
    try {
      activeRecognitionController.abort();
    } catch (err) {
      console.log('取消辨識中斷：', err);
    }
    activeRecognitionController = null;
  }
  isRecognizing = false;
  setCloudCameraBusy(false);
  if (typeof document !== 'undefined') {
    const hud = document.getElementById('aiScanLoadingModal');
    if (hud) {
      hud.classList.remove('active');
      hud.style.display = 'none';
    }
    if (typeof window !== 'undefined' && typeof window.unlockBodyScroll === 'function') {
      window.unlockBodyScroll();
    }
  }
}

async function consent(signal) {
  try { if (localStorage.getItem(CONSENT_KEY) === 'yes') return true; } catch {}
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'cloud-consent-overlay';
    overlay.innerHTML = '<section class="cloud-consent-dialog" role="dialog" aria-modal="true" aria-labelledby="cloudConsentTitle"><h2 id="cloudConsentTitle">使用雲端照片辨識</h2><p>選擇的照片會傳送至 Cloudflare 與 Google Gemini，協助讀取商品和日期。本 App 後端不儲存照片；供應商依服務方案處理資料。</p><p>辨識可能出錯，儲存前請確認名稱與日期。你也可以選擇手動填寫。</p><button type="button" data-accept>同意並辨識</button><button type="button" data-cancel>改用手動填寫</button></section>';
    let finished = false;
    const onAbort = () => finish(false);
    const priorBodyOverflow = document.body.style.overflow;
    const onKeyDown = event => { if (event.key === 'Escape') finish(false); };
    const finish = value => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = priorBodyOverflow;
      overlay.remove();
      resolve(value);
    };
    const acceptBtn = overlay.querySelector('[data-accept]');
    const cancelBtn = overlay.querySelector('[data-cancel]');
    acceptBtn.onclick = () => {
      acceptBtn.disabled = true;
      acceptBtn.classList.add('loading');
      if (cancelBtn) cancelBtn.disabled = true;
      try { localStorage.setItem(CONSENT_KEY, 'yes'); } catch {}
      finish(true);
    };
    cancelBtn.onclick = () => finish(false);
    overlay.addEventListener('click', event => { if (event.target === overlay) finish(false); });
    document.body.style.overflow = 'hidden';
    document.body.append(overlay);
    document.addEventListener('keydown', onKeyDown);
    acceptBtn.focus({ preventScroll: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) finish(false);
  });
}

function dateOrNull(value, evidence) {
  if (!evidence || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export async function resizeCanvasToBlob(canvas, maxDimension = 1024, quality = 0.7) {
  let targetCanvas = canvas;
  if (typeof document !== 'undefined' && canvas && (canvas.width > maxDimension || canvas.height > maxDimension)) {
    const maxSide = Math.max(canvas.width, canvas.height);
    const scale = maxDimension / maxSide;
    const targetWidth = Math.round(canvas.width * scale);
    const targetHeight = Math.round(canvas.height * scale);
    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = targetWidth;
    resizedCanvas.height = targetHeight;
    const ctx = resizedCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
      targetCanvas = resizedCanvas;
    }
  }
  return new Promise(resolve => targetCanvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function recognizeCanvas(canvas, photoDataUrl) {
  if (isCloudCameraBusy()) throw new Error('正在辨識，請稍候。');
  activeRecognitionController = new AbortController();
  const controller = activeRecognitionController;
  const generation = cacheGeneration;
  isRecognizing = true;
  setCloudCameraBusy(true);
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    if (!await consent(controller.signal)) throw new Error('已選擇手動填寫，照片未上傳。');
    if (controller.signal.aborted) {
      const abortErr = new Error('辨識已取消');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    setCloudCameraBusy(true);
    // 768px keeps product labels readable while reducing vision input tokens.
    const blob = await resizeCanvasToBlob(canvas, 768, 0.7);
    if (controller.signal.aborted) {
      const abortErr = new Error('辨識已取消');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    if (!blob || blob.size > 2 * 1024 * 1024) throw new Error('照片太大，請靠近單一商品再拍一次。');
    const fingerprint = await imageFingerprint(blob);
    if (controller.signal.aborted) throw new DOMException('辨識已取消', 'AbortError');
    for (const [key, value] of recognitionCache) if (Date.now() - value.at >= CACHE_TTL) recognitionCache.delete(key);
    const cached = fingerprint && recognitionCache.get(fingerprint);
    let payload;
    if (cached) {
      payload = { success: true, result: structuredClone(cached.result) };
    } else {
      if (!navigator.onLine) throw new Error('目前沒有網路，請手動填寫或連線後重新拍照。');
      if (window.getSmartLensQuotaInfo?.().remaining <= 0) throw new Error('今日智慧鏡頭辨識額度已達上限，請明天再試或手動填寫。');
      window.consumeSmartLensQuota?.();
      const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal: controller.signal, credentials: 'omit' });
      try {
        payload = await response.json();
      } catch {
        if (controller.signal.aborted) throw new DOMException('辨識已取消', 'AbortError');
        throw new Error('辨識服務尚未就緒，請先手動填寫。');
      }
      if (!response.ok || !payload.success) throw new Error(payload.message || '辨識暫時無法完成，請手動填寫。');
    }
    if (controller.signal.aborted) throw new DOMException('辨識已取消', 'AbortError');
    const result = payload.result;
    if (!result || typeof result.recognized !== 'boolean' || typeof result.name !== 'string') throw new Error('辨識結果不完整，請手動確認。');
    if (!cached && fingerprint && generation === cacheGeneration && result.recognized && result.name.trim()) {
      // Keep only small validated results, never errors or unrecognized images.
      if (recognitionCache.size >= 8) recognitionCache.delete(recognitionCache.keys().next().value);
      recognitionCache.set(fingerprint, { at: Date.now(), result: structuredClone(result) });
    }
    const matched = window.matchCategoryAndSubCategory?.(result.name || '');
    const modelCategory = result.recognized && Object.hasOwn(window.DEFAULT_CATEGORIES || {}, result.category)
      ? result.category
      : 'other';
    // Prefer a concrete local name match over the model's broad visual guess.
    // For example, a name containing "光泉鮮乳" is a dairy product even when
    // the image model labels the package as fresh produce ("fresh").
    const category = matched?.category && matched.category !== 'other'
      ? matched.category
      : (modelCategory !== 'other' ? modelCategory : (matched?.category || 'other'));
    const expiryDate = dateOrNull(result.expiryDate, result.expiryEvidence);
    // Keep a useful product name even when the model cannot map it to a
    // category. The confirmation dialog will use `other` instead of dropping
    // the name and forcing the user to type it again.
    const name = typeof result.name === 'string' ? result.name.trim().slice(0, 100) : '';
    const subCategory = (matched && matched.category === category) ? (matched.subCategory || '') : '';
    const autoInferred = window.inferItemLifespanOrUsageDate?.(name, category, subCategory);
    return { success: true, source: cached ? 'cloud-cache' : 'cloud', name, category, subCategory, autoInferred,
      emoji: window.DEFAULT_CATEGORIES?.[category]?.emoji || matched?.emoji || '📦', expiryDate, hasEndDate: !!expiryDate, remindDaysBefore: 3, remindTime: '09:00', image: photoDataUrl,
      recognitionNotice: [(name ? (result.recognized ? '' : '已辨識名稱，分類暫選「其他」，請確認。') : '無法確認商品，請填入名稱。'), expiryDate ? '辨識日期：' + expiryDate + '，請對照包裝確認。' : (autoInferred?.hasEndDate ? `未讀到包裝到期日，已為您準備建議使用期限（約 ${autoInferred.durationDays} 天）。` : '此物品未讀到效期，可記錄使用日期或手動填寫。'), typeof result.uncertainty === 'string' ? result.uncertainty.slice(0, 200) : ''].filter(Boolean).join('\n'),
      notes: typeof result.expiryEvidence === 'string' && expiryDate ? '日期原文：' + result.expiryEvidence.slice(0, 300) : '' };
  } catch (error) {
    if (error.name === 'AbortError' || controller.signal.aborted) {
      console.log('辨識已主動中斷或取消：', error.message || 'AbortError');
      const abortErr = new Error('辨識已取消');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    if (error instanceof TypeError) throw new Error('無法連線至辨識服務，請確認網路或稍後重試。');
    throw error;
  } finally {
    clearTimeout(timer);
    if (activeRecognitionController === controller) {
      activeRecognitionController = null;
      isRecognizing = false;
      setCloudCameraBusy(false);
    }
  }
}

if (typeof window !== 'undefined') {
  window.recognizeCloudCamera = recognizeCanvas;
  window.resizeCanvasToBlob = resizeCanvasToBlob;
  window.isCloudCameraBusy = isCloudCameraBusy;
  window.setCloudCameraBusy = setCloudCameraBusy;
  window.cancelCurrentRecognition = cancelCurrentRecognition;
  window.revokeCloudPhotoConsent = () => {
    cancelCurrentRecognition();
    clearRecognitionCache();
    try { localStorage.removeItem(CONSENT_KEY); } catch {}
    alert('已撤回雲端照片同意。下次拍照辨識會重新詢問。');
  };
}
