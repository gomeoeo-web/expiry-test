// 1.9.2 — public endpoint only; no API key or developer password in the app.
const ENDPOINT = 'https://expiry-ai.gomeoeo.workers.dev/api/recognize';
const CONSENT_KEY = 'expiry_cloud_photo_consent_v1';

async function consent() {
  try { if (localStorage.getItem(CONSENT_KEY) === 'yes') return true; } catch {}
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'max-width:360px;width:calc(100% - 32px);border:0;border-radius:22px;padding:24px;background:#fff;color:#222;font:16px/1.6 system-ui;';
    dialog.innerHTML = '<h2 style="font-size:20px;margin-top:0">使用雲端照片辨識</h2><p>選擇的照片會傳送至 Cloudflare 與 Google Gemini，協助讀取商品和日期。本 App 後端不儲存照片；供應商依服務方案處理資料。</p><p>辨識可能出錯，儲存前請確認名稱與日期。你也可以選擇手動填寫。</p><button type="button" data-accept style="font:inherit;padding:12px;border:0;border-radius:12px;background:#205f40;color:white;width:100%">同意並辨識</button><button type="button" data-cancel style="font:inherit;padding:12px;margin-top:8px;border:1px solid #ccc;border-radius:12px;background:white;width:100%">改用手動填寫</button>';
    let finished = false;
    const finish = value => { if (finished) return; finished = true; dialog.close(); dialog.remove(); resolve(value); };
    dialog.querySelector('[data-accept]').onclick = () => { try { localStorage.setItem(CONSENT_KEY, 'yes'); } catch {} finish(true); };
    dialog.querySelector('[data-cancel]').onclick = () => finish(false);
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
    document.body.append(dialog); dialog.showModal();
  });
}
function dateOrNull(value, evidence) {
  if (!evidence || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
export async function recognizeCanvas(canvas, photoDataUrl) {
  if (!await consent()) throw new Error('已選擇手動填寫，照片未上傳。');
  if (!navigator.onLine) throw new Error('目前沒有網路，請手動填寫或連線後重新拍照。');
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob || blob.size > 2 * 1024 * 1024) throw new Error('照片太大，請靠近單一商品再拍一次。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal: controller.signal, credentials: 'omit' });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('辨識服務尚未就緒，請先手動填寫。'); }
    if (!response.ok || !payload.success) throw new Error(payload.message || '辨識暫時無法完成，請手動填寫。');
    const result = payload.result;
    if (!result || typeof result.recognized !== 'boolean' || typeof result.name !== 'string') throw new Error('辨識結果不完整，請手動確認。');
    const matched = window.matchCategoryAndSubCategory?.(result.name || '');
    const category = result.recognized && Object.hasOwn(window.DEFAULT_CATEGORIES || {}, result.category) ? result.category : (matched?.category || 'other');
    const expiryDate = dateOrNull(result.expiryDate, result.expiryEvidence);
    const name = result.recognized ? result.name.trim().slice(0, 100) : '';
    const subCategory = (matched && matched.category === category) ? (matched.subCategory || '') : '';
    const autoInferred = window.inferItemLifespanOrUsageDate?.(name, category, subCategory);
    return { success: true, source: 'cloud', name, category, subCategory, autoInferred,
      emoji: window.DEFAULT_CATEGORIES?.[category]?.emoji || matched?.emoji || '📦', expiryDate, hasEndDate: !!expiryDate, remindDaysBefore: 3, remindTime: '09:00', image: photoDataUrl,
      recognitionNotice: [result.recognized ? '' : '無法確認商品，請填入名稱。', expiryDate ? '辨識日期：' + expiryDate + '，請對照包裝確認。' : (autoInferred?.hasEndDate ? `未讀到包裝到期日，已為您準備建議使用期限（約 ${autoInferred.durationDays} 天）。` : '此物品未讀到效期，可記錄使用日期或手動填寫。'), typeof result.uncertainty === 'string' ? result.uncertainty.slice(0, 200) : ''].filter(Boolean).join('\n'),
      notes: typeof result.expiryEvidence === 'string' && expiryDate ? '日期原文：' + result.expiryEvidence.slice(0, 300) : '' };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('辨識等待逾時，請手動填寫或稍後重試。');
    if (error instanceof TypeError) throw new Error('無法連線至辨識服務，請確認網路或稍後重試。');
    throw error;
  } finally { clearTimeout(timer); }
}
window.recognizeCloudCamera = recognizeCanvas;
window.revokeCloudPhotoConsent = () => {
  try { localStorage.removeItem(CONSENT_KEY); } catch {}
  alert('已撤回雲端照片同意。下次拍照辨識會重新詢問。');
};
