/**
 * 期效管家 - 現代微圓角幾何扁平彩色向量圖標庫 (Modern Soft Flat Vector Icons) v1.9.8
 * 設計準則：
 * 1. 【單一核心主體】：絕對不放置多餘或旁邊附屬的干擾圖示，主體居中、飽滿大方，一眼即可直覺辨識。
 * 2. 【2D 正面幾何扁平拼色】：乾淨俐落的微圓角幾何、明亮且具有對比感的現代色彩計畫。
 * 3. 【純粹向量與通用透明度】：所有輪廓與打孔皆為原生 SVG 路徑，無偽造背景遮罩，於亮色、深色、AMOLED 或半透明標籤均能完美呈現。
 * 4. 【標準規格】：viewBox="0 0 48 48"，約 10% 內距，在 16px 至 64px 縮放皆清晰精緻。
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exp = factory();
    root.CATEGORY_ICONS = exp.CATEGORY_ICONS;
    root.getCategoryIcon = exp.getCategoryIcon;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const CATEGORY_ICONS = {
    // 1. 食品 (food)：單一純鮮乳盒（屋頂摺角、天藍乳品色帶、純白水滴標章）
    food: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 鮮奶盒頂部壓條封口 (Carton Top Crimp) -->
      <path d="M18 9H30L28 5H20L18 9Z" fill="#94A3B8"/>
      <rect x="19" y="5" width="10" height="2" rx="0.5" fill="#CBD5E1"/>
      <!-- 鮮奶盒純白屋頂與盒身本體 (Carton Milk White Body) -->
      <path d="M11 17L18 9H30L37 17V41C37 42.7 35.7 44 34 44H14C12.3 44 11 42.7 11 41V17Z" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="0.8"/>
      <!-- 盒身右半微立體陰影 (Carton Right Shadow) -->
      <path d="M24 9H30L37 17V41C37 42.7 35.7 44 34 44H24V9Z" fill="#E2E8F0"/>
      <!-- 屋頂摺痕 (Gable Fold Crease) -->
      <path d="M18 9L24 17L30 9" stroke="#CBD5E1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- 鮮乳天藍色中段色帶 (Blue Milk Label) -->
      <path d="M11 22H37V36H11V22Z" fill="#38BDF8"/>
      <path d="M24 22H37V36H24V22Z" fill="#0284C7"/>
      <!-- 白色品牌標籤橫條 (White Label Band) -->
      <rect x="13" y="27" width="22" height="4.5" rx="1.2" fill="#FFFFFF" opacity="0.95"/>
      <!-- 盒身純白鮮奶水滴標章 (Milk Droplet Emblem) -->
      <circle cx="24" cy="17" r="3.2" fill="#0284C7"/>
      <circle cx="24" cy="17" r="1.8" fill="#FFFFFF"/>
      <!-- 左側高光線 (Highlight) -->
      <line x1="13.5" y1="18" x2="13.5" y2="41" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" opacity="0.65"/>
    </svg>`,

    // 2. 飲品 (drinks)：單一外帶冷熱飲杯（雙色杯身、防燙杯套、杯蓋）
    drinks: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 白色杯蓋 (Lid) -->
      <rect x="11" y="8" width="26" height="5" rx="2.5" fill="#F8FAFC"/>
      <path d="M15 8L17 5H31L33 8H15Z" fill="#E2E8F0"/>
      <!-- 飲品杯身 (Cup Body) -->
      <path d="M13 13H35L31.5 41C31.3 42.1 30.4 43 29.3 43H18.7C17.6 43 16.7 42.1 16.5 41L13 13Z" fill="#F97316"/>
      <!-- 暖色隔熱杯套 (Sleeve) -->
      <path d="M14.5 21H33.5L32.2 33H15.8L14.5 21Z" fill="#EA580C"/>
      <!-- 杯套咖啡圓形徽章 (Emblem) -->
      <circle cx="24" cy="27" r="3.5" fill="#FED7AA"/>
      <circle cx="24" cy="27" r="2" fill="#C2410C"/>
      <!-- 杯身高光 (Highlight) -->
      <path d="M15.5 15L17.5 39" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" opacity="0.35"/>
    </svg>`,

    // 3. 零食 (snack)：單一香濃巧克力餅乾（金黃烘焙圓餅、飽滿巧克力豆）
    snack: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 餅乾圓形主體 (Cookie Body) -->
      <circle cx="24" cy="24" r="18" fill="#D97706"/>
      <!-- 餅乾微暗外圈邊緣 (Baked Edge Rim) -->
      <circle cx="24" cy="24" r="18" stroke="#B45309" stroke-width="1.5"/>
      <!-- 香濃巧克力豆 (Chocolate Chips) -->
      <circle cx="16" cy="18" r="3" fill="#78350F"/>
      <circle cx="27" cy="16" r="2.8" fill="#78350F"/>
      <circle cx="21" cy="25" r="3.2" fill="#78350F"/>
      <circle cx="32" cy="24" r="2.8" fill="#78350F"/>
      <circle cx="17" cy="31" r="2.6" fill="#78350F"/>
      <circle cx="27" cy="33" r="3" fill="#78350F"/>
      <circle cx="33" cy="32" r="2.2" fill="#78350F"/>
      <!-- 餅乾頂部微高光 (Cookie Highlight) -->
      <path d="M12 18C15 11 27 10 33 13" stroke="#FDE68A" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
    </svg>`,

    // 4. 生鮮 (fresh)：單一新鮮海魚（流線魚身、清爽水藍肚、魚鰭紋理）
    fresh: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 鮮魚背部藍色主體 (Fish Back) -->
      <path d="M5 24C12 14 26 13 36 21L43 14V34L36 27C26 35 12 34 5 24Z" fill="#38BDF8"/>
      <!-- 鮮魚白色魚肚 (White Belly) -->
      <path d="M5 24C12 29 23 32 36 27L43 34V24C36 27 26 29 5 24Z" fill="#E0F2FE"/>
      <!-- 背鰭與腹鰭 (Fins) -->
      <path d="M22 15C25 10 30 11 31 15" fill="#0284C7"/>
      <path d="M20 33C23 37 28 36 29 33" fill="#0284C7"/>
      <!-- 靈動魚眼 (Eye) -->
      <circle cx="12" cy="21" r="2.5" fill="#FFFFFF"/>
      <circle cx="11.5" cy="21" r="1.3" fill="#0F172A"/>
      <!-- 魚鰓弧線 (Gill Line) -->
      <path d="M17 19C19 22 19 26 17 29" stroke="#0284C7" stroke-width="2" stroke-linecap="round"/>
      <path d="M25 21C26.5 23 26.5 25 25 27" stroke="#0284C7" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`,

    // 5. 藥品 (medicine)：單一紅白立體膠囊（45度斜角、亮白反光、十字標記）
    medicine: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-40 24 24)">
        <!-- 膠囊紅色上半部 (Red Cap) -->
        <path d="M16 11C16 6.6 19.6 3 24 3C28.4 3 32 6.6 32 11V24H16V11Z" fill="#F43F5E"/>
        <!-- 膠囊白色下半部 (White Body) -->
        <path d="M16 24H32V37C32 41.4 28.4 45 24 45C19.6 45 16 41.4 16 37V24Z" fill="#F8FAFC"/>
        <!-- 膠囊中央縫線 (Center Seam) -->
        <line x1="16" y1="24" x2="32" y2="24" stroke="#E2E8F0" stroke-width="2"/>
        <!-- 側身高光反射 (Glossy Reflection) -->
        <rect x="18.5" y="8" width="2.5" height="28" rx="1.25" fill="#FFFFFF" opacity="0.65"/>
        <!-- 醫藥十字標誌 (Medical Cross) -->
        <rect x="23" y="12" width="2" height="6" rx="0.5" fill="#FFFFFF" opacity="0.85"/>
        <rect x="21" y="14" width="6" height="2" rx="0.5" fill="#FFFFFF" opacity="0.85"/>
      </g>
    </svg>`,

    // 6. 保健 (supplement)：單一綜合維他命營養瓶（金屬旋蓋、碧綠瓶身、V字能量標章）
    supplement: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 金色金屬旋蓋 (Gold Cap) -->
      <rect x="16" y="5" width="16" height="6" rx="2" fill="#F59E0B"/>
      <rect x="18" y="11" width="12" height="2" fill="#D97706"/>
      <!-- 碧綠瓶身 (Teal Bottle) -->
      <rect x="12" y="13" width="24" height="29" rx="7" fill="#0D9488"/>
      <!-- 潔淨白色標籤 (Label) -->
      <rect x="14" y="19" width="20" height="17" rx="3" fill="#CCFBF1"/>
      <!-- 維他命 V 能量徽章 (Vitamin V Emblem) -->
      <path d="M19 23L24 32L29 23" stroke="#0D9488" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- 瓶身高光 (Highlight) -->
      <path d="M14 17V39" stroke="#5EEAD4" stroke-width="1.8" stroke-linecap="round" opacity="0.5"/>
    </svg>`,

    // 7. 美妝 (beauty)：單一經典口紅（深灰金屬管、金飾環、斜切紅潤膏體）
    beauty: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 口紅底管 (Tube Base) -->
      <rect x="16" y="23" width="16" height="20" rx="3" fill="#1E293B"/>
      <!-- 金色中段飾環 (Gold Middle Ring) -->
      <rect x="17.5" y="17" width="13" height="6" fill="#F59E0B"/>
      <!-- 經典斜切口紅膏體 (Red Bullet) -->
      <path d="M19 17H29V8C29 8 26 5 23 5C20 5 19 10 19 17Z" fill="#E11D48"/>
      <!-- 斜切面高光 (Bevel Highlight) -->
      <path d="M19.5 17L27.5 8" stroke="#FDA4AF" stroke-width="2" stroke-linecap="round"/>
      <!-- 底管垂直反光線 (Base Highlight) -->
      <rect x="18.5" y="25" width="2" height="16" rx="1" fill="#475569"/>
    </svg>`,

    // 8. 日用 (pao)：單一按壓式洗沐瓶（按壓泵頭、薰衣草紫瓶身、水滴標籤）
    pao: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 泵頭噴嘴 (Pump Head) -->
      <path d="M24 5H15C13.5 5 13 6.5 13 8C13 9.5 14.5 9.5 16 9.5H22V13H26V8C26 6.3 25.1 5 24 5Z" fill="#C4B5FD"/>
      <!-- 泵頸 (Neck) -->
      <rect x="22" y="12" width="4" height="4" fill="#A78BFA"/>
      <!-- 瓶身本體 (Bottle Body) -->
      <rect x="14" y="16" width="20" height="27" rx="7" fill="#8B5CF6"/>
      <!-- 淡紫標籤 (Label) -->
      <rect x="17" y="24" width="14" height="13" rx="3" fill="#DDD6FE"/>
      <!-- 水滴圖樣 (Droplet) -->
      <path d="M24 27C24 27 21 31 21 32.5C21 34.2 22.3 35.5 24 35.5C25.7 35.5 27 34.2 27 32.5C27 31 24 27 24 27Z" fill="#8B5CF6"/>
    </svg>`,

    // 9. 清潔 (cleaning)：單一多功能清潔噴霧瓶（噴槍握柄、天藍瓶身、刻度線）
    cleaning: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 噴頭組件 (Spray Head) -->
      <path d="M20 7H28V14H20V7Z" fill="#0891B2"/>
      <path d="M28 8H36L38 13H28V8Z" fill="#06B6D4"/>
      <path d="M29 13L32 19H28V13Z" fill="#22D3EE"/>
      <rect x="36" y="9.5" width="2.5" height="2.5" rx="0.5" fill="#E0F2FE"/>
      <!-- 噴霧瓶身 (Bottle Body) -->
      <path d="M19 18C19 15.5 21 14 23.5 14H25.5C28 14 30 15.5 30 18L31 41C31 42.1 30.1 43 29 43H20C18.9 43 18 42.1 18 41L19 18Z" fill="#06B6D4"/>
      <!-- 透明劑量視窗 (Level Window) -->
      <rect x="21" y="25" width="7" height="12" rx="2" fill="#E0F2FE"/>
      <path d="M22 30H27M22 34H26" stroke="#0891B2" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,

    // 10. 耗材 (filter)：單一空氣濾清/淨水圓筒濾心（折疊濾網紋理、頂座外環）
    filter: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 圓筒頂座 (Top Collar) -->
      <ellipse cx="24" cy="11" rx="14" ry="5" fill="#94A3B8"/>
      <ellipse cx="24" cy="11" rx="8" ry="3" fill="#475569"/>
      <!-- 濾網主體 (Filter Pleats Body) -->
      <path d="M10 11V34C10 37 16.3 39.5 24 39.5C31.7 39.5 38 37 38 34V11" fill="#64748B"/>
      <!-- HEPA 垂直折疊皺褶 (Pleats) -->
      <line x1="14" y1="14" x2="14" y2="36" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/>
      <line x1="19" y1="16" x2="19" y2="39" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/>
      <line x1="24" y1="16" x2="24" y2="39.5" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/>
      <line x1="29" y1="16" x2="29" y2="39" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/>
      <line x1="34" y1="14" x2="34" y2="36" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/>
      <!-- 底座支撐環 (Bottom Rim) -->
      <path d="M10 34C10 37 16.3 39.5 24 39.5C31.7 39.5 38 37 38 34" stroke="#94A3B8" stroke-width="2"/>
    </svg>`,

    // 11. 保固 (warranty)：單一安全防護盾牌（湛藍雙層盾、亮白安全核准勾號）
    warranty: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 盾牌外廓 (Shield Outer) -->
      <path d="M24 4L39 9V22C39 32.5 32.5 39.5 24 44C15.5 39.5 9 32.5 9 22V9L24 4Z" fill="#2563EB"/>
      <!-- 盾牌內層立體色塊 (Inner Shield) -->
      <path d="M24 7.5L36 11.5V22C36 30.5 30.8 36.5 24 40.5C17.2 36.5 12 30.5 12 22V11.5L24 7.5Z" fill="#3B82F6"/>
      <!-- 盾牌右側陰影層 (Depth Shadow) -->
      <path d="M24 7.5L36 11.5V22C36 30.5 30.8 36.5 24 40.5V7.5Z" fill="#1D4ED8" opacity="0.3"/>
      <!-- 白色核准勾號 (Checkmark) -->
      <path d="M17 22L22 27L31 17" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    // 12. 數位 (digital)：單一全螢幕智慧手機（窄邊框、前鏡頭孔、亮藍螢幕）
    digital: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 手機外框 (Phone Frame) -->
      <rect x="12" y="4" width="24" height="40" rx="6" fill="#1E293B" stroke="#334155" stroke-width="1.5"/>
      <!-- 亮藍螢幕 (Screen) -->
      <rect x="14" y="7" width="20" height="34" rx="3.5" fill="#38BDF8"/>
      <!-- 前鏡頭孔 (Camera Notch) -->
      <circle cx="24" cy="9.5" r="1.2" fill="#0F172A"/>
      <!-- 底部手勢條 (Home Indicator Bar) -->
      <rect x="20" y="38" width="8" height="1.5" rx="0.75" fill="#FFFFFF" opacity="0.85"/>
      <!-- 螢幕高光反射 (Screen Glare) -->
      <path d="M14 18L26 7H34L14 27V18Z" fill="#FFFFFF" opacity="0.25"/>
    </svg>`,

    // 13. 車輛 (vehicle)：單一現代房車側影（流線車體、車窗輪廓、前後車輪）
    vehicle: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 房車車體本體 (Car Body) -->
      <path d="M4 27L8 18C9.5 16 12 15 15 15H31C34 15 36.5 16.5 38.5 19L43 24H44C45.1 24 46 24.9 46 26V32C46 32.6 45.6 33 45 33H42C42 29.7 39.3 27 36 27C32.7 27 30 29.7 30 33H18C18 29.7 15.3 27 12 27C8.7 27 6 29.7 6 33H3C2.4 33 2 32.6 2 32V29C2 27.9 2.9 27 4 27Z" fill="#3B82F6"/>
      <!-- 前後車窗 (Windows) -->
      <path d="M15 17.5H22V24H10L15 17.5Z" fill="#93C5FD"/>
      <path d="M24 17.5H30C32 17.5 33.5 18.5 35 20.5L37.5 24H24V17.5Z" fill="#93C5FD"/>
      <!-- 車燈 (Lights) -->
      <rect x="43" y="26" width="3" height="3" rx="1" fill="#FBBF24"/>
      <rect x="2" y="27" width="2" height="3" rx="0.5" fill="#EF4444"/>
      <!-- 前後車輪與輪圈 (Wheels & Rims) -->
      <circle cx="12" cy="33" r="5.5" fill="#1E293B"/>
      <circle cx="12" cy="33" r="2.5" fill="#E2E8F0"/>
      <circle cx="36" cy="33" r="5.5" fill="#1E293B"/>
      <circle cx="36" cy="33" r="2.5" fill="#E2E8F0"/>
    </svg>`,

    // 14. 訂閱 (subscription)：單一日曆循環翻頁（撕曆、紫色循環更新箭頭）
    subscription: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 日曆底紙 (Calendar Base) -->
      <rect x="8" y="9" width="32" height="34" rx="6" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1.5"/>
      <!-- 紅色頂部橫條 (Red Header) -->
      <path d="M8 15C8 11.7 10.7 9 14 9H34C37.3 9 40 11.7 40 15V17H8V15Z" fill="#EF4444"/>
      <!-- 吊環孔 (Binder Rings) -->
      <rect x="14" y="6" width="4" height="6" rx="2" fill="#94A3B8"/>
      <rect x="30" y="6" width="4" height="6" rx="2" fill="#94A3B8"/>
      <!-- 循環箭頭標誌 (Recurring Cycle Arrows) -->
      <path d="M24 23C27.9 23 31 26.1 31 30C31 31.5 30.5 32.8 29.7 34L32 36.3H26V30.3L28.2 32.5C28.7 31.8 29 30.9 29 30C29 27.2 26.8 25 24 25C22.6 25 21.4 25.6 20.5 26.5L19.1 25.1C20.3 23.8 22.1 23 24 23Z" fill="#8B5CF6"/>
      <path d="M24 37C20.1 37 17 33.9 17 30C17 28.5 17.5 27.2 18.3 26L16 23.7H22V29.7L19.8 27.5C19.3 28.2 19 29.1 19 30C19 32.8 21.2 35 24 35C25.4 35 26.6 34.4 27.5 33.5L28.9 34.9C27.7 36.2 25.9 37 24 37Z" fill="#A78BFA"/>
    </svg>`,

    // 15. 辦公 (office)：單一經典皮革公事包（提把、銅釦翻蓋、飽滿皮革包身）
    office: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 皮革提把 (Briefcase Handle) -->
      <path d="M19 12V8C19 6.9 19.9 6 21 6H27C28.1 6 29 6.9 29 8V12" stroke="#92400E" stroke-width="3" stroke-linecap="round"/>
      <!-- 公事包本體 (Main Body) -->
      <rect x="6" y="12" width="36" height="28" rx="5" fill="#B45309"/>
      <!-- 前掀蓋 (Front Flap) -->
      <path d="M6 16C6 13.8 7.8 12 10 12H38C40.2 12 42 13.8 42 16V24L26 29.5C24.7 30 23.3 30 22 29.5L6 24V16Z" fill="#D97706"/>
      <!-- 金屬鎖扣 (Metal Clasp) -->
      <rect x="22" y="27" width="4" height="6" rx="1.5" fill="#F59E0B"/>
      <circle cx="24" cy="30" r="1" fill="#78350F"/>
      <!-- 車縫裝飾線 (Stitches) -->
      <line x1="8" y1="36" x2="40" y2="36" stroke="#92400E" stroke-width="1.2" stroke-dasharray="2 2"/>
    </svg>`,

    // 16. 文具 (stationery)：單一經典黃金削尖鉛筆（45度斜角、粉紅橡皮擦、石墨筆尖）
    stationery: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(45 24 24)">
        <!-- 粉紅橡皮擦 (Pink Eraser) -->
        <path d="M21 4H27V9H21V4Z" fill="#F43F5E"/>
        <!-- 銀色金屬環箍 (Metal Ferrule) -->
        <rect x="20.5" y="9" width="7" height="4" fill="#CBD5E1"/>
        <line x1="20.5" y1="11" x2="27.5" y2="11" stroke="#94A3B8" stroke-width="0.8"/>
        <!-- 黃色六角筆桿 (Yellow Pencil Body) -->
        <rect x="21" y="13" width="6" height="23" fill="#F59E0B"/>
        <!-- 筆桿深色陰影面 (Shadow Side) -->
        <rect x="24.5" y="13" width="2.5" height="23" fill="#D97706"/>
        <!-- 削尖原木錐體 (Sharpened Wood Tip) -->
        <polygon points="21,36 27,36 24,44" fill="#FDE68A"/>
        <!-- 石墨黑鉛筆芯 (Graphite Lead Point) -->
        <polygon points="22.8,41 25.2,41 24,44" fill="#1E293B"/>
      </g>
    </svg>`,

    // 17. 運動 (sports)：單一專業六角啞鈴（45度斜角、防滑刻紋金屬握桿、深鐵六角頭）
    sports: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(45 24 24)">
        <!-- 金屬握桿 (Handle) -->
        <rect x="21" y="8" width="6" height="32" rx="2" fill="#94A3B8"/>
        <!-- 防滑刻紋 (Knurling) -->
        <line x1="21" y1="18" x2="27" y2="18" stroke="#64748B" stroke-width="1"/>
        <line x1="21" y1="21" x2="27" y2="21" stroke="#64748B" stroke-width="1"/>
        <line x1="21" y1="24" x2="27" y2="24" stroke="#64748B" stroke-width="1"/>
        <line x1="21" y1="27" x2="27" y2="27" stroke="#64748B" stroke-width="1"/>
        <line x1="21" y1="30" x2="27" y2="30" stroke="#64748B" stroke-width="1"/>
        <!-- 上方六角鐵頭 (Top Hex Head) -->
        <path d="M24 2L33 6V14L24 18L15 14V6L24 2Z" fill="#334155"/>
        <path d="M24 4L31 7V13L24 16L17 13V7L24 4Z" fill="#475569"/>
        <!-- 下方六角鐵頭 (Bottom Hex Head) -->
        <path d="M24 30L33 34V42L24 46L15 42V34L24 30Z" fill="#334155"/>
        <path d="M24 32L31 35V41L24 44L17 41V35L24 32Z" fill="#475569"/>
      </g>
    </svg>`,

    // 18. 戶外 (outdoor)：單一經典露營帳篷（亮橘帳身、門簾開口、營帳頂旗）
    outdoor: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 帳篷主體錐頂 (Tent Body) -->
      <path d="M24 8L5 38H43L24 8Z" fill="#F97316"/>
      <!-- 帳篷右側立體陰影 (Right Facet) -->
      <path d="M24 8L43 38H31L24 8Z" fill="#EA580C"/>
      <!-- 門口陰影與開口門簾 (Tent Door Opening) -->
      <path d="M24 16L15 38H33L24 16Z" fill="#7C2D12"/>
      <!-- 門布細節 (Flaps) -->
      <path d="M24 16L18 38H21L24 22L27 38H30L24 16Z" fill="#FB923C"/>
      <!-- 頂端營旗 (Tent Flag) -->
      <path d="M24 4V8L19 6L24 4Z" fill="#FBBF24"/>
    </svg>`,

    // 19. 居家 (home)：單一溫馨小屋（紅瓦斜屋頂、小煙囪、暖黃窗戶、木門）
    home: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 煙囪 (Chimney) -->
      <rect x="31" y="9" width="4" height="9" rx="1" fill="#DC2626"/>
      <!-- 房屋磚牆主體 (House Walls) -->
      <rect x="10" y="21" width="28" height="21" rx="3" fill="#FEF3C7"/>
      <!-- 紅瓦三角屋頂 (Pitched Roof) -->
      <path d="M24 5L5 22H43L24 5Z" fill="#EF4444"/>
      <path d="M24 5L43 22H37L24 10.5V5Z" fill="#DC2626"/>
      <!-- 暖黃十字窗戶 (Warm Window) -->
      <rect x="14" y="25" width="8" height="8" rx="1.5" fill="#F59E0B"/>
      <line x1="18" y1="25" x2="18" y2="33" stroke="#FEF3C7" stroke-width="1.5"/>
      <line x1="14" y1="29" x2="22" y2="29" stroke="#FEF3C7" stroke-width="1.5"/>
      <!-- 溫暖木門 (Wooden Door) -->
      <path d="M26 42V29C26 27.5 27.5 26.5 29 26.5H33C34.5 26.5 35 27.5 35 29V42H26Z" fill="#B45309"/>
      <!-- 門把銅鈕 (Door Knob) -->
      <circle cx="28" cy="35" r="1" fill="#FBBF24"/>
    </svg>`,

    // 20. 穿搭 (fashion)：單一潮流短袖T恤（俐落領口、折疊袖口、純色大方）
    fashion: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- T恤全輪廓 (T-Shirt Body) -->
      <path d="M16 8L8 15L12 21L15 19V40C15 41.1 15.9 42 17 42H31C32.1 42 33 41.1 33 40V19L36 21L40 15L32 8C30.5 12 17.5 12 16 8Z" fill="#3B82F6"/>
      <!-- 圓領領口羅紋 (Ribbed Collar) -->
      <path d="M18 8C19 12 29 12 30 8" stroke="#1D4ED8" stroke-width="2.5" stroke-linecap="round"/>
      <!-- 袖子縫線 (Sleeve Seams) -->
      <line x1="15" y1="19" x2="11" y2="14" stroke="#2563EB" stroke-width="1.5"/>
      <line x1="33" y1="19" x2="37" y2="14" stroke="#1D4ED8" stroke-width="1.5"/>
      <!-- 下擺高光 (Bottom Hem Accent) -->
      <line x1="17" y1="39" x2="31" y2="39" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,

    // 21. 五金 (tools)：單一活動活動板手（開口鉗口、調節渦輪螺桿、純向量無遮罩）
    tools: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-45 24 24)">
        <!-- 板手手柄與懸掛孔（以路徑挖空，全透明相容） -->
        <path fill-rule="evenodd" clip-rule="evenodd" d="M21 14C21 12.3 22.3 11 24 11C25.7 11 27 12.3 27 14V37C27 39.8 24.8 42 22 42C19.2 42 17 39.8 17 37C17 34.2 19.2 32 22 32V14H21ZM22 39.5C23.4 39.5 24.5 38.4 24.5 37C24.5 35.6 23.4 34.5 22 34.5C20.6 34.5 19.5 35.6 19.5 37C19.5 38.4 20.6 39.5 22 39.5Z" fill="#94A3B8"/>
        <!-- 活動板手頭部（開放鉗口實體路徑） -->
        <path d="M16 14C16 7.5 20.5 4.5 23 4.5V11H25V4.5C27.5 4.5 32 7.5 32 14H16Z" fill="#64748B"/>
        <!-- 調節滾花滾輪 (Thumb Wheel) -->
        <rect x="21.5" y="13" width="5" height="5" rx="1" fill="#475569"/>
        <line x1="22" y1="15.5" x2="26" y2="15.5" stroke="#94A3B8" stroke-width="1"/>
      </g>
    </svg>`,

    // 22. 寵物 (pet)：單一萌系暖心肉球爪印（大肉墊、4枚圓潤趾瓣、溫暖高辨識）
    pet: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 掌心大肉墊 (Main Paw Pad) -->
      <path d="M24 20C17.5 20 12 25 14.5 33C16 38 20 41 24 41C28 41 32 38 33.5 33C36 25 30.5 20 24 20Z" fill="#F59E0B"/>
      <!-- 大肉墊立體光影 (Highlight) -->
      <path d="M18 29C17 26 21 22 24 22C27 22 31 26 30 29" stroke="#FDE68A" stroke-width="1.8" stroke-linecap="round" opacity="0.7"/>
      <!-- 4 枚圓潤趾瓣 (4 Toe Beans) -->
      <ellipse cx="12" cy="19" rx="4" ry="5.5" transform="rotate(-20 12 19)" fill="#FB923C"/>
      <ellipse cx="20" cy="11" rx="4.2" ry="6" transform="rotate(-6 20 11)" fill="#FB923C"/>
      <ellipse cx="28" cy="11" rx="4.2" ry="6" transform="rotate(6 28 11)" fill="#FB923C"/>
      <ellipse cx="36" cy="19" rx="4" ry="5.5" transform="rotate(20 36 19)" fill="#FB923C"/>
    </svg>`,

    // 23. 母嬰 (baby)：單一寬口嬰兒奶瓶（矽膠奶嘴、雙耳刻度、新鮮奶水）
    baby: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 矽膠奶嘴 (Silicone Teat) -->
      <path d="M20 10C20 6.5 22 4 24 4C26 4 28 6.5 28 10H20Z" fill="#FDE047"/>
      <!-- 防脹氣瓶環 (Collar Ring) -->
      <rect x="17" y="10" width="14" height="4" rx="1.5" fill="#2DD4BF"/>
      <!-- 寬口奶瓶瓶身 (Bottle Body) -->
      <rect x="15" y="14" width="18" height="28" rx="5" fill="#93C5FD" fill-opacity="0.35" stroke="#60A5FA" stroke-width="2"/>
      <!-- 瓶內新鮮奶液 (Milk Level) -->
      <rect x="17" y="24" width="14" height="16" rx="3" fill="#FFFFFF"/>
      <!-- 毫升刻度標記 (Measurement Ticks) -->
      <line x1="18" y1="19" x2="22" y2="19" stroke="#3B82F6" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="18" y1="25" x2="24" y2="25" stroke="#3B82F6" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="18" y1="31" x2="22" y2="31" stroke="#3B82F6" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="18" y1="37" x2="24" y2="37" stroke="#3B82F6" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`,

    // 24. 動畫 (animation)：單一經典導演場記板（黑白斜斑馬紋、打板展開視角）
    animation: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 場記板底板 (Slate Board) -->
      <rect x="8" y="18" width="32" height="24" rx="3" fill="#1E293B"/>
      <!-- 場次隔線 (Chalk Lines) -->
      <line x1="12" y1="25" x2="36" y2="25" stroke="#64748B" stroke-width="2"/>
      <line x1="12" y1="32" x2="36" y2="32" stroke="#64748B" stroke-width="2"/>
      <line x1="24" y1="25" x2="24" y2="39" stroke="#64748B" stroke-width="2"/>
      <!-- 頂部拍板棒（斜角開啟） (Clapstick) -->
      <g transform="rotate(-15 8 18)">
        <rect x="8" y="10" width="32" height="8" rx="2" fill="#0F172A"/>
        <!-- 黑白斜斑馬紋 (Diagonal Stripes) -->
        <polygon points="12,10 16,10 12,18 8,18" fill="#FFFFFF"/>
        <polygon points="20,10 24,10 20,18 16,18" fill="#FFFFFF"/>
        <polygon points="28,10 32,10 28,18 24,18" fill="#FFFFFF"/>
        <polygon points="36,10 40,10 36,18 32,18" fill="#FFFFFF"/>
      </g>
    </svg>`,

    // 25. 遊戲 (game)：單一人體工學無線遊戲手把（雙類比搖桿、十字鍵、彩色動作按鍵）
    game: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 手把機身流線曲線 (Controller Body) -->
      <path d="M12 14C17 14 19 16 24 16C29 16 31 14 36 14C43 14 47 19 45 28L43 38C42 41 38.5 42 36 40L30 34C28 33 26 33 24 33C22 33 20 33 18 34L12 40C9.5 42 6 41 5 38L3 28C1 19 5 14 12 14Z" fill="#6366F1"/>
      <!-- 十字方向鍵 (D-Pad) -->
      <rect x="11" y="21" width="8" height="2.8" rx="1" fill="#1E293B"/>
      <rect x="13.6" y="18.4" width="2.8" height="8" rx="1" fill="#1E293B"/>
      <!-- 左右雙類比搖桿 (Dual Thumbsticks) -->
      <circle cx="18" cy="29" r="3.5" fill="#4338CA"/>
      <circle cx="18" cy="29" r="2" fill="#312E81"/>
      <circle cx="30" cy="29" r="3.5" fill="#4338CA"/>
      <circle cx="30" cy="29" r="2" fill="#312E81"/>
      <!-- 彩色動作按鍵 ABXY (Action Buttons) -->
      <circle cx="34" cy="19" r="1.5" fill="#F43F5E"/>
      <circle cx="37.5" cy="22.5" r="1.5" fill="#10B981"/>
      <circle cx="30.5" cy="22.5" r="1.5" fill="#38BDF8"/>
      <circle cx="34" cy="26" r="1.5" fill="#FBBF24"/>
    </svg>`,

    // 26. 二次元 (otaku)：單一閃耀吧唧徽章（金屬外圈包邊、耀眼金色十字星光）
    otaku: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 徽章外金屬底環 (Can Badge Rim) -->
      <circle cx="24" cy="24" r="18" fill="#EC4899"/>
      <!-- 徽章粉嫩主盤面 (Badge Face) -->
      <circle cx="24" cy="24" r="15.5" fill="#F472B6"/>
      <!-- 中心大愛心 (Heart Emblem) -->
      <path d="M24 31L18.5 25.5C16.5 23.5 16.5 20.5 18.5 18.5C20.5 16.5 23.5 17 24 19C24.5 17 27.5 16.5 29.5 18.5C31.5 20.5 31.5 23.5 29.5 25.5L24 31Z" fill="#FFFFFF"/>
      <!-- 閃耀十字金星 (Sparkle Star) -->
      <path d="M34 11L35 14L38 15L35 16L34 19L33 16L30 15L33 14L34 11Z" fill="#FDE047"/>
      <path d="M13 32L13.8 34L16 34.8L13.8 35.5L13 37.5L12.2 35.5L10 34.8L12.2 34L13 32Z" fill="#FDE047"/>
      <!-- 弧面反光高光 (Gloss Arc) -->
      <path d="M15 13C20 9.5 28 9.5 33 13" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
    </svg>`,

    // 27. 票券 (ticket)：單一展演票根（兩側原生圓形凹切孔、撕角虛線、金黃票面）
    ticket: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-15 24 24)">
        <!-- 票券主體（原生打孔路徑，全透明相容） -->
        <path d="M10 15H38C40.2 15 42 16.8 42 19V21C39.5 21 38 22.5 38 24C38 25.5 39.5 27 42 27V29C42 31.2 40.2 33 38 33H10C7.8 33 6 31.2 6 29V27C8.5 27 10 25.5 10 24C10 22.5 8.5 21 6 21V19C6 16.8 7.8 15 10 15Z" fill="#F59E0B"/>
        <!-- 票券虛線撕條 (Perforated Tear Line) -->
        <line x1="31" y1="15" x2="31" y2="33" stroke="#FDE68A" stroke-width="1.8" stroke-dasharray="2.5 2.5"/>
        <!-- 白色五角星 (Star) -->
        <path d="M17 19L18.5 22.5L22 23L19.5 25.5L20 29L17 27.2L14 29L14.5 25.5L12 23L15.5 22.5L17 19Z" fill="#FFFFFF"/>
        <!-- 條碼線條 (Barcode) -->
        <line x1="35" y1="18" x2="35" y2="30" stroke="#78350F" stroke-width="1.8"/>
        <line x1="38" y1="18" x2="38" y2="30" stroke="#78350F" stroke-width="1.2"/>
      </g>
    </svg>`,

    // 28. 其他 (other)：單一牛皮紙包裹箱（十字封箱膠帶、快遞宅配標籤）
    other: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 紙箱正面本體 (Box Front) -->
      <rect x="8" y="12" width="32" height="28" rx="4" fill="#D97706"/>
      <!-- 紙箱頂部掀蓋摺邊 (Top Flaps) -->
      <path d="M8 16C8 13.8 9.8 12 12 12H36C38.2 12 40 13.8 40 16V20H8V16Z" fill="#B45309"/>
      <!-- 垂直封箱膠帶 (Vertical Tape) -->
      <rect x="21" y="12" width="6" height="28" fill="#FDE68A" opacity="0.9"/>
      <!-- 水平封箱膠帶 (Horizontal Tape) -->
      <rect x="8" y="16" width="32" height="4" fill="#FDE68A" opacity="0.9"/>
      <!-- 白色貨運快遞標籤 (Shipping Label) -->
      <rect x="28" y="26" width="9" height="10" rx="1.5" fill="#FFFFFF"/>
      <line x1="30" y1="29" x2="35" y2="29" stroke="#64748B" stroke-width="1.2"/>
      <line x1="30" y1="32" x2="34" y2="32" stroke="#64748B" stroke-width="1.2"/>
    </svg>`
  };

  // 分類與子分類、繁體中文別名、原生 Emoji 映射字典
  const ALIAS_MAP = {
    '鮮乳': 'food', '鮮奶': 'food', '牛乳': 'food', '牛奶': 'food', 'milk': 'food', '🥛': 'food', '食品': 'food',
    '飲料': 'drinks', '飲品': 'drinks', '咖啡': 'drinks', 'coffee': 'drinks', '🥤': 'drinks', '☕': 'drinks',
    '零食': 'snack', '點心': 'snack', '餅乾': 'snack', '🍪': 'snack',
    '生鮮': 'fresh', '魚': 'fresh', '海鮮': 'fresh', '肉品': 'fresh', '🐟': 'fresh', '🥩': 'fresh',
    '藥品': 'medicine', '成藥': 'medicine', '💊': 'medicine',
    '保健': 'supplement', '維他命': 'supplement', '🌿': 'supplement',
    '美妝': 'beauty', '化妝品': 'beauty', '口紅': 'beauty', '💄': 'beauty',
    '日用': 'pao', '沐浴': 'pao', '洗手乳': 'pao', '🧻': 'pao',
    '清潔': 'cleaning', '掃除': 'cleaning', '噴霧': 'cleaning', '🧼': 'cleaning',
    '耗材': 'filter', '濾網': 'filter', '濾心': 'filter', '🪥': 'filter',
    '保固': 'warranty', '保修': 'warranty', '🛡️': 'warranty', '🛡': 'warranty',
    '數位': 'digital', '3c': 'digital', '手機': 'digital', '📱': 'digital',
    '車輛': 'vehicle', '汽車': 'vehicle', '車': 'vehicle', '🚗': 'vehicle',
    '訂閱': 'subscription', '週期': 'subscription', '📅': 'subscription',
    '辦公': 'office', '商務': 'office', '💼': 'office',
    '文具': 'stationery', '鉛筆': 'stationery', '原子筆': 'stationery', '✏️': 'stationery', '✏': 'stationery',
    '運動': 'sports', '健身': 'sports', '啞鈴': 'sports', '🏃': 'sports',
    '戶外': 'outdoor', '露營': 'outdoor', '帳篷': 'outdoor', '⛺': 'outdoor',
    '居家': 'home', '家庭': 'home', '房屋': 'home', '🏠': 'home',
    '穿搭': 'fashion', '服飾': 'fashion', '衣服': 'fashion', '👕': 'fashion',
    '五金': 'tools', '工具': 'tools', '板手': 'tools', '🔧': 'tools',
    '寵物': 'pet', '毛孩': 'pet', '肉球': 'pet', '🐾': 'pet',
    '母嬰': 'baby', '嬰兒': 'baby', '奶瓶': 'baby', '🍼': 'baby',
    '動畫': 'animation', '動漫': 'animation', '影視': 'animation', '場記板': 'animation', '🎬': 'animation',
    '遊戲': 'game', '電玩': 'game', '手把': 'game', '🎮': 'game',
    '二次元': 'otaku', '谷子': 'otaku', '周邊': 'otaku', '吧唧': 'otaku', '✨': 'otaku',
    '票券': 'ticket', '展覽': 'ticket', '電影票': 'ticket', '門票': 'ticket', '🎟️': 'ticket', '🎟': 'ticket',
    '其他': 'other', '包裹': 'other', '紙箱': 'other', '雜物': 'other', '📦': 'other'
  };

  /**
   * 根據分類鍵或別名取得對應的 SVG 字串
   * @param {string} catKey 分類代碼 (如 'food', 'drinks' 等) 或中文標籤、子分類或 Emoji
   * @param {string} [className] 額外附加至 <svg> 的 CSS 類別名
   * @returns {string} 完整的 SVG HTML 字串
   */
  function getCategoryIcon(catKey, className = '') {
    const raw = (catKey || '').toString().trim().toLowerCase();
    const resolvedKey = CATEGORY_ICONS[raw] ? raw : (ALIAS_MAP[raw] || 'other');
    let svg = CATEGORY_ICONS[resolvedKey] || CATEGORY_ICONS.other;
    if (className) {
      svg = svg.replace('<svg ', `<svg class="${className}" `);
    }
    return svg;
  }

  return {
    CATEGORY_ICONS,
    getCategoryIcon
  };
});
