# Mobile VLM Low Memory Mode 最佳化驗證報告 (v1.8.17)

## 目標與概述

本版本針對行動裝置（iPhone Safari、Android Chrome、Samsung Galaxy S25 FE 等手機環境）新增 **「Mobile VLM Low Memory Mode」**，在保留端側視覺語言大模型 `HuggingFaceTB/SmolVLM-256M-Instruct` 的前提下，進行極致的顯存與記憶體佔用最佳化，並具備完整平滑降級備援與 iOS Safari 序列推論防護機制。

---

## 核心修改內容 (Changes Made)

### 1. 跨平台裝置環境辨識 (`isMobileDevice()`)
- 新增 `isMobileDevice()` 函式，支援偵測：
  - **iPhone** (`/iphone/`)
  - **iPad** (`/ipad/` 以及 iPadOS 桌面模式 `MacIntel + maxTouchPoints > 1`)
  - **Android** (`/android/`，涵蓋 Samsung Galaxy S25 FE、Pixel 等)
  - **Mobile UA** (`/mobile|touch|webos|blackberry|iemobile|opera mini/` 及 `navigator.userAgentData.mobile`)
- 新增 `isIosSafari()` 函式，專責精準辨識 iOS / iPadOS WebKit 嚴格記憶體限制環境。

### 2. SmolVLM 模型載入最佳化與 3 順位 Fallback
- **桌面模式**：維持原設定，不指定 `dtype`。
- **手機模式**：
  優先嘗試載入指定之 dtype mapping：
  ```javascript
  AutoModelForVision2Seq.from_pretrained(
    'HuggingFaceTB/SmolVLM-256M-Instruct',
    {
      device: 'webgpu',
      dtype: {
        embed_tokens: 'fp32',
        vision_encoder: 'q4',
        decoder_model_merged: 'q4'
      },
      progress_callback
    }
  )
  ```
  若該環境不支援 mapping，捕捉錯誤並依序自動降級：
  - **第 1 順位**：`dtype: 'q4'`
  - **第 2 順位**：`dtype: 'q8'`
  - **第 3 順位**：不指定 `dtype` (預設)
- 每次 fallback 均輸出清晰之 `[VLM DEBUG]` 日誌，嚴禁靜默失敗。

### 3. VLM 圖片尺寸降低與 OCR 原圖保護
- **桌面端**：`maxDim = 768`
- **手機端**：`maxDim = 512`
- **獨立保護**：尺寸縮小僅限於 VLM 推論輸入；Tesseract OCR 繼續維持原始高解析度影像與 1200px 銳化裁切對焦，確保效期數字識別率不被犧牲。

### 4. 生成 Token 限制
- **桌面端**：`max_new_tokens: 160`
- **手機端**：`max_new_tokens: 64`
- `do_sample: false` 維持固定不變。

### 5. iOS Safari 序列推論特別保護
- 偵測到 iOS Safari / WebKit 核心時，不同時初始化 MobileNet、OCR、VLM 三套模型。
- 先只載入與執行 SmolVLM；待 SmolVLM 推論完成後，再按需啟動 OCR，避免峰值顯存與記憶體疊加溢出崩潰。
- VLM 模型下載期間禁止啟動其他大型模型。

### 6. Android / Samsung 平滑降級機制
- Android Chrome 具備 `navigator.gpu` 時，最優先嘗試 SmolVLM 256M q4 WebGPU。
- 若 GPU 顯存不足、著色器編譯失敗或推論超時，自動捕獲異常並平滑降級至 MobileNet + OCR 雙軌辨識，保證頁面絕不崩潰。

### 7. 完整 Debug 診斷輸出
- `[VLM DEBUG] device class: mobile / desktop`
- `[VLM DEBUG] mobile low memory mode: true / false`
- `[VLM DEBUG] requested dtype:`
- `[VLM DEBUG] actual dtype fallback:`
- `[VLM DEBUG] VLM image maxDim:`
- `[VLM DEBUG] max_new_tokens:`
- `[VLM DEBUG] mobile VLM load success`
- `[VLM DEBUG] mobile VLM load failed`

### 8. 版本號更新與建置同步
- 版本號同步更新為 **v1.8.17**：
  - [package.json](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/package.json)
  - [index.html](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/index.html)
  - [app.js](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/app.js)
  - [www/index.html](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/www/index.html)
  - [www/app.js](file:///c:/Users/gomeo/OneDrive/桌面/我的超級APP/新期效管家/--main/www/app.js)

---

## 測試與驗證結果 (Verification Results)

自動化測試套件已全數通過：
- `node scratch/test_v1817_mobile_vlm.js`：驗證版本號一致性、跨平台裝置判斷、圖片尺寸分流、Token 生成規格。
- `node scratch/test_mobile_vlm.js`：8 大情境全覆蓋（包含 3 階 fallback、iOS Safari 序列保護、Android WebGPU 降級、OCR 獨立原圖）。
- `node scratch/test_flow_v1816.js` & `node scratch/test_date_parser.js`：OCR 與 VLM 融合防幻覺決策邏輯 100% 通過。
