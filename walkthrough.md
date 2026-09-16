# MobileCLIP 手機測試模式 (?mobilecliptest=1) 實作與驗證報告

## 目標與概述

為了解決在 iPhone Safari 等行動裝置上無法連接 Mac Remote Web Inspector Console 執行 `window.testMobileClip(...)` 的限制，本版本新增 **「MobileCLIP 手機測試模式」**。

此模式具備**嚴格條件啟用**與**完全隔離**特性：
- 僅在網址明確帶有 `?mobilecliptest=1` 時生效。
- 正常正式網址絕不受任何影響，維持既有正式相機與 SmolVLM / 雙軌辨識流程。
- 測試結果只做彈窗顯示，絕不寫入正式表單、不修改分類、不新增物品。

---

## 核心修改與分流架構

### 1. 測試模式判斷函式 (`isMobileClipTestMode()`)
- 位於 [app.js](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/app.js) 與 [www/app.js](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/www/app.js)：
```javascript
function isMobileClipTestMode() {
  if (typeof window === 'undefined' || !window.location) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('mobilecliptest') === '1';
  } catch (e) {
    return false;
  }
}
```

### 2. 相機拍照完成後分流 (`processCapturedImage`)
- 位於 [index.html](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/index.html) 與 [www/index.html](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/www/index.html) 的 `processCapturedImage(source)`：
```javascript
const photoDataUrl = canvas.toDataURL('image/jpeg', 0.86);

// 【MobileCLIP 手機測試模式分流】
const isMobileClipTest = (typeof window !== 'undefined' && (
  (typeof window.isMobileClipTestMode === 'function' && window.isMobileClipTestMode()) ||
  new URLSearchParams(window.location.search).get('mobilecliptest') === '1'
));

if (isMobileClipTest) {
  console.log('[MOBILECLIP TEST] 拍照完成，進入 MobileCLIP 手機測試模式');
  await window.runMobileClipCameraTest(photoDataUrl);
  return; // 測試模式在此結束，絕不執行後續 analyzeSmartCameraWithVlm 或 analyzeSmartCameraDualTrack
}

// 正常網址：關閉相機取景，立即啟動辨識遮罩與 AI 雙軌載入動畫
closeCameraScanModal();
...
```

### 3. 模型下載與推論 Loading 提示 (`runMobileClipCameraTest`)
- 沿用 `#modelLoadingOverlay` 與 `#aiScanLoadingModal`：
  - **模型首次下載時**：顯示 `MobileCLIP 模型下載中...`，並依 `onProgress` 更新進度百分比與檔案名稱。
  - **推論時**：顯示 `MobileCLIP 分析中...`。
  - **完成或錯誤時**：自動關閉 Loading 與相機視窗。

### 4. 測試結果與錯誤顯示 (iPhone 友善彈窗)
- **成功結果**：以原生 `alert` 顯示前 5 名排序結果（格式完全對齊需求）：
```text
MobileCLIP 測試結果

1. a carton or bottle of fresh milk — 82.3%
2. a food snack package — 8.4%
3. an unknown household item — 3.1%
4. a bottle of shampoo — 2.1%
5. a tube of toothpaste — 1.5%
```
- **失敗或推論異常**：彈出錯誤視窗：
```text
MobileCLIP TEST ERROR
[error.message]
```
- **資料隔離**：純測試畫面，不將結果寫入正式物品表單，不新增物品，不修改分類。

### 5. 雙重安全防護 (SmolVLM 與 DualTrack 阻斷)
- 在 `initVisionModel`、`analyzeSmartCameraWithVlm`、`analyzeSmartCameraDualTrack` 入口處均加入 `if (isMobileClipTestMode()) return null;` 防護：
  - 測試網址開啟相機時，**不會**在背景預載 256MB 的 SmolVLM，避免行動裝置顯存與網路浪費。
  - 確保測試模式**只跑 MobileCLIP**。

---

## 測試驗證結果 (Verification Results)

自動化驗證腳本 [test_mobileclip_mode.js](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/scratch/test_mobileclip_mode.js) 執行結果：
1. `isMobileClipTestMode()` 網址判斷：
   - 正常網址（無參數）-> `false`
   - 其他參數（`?theme=dark`）-> `false`
   - 非 1 數值（`?mobilecliptest=0`）-> `false`
   - 測試網址（`?mobilecliptest=1`）-> `true`
   - 多參數組合（`?theme=dark&mobilecliptest=1`）-> `true`
2. 預載隔離測試：
   - `initVisionModel()` 在測試模式下回傳 `null`，確認不預載 SmolVLM。
3. 相機流程阻斷測試：
   - `analyzeSmartCameraWithVlm()` 回傳 `null`。
   - `analyzeSmartCameraDualTrack()` 回傳 `null`。
4. 結果字串與錯誤字串格式化驗證：
   - 百分比與 em-dash `—` 格式 100% 符合規範。
   - 錯誤訊息符合 `MobileCLIP TEST ERROR\n+ error.message` 格式。
5. 全專案相容性回歸：
   - `verify_syntax_all.js` 語法檢查 100% 通過。
   - `test_v1817_mobile_vlm.js` 回歸測試 100% 通過。
   - `test_flow_v1816.js` 及 `test_date_parser.js` 100% 通過。
   - `app.js` 與 `www/app.js`、`index.html` 與 `www/index.html` 100% 同步。
