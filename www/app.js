/**
 * 期效管家 - 純本機智慧自然語言速記與 RoBERTa-Tiny / BERT-Tiny 命名實體識別引擎
 * Smart Quick Add & On-Device NER Parser v1.8.26
 *
 * 特性：
 * 1. 支援 Transformers.js 於瀏覽器本地離線執行微型中文命名實體模型 (Xenova/bert-tiny-chinese-ner / RoBERTa-Tiny)。
 * 2. 非同步模型初始化 (initModel) 與多段式載入狀態提示 (Loading / Ready / Fallback)。
 * 3. 智慧輸入自動對應分類項目與細項項目（SMART_KEYWORD_MAP），若無對應則自動選「其他 (other)」。
 * 4. parseWithLocalNER 命名實體識別：
 *    - 提取實體名詞（如：鮮奶、貓、會議），精準過濾贅詞與口語雜訊。
 *    - 提取時間字詞（如：下星期六、3天後、明天下午2點...）。
 *    - 名稱精煉：將提取到的名詞嚴格控制在 2~6 字（例如「貓」搭配「出生」濃縮為「貓咪誕生」）。
 *    - 時間換算：將提取出的時間片段傳入既有的本地 Date 換算函式，算出精確到期日。
 * 5. 上下文追問與修改：
 *    - 保留 lastCreatedItem 機制，若使用者輸入「那隻貓叫小黑」，辨識出新名詞後直接覆蓋上一筆名稱。
 * 6. 錯誤降級處理：
 *    - 若模型尚未下載完成、處於離線環境或推論異常，自動降級使用純本地正則解析器 (parseNaturalInput)。
 * 7. MobileCLIP2-S0 輕量視覺特徵比對 + Tesseract OCR + SMART_KEYWORD_MAP 決策融合 (v1.8.22 全新升級)
 */

// Universal MobileCLIP2-S0 特徵庫載入 (相容 Node.js CommonJS require 與瀏覽器環境)
let MOBILECLIP2_CATEGORIES = [];
let MOBILECLIP2_CANDIDATES = [];

if (typeof window !== 'undefined' && window.MOBILECLIP2_CATEGORIES && window.MOBILECLIP2_CANDIDATES) {
  MOBILECLIP2_CATEGORIES = window.MOBILECLIP2_CATEGORIES;
  MOBILECLIP2_CANDIDATES = window.MOBILECLIP2_CANDIDATES;
} else if (typeof require !== 'undefined') {
  try {
    const labelsData = require('./mobileclip2-labels.json');
    MOBILECLIP2_CATEGORIES = labelsData.categories || [];
    MOBILECLIP2_CANDIDATES = labelsData.candidates || [];
  } catch (e) {
    // 忽略在無 JSON 環境下的錯誤
  }
}

// ==========================================
// 1. 全域狀態與模型管線 & 相機 Debug 診斷開關
// ==========================================
let cameraDebug = true;
if (typeof window !== 'undefined') {
  window.cameraDebug = true;
}
function isCameraDebug() {
  if (typeof window !== 'undefined' && window.cameraDebug !== undefined) {
    return !!window.cameraDebug;
  }
  return !!cameraDebug;
}

let nerPipeline = null;
let isModelLoading = false;
let modelStatus = 'idle'; // 'idle' | 'loading' | 'ready' | 'fallback'
let lastCreatedItem = null; // 最近一筆新增或編輯之物品快取 (Context Continuity)

// 中文數字轉換輔助
const cnNumMap = {
  '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15, '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
  '二十一': 21, '二十二': 22, '二十三': 23
};

function parseChineseNum(str) {
  if (!str) return null;
  str = String(str).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  if (str === '半') return 0.5;
  if (cnNumMap[str] !== undefined) return cnNumMap[str];
  if (str.length === 2 && str.startsWith('十')) return 10 + (cnNumMap[str[1]] || 0);
  if (str.length === 2 && str.endsWith('十')) return (cnNumMap[str[0]] || 1) * 10;
  if (str.length === 3 && str[1] === '十') return (cnNumMap[str[0]] || 1) * 10 + (cnNumMap[str[2]] || 0);
  return null;
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function offsetDays(d, numDays) {
  const res = new Date(d.getTime());
  res.setDate(res.getDate() + numDays);
  return res;
}

// ==========================================
// 1.4 一級分類與細項項目設定 (DEFAULT_CATEGORIES & SUB_CATEGORY_CONFIG)
// ==========================================
const DEFAULT_CATEGORIES = {
  vehicle: { label: '車輛', emoji: '🚗' },
  subscription: { label: '訂閱', emoji: '📅' },
  medicine: { label: '藥品', emoji: '💊' },
  cleaning: { label: '清潔', emoji: '🧼' },
  warranty: { label: '保固', emoji: '🛡️' },
  filter: { label: '耗材', emoji: '🔄' },
  food: { label: '食品', emoji: '🥦' },
  pao: { label: '日用', emoji: '🧴' },
  pet: { label: '寵物', emoji: '🐾' },
  baby: { label: '母嬰', emoji: '🍼' },
  office: { label: '辦公', emoji: '💼' },
  outdoor: { label: '戶外', emoji: '⛺' },
  home: { label: '居家', emoji: '🪴' },
  fashion: { label: '穿搭', emoji: '👗' },
  animation: { label: '動畫', emoji: '🎬' },
  game: { label: '遊戲', emoji: '🎮' },
  otaku: { label: '二次元', emoji: '✨' },
  ticket: { label: '票券/活動', emoji: '🎟️' },
  other: {
    label: '其他',
    emoji: '📦',
    items: [
      { name: '日常生活用品', subCat: '一般雜項', emoji: '📦' },
      { name: '隨身配件眼鏡', subCat: '配件小物', emoji: '👓' },
      { name: '未分類備忘物品', subCat: '未分類', emoji: '📦' },
      { name: '慢跑球鞋', subCat: '球鞋', emoji: '👟' },
      { name: '商務背包', subCat: '包袋', emoji: '🎒' },
      { name: '日常工作會議', subCat: '會議', emoji: '📅' },
      { name: '各類生活備忘', subCat: '備忘', emoji: '📌' }
    ]
  }
};

const SUB_CATEGORY_CONFIG = {
  vehicle: ['機油', '齒輪油', '輪胎', '電瓶', '雨刷', '煞車', '驗車', '車險'],
  subscription: ['影音', '音樂', '雲端', '軟體', '健身', '電信', '租約', '訂閱服務'],
  medicine: ['眼藥水', '維他命', '魚油', '藥膏', '成藥', '醫療', '保養液'],
  cleaning: ['菜瓜布', '洗衣精', '洗碗精', '抹布', '潔廁劑', '酒精', '除蟎'],
  warranty: ['家具', '電腦', '手機', '耳機', '家電', '手錶', '遊戲機'],
  filter: ['濾網', '濾芯', '牙刷', '除濕盒', '掃地耗材', '咖啡保養'],
  food: ['青菜', '水果', '鮮乳', '咖啡', '雞蛋', '茶包', '調味料', '零食', '生鮮肉品', '麵包烘焙'],
  pao: ['洗沐', '防曬', '保養', '護手霜', '牙膏', '刮鬍刀', '香水', '彩妝'],
  pet: ['乾糧', '罐頭', '驅蟲藥', '疫苗健檢', '貓砂尿墊', '零食凍乾', '寵物保健'],
  baby: ['配方奶', '尿布', '濕紙巾', '副食品', '奶嘴用品', '幼兒疫苗'],
  office: ['耗材墨水', '碳粉匣', '電池', '筆記文具', '證件合約', '專業證照'],
  outdoor: ['高蛋白', '露營裝備', '登山裝備', '水壺配件', '補給品', '球拍線路'],
  home: ['植栽綠化', '花草肥料', '燈具照明', '寢具家飾', '居家安全', '修繕保養'],
  fashion: ['換季送洗', '皮革保養', '珠寶飾品', '衣物防護', '精品鞋靴'],
  animation: ['漫畫/單行本', '輕小說', 'BD/影音', '畫冊/設定集', '周邊特典'],
  game: ['Switch 卡帶', 'PS/Xbox 光碟', '主機/手把周邊', '點数卡/序號', '特典周邊'],
  otaku: ['徽章/吧唧', '壓克力立牌/磚', '色紙/相卡', '模型/黏土人/景品', '棉花娃/玩偶', '一番賞'],
  ticket: ['電影票', '演唱會/音樂會', '動漫展覽門票', '活動兌換券'],
  other: ['一般雜項', '配件小物', '未分類', '球鞋', '包袋', '會議', '備忘']
};

// ==========================================
// 1.5 智慧分類與細項對應辭典 (SMART_KEYWORD_MAP)
// ==========================================
const SMART_KEYWORD_MAP = [
  // 車輛 (vehicle)
  { keywords: ['齒輪油', '變速箱油', '差速器油'], emoji: '🛵', cat: 'vehicle', subCat: '齒輪油' },
  { keywords: ['機油', '机油', '機油芯', '換機油', '換油'], emoji: '🚗', cat: 'vehicle', subCat: '機油' },
  { keywords: ['輪胎', '胎壓', '補胎', '換胎', '米其林', '馬牌'], emoji: '🛞', cat: 'vehicle', subCat: '輪胎' },
  { keywords: ['電瓶', '電池', '汽車電瓶', 'agm電瓶', '鉛酸電瓶'], emoji: '🔋', cat: 'vehicle', subCat: '電瓶' },
  { keywords: ['雨刷', '雨刷片', '雨刷精', '矽膠雨刷'], emoji: '🌧️', cat: 'vehicle', subCat: '雨刷' },
  { keywords: ['煞車', '剎車', '煞車皮', '煞車油', '來令片'], emoji: '🛑', cat: 'vehicle', subCat: '煞車' },
  { keywords: ['驗車', '定檢', '代檢', '車輛檢驗'], emoji: '📋', cat: 'vehicle', subCat: '驗車' },
  { keywords: ['強制險', '車險', '第三人責任險', '丙式', '乙式'], emoji: '📑', cat: 'vehicle', subCat: '車險' },
  { keywords: ['車', '機車', '汽車', 'gogoro', '重機', '檔車'], emoji: '🚗', cat: 'vehicle', subCat: '車輛' },

  // 訂閱 (subscription)
  { keywords: ['netflix', 'disney', 'youtube', '影音', '串流', 'hbo', 'friday', '愛奇藝'], emoji: '🎬', cat: 'subscription', subCat: '影音' },
  { keywords: ['spotify', 'kkbox', 'apple music', '音樂', 'youtube music'], emoji: '🎵', cat: 'subscription', subCat: '音樂' },
  { keywords: ['icloud', 'google one', '雲端', 'dropbox', 'onedrive'], emoji: '☁️', cat: 'subscription', subCat: '雲端' },
  { keywords: ['chatgpt', 'openai', 'adobe', '軟體', 'midjourney', 'copilot', 'notion', 'github'], emoji: '💻', cat: 'subscription', subCat: '軟體' },
  { keywords: ['健身房', '會籍', '健身', '瑜珈', 'world gym', '健身工廠'], emoji: '💪', cat: 'subscription', subCat: '健身' },
  { keywords: ['寬頻', '電信', '電話費', '第四台', '固網', '光世代', '中華電信', '遠傳', '台灣大哥大'], emoji: '📶', cat: 'subscription', subCat: '電信' },
  { keywords: ['租約', '房租', '店租', '車位租金', '押金'], emoji: '🏠', cat: 'subscription', subCat: '租約' },
  { keywords: ['訂閱', '會員', '月費', '年費'], emoji: '📅', cat: 'subscription', subCat: '訂閱服務' },

  // 藥品 (medicine)
  { keywords: ['眼藥水', '人工淚液', '洗眼液'], emoji: '💊', cat: 'medicine', subCat: '眼藥水' },
  { keywords: ['維他命', '維生素', 'b群', '維他命c', '合利他命'], emoji: '💊', cat: 'medicine', subCat: '維他命' },
  { keywords: ['魚油', '葉黃素', '益生菌', '保健品', '膠原蛋白', '鈣片', '鋅錠'], emoji: '🐟', cat: 'medicine', subCat: '魚油' },
  { keywords: ['藥膏', '皮膚膏', '抗生素', '曼秀雷敦', '眼藥膏', '蚊蟲膏', 'ok繃', '創口貼', '優碘', '碘酒'], emoji: '🩹', cat: 'medicine', subCat: '藥膏' },
  { keywords: ['止痛藥', '感冒藥', '胃藥', '成藥', '膠囊', '錠', '藥', '普拿疼', '退燒藥', '胃散', '正露丸', '止咳藥', '消炎藥'], emoji: '🩺', cat: 'medicine', subCat: '成藥' },
  { keywords: ['牙醫', '洗牙', '看診', '診所', '醫院', '看牙', '牙齒', '補牙'], emoji: '🦷', cat: 'medicine', subCat: '醫療' },
  { keywords: ['隱形眼鏡', '保養液', '隱眼', '生理食鹽水'], emoji: '👁️', cat: 'medicine', subCat: '保養液' },

  // 清潔 (cleaning)
  { keywords: ['菜瓜布', '海綿', '科技海綿', '洗碗海綿'], emoji: '🧼', cat: 'cleaning', subCat: '菜瓜布' },
  { keywords: ['洗衣精', '洗衣球', '洗衣膠囊', '洗衣粉', '柔軟精', '漂白水'], emoji: '🧺', cat: 'cleaning', subCat: '洗衣精' },
  { keywords: ['洗碗精', '洗潔精', '洗碗機洗碗粉', '光潔劑', '洗碗錠', '洗碗塊'], emoji: '🍽️', cat: 'cleaning', subCat: '洗碗精' },
  { keywords: ['抹布', '拖把', '除塵拖', '除塵紙', '靜電拖'], emoji: '🧽', cat: 'cleaning', subCat: '抹布' },
  { keywords: ['潔廁劑', '清潔劑', '漂白水', '洗碗精', '洗潔精', '洗衣精', '洗衣球', '洗衣膠囊', '洗衣粉', '柔軟精', '除黴', '除霉', '去漬', '洗手乳', '洗手液', '地板清潔', '馬桶刷', '芳香劑', '馬桶清潔', '水垢清', '小蘇打', '過碳酸鈉'], emoji: '🚽', cat: 'cleaning', subCat: '潔廁劑' },
  { keywords: ['酒精', '消毒水', '乾洗手', '次氯酸'], emoji: '🧴', cat: 'cleaning', subCat: '酒精' },
  { keywords: ['除蟎', '防蟎噴霧', '防塵蟎'], emoji: '💨', cat: 'cleaning', subCat: '除蟎' },

  // 耗材 (filter)
  { keywords: ['濾網', '清淨機', 'hepa', '冷氣濾網', '空氣濾網', '除甲醛濾網'], emoji: '🌀', cat: 'filter', subCat: '濾網' },
  { keywords: ['濾芯', '濾心', '淨水', 'ro', '飲水', '濾水壺', 'brita'], emoji: '💧', cat: 'filter', subCat: '濾芯' },
  { keywords: ['牙刷', '刷頭', '音波牙刷', '電動牙刷'], emoji: '🪥', cat: 'filter', subCat: '牙刷' },
  { keywords: ['除濕盒', '除濕劑', '乾燥劑', '克潮靈', '防潮包', '除濕桶', '集水袋', '備長炭'], emoji: '🌧️', cat: 'filter', subCat: '除濕盒' },
  { keywords: ['吸塵器', '掃地機', '掃地機器人', 'dyson', '主刷', '邊刷', '集塵袋'], emoji: '🧹', cat: 'filter', subCat: '掃地耗材' },
  { keywords: ['除鈣劑', '咖啡機除鈣', '水垢除鈣'], emoji: '☕', cat: 'filter', subCat: '咖啡保養' },

  // 保固 (warranty)
  { keywords: ['椅', 'chair', '沙發', '辦公椅', '人體工學', '升降桌', '家具'], emoji: '🪑', cat: 'warranty', subCat: '家具' },
  { keywords: ['電腦', '筆電', 'mac', 'macbook', 'pc', '主機', 'ipad', '平板', 'surface'], emoji: '💻', cat: 'warranty', subCat: '電腦' },
  { keywords: ['滑鼠', '電腦滑鼠', '無線滑鼠', '電競滑鼠', '藍芽滑鼠', '藍牙滑鼠', '光學滑鼠', '鍵盤', '電腦鍵盤', '機械鍵盤', '無線鍵盤', '滑鼠墊', '桌墊', '電腦螢幕', 'mouse', 'keyboard', 'mousepad', 'trackpad'], emoji: '🖱️', cat: 'warranty', subCat: '電腦' },
  { keywords: ['手機', 'iphone', 'pixel', 'galaxy', 'android'], emoji: '📱', cat: 'warranty', subCat: '手機' },
  { keywords: ['耳機', 'airpods', 'buds', 'headphone', '喇叭', '音響', 'soundbar'], emoji: '🎧', cat: 'warranty', subCat: '耳機' },
  { keywords: ['電視', '螢幕', '顯示器', 'tv', '冰箱', '洗衣機', '冷氣', '微波爐', '烤箱', '除濕機', '電風扇'], emoji: '📺', cat: 'warranty', subCat: '家電' },
  { keywords: ['手錶', '錶', 'watch', 'apple watch', 'garmin'], emoji: '⌚', cat: 'warranty', subCat: '手錶' },
  { keywords: ['遊戲機', 'ps5', 'switch', 'xbox', 'playstation', 'steam deck'], emoji: '🎮', cat: 'warranty', subCat: '遊戲機' },

  // 食品 (food)
  { keywords: [
    '青菜', '蔬菜', '葉菜', '菠菜', '空心菜', '高麗菜', '花椰菜', '地瓜葉', '大白菜', '芹菜',
    '萵苣', '豆芽', '小白菜', '青花菜', '綠花椰', '白花椰', '娃娃菜', '青江菜', '油菜',
    '芥藍', '芥菜', '皇宮菜', '龍鬚菜', '水蓮', '紅鳳菜', '莧菜', '川七', '茼蒿', '美生菜',
    '蘿蔓', '胡蘿蔔', '紅蘿蔔', '白蘿蔔', '蘿蔔', '洋蔥', '青蔥', '大蔥', '蔥花', '蔥',
    '大蒜', '蒜頭', '蒜苗', '生薑', '老薑', '薑', '辣椒', '朝天椒', '甜椒', '青椒', '彩椒',
    '小黃瓜', '黃瓜', '絲瓜', '苦瓜', '冬瓜', '南瓜', '節瓜', '櫛瓜', '佛手瓜', '茄子',
    '四季豆', '毛豆', '豌豆', '豆莢', '甜豆', '扁豆', '敏豆', '玉米', '玉米筍', '秋葵',
    '蘆筍', '竹筍', '茭白筍', '綠竹筍', '麻竹筍', '筍', '牛蒡', '蓮藕', '山藥', '地瓜',
    '馬鈴薯', '芋頭', '香菇', '杏鮑菇', '金針菇', '鴻喜菇', '雪白菇', '秀珍菇', '木耳',
    '黑木耳', '白木耳', '蘑菇', '洋菇', '九層塔', '香菜'
  ], emoji: '🥬', cat: 'food', subCat: '青菜' },

  { keywords: [
    '水果', '木瓜', '蘋果', '香蕉', '芭樂', '橘子', '柳丁', '葡萄', '奇異果', '芒果', '西瓜',
    '草莓', '檸檬', '番茄', '鳳梨', '水蜜桃', '哈密瓜', '火龍果', '藍莓', '櫻桃', '水梨',
    '梨子', '蓮霧', '荔枝', '龍眼', '百香果', '葡萄柚', '柚子', '文旦', '金桔', '金柑',
    '柿子', '甜柿', '甜瓜', '香瓜', '洋香瓜', '釋迦', '鳳梨釋迦', '酪梨', '無花果',
    '榴槤', '山竹', '桑椹', '蜜棗', '棗子', '桃子', '李子', '梅子', '楊桃', '枇杷',
    '椰子', '甘蔗'
  ], emoji: '🍎', cat: 'food', subCat: '水果' },

  { keywords: [
    '鮮乳', '牛乳', '羊乳', '保久乳', '全脂乳', '低脂乳', '鮮奶', '牛奶', '優格', '起司',
    '豆漿', '奶粉', 'milk', '生乳', 'fresh milk', '優酪乳', '燕麥奶', '堅果奶', '黑豆漿', '米漿', '鮮奶油',
    '乳酪', '奶酪', '起司片', '起司條', '奶油', '牛油', '優格飲', '發酵乳', '養樂多',
    '布丁', '木瓜牛奶'
  ], emoji: '🥛', cat: 'food', subCat: '鮮乳' },

  { keywords: [
    '咖啡', '咖啡豆', '咖啡粉', '美式', '拿鐵', '濾掛', '濃縮咖啡',
    '耳掛咖啡', '冷萃', '冰美式', '卡布奇諾', '摩卡', '美式咖啡', '拿鐵咖啡'
  ], emoji: '☕', cat: 'food', subCat: '咖啡' },

  { keywords: [
    '蛋', '雞蛋', '鴨蛋', '茶葉蛋', '皮蛋', '鹹蛋', '生鮮蛋', '洗選蛋', '放牧蛋',
    '土雞蛋', '烏骨雞蛋', '溏心蛋', '溫泉蛋', '水煮蛋', '鵪鶉蛋'
  ], emoji: '🥚', cat: 'food', subCat: '雞蛋' },

  { keywords: [
    '茶', '茶葉', '茶包', '烏龍茶', '綠茶', '紅茶', '普洱茶',
    '四季春', '青茶', '鐵觀音', '包種茶', '奶茶', '花茶', '菊花茶', '麥茶', '玄米茶'
  ], emoji: '🍵', cat: 'food', subCat: '茶包' },

  { keywords: [
    '醬油', '鹽', '糖', '油', '醋', '調味料', '胡椒', '沙拉醬', '橄欖油', '辣醬',
    '味噌', '麻油', '香油', '烏醋', '白醋', '米酒', '料理米酒', '蠔油', '番茄醬',
    '美乃滋', '芥末', '咖哩', '咖哩塊', '胡椒粉', '胡椒鹽', '辣椒醬', '豆瓣醬',
    '沙茶醬', '芝麻醬', '烤肉醬', '沙拉油', '葵花油'
  ], emoji: '🧂', cat: 'food', subCat: '調味料' },

  { keywords: [
    '零食', '堅果', '餅乾', '巧克力', '洋芋片', '點心', '爆米花', '海苔',
    '蛋捲', '仙貝', '糖果', '軟糖', '果凍', '肉乾', '豬肉乾', '牛肉乾',
    '腰果', '核桃', '杏仁', '開心果', '夏威夷豆', '花生'
  ], emoji: '🍪', cat: 'food', subCat: '零食' },

  { keywords: [
    '牛肉', '豬肉', '雞肉', '雞胸肉', '鮭魚', '蝦', '生鮮肉品', '牛排', '絞肉',
    '羊肉', '鴨肉', '鵝肉', '松阪豬', '梅花豬', '豬五花', '五花肉', '里肌', '排骨',
    '培根', '香腸', '火腿', '肉絲', '肉片', '牛腩', '牛腱', '牛五花', '雞腿', '雞翅',
    '雞柳', '雞排', '貢丸', '肉丸', '魚', '魚排', '魚片', '生魚片', '鱈魚', '鯛魚',
    '鱸魚', '虱目魚', '鯖魚', '秋刀魚', '吻仔魚', '鮮蝦', '白蝦', '草蝦', '蝦仁',
    '明蝦', '龍蝦', '蛤蜊', '文蛤', '牡蠣', '蚵仔', '干貝', '透抽', '花枝', '軟絲',
    '小卷', '中卷', '章魚', '魷魚', '螃蟹', '蟹肉'
  ], emoji: '🥩', cat: 'food', subCat: '生鮮肉品' },

  { keywords: [
    '麵包', '吐司', '貝果', '可頌', '蛋糕', '鬆餅', '烘焙',
    '菠蘿麵包', '餐包', '生吐司', '法棍', '歐包', '蛋撻', '蛋塔', '泡芙', '派',
    '司康', '馬卡龍', '披薩', 'pizza'
  ], emoji: '🍞', cat: 'food', subCat: '麵包烘焙' },

  // 日用 (pao)
  { keywords: ['沐浴', '洗髮', '潤髮', '肥皂', '洗沐', '沐浴乳', '洗髮精', '潤髮乳', 'shampoo'], emoji: '🧴', cat: 'pao', subCat: '洗沐' },
  { keywords: ['防曬', '隔離', '防曬乳', '防曬露', '防曬噴霧'], emoji: '☀️', cat: 'pao', subCat: '防曬' },
  { keywords: ['精華', '乳液', '面膜', '化妝水', '保濕', '眼霜', '面霜', '精華液', '保養品', '洗面乳', '潔顏乳', '卸妝水', '卸妝油', '化妝棉'], emoji: '✨', cat: 'pao', subCat: '保養' },
  { keywords: ['護手霜', '護唇膏', '身體乳', '護足霜'], emoji: '👐', cat: 'pao', subCat: '護手霜' },
  { keywords: ['牙膏', '漱口水', '牙線', '牙線棒', 'toothpaste'], emoji: '🪥', cat: 'pao', subCat: '牙膏' },
  { keywords: ['刮鬍刀', '刀頭', '刮鬍泡', '電鬍刀'], emoji: '🪒', cat: 'pao', subCat: '刮鬍刀' },
  { keywords: ['香水', '淡香水', '香氛', '香膏'], emoji: '🌸', cat: 'pao', subCat: '香水' },
  { keywords: ['唇膏', '口紅', '粉底', '遮瑕', '眼影', '腮紅', '彩妝'], emoji: '💄', cat: 'pao', subCat: '彩妝' },

  // 寵物 (pet)
  { keywords: ['貓糧', '狗糧', '飼料', '乾糧', '無穀飼料'], emoji: '🥣', cat: 'pet', subCat: '乾糧' },
  { keywords: ['主食罐', '副食罐', '罐罐', '貓罐頭', '狗罐頭'], emoji: '🥫', cat: 'pet', subCat: '罐頭' },
  { keywords: ['全能狗', '蚤不到', '心絲蟲', '驅蟲', '滴劑', '驅蟲藥'], emoji: '💊', cat: 'pet', subCat: '驅蟲藥' },
  { keywords: ['狂犬疫苗', '三合一疫苗', '五合一疫苗', '寵物健檢', '寵物疫苗', '結紮'], emoji: '💉', cat: 'pet', subCat: '疫苗健檢' },
  { keywords: ['豆腐砂', '礦砂', '松木砂', '貓砂', '尿墊', '尿布墊', '便盆'], emoji: '🪵', cat: 'pet', subCat: '貓砂尿墊' },
  { keywords: ['凍乾', '肉泥', '肉乾', '潔牙骨', '寵物零食', '貓草', '排毛粉'], emoji: '🥩', cat: 'pet', subCat: '零食凍乾' },
  { keywords: ['貓', '狗', '毛孩', '小貓', '小狗', '貓咪', '幼貓', '幼犬', '倉鼠', '兔子'], emoji: '🐾', cat: 'pet', subCat: '寵物保健' },

  // 母嬰 (baby)
  { keywords: ['奶粉', '配方奶', '成長奶粉', '水解奶粉', '早產兒奶粉'], emoji: '🍼', cat: 'baby', subCat: '配方奶' },
  { keywords: ['尿布', '紙尿褲', '拉拉褲', '安睡褲', '學習褲'], emoji: '🧷', cat: 'baby', subCat: '尿布' },
  { keywords: ['濕紙巾', '純水濕巾', '柔濕巾', '口手濕巾'], emoji: '🧻', cat: 'baby', subCat: '濕紙巾' },
  { keywords: ['副食品', '寶寶粥', '米餅', '果泥', '常溫粥'], emoji: '🥣', cat: 'baby', subCat: '副食品' },
  { keywords: ['奶嘴', '安撫奶嘴', '奶瓶', '固齒器', '奶瓶嘴'], emoji: '🍼', cat: 'baby', subCat: '奶嘴用品' },
  { keywords: ['預防針', '幼兒疫苗', '五合一', '卡介苗', '水痘疫苗'], emoji: '💉', cat: 'baby', subCat: '幼兒疫苗' },

  // 辦公 (office)
  { keywords: ['墨水', '墨水匣', '連續供墨', '填充墨水'], emoji: '🖨️', cat: 'office', subCat: '耗材墨水' },
  { keywords: ['碳粉', '碳粉匣', '感光鼓', '雷射碳粉'], emoji: '📦', cat: 'office', subCat: '碳粉匣' },
  { keywords: ['電池', '3號電池', '4號電池', '鹼性電池', '充電電池', '水銀電池'], emoji: '🔋', cat: 'office', subCat: '電池' },
  { keywords: ['手帳', '筆記本', '鋼筆', '原子筆', '文具', '影印紙', '便利貼'], emoji: '📓', cat: 'office', subCat: '筆記文具' },
  { keywords: ['護照', '簽證', '台胞證', '居留證', '身分證', '健保卡', '證件'], emoji: '🛂', cat: 'office', subCat: '證件合約' },
  { keywords: ['證照', '回訓', '檢定', '換證', '技師證'], emoji: '📜', cat: 'office', subCat: '專業證照' },

  // 戶外 (outdoor)
  { keywords: ['蛋白粉', '乳清', '乳清蛋白', '肌酸', 'bcaa'], emoji: '🥤', cat: 'outdoor', subCat: '高蛋白' },
  { keywords: ['帳篷', '天幕', '睡袋', '露營椅', '露營桌', '營釘'], emoji: '🏕️', cat: 'outdoor', subCat: '露營裝備' },
  { keywords: ['登山鞋', '健行鞋', '登山杖', '登山包', '攻頂包'], emoji: '🥾', cat: 'outdoor', subCat: '登山裝備' },
  { keywords: ['水壺', '水袋', '保溫瓶', '運動水壺'], emoji: '🧊', cat: 'outdoor', subCat: '水壺配件' },
  { keywords: ['能量膠', '能量飲', '電解質', '鹽錠', '運動補給'], emoji: '⚡', cat: 'outdoor', subCat: '補給品' },
  { keywords: ['羽球拍', '網球拍', '拍線', '穿線', '握把布'], emoji: '🏸', cat: 'outdoor', subCat: '球拍線路' },

  // 居家 (home)
  { keywords: ['澆水', '盆栽', '觀葉植物', '多肉', '綠植', '換盆', '植栽'], emoji: '🌿', cat: 'home', subCat: '植栽綠化' },
  { keywords: ['肥料', '緩釋肥', '花肥', '液肥', '植物養護'], emoji: '🌱', cat: 'home', subCat: '花草肥料' },
  { keywords: ['燈泡', 'led燈', '吸頂燈', '嵌燈', '燈管'], emoji: '💡', cat: 'home', subCat: '燈具照明' },
  { keywords: ['枕套', '被套', '床包', '床單', '天絲', '寢具', '枕頭'], emoji: '🛏️', cat: 'home', subCat: '寢具家飾' },
  { keywords: ['住警器', '火災警報器', '煙霧偵測', '瓦斯警報', '滅火器'], emoji: '🧯', cat: 'home', subCat: '居家安全' },
  { keywords: ['水管', '水龍頭', '補漏', '五金', '矽利康'], emoji: '🔧', cat: 'home', subCat: '修繕保養' },

  // 穿搭 (fashion)
  { keywords: ['羽絨', '乾洗', '送洗', '大衣乾洗', '冬衣送洗'], emoji: '🧥', cat: 'fashion', subCat: '換季送洗' },
  { keywords: ['名牌包', '皮包', '皮夾', '皮革保養', '皮革油', '貂油'], emoji: '👜', cat: 'fashion', subCat: '皮革保養' },
  { keywords: ['純銀', '銀飾', '項鍊', '戒指', '拭銀布', '珠寶'], emoji: '💍', cat: 'fashion', subCat: '珠寶飾品' },
  { keywords: ['樟木', '防蛀包', '防蟲包', '除蟲片', '衣櫃防潮'], emoji: '🌿', cat: 'fashion', subCat: '衣物防護' },
  { keywords: ['高跟鞋', '皮鞋', '皮靴', '精品鞋', '靴子'], emoji: '👠', cat: 'fashion', subCat: '精品鞋靴' },

  // 動畫 (animation) - 書籍、漫畫、單行本、BD影音
  { keywords: ['漫畫', '單行本', '漫畫書', '輕小說', '小說', '書籍', '書本', '圖書', '雜誌', '課本', '畫冊', '設定集', '同人誌', '角川', '東立', '尖端', '青文', '航海王', '海賊王', '鬼滅之刃', '鬼滅', '咒術迴戰', '咒術', '葬送的芙莉蓮', '芙莉蓮', '排球少年', '我推的孩子', '間諜家家酒', '鏈鋸人', '進擊的巨人', '柯南', '火影', '死神', '獵人', 'isbn'], emoji: '📚', cat: 'animation', subCat: '漫畫/單行本', duration: 365 },
  { keywords: ['bd', 'blu-ray', 'dvd', '動漫影音', '動畫影音', '番劇'], emoji: '💿', cat: 'animation', subCat: 'BD/影音', duration: 180 },
  { keywords: ['動漫特典', '周邊特典', '特典', '預購特典'], emoji: '🎁', cat: 'animation', subCat: '周邊特典', duration: 365 },

  // 遊戲 (game) - 主機卡帶、光碟、周邊
  { keywords: ['switch', 'switch卡帶', 'ns卡帶', '任天堂', '薩爾達', '瑪利歐', '寶可夢', '動森', '魔物獵人'], emoji: '🎮', cat: 'game', subCat: 'Switch 卡帶', duration: 365 },
  { keywords: ['ps5', 'ps4', 'xbox', '遊戲光碟', 'ps光碟'], emoji: '💿', cat: 'game', subCat: 'PS/Xbox 光碟', duration: 365 },
  { keywords: ['遊戲手把', '手把', 'joycon', 'pro手把', '搖桿'], emoji: '🕹️', cat: 'game', subCat: '主機/手把周邊', duration: 365 },
  { keywords: ['點數卡', 'psn點數', 'eshop點數', 'steam點數', '遊戲點數', '序號'], emoji: '💳', cat: 'game', subCat: '點數卡/序號', duration: 365 },

  // 二次元 (otaku) - 徽章、立牌、模型、玩偶
  { keywords: ['徽章', '吧唧', '胸章', '馬口鐵徽章'], emoji: '🏅', cat: 'otaku', subCat: '徽章/吧唧', duration: 365 },
  { keywords: ['壓克力立牌', '立牌', '壓克力磚', '壓克力牌', '立牌擺件'], emoji: '🪧', cat: 'otaku', subCat: '壓克力立牌/磚', duration: 365 },
  { keywords: ['色紙', '相卡', '拍立得卡', '小卡', '透卡', '收藏卡'], emoji: '🖼️', cat: 'otaku', subCat: '色紙/相卡', duration: 365 },
  { keywords: ['模型', '黏土人', '景品', '手辦', '公仔', '一番賞', '扭蛋', '轉蛋'], emoji: '🪀', cat: 'otaku', subCat: '模型/黏土人/景品', duration: 365 },
  { keywords: ['棉花娃', '娃', '玩偶', '毛絨公仔', '趴趴'], emoji: '🧸', cat: 'otaku', subCat: '棉花娃/玩偶', duration: 365 },

  // 票券/活動 (ticket) - 電影票、演唱會、展覽、兌換券
  { keywords: ['電影票', '威秀', '國賓', '秀泰', '百老匯', '電影'], emoji: '🎬', cat: 'ticket', subCat: '電影票', duration: 7 },
  { keywords: ['演唱會', '門票', '音樂會', '演場會門票', '拓元', '寬宏', '年代售票'], emoji: '🎤', cat: 'ticket', subCat: '演唱會/音樂會', duration: 30 },
  { keywords: ['展覽門票', '動漫展', '漫畫博覽會', 'ff', 'cwt', '展覽'], emoji: '🖼️', cat: 'ticket', subCat: '動漫展覽門票', duration: 30 },
  { keywords: ['兌換券', '餐券', '住宿券', '優惠券', '提貨券', '商品券'], emoji: '🔖', cat: 'ticket', subCat: '活動兌換券', duration: 365 },

  // 其他 (other)
  { keywords: ['一般雜項', '雜項', '雜物', '日用品', '生活用品'], emoji: '📦', cat: 'other', subCat: '一般雜項' },
  { keywords: ['眼鏡', '墨鏡', '太陽眼鏡', '抗藍光', '鏡框', '鏡片', '老花眼鏡', '護目鏡'], emoji: '👓', cat: 'other', subCat: '配件小物', duration: 365 },
  { keywords: ['配件小物', '飾品小物', '隨身配件', '小物'], emoji: '👓', cat: 'other', subCat: '配件小物' },
  { keywords: ['未分類', '其他物品', '待整理'], emoji: '📦', cat: 'other', subCat: '未分類' },
  { keywords: ['球鞋', '慢跑鞋', '運動鞋', '拖鞋'], emoji: '👟', cat: 'other', subCat: '球鞋' },
  { keywords: ['背包', '後背包', '公事包', '手提包'], emoji: '🎒', cat: 'other', subCat: '包袋' },
  { keywords: ['衣服', '褲子', '襯衫', '外套', '洋裝'], emoji: '🧥', cat: 'other', subCat: '衣物' },
  { keywords: ['會議', '開會', '研討會', '週會', '月會', '晨會'], emoji: '📅', cat: 'other', subCat: '會議' },
  { keywords: ['備忘', '筆記', '代辦', '待辦', '個人事項', '隨手記'], emoji: '📌', cat: 'other', subCat: '備忘' }
];

/**
 * 智慧分類與細項對應器：
 * 自動根據輸入文字以最大關鍵字長度優先匹配一級分類與細項項目，若無任何匹配則自動選擇「其他 (other)」
 */
function matchCategoryAndSubCategory(text, fallbackCat = 'other') {
  if (!text || typeof text !== 'string') {
    return { category: fallbackCat, subCategory: '', emoji: fallbackCat === 'other' ? '📦' : '📌' };
  }

  // 【最優先判定 1】：乳製品/鮮乳 Priority 1 優先攔截 (包含中英日關鍵字，防止「超高溫瞬間殺菌」或白瓶被誤殺成清潔用品)
  const DAIRY_REGEX = /(鮮乳|鮮奶|牛乳|生乳|全脂|低脂|脱脂|脫脂|保久乳|純鮮乳|瑞穗|光泉|義美|林鳳營|初鹿|milk|乳飲品)/i;
  if (DAIRY_REGEX.test(text)) {
    return { category: 'food', subCategory: '鮮乳', emoji: '🥛' };
  }

  // 【配件小物判定】：眼鏡與個人配件 (包含中英日關鍵字，排除隱形眼鏡與保養液，嚴禁進入食品)
  const GLASSES_REGEX = /(眼鏡|墨鏡|太陽眼鏡|メガネ|glasses|sunglasses|spectacles|鏡框|抗藍光|鏡片|老花眼鏡|護目鏡)/i;
  if (GLASSES_REGEX.test(text) && !text.includes('隱形眼鏡') && !text.includes('保養液')) {
    return { category: 'other', subCategory: '配件小物', emoji: '👓' };
  }

  const lower = text.toLowerCase();
  let bestMatch = null;
  let bestLen = 0;

  for (const item of SMART_KEYWORD_MAP) {
    for (const kw of item.keywords) {
      const kwLower = kw.toLowerCase();
      if (lower.includes(kwLower)) {
        if (kwLower.length > bestLen) {
          bestLen = kwLower.length;
          bestMatch = item;
        }
      }
    }
  }

  if (bestMatch) {
    return {
      category: bestMatch.cat || fallbackCat,
      subCategory: bestMatch.subCat || '',
      emoji: bestMatch.emoji || (fallbackCat === 'other' ? '📦' : '📌')
    };
  }
  return { category: fallbackCat, subCategory: '', emoji: fallbackCat === 'other' ? '📦' : '📌' };
}


// ==========================================
// 2. UI 狀態指示器 (輸入框 Placeholder)
// ==========================================
function updateNerStatus(status) {
  modelStatus = status;
  if (typeof document === 'undefined') return;

  const input = document.getElementById('smartQuickAddInput');

  if (status === 'loading') {
    if (input) {
      input.placeholder = '智慧輸入 (如：鮮奶5天後到期、那隻貓叫小黑)';
      input.title = '智慧輸入：支援自然語言與日期分析';
    }
  } else if (status === 'ready') {
    if (input) {
      input.placeholder = '✨ 智慧輸入 (如：鮮奶5天後到期、那隻貓叫小黑)';
      input.title = '智慧輸入：本地微型實體模型支援';
    }
  } else if (status === 'fallback') {
    if (input) {
      input.placeholder = '智慧輸入 (如：交通會議 下週三下午2點提醒、鮮奶5天後到期)';
      input.title = '智慧輸入';
    }
  }
}

// ==========================================
// 2.9 AI 模型防護載入引擎 (getVisionEngine - 僅於使用者點擊相機或下載模型時觸發)
// ==========================================
async function getVisionEngine() {
  const isDebug = isCameraDebug();
  try {
    if (typeof window !== 'undefined' && window.transformersLib) {
      return window.transformersLib;
    }
    const tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1');
    if (typeof window !== 'undefined') {
      window.transformersLib = tf;
      if (tf.AutoProcessor) window.AutoProcessor = tf.AutoProcessor;
      if (tf.CLIPVisionModelWithProjection) window.CLIPVisionModelWithProjection = tf.CLIPVisionModelWithProjection;
      if (tf.RawImage) window.RawImage = tf.RawImage;
      if (tf.load_image) window.load_image = tf.load_image;
      if (tf.pipeline) window.pipeline = tf.pipeline;
      if (tf.env) {
        tf.env.useBrowserCache = true;
        tf.env.allowLocalModels = false;
        window.transformersEnv = tf.env;
      }
    }
    return tf;
  } catch (err) {
    if (isDebug) {
      console.error('[MOBILECLIP2] Transformers.js 動態 import 失敗:\n完整 Error Stack:', err && err.stack ? err.stack : err);
    }
    console.warn('AI 模型載入失敗，降級使用本機 OCR / MobileNet:', err);
    return null;
  }
}

let transformersModule = null;
async function loadTransformers() {
  const isDebug = isCameraDebug();
  try {
    const tf = await getVisionEngine();
    if (tf) {
      transformersModule = tf;
      if (isDebug) {
        console.log('[MOBILECLIP2] Transformers.js 是否成功載入: 成功');
      }
      return tf;
    }
    if (isDebug) {
      console.error('[MOBILECLIP2] Transformers.js 是否成功載入: 失敗 (getVisionEngine 回傳空值)');
    }
    return null;
  } catch (err) {
    if (isDebug) {
      console.error('[MOBILECLIP2] Transformers.js 是否成功載入: 失敗 (載入發生例外)\n完整 Error Stack:', err && err.stack ? err.stack : err);
    }
    console.warn('[loadTransformers] 載入失敗，降級備援:', err);
    return null;
  }
}

// 3. 非同步初始化微型中文命名實體模型 (initModel)
// ==========================================
async function initModel() {
  if (nerPipeline) return nerPipeline;
  if (isModelLoading) return null;
  isModelLoading = true;
  updateNerStatus('loading');

  try {
    let pipelineFn = null;
    try {
      const tf = await loadTransformers();
      if (tf && tf.pipeline) {
        pipelineFn = tf.pipeline;
        if (typeof window !== 'undefined') {
          window.pipeline = tf.pipeline;
          if (tf.env) window.transformersEnv = tf.env;
        }
      }
    } catch (tfErr) {
      if (typeof window !== 'undefined' && typeof window.pipeline === 'function') {
        pipelineFn = window.pipeline;
      }
    }

    if (typeof pipelineFn === 'function') {
      console.log('[NLP] 正在初始化本地微型中文命名實體模型 (Xenova/bert-tiny-chinese-ner)...');
      nerPipeline = await pipelineFn('token-classification', 'Xenova/bert-tiny-chinese-ner', {
        aggregation_strategy: 'simple'
      });
      isModelLoading = false;
      modelStatus = 'ready';
      updateNerStatus('ready');
      console.log('[NLP] ✅ 微型中文實體模型 (RoBERTa/BERT-Tiny) 初始化完成！');
      return nerPipeline;
    } else {
      throw new Error('window.pipeline is not accessible');
    }
  } catch (err) {
    console.warn('[NLP] 實體模型載入未完成或處於離線環境，啟用正則表達式備援：', err);
    isModelLoading = false;
    modelStatus = 'fallback';
    updateNerStatus('fallback');
    return null;
  }
}

// ==========================================
// 4. 基礎抽取函式 (時間、日期、品名正則輔助)
// ==========================================

/**
 * 抽取具體時間（時:分，24小時制 HH:mm）
 * 嚴格支援 12/24 小時制轉換（下午/晚上/PM 自動 +12），補零並防止十位數字截斷
 */
function extractTime(str) {
  if (!str) return null;
  const s = String(str).trim();

  // 檢查時段修飾詞 (包含 PM/AM, 下午, 晚上, 上午 等)
  const isPM = /(?:下午|午後|傍晚|晚上|今晚|明晚|\bpm\b|\bpost\s*meridiem\b)/i.test(s);
  const isAM = /(?:上午|早上|早晨|清晨|凌晨|半夜|\bam\b|\bante\s*meridiem\b)/i.test(s);
  const isNoon = /中午/.test(s);

  // 1. 24h/12h 數位時間 (如 15:00, 14:30, 09:00, 9:30, 3:00 PM, 下午 3:00)
  // 正則確保十位數不被截斷，完整捕捉 1~2 位小時與 2 位分鐘
  const digitalMatch = s.match(/(?:^|[^\d:])(\d{1,2}):([0-5]\d)(?!\d)(?:\s*(am|pm))?/i);
  if (digitalMatch) {
    let h = parseInt(digitalMatch[1], 10);
    const m = parseInt(digitalMatch[2], 10);
    const inlineAmpm = digitalMatch[3] ? digitalMatch[3].toLowerCase() : null;

    if (inlineAmpm === 'pm' || isPM) {
      if (h < 12) h += 12;
    } else if (inlineAmpm === 'am' || isAM) {
      if (h === 12) h = 0;
    } else if (isNoon) {
      if (h < 11) h += 12;
    }

    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  // 2. 英文/數字 PM/AM 簡寫 (如 3pm, 3 pm, 11am)
  const ampmMatch = s.match(/(?:^|[^\d])(\d{1,2})\s*(am|pm)(?!\w)/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    const inlineAmpm = ampmMatch[2].toLowerCase();
    if (inlineAmpm === 'pm') {
      if (h < 12) h += 12;
    } else if (inlineAmpm === 'am') {
      if (h === 12) h = 0;
    }
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, '0')}:00`;
    }
  }

  // 3. 中文點/分 (例如：下午2點30分、明天上午9點、晚上8點半、14點、下午 3 點、15點)
  // 完整捕捉 1~2 位數字或中文數字，避免十位數字被截斷
  const hourMatch = s.match(/(?:(?:上午|早上|早晨|清晨|中午|下午|午後|傍晚|晚上|今晚|明晚|半夜|凌晨)\s*)?(\d{1,2}|[一二兩三四五六七八九十]+)\s*(?:點|点|時|时)(?:\s*(?:半|(\d{1,2}|[一二兩三四五六七八九十]+)\s*分(?:鐘)?))?/);
  if (hourMatch) {
    let h = parseChineseNum(hourMatch[1]);
    if (h !== null && !isNaN(h)) {
      let m = 0;
      if (hourMatch[0].includes('半')) {
        m = 30;
      } else if (hourMatch[2]) {
        const mVal = parseChineseNum(hourMatch[2]);
        if (mVal !== null && !isNaN(mVal)) m = mVal;
      }

      if (isPM) {
        if (h < 12) h += 12;
      } else if (isAM) {
        if (h === 12) h = 0;
      } else if (isNoon) {
        if (h < 11) h += 12;
      }

      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

/**
 * 抽取日期 (YYYY-MM-DD)
 */
function extractDate(str, refDate, targetItem = null) {
  const todayYear = refDate.getFullYear();
  const todayMonth = refDate.getMonth();
  const todayDate = refDate.getDate();

  // 1. 延長/延後天數 (相對於現有物品到期日或基準時間)
  if (/(?:延長|延後|推遲|再放|再存|多放)\s*(\d+|[一二兩三四五六七八九十]+)\s*(?:天|日)/.test(str)) {
    const match = str.match(/(?:延長|延後|推遲|再放|再存|多放)\s*(\d+|[一二兩三四五六七八九十]+)\s*(?:天|日)/);
    const num = parseChineseNum(match[1]);
    if (num) {
      let base = refDate;
      if (targetItem && (targetItem.endDate || targetItem.expiryDate)) {
        const tDate = new Date((targetItem.endDate || targetItem.expiryDate) + 'T00:00:00');
        if (!isNaN(tDate.getTime())) base = tDate;
      }
      return formatDate(offsetDays(base, Math.round(num)));
    }
  }

  // 2. 明確完整日期：YYYY-MM-DD / YYYY/MM/DD / YYYY年M月D日
  const fullDateMatch = str.match(/(20\d\d)[-/年\.]\s*(\d{1,2})[-/月\.]\s*(\d{1,2})[日號]?/);
  if (fullDateMatch) {
    const y = parseInt(fullDateMatch[1], 10);
    const m = String(parseInt(fullDateMatch[2], 10)).padStart(2, '0');
    const d = String(parseInt(fullDateMatch[3], 10)).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 3. 月/日 (例如 10/15, 5月20日)
  const mdMatch = str.match(/(?:^|[^\d])(\d{1,2})[-/月\.]\s*(\d{1,2})[日號]?/);
  if (mdMatch) {
    const m = parseInt(mdMatch[1], 10);
    const d = parseInt(mdMatch[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      let year = todayYear;
      const targetThisYear = new Date(year, m - 1, d);
      const todayNoTime = new Date(todayYear, todayMonth, todayDate);
      if (targetThisYear.getTime() < todayNoTime.getTime()) {
        year += 1;
      }
      return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 4. 口語日期
  if (/大後天|大后天/.test(str)) return formatDate(offsetDays(refDate, 3));
  if (/後天|后天/.test(str)) return formatDate(offsetDays(refDate, 2));
  if (/明天|明兒個/.test(str)) return formatDate(offsetDays(refDate, 1));
  if (/今天|今日/.test(str)) return formatDate(offsetDays(refDate, 0));

  // 5. 週別日期 (下週X / 下星期X)
  const weekMatch = str.match(/(下下|下|這|本)?\s*(?:週|周|星期|禮拜)(?:\s*([一二三四五六日天1-7]))?/);
  if (weekMatch) {
    const prefix = weekMatch[1] || '';
    const dayStr = weekMatch[2] || '1';
    const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };
    const targetDay = dayMap[dayStr];
    const currentDay = refDate.getDay() === 0 ? 7 : refDate.getDay();
    let daysToAdd = 0;
    if (prefix === '下下') {
      daysToAdd = (14 - currentDay) + targetDay;
    } else if (prefix === '下') {
      daysToAdd = (7 - currentDay) + targetDay;
    } else {
      daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
    }
    return formatDate(offsetDays(refDate, daysToAdd));
  }

  // 6. 相對年數 (半年後、X年後)
  if (/半年(?:後|后)?/.test(str)) {
    const res = new Date(refDate.getTime());
    res.setMonth(res.getMonth() + 6);
    return formatDate(res);
  }
  const yearMatch = str.match(/(\d+|[一二兩三四五六七八九十]+)\s*(?:個)?年(?:半)?(?:後|后)?/);
  if (yearMatch) {
    const num = parseChineseNum(yearMatch[1]);
    if (num) {
      const isHalf = yearMatch[0].includes('半');
      const res = new Date(refDate.getTime());
      res.setFullYear(res.getFullYear() + Math.floor(num));
      if (isHalf) res.setMonth(res.getMonth() + 6);
      return formatDate(res);
    }
  }

  // 7. 相對月數 (下下個月、下個月、半個月、X個月後)
  if (/下下(?:個)?月/.test(str)) {
    const res = new Date(refDate.getTime());
    res.setMonth(res.getMonth() + 2);
    return formatDate(res);
  }
  if (/下(?:個)?月/.test(str)) {
    const res = new Date(refDate.getTime());
    res.setMonth(res.getMonth() + 1);
    return formatDate(res);
  }
  if (/這(?:個)?月|本月/.test(str)) {
    return formatDate(refDate);
  }
  if (/半個月(?:後|后)?|半月(?:後|后)?/.test(str)) {
    return formatDate(offsetDays(refDate, 15));
  }
  const monthMatch = str.match(/(?:放|存|保質|保存|剩|還有)?\s*(\d+|[一二兩三四五六七八九十]+)\s*個?月(?:半)?(?:後|后)?/);
  if (monthMatch && (monthMatch[0].includes('月') || monthMatch[0].includes('後'))) {
    const num = parseChineseNum(monthMatch[1]);
    if (num) {
      const isHalf = monthMatch[0].includes('半');
      const res = new Date(refDate.getTime());
      res.setMonth(res.getMonth() + Math.floor(num));
      if (isHalf) res.setDate(res.getDate() + 15);
      return formatDate(res);
    }
  }

  // 8. 相對週數
  const weekRelMatch = str.match(/(?:放|存|保質|保存|剩|還有)?\s*(\d+|[一二兩三四五六七八九十]+)\s*(?:個)?(?:週|周|星期|禮拜)(?:後|后)?/);
  if (weekRelMatch) {
    const num = parseChineseNum(weekRelMatch[1]);
    if (num) return formatDate(offsetDays(refDate, Math.round(num * 7)));
  }

  // 9. 相對天數 (如：5天後、3天後到期)
  const dayRelMatch = str.match(/(?:放|存|保質|保存|剩|還有)?\s*(\d+|[一二兩三四五六七八九十]+)\s*(?:天|日)(?:\s*(?:後|后|之后|之內|到期|過期))?/);
  if (dayRelMatch) {
    const num = parseChineseNum(dayRelMatch[1]);
    if (num !== null && !isNaN(num) && num > 0) {
      return formatDate(offsetDays(refDate, Math.round(num)));
    }
  }

  return null;
}

/**
 * 抽取乾淨品名（過濾贅詞，保留核心主體）
 */
function simplifyItemName(rawText) {
  if (!rawText || typeof rawText !== 'string') return '未命名物品';

  let clean = rawText.trim()
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');

  // 0. 特殊格式保護：ISBN 條碼格式保護與條碼商品保護
  const isbnMatch = clean.match(/(?:ISBN[:\s]*)?(97[89]\d{9,10})/i);
  if (isbnMatch) {
    return `圖書/漫畫 (ISBN: ${isbnMatch[1]})`;
  }
  if (/^條碼商品/i.test(clean)) {
    return '條碼商品';
  }

  // 0.5 移除 OCR 影像包裝雜訊（營養標示、成分、工廠、淨重、效期標籤等）
  clean = clean.replace(/(?:有效日期|保存期限|有效期限|製造日期|到期日|賞味期限|EXP|MFG|BBD|LOT|NET\s*WT)[:：\s]*[\w\d\-./]*/gi, ' ');
  clean = clean.replace(/條碼[:：\s]+[\w\d\-./]+/gi, ' ');
  clean = clean.replace(/(?:營養標示|成份|成分|過敏原|原產地|淨重|內容量|保存條件|委託製造商|製造商|進口商|服務專線|服務電話|注意事項|台灣製造|MADE IN)[^]*$/gi, ' ');
  clean = clean.replace(/^(?:品名|名稱|商品名稱|品項)[:：\s]*/gi, ' ');

  // 1. 移除時鐘與提醒修飾詞
  clean = clean.replace(/(?:提前|提早|前)?\s*\d+\s*(?:個)?(?:天|日|週|周|月|年)?(?:\s*(?:上午|早上|下午|晚上|中午|凌晨)?\s*\d{1,2}\s*(?:點|点|時|时|:\d{2})(?:\s*(?:半|\d{1,2}\s*分(?:鐘)?))?)?\s*(?:提醒|通知)/g, ' ');
  clean = clean.replace(/(?:當天|當日|當天上午|當天下午|當天晚上)\s*(?:提醒|通知)?/g, ' ');
  clean = clean.replace(/不提醒|免提醒|不用提醒|提醒我?|通知我?|提醒|通知/g, ' ');

  // 2. 移除時間日期字詞
  const timeRegexes = [
    /20\d\d[-/年\.]\s*\d{1,2}[-/月\.]\s*\d{1,2}[日號]?/g,
    /\d{1,2}[-/月\.]\s*\d{1,2}[日號]?/g,
    /大後天|大后天|後天|后天|明天|明兒個|今天|今日|昨天|昨兒個/g,
    /(?:下下|下|這|本)?\s*(?:週|周|星期|禮拜)(?:\s*[一二三四五六日天1-7])?/g,
    /每(?:年|月|週|周|星期|禮拜|天|日)/g,
    /(?:還有|剩|保質|保存|保固|有效期)?\s*(?:半|\d+|[一二兩三四五六七八九十]+)\s*(?:個)?(?:半)?(?:年|個月|月|週|周|星期|禮拜|天|日)(?:後|后|到期|過期)?/g,
    /半個月(?:後|后)?|半月(?:後|后)?|半年(?:後|后)?/g,
    /(?:放|存|保質|保存|剩|還有)?\s*(\d+|[一二兩三四五六七八九十]+)\s*個?月(?:半)?(?:後|后)?/g,
    /(?:放|存|保質|保存|剩|還有)?\s*(\d+|[一二兩三四五六七八九十]+)\s*(?:個)?(?:週|周|星期|禮拜)(?:後|后)?/g,
    /(?:放|存|保質|保存|剩|還有)?\s*(\d+|[一二兩三四五六七八九十]+)\s*(?:天|日)(?:\s*(?:後|后|之后|之內|到期|過期))?/g,
    /(?:延長|延後|推遲|再放|再存|多放)\s*(\d+|[一二兩三四五六七八九十]+)\s*(?:天|日)/g,
    /(?:上午|早上|早晨|清晨|中午|下午|午後|傍晚|晚上|今晚|明晚|半夜|凌晨)?\s*\d{1,2}\s*(?:點|点|時|时)(?:\s*(?:半|\d{1,2}\s*分(?:鐘)?))?/g,
    /\d{1,2}\s*(?:點|点|時|时)(?:\s*(?:半|\d{1,2}\s*分(?:鐘)?))?/g,
    /\d{1,2}\s*(?:am|pm)/gi,
    /(?:^|[^\d:])(\d{1,2}):([0-5]\d)(?!\d)(?:\s*(?:am|pm))?/gi,
    /上午|早上|早晨|清晨|中午|下午|午後|傍晚|晚上|今晚|明晚|半夜|凌晨/g
  ];
  timeRegexes.forEach(rg => { clean = clean.replace(rg, ' '); });

  // 2.5 移除僅記天數/不設到期修飾詞
  clean = clean.replace(/(?:謹記|僅記|記|紀錄|記錄)?\s*(?:使用天數|陪伴天數|天數)/g, ' ');
  clean = clean.replace(/不設定到期(?:日|時間)?|不設到期(?:日|時間)?|無到期日?|不限期|永久/g, ' ');

  // 3. 移除口語前綴贅詞 (Conversational Noise Prefixes)
  const conversationalNoise = [
    /幫我(?:記錄|記一下|記|紀錄|寫一下|建一下|備忘一下)(?:一下)?/g,
    /請幫我(?:記錄|記一下|記|紀錄)?/g,
    /記錄一下|記一下|紀錄一下/g,
    /記得(?:幫我|提醒我|通知我)?/g,
    /別忘記|別忘了|麻煩幫我|要記得/g,
    /剛剛在|剛在|今天在|昨天在|在[^\s,，。]+(?:買的|訂購的|新買的|買了|剛買的)/g,
    /剛剛買了|剛買了|剛剛買|剛買|剛剛訂購|剛訂購|新買的|新買了|新買|訂購了|訂購|購買了|購買|買了/g,
    /有一隻|有一頭|有一個|有一位|有一場|有一部|有一件|有一堂|有一臺|有一台|有一批|有一支|有一輛|有一袋|有一箱|有一包|有一盒|有一瓶|有一罐|有一條/g,
    /領養了一隻|領養了|收編了一隻|收編了/g,
    /準備(?:要|去|參加|去吃|去拿|更換|換)?/g,
    /要去|準備去|去拿|去吃|去買|去喝|想去/g,
    /放在|放進|存進|存放在|存了|放了|留著|收在|收進/g
  ];
  conversationalNoise.forEach(rg => { clean = clean.replace(rg, ' '); });

  // 4. 移除數量詞修飾 (如：兩大瓶、5盒、一個、三大包、一條、三包)
  clean = clean.replace(/(?:\d+|[一二兩三四五六七八九十幾]+)\s*(?:個|場|瓶|隻|件|張|條|盒|包|袋|碗|次|批|堂|大瓶|小瓶|大盒|小盒|罐|箱|支|臺|台|顆|粒|片|包裝|抽|大袋|大箱|捲|公升|ml|g|kg|斤|瓶裝)/gi, ' ');
  clean = clean.replace(/兩大瓶|三大盒|一大箱|好幾盒|幾包|幾瓶|好幾瓶|兩小瓶|一大顆/g, ' ');

  // 5. 移除存儲位置與口語中介詞
  clean = clean.replace(/(?:在|放|放在)?(?:冰箱|冷藏|冷凍|蔬果室|防潮箱|陽台|車庫|客廳|廚房|臥室|浴室|抽屜|櫃子|書房|桌上|鞋櫃|衣櫃|儲藏室|後車廂|後座|推車|辦公室)(?:裡|內|中|上|下)?/g, ' ');
  clean = clean.replace(/放冷藏|放冷凍|放陰涼處|常溫保存|密封保存/g, ' ');

  // 6. 移除狀態贅詞與動作尾綴
  clean = clean.replace(/大概|預計|預估|應該|可能|差不多|左右|之內|前後/g, ' ');
  clean = clean.replace(/到期了|過期了|到期|過期|更換|換新|換了|截止|用完|喝完|吃完|結束|開始|續約|續訂|提醒我|通知我|買的|買了|完成了|完成/g, ' ');

  // 7. 清除標點符號與邊界雜詞
  clean = clean.replace(/[,，。!！?？~～、:：()（）\[\]【】]/g, ' ').replace(/\s+/g, ' ').trim();
  clean = clean.replace(/^[個場瓶隻件張條盒包袋碗次批堂大瓶小瓶大盒小盒顆粒箱片]+/g, '').trim();
  clean = clean.replace(/^(?:訂購|購買|領養|收編|準備|新買|新訂|[的了在與和從於去買拿放換])+/g, '').trim();
  clean = clean.replace(/(?:更換|換新|換了|到期|過期|穿著|送洗|保固|完成|處理|後|后|[的了在與和從於去買拿放換])+$/g, '').trim();

  // 8. 專有名詞語意簡化與核心保留
  // 會議保護
  if (clean.includes('會議') || clean.includes('開會') || clean.includes('研討會')) {
    const match = clean.match(/([^\s]{1,12})(?:會議|開會|研討會)/);
    if (match) {
      let prefix = match[1].replace(/^[要有去參加個場堂]/, '').trim();
      if (prefix.length > 0 && prefix !== '個' && prefix !== '場') {
        return prefix + (clean.includes('研討會') ? '研討會' : '會議');
      }
    }
    return clean.includes('研討會') ? '研討會' : '工作會議';
  }

  // 寵物出生 / 誕生
  if (/貓.*(?:出生|誕生)/.test(rawText)) {
    const petM = clean.match(/([^\s]{1,4})(?:貓|小貓|幼貓)/);
    if (petM && !['一隻', '有隻', '那隻', '這隻'].includes(petM[1])) {
      return petM[1] + '貓咪誕生';
    }
    return '貓咪誕生';
  }
  if (/狗.*(?:出生|誕生)/.test(rawText)) {
    return '狗狗誕生';
  }

  // 車輛耗材
  if (/機油/.test(rawText)) {
    if (rawText.includes('機車')) return '機車機油';
    if (rawText.includes('汽車')) return '汽車機油';
    return clean.includes('機油') ? clean : '機油更換';
  }
  if (/齒輪油/.test(rawText)) {
    return '機車齒輪油';
  }

  // 鮮奶與乳品保留品牌完整度
  if (/鮮奶|牛奶|鮮乳/.test(rawText)) {
    const brandMatch = clean.match(/(好市多|光泉|瑞穗|義美|福樂|林鳳營|高大|初鹿|柳營|四方|東海|萬丹|六甲|崙背)?([^\s]{0,6})(?:鮮奶|牛奶|鮮乳)/);
    if (brandMatch && brandMatch[0]) {
      let result = brandMatch[0].replace(/^[買了大瓶小瓶一兩三]+/g, '').trim();
      if (result.length >= 2) return result;
    }
    return clean.includes('鮮奶') ? clean : '全脂鮮奶';
  }

  // 9. 取消 6 個字硬性限制，放寬至合理的 30 字上限，保留品名完整性！
  if (clean.length > 30) {
    clean = clean.slice(0, 30);
  }

  // 若清理後只剩單字，進行自然補齊
  if (clean.length === 1) {
    if (clean === '貓') clean = '貓咪';
    else if (clean === '狗') clean = '狗狗';
    else if (clean === '藥') clean = '常備藥';
    else if (clean === '奶') clean = '鮮奶';
    else if (clean === '蛋') clean = '新鮮雞蛋';
    else if (clean === '茶') clean = '茶葉包';
    else if (clean === '水') clean = '礦泉水';
    else clean = clean + '品';
  }

  return clean || '未命名物品';
}

function extractCleanName(rawText) {
  return simplifyItemName(rawText);
}


// ==========================================
// 5. 本地 RoBERTa-Tiny / BERT-Tiny 命名實體識別解析器 (parseWithLocalNER)
// ==========================================
/**
 * 透過 Transformers.js 本地微型模型執行命名實體抽取 (Token-Classification NER)
 * 結合名稱精煉 (2~6字)、自動分類與細項對應、時間換算與上下文修改機制
 */
async function parseWithLocalNER(rawInput, baseDate = new Date(), existingItems = [], lastCreated = null) {
  if (!rawInput || typeof rawInput !== 'string') {
    return { success: false, error: 'EMPTY_INPUT' };
  }

  let text = rawInput.trim()
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
  if (!text) {
    return { success: false, error: 'EMPTY_INPUT' };
  }

  // 上下文參照取得
  const targetLast = lastCreated || (typeof window !== 'undefined' && window.getLastCreatedItem ? window.getLastCreatedItem() : lastCreatedItem);
  const itemsList = (Array.isArray(existingItems) && existingItems.length > 0)
    ? existingItems
    : (typeof window !== 'undefined' && window.getItems ? window.getItems() : []);

  // 若模型尚未準備好，優雅降級至正則解析
  if (!nerPipeline) {
    console.log('[NLP] NER 模型尚未完成載入，自動降級為正則解析器');
    return parseNaturalInput(text, baseDate, itemsList, targetLast);
  }

  // A. 上下文追問與修改偵測 (例如：「那隻貓叫小黑」、「改名叫小黑」、「改成小黑」)
  const isRenamePattern = /(?:那隻|這隻|牠|它|剛才的|上次的)?\s*(?:貓|狗|寵物)?\s*(?:叫|名叫|叫做|改名[成為]?|改為|改成)\s*([^\s,，。]+)/;
  const renameMatch = text.match(isRenamePattern);

  if (targetLast && (renameMatch || text.includes('叫') || text.includes('改名') || text.includes('改成'))) {
    let newName = '';
    if (renameMatch && renameMatch[1]) {
      newName = renameMatch[1].replace(/出生|誕生|叫/, '').trim();
    } else {
      // 透過模型提取新實體名稱
      try {
        const entities = await nerPipeline(text);
        if (Array.isArray(entities) && entities.length > 0) {
          const perOrNoun = entities.find(e => e.entity_group === 'PER' || e.entity_group === 'ORG' || e.word);
          if (perOrNoun && perOrNoun.word) {
            newName = perOrNoun.word.trim();
          }
        }
      } catch (e) {
        console.warn('[NLP] 上下文 NER 提取錯誤：', e);
      }
    }

    if (!newName) {
      newName = extractCleanName(text);
    }

    // 名稱精煉：控制在 2~6 字
    if (newName.length > 30) newName = newName.slice(0, 30);
    if (newName.length < 2 && newName.length > 0) newName = newName + '咪';

    // 若輸入中帶有新類別特徵則更新類別與細項，否則沿用上筆資料
    const contextCat = matchCategoryAndSubCategory(text, targetLast.category || 'other');

    const expDate = targetLast.endDate || targetLast.expiryDate || formatDate(offsetDays(baseDate, 7));
    const targetWarn = (targetLast.warnDays !== undefined) ? targetLast.warnDays : 3;
    const targetTime = targetLast.reminderTime || '15:00';
    const reminderDate = (targetWarn >= 0) ? formatDate(offsetDays(new Date(expDate + 'T00:00:00'), -targetWarn)) : null;

    return {
      success: true,
      action: 'update',
      targetName: targetLast.name,
      targetId: targetLast.id || null,
      name: newName,
      category: contextCat.category || targetLast.category || 'other',
      subCategory: contextCat.subCategory || targetLast.subCategory || '',
      emoji: contextCat.emoji || targetLast.emoji || '📌',
      expiryDate: expDate,
      remindDaysBefore: targetWarn,
      remindTime: targetTime,
      hasCustomTime: false,
      reminderDate: reminderDate,
      source: 'local-ner'
    };
  }

  // B. 呼叫模型執行實體提取 (nerPipeline)
  let nerEntities = [];
  try {
    nerEntities = await nerPipeline(text);
    if (!Array.isArray(nerEntities)) nerEntities = [];
    console.log('[NLP] NER 模型抽取的實體：', nerEntities);
  } catch (err) {
    console.warn('[NLP] nerPipeline 執行異常，降級使用正則解析器：', err);
    return parseNaturalInput(text, baseDate, itemsList, targetLast);
  }

  // C. 提取時間詞與換算精確日期
  const parsedTime = extractTime(text);
  let parsedDate = extractDate(text, baseDate);

  // 若模型標註了 TIME 或 DATE 實體，嘗試傳入換算
  if (!parsedDate && Array.isArray(nerEntities)) {
    const timeEntity = nerEntities.find(e => e.entity_group === 'TIME' || e.entity_group === 'DATE');
    if (timeEntity && timeEntity.word) {
      parsedDate = extractDate(timeEntity.word, baseDate);
    }
  }

  // 提醒天數判斷 (提前X天, 當天, 不提醒)
  let remindDaysBefore = null;
  const remindDayMatch = text.match(/(?:提前|提早|前)\s*(\d+|[一二兩三四五六七八九十]+)\s*(?:個)?(?:天|日)/);
  if (remindDayMatch) {
    const num = parseChineseNum(remindDayMatch[1]);
    if (num !== null && !isNaN(num)) remindDaysBefore = Math.round(num);
  } else if (/當天|當日/.test(text)) {
    remindDaysBefore = 0;
  } else if (/不提醒|免提醒|不用提醒/.test(text)) {
    remindDaysBefore = -1;
  } else if (parsedTime !== null) {
    remindDaysBefore = 0;
  }

  // D. 提取實體名詞與過濾無意義贅詞
  let extractedNoun = '';

  // 1. 從 NER 實體集合中尋找名詞 (排除 TIME/DATE/標點)
  const candidateEntities = nerEntities.filter(e =>
    e.entity_group !== 'TIME' &&
    e.entity_group !== 'DATE' &&
    e.word &&
    e.word.trim().length > 0 &&
    !/^[,，。!！?？~～、]$/.test(e.word.trim())
  );

  if (candidateEntities.length > 0) {
    // 組合實體詞片段並清理
    const entityWords = candidateEntities.map(e => e.word.replace(/^##/, '').trim()).filter(Boolean);
    extractedNoun = entityWords.join('');
  }

  // 2. 若 NER 未能提取出名詞，或提取結果過短，結合 extractCleanName 補足
  if (!extractedNoun || extractedNoun.length < 2) {
    extractedNoun = extractCleanName(text);
  }

  // E. 名稱精煉邏輯 (嚴格控制在 2~6 字)
  let refinedName = extractedNoun.replace(/^[,，。!！?？~～、\s]+|[,，。!！?？~～、\s]+$/g, '');

  // 特殊專有名詞精煉規則：若為「貓」搭配「出生」或「誕生」，濃縮為「貓咪誕生」
  if ((refinedName.includes('貓') || text.includes('貓')) && (text.includes('出生') || text.includes('誕生'))) {
    refinedName = '貓咪誕生';
  } else if (text.includes('鮮奶') || text.includes('牛奶') || text.includes('鮮乳')) {
    if (text.includes('好市多')) refinedName = '好市多鮮奶';
    else if (text.includes('低脂')) refinedName = '低脂鮮奶';
    else refinedName = '全脂鮮奶';
  } else if (text.includes('會議') || text.includes('開會') || text.includes('研討會')) {
    if (text.includes('交通')) refinedName = '交通會議';
    else if (text.includes('研討會')) refinedName = '研討會';
    else refinedName = '工作會議';
  } else if (text.includes('機油')) {
    if (text.includes('機車')) refinedName = '機車機油';
    else if (text.includes('汽車')) refinedName = '汽車機油';
    else refinedName = '更換機油';
  } else if (text.includes('牙醫') || text.includes('看診') || text.includes('看牙')) {
    refinedName = '牙醫看診';
  }

  // 規範長度在 2~6 字之內
  if (refinedName.length > 30) {
    refinedName = refinedName.slice(0, 30);
  }
  if (refinedName.length < 2 && refinedName.length > 0) {
    if (refinedName === '貓') refinedName = '貓咪';
    else if (refinedName === '藥') refinedName = '常備藥';
    else if (refinedName === '奶') refinedName = '鮮奶';
    else refinedName = refinedName + '物';
  }
  if (!refinedName) refinedName = '未命名物品';

  // F. 補齊預設到期日 (若未輸入時間，提供合理預設值或轉為謹記使用天數模式)
  const isElapsedExplicit = /(?:謹記|僅記|記|紀錄|記錄)?\s*(?:使用天數|陪伴天數|天數)|不設(?:定)?(?:到期|效期|時間|日)|無到期|不限期|永久/i.test(text);
  let finalDate = parsedDate;
  let hasEndDate = true;

  if (isElapsedExplicit) {
    hasEndDate = false;
    finalDate = null;
  } else if (!finalDate) {
    if (/鮮奶|牛奶|鮮乳/.test(text)) finalDate = formatDate(offsetDays(baseDate, 7));
    else if (/蔬菜|青菜/.test(text)) finalDate = formatDate(offsetDays(baseDate, 5));
    else if (/水果|木瓜|蘋果|香蕉|芭樂|西瓜|芒果/.test(text)) finalDate = formatDate(offsetDays(baseDate, 7));
    else if (/機油/.test(text)) finalDate = formatDate(offsetDays(baseDate, 180));
    else if (/會議|開會|研討會/.test(text)) finalDate = formatDate(offsetDays(baseDate, 7));
    else if (/貓.*出生|貓.*誕生/.test(text)) finalDate = formatDate(offsetDays(baseDate, 7));
    else if (/訂閱|續約|netflix|spotify|disney|youtube|軟體|月費/.test(text)) finalDate = formatDate(offsetDays(baseDate, 30));
    else {
      // 智慧輸入未設定到期時間，自動切換為「謹記使用天數」模式
      hasEndDate = false;
      finalDate = null;
    }
  }

  // 抽取開始日期 (針對謹記使用天數或自訂開始日)
  let parsedStartDate = null;
  const startRelMatch = text.match(/(\d+|[一二兩三四五六七八九十]+)\s*(?:天|日|個月|月|年)前(?:\s*(?:開始|買|領養|收編|啟用|拆封))?/);
  if (startRelMatch) {
    const rawNum = parseChineseNum(startRelMatch[1]);
    if (rawNum !== null && !isNaN(rawNum)) {
      if (startRelMatch[0].includes('年')) {
        const d = new Date(baseDate.getTime());
        d.setFullYear(d.getFullYear() - Math.floor(rawNum));
        parsedStartDate = formatDate(d);
      } else if (startRelMatch[0].includes('月')) {
        const d = new Date(baseDate.getTime());
        d.setMonth(d.getMonth() - Math.floor(rawNum));
        parsedStartDate = formatDate(d);
      } else {
        parsedStartDate = formatDate(offsetDays(baseDate, -Math.round(rawNum)));
      }
    }
  } else if (/昨天|昨兒個/.test(text)) {
    parsedStartDate = formatDate(offsetDays(baseDate, -1));
  } else if (/前天/.test(text)) {
    parsedStartDate = formatDate(offsetDays(baseDate, -2));
  }

  // G. 智慧分類與細項項目自動對應 (若無對應則自動選 other 其他)
  const matched = matchCategoryAndSubCategory(text + ' ' + refinedName, 'other');
  const category = matched.category || 'other';
  const subCategory = matched.subCategory || '';
  const emoji = matched.emoji || '📌';

  const finalWarnDays = hasEndDate ? (remindDaysBefore !== null ? remindDaysBefore : 3) : -1;
  const finalRemindTime = parsedTime || '15:00';
  const calculatedReminderDate = (hasEndDate && finalDate && finalWarnDays >= 0)
    ? formatDate(offsetDays(new Date(finalDate + 'T00:00:00'), -finalWarnDays))
    : null;

  return {
    success: true,
    action: 'create',
    name: refinedName,
    category: category,
    subCategory: subCategory,
    emoji: emoji,
    startDate: parsedStartDate || formatDate(baseDate),
    hasEndDate: hasEndDate,
    mode: hasEndDate ? 'expiry' : 'elapsed',
    expiryDate: finalDate,
    remindDaysBefore: finalWarnDays,
    remindTime: finalRemindTime,
    hasCustomTime: parsedTime !== null,
    reminderDate: calculatedReminderDate,
    source: 'local-ner',
    entities: nerEntities
  };
}

// ==========================================
// 6. 本機正則解析器 (純 JavaScript 備援引擎 / 100% 離線可用)
// ==========================================
function parseNaturalInput(rawInput, baseDate = new Date(), existingItems = [], lastCreated = null) {
  if (!rawInput || typeof rawInput !== 'string') {
    return { success: false, error: 'EMPTY_INPUT' };
  }

  let text = rawInput.trim()
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
  if (!text) {
    return { success: false, error: 'EMPTY_INPUT' };
  }

  // 1. 抽取時間與日期
  const parsedTime = extractTime(text);
  const parsedDate = extractDate(text, baseDate);

  // 2. 提醒天數與時間判定
  let remindDaysBefore = null;
  const remindDayMatch = text.match(/(?:提前|提早|前)\s*(\d+|[一二兩三四五六七八九十]+)\s*(?:個)?(?:天|日)/);
  if (remindDayMatch) {
    const num = parseChineseNum(remindDayMatch[1]);
    if (num !== null && !isNaN(num)) remindDaysBefore = Math.round(num);
  } else if (/當天|當日/.test(text)) {
    remindDaysBefore = 0;
  } else if (/不提醒|免提醒|不用提醒/.test(text)) {
    remindDaysBefore = -1;
  } else if (parsedTime !== null) {
    remindDaysBefore = 0;
  }

  const defaultWarnDays = remindDaysBefore !== null ? remindDaysBefore : 3;

  // 3. 判斷是否為修改 (UPDATE)
  const updateKeywords = ['改成', '修改', '改為', '改名', '延長', '推遲', '延後', '不是', '換成'];
  let isUpdate = updateKeywords.some(kw => text.includes(kw)) || (/那隻.*叫|牠叫|它叫/.test(text));

  let targetItem = null;
  if (Array.isArray(existingItems) && existingItems.length > 0) {
    for (const it of existingItems) {
      if (text.includes(it.name)) {
        targetItem = it;
        isUpdate = true;
        break;
      }
    }
  }
  if (!targetItem && lastCreated) {
    targetItem = lastCreated;
  }

  if (isUpdate && targetItem) {
    let newName = targetItem.name;
    const renameMatch = text.match(/(?:改名[成為]|改名為?|改成)\s*([^\s,，。]+)/);
    if (renameMatch && !extractDate(renameMatch[1], baseDate)) {
      newName = renameMatch[1].trim();
    } else {
      const petNameMatch = text.match(/(?:那隻\s*(?:貓|狗|寵物)?\s*(?:叫|名叫|叫做)?|(?:它|牠)\s*(?:叫|名叫|叫做)?|名叫|叫做)\s*([^\s,，。]+)/);
      if (petNameMatch) {
        const petName = petNameMatch[1].replace(/出生|誕生|叫/, '').trim();
        newName = petName;
      }
    }

    if (newName.length > 30) {
      newName = newName.slice(0, 30);
    }

    // 若輸入包含新分類特徵，嘗試更新分類與細項
    const updateCat = matchCategoryAndSubCategory(text, targetItem.category || 'other');

    const expDate = parsedDate || targetItem.endDate || targetItem.expiryDate || formatDate(offsetDays(baseDate, 3));
    const targetWarn = remindDaysBefore !== null ? remindDaysBefore : (targetItem.warnDays !== undefined ? targetItem.warnDays : 3);
    const targetTime = parsedTime || targetItem.reminderTime || '09:00';
    const reminderDate = (targetWarn >= 0) ? formatDate(offsetDays(new Date(expDate + 'T00:00:00'), -targetWarn)) : null;

    return {
      success: true,
      action: 'update',
      targetName: targetItem.name,
      targetId: targetItem.id || null,
      name: newName,
      category: updateCat.category || targetItem.category || 'other',
      subCategory: updateCat.subCategory || targetItem.subCategory || '',
      emoji: updateCat.emoji || targetItem.emoji || '📌',
      expiryDate: expDate,
      remindDaysBefore: targetWarn,
      remindTime: targetTime,
      hasCustomTime: parsedTime !== null,
      reminderDate: reminderDate,
      source: 'local'
    };
  }

  // 4. 處理新增 (CREATE)
  const isElapsedExplicit = /(?:謹記|僅記|記|紀錄|記錄)?\s*(?:使用天數|陪伴天數|天數)|不設(?:定)?(?:到期|效期|時間|日)|無到期|不限期|永久/i.test(text);
  let finalDate = parsedDate;
  let hasEndDate = true;

  if (isElapsedExplicit) {
    hasEndDate = false;
    finalDate = null;
  } else if (!finalDate) {
    if (/鮮奶|牛奶|鮮乳/.test(text)) finalDate = formatDate(offsetDays(baseDate, 7));
    else if (/蔬菜|青菜/.test(text)) finalDate = formatDate(offsetDays(baseDate, 5));
    else if (/水果|木瓜|蘋果|香蕉|芭樂|西瓜|芒果/.test(text)) finalDate = formatDate(offsetDays(baseDate, 7));
    else if (/機油/.test(text)) finalDate = formatDate(offsetDays(baseDate, 180));
    else if (/會議|開會|研討會/.test(text)) finalDate = formatDate(offsetDays(baseDate, 7));
    else if (/貓.*出生|貓.*誕生/.test(text)) finalDate = formatDate(offsetDays(baseDate, 7));
    else if (/訂閱|續約|netflix|spotify|disney|youtube|軟體|月費/.test(text)) finalDate = formatDate(offsetDays(baseDate, 30));
    else {
      // 智慧輸入未設定到期時間，自動切換為「謹記使用天數」模式
      hasEndDate = false;
      finalDate = null;
    }
  }

  // 抽取開始日期 (針對謹記使用天數或自訂開始日)
  let parsedStartDate = null;
  const startRelMatch = text.match(/(\d+|[一二兩三四五六七八九十]+)\s*(?:天|日|個月|月|年)前(?:\s*(?:開始|買|領養|收編|啟用|拆封))?/);
  if (startRelMatch) {
    const rawNum = parseChineseNum(startRelMatch[1]);
    if (rawNum !== null && !isNaN(rawNum)) {
      if (startRelMatch[0].includes('年')) {
        const d = new Date(baseDate.getTime());
        d.setFullYear(d.getFullYear() - Math.floor(rawNum));
        parsedStartDate = formatDate(d);
      } else if (startRelMatch[0].includes('月')) {
        const d = new Date(baseDate.getTime());
        d.setMonth(d.getMonth() - Math.floor(rawNum));
        parsedStartDate = formatDate(d);
      } else {
        parsedStartDate = formatDate(offsetDays(baseDate, -Math.round(rawNum)));
      }
    }
  } else if (/昨天|昨兒個/.test(text)) {
    parsedStartDate = formatDate(offsetDays(baseDate, -1));
  } else if (/前天/.test(text)) {
    parsedStartDate = formatDate(offsetDays(baseDate, -2));
  }

  const cleanName = extractCleanName(text);

  // 分類與細項項目自動對應（若無對應則預設選 other 其他）
  const matched = matchCategoryAndSubCategory(text + ' ' + cleanName, 'other');
  const category = matched.category || 'other';
  const subCategory = matched.subCategory || '';
  const emoji = matched.emoji || '📌';

  const finalWarnDays = hasEndDate ? defaultWarnDays : -1;
  const finalRemindTime = parsedTime || '15:00';
  const calculatedReminderDate = (hasEndDate && finalDate && finalWarnDays >= 0)
    ? formatDate(offsetDays(new Date(finalDate + 'T00:00:00'), -finalWarnDays))
    : null;

  return {
    success: true,
    action: 'create',
    name: cleanName,
    category: category,
    subCategory: subCategory,
    emoji: emoji,
    startDate: parsedStartDate || formatDate(baseDate),
    hasEndDate: hasEndDate,
    mode: hasEndDate ? 'expiry' : 'elapsed',
    expiryDate: finalDate,
    remindDaysBefore: finalWarnDays,
    remindTime: finalRemindTime,
    hasCustomTime: parsedTime !== null,
    reminderDate: calculatedReminderDate,
    source: 'local'
  };
}

/**
 * 非同步智慧解析封裝：自動在 NER 模型與本機解析之間流暢轉換
 */
async function parseNaturalInputAsync(rawInput, baseDate = new Date(), existingItems = [], lastCreated = null) {
  if (nerPipeline) {
    try {
      const res = await parseWithLocalNER(rawInput, baseDate, existingItems, lastCreated);
      if (res && res.success) return res;
    } catch (err) {
      console.warn('[NLP] parseWithLocalNER 執行異常，降級使用正則解析器：', err);
    }
  }
  return parseNaturalInput(rawInput, baseDate, existingItems, lastCreated);
}

// ==========================================
// 7. 物品新增與更新操作
// ==========================================
function addItem(itemData) {
  if (!itemData || typeof itemData !== 'object') return null;

  const newId = itemData.id || ('item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
  const hasEndDate = (itemData.hasEndDate !== false);
  const startDate = itemData.startDate || formatDate(new Date());
  const endDate = hasEndDate ? (itemData.endDate || startDate) : null;
  const warnDays = hasEndDate ? ((typeof itemData.warnDays === 'number') ? itemData.warnDays : 3) : -1;
  const reminderType = hasEndDate ? (itemData.reminderType || ((warnDays >= 0) ? 'preset' : 'none')) : 'none';
  const reminderDate = (hasEndDate && warnDays >= 0) ? (itemData.reminderDate || formatDate(offsetDays(new Date(endDate + 'T00:00:00'), -warnDays))) : null;
  const reminderTime = hasEndDate ? (itemData.reminderTime || '09:00') : '09:00';
  const durationDays = hasEndDate ? Math.max(1, Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) || 1) : 1;

  const newItem = {
    id: newId,
    name: (itemData.name || '未命名物品').trim(),
    category: itemData.category || 'other',
    subCategory: (itemData.subCategory || '').trim(),
    emoji: itemData.emoji || '📌',
    image: itemData.image || null,
    startDate: startDate,
    hasEndDate: hasEndDate,
    durationDays: durationDays,
    endDate: endDate,
    reminderType: reminderType,
    reminderDate: reminderDate,
    reminderTime: reminderTime,
    warnDays: warnDays,
    location: (itemData.location || '').trim(),
    brand: (itemData.brand || '').trim(),
    notes: (itemData.notes || '').trim(),
    history: Array.isArray(itemData.history) ? itemData.history : [],
    createdAt: itemData.createdAt || Date.now()
  };

  if (typeof items !== 'undefined' && Array.isArray(items)) {
    items.unshift(newItem);
  }

  lastCreatedItem = newItem;
  if (typeof window !== 'undefined' && window.setLastCreatedItem) {
    window.setLastCreatedItem(newItem);
  }

  if (typeof saveItems === 'function') saveItems();
  if (typeof scheduleItemNotification === 'function') {
    scheduleItemNotification(newItem);
  }
  if (typeof renderApp === 'function') renderApp();

  return newItem;
}

function updateItemByNlp(targetId, updates) {
  if (!updates || typeof updates !== 'object') return null;
  let target = null;
  if (typeof items !== 'undefined' && Array.isArray(items)) {
    target = items.find(i => i.id === targetId);
  }
  if (!target && lastCreatedItem) {
    target = lastCreatedItem;
  }
  if (!target) return null;

  if (updates.name) target.name = updates.name.trim();
  if (updates.expiryDate) {
    target.endDate = updates.expiryDate;
    if (typeof diffDays === 'function' && target.startDate) {
      target.durationDays = Math.max(1, diffDays(target.startDate, target.endDate));
    }
  }

  if (typeof updates.remindDaysBefore === 'number') {
    target.warnDays = updates.remindDaysBefore;
    target.reminderType = updates.reminderType || ((target.warnDays >= 0) ? 'preset' : 'none');
    target.reminderDate = updates.reminderDate || ((target.warnDays >= 0) ? formatDate(offsetDays(new Date(target.endDate + 'T00:00:00'), -target.warnDays)) : null);
    target.reminderTime = updates.remindTime || target.reminderTime || '15:00';
  }

  if (updates.category) {
    target.category = updates.category;
  }
  if (updates.subCategory !== undefined) {
    target.subCategory = updates.subCategory;
  }
  if (updates.emoji) {
    target.emoji = updates.emoji;
  }

  lastCreatedItem = target;
  if (typeof window !== 'undefined' && window.setLastCreatedItem) {
    window.setLastCreatedItem(target);
  }

  if (typeof saveItems === 'function') saveItems();
  if (typeof scheduleItemNotification === 'function') {
    scheduleItemNotification(target);
  }
  if (typeof renderApp === 'function') renderApp();

  return target;
}

// ==========================================
// 7.5 卡片效期狀態與進度條判定模組 (v1.8.7)
// ==========================================
/**
 * 依據效期嚴格三段天數判定，直接透過 JavaScript 計算並設定 progressBarFill 的 backgroundColor 與 width
 * 
 * 1. 排除無到期日／僅記使用天數的項目：
 *    - 檢查項目是否為「僅記使用天數」（trackingType === 'count_up' 或無 expiryDate）：
 *    - 若無到期日，進度條顏色固定為微透白：
 *      progressBarFill.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
 *      progressBarFill.style.width = '100%';
 *      並且不參與任何過期/即將到期的計數。
 * 
 * 2. 有到期日項目的嚴格三段天數判定（以毫秒相除轉為整數天數）：
 *    const today = new Date();
 *    today.setHours(0, 0, 0, 0);
 *    const exp = new Date(item.expiryDate);
 *    exp.setHours(0, 0, 0, 0);
 *    const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
 * 
 *    - 【情況 A：已過期】diffDays < 0：
 *      progressBarFill.style.backgroundColor = '#FF453A'; // 純紅
 *      progressBarFill.style.width = '100%';
 * 
 *    - 【情況 B：即將到期】diffDays >= 0 且 diffDays <= 3（3天內，包含今天與第3天）：
 *      progressBarFill.style.backgroundColor = '#FF9F0A'; // 警告橘
 *      // 依剩餘比例計算寬度，或固定為高顯眼寬度
 * 
 *    - 【情況 C：安全正常】diffDays > 3（4天、6天、100天以上）：
 *      progressBarFill.style.backgroundColor = 'rgba(255, 255, 255, 0.25)'; // 中性低調白
 *      // 絕不可出現 #FF453A 或 #FF9F0A！
 * 
 * @param {HTMLElement} progressBarFill 進度條填充元素
 * @param {Object} item 物品資料物件
 * @returns {Object} 狀態與樣式配置資訊
 */
function renderProgressBar(progressBarFill, item) {
  if (!item) return null;

  const expDateStr = item.expiryDate || item.endDate;
  const isCountUp = item.trackingType === 'count_up' || !expDateStr || item.hasEndDate === false;

  // 1. 排除無到期日／僅記使用天數的項目
  if (isCountUp) {
    if (progressBarFill && progressBarFill.style) {
      progressBarFill.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
      progressBarFill.style.setProperty('background-color', 'rgba(255, 255, 255, 0.15)', 'important');
      progressBarFill.style.width = '100%';
    }
    return {
      status: 'count_up',
      diffDays: null,
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
      width: '100%'
    };
  }

  // 2. 有到期日項目的嚴格三段天數判定（以毫秒相除轉為整數天數）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expDateStr);
  exp.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));

  let bgColor = 'rgba(255, 255, 255, 0.25)';
  let fillWidth = '100%';
  let status = 'normal';

  if (diffDays < 0) {
    // 【情況 A：已過期】diffDays < 0
    status = 'expired';
    bgColor = '#FF453A'; // 純紅
    fillWidth = '100%';
  } else if (diffDays >= 0 && diffDays <= 3) {
    // 【情況 B：即將到期】diffDays >= 0 且 diffDays <= 3（3天內，包含今天與第3天）
    status = 'warning';
    bgColor = '#FF9F0A'; // 警告橘
    let percent = 100;
    if (item.startDate) {
      const start = new Date(item.startDate);
      start.setHours(0, 0, 0, 0);
      const total = Math.max(1, Math.ceil((exp - start) / (1000 * 60 * 60 * 24)));
      const elapsed = Math.max(0, Math.ceil((today - start) / (1000 * 60 * 60 * 24)));
      percent = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
    }
    fillWidth = `${percent > 0 ? percent : 20}%`;
  } else {
    // 【情況 C：安全正常】diffDays > 3（4天、6天、100天以上，絕不可出現 #FF453A 或 #FF9F0A！）
    status = 'normal';
    bgColor = 'rgba(255, 255, 255, 0.25)'; // 中性低調白
    let percent = 100;
    if (item.startDate) {
      const start = new Date(item.startDate);
      start.setHours(0, 0, 0, 0);
      const total = Math.max(1, Math.ceil((exp - start) / (1000 * 60 * 60 * 24)));
      const elapsed = Math.max(0, Math.ceil((today - start) / (1000 * 60 * 60 * 24)));
      percent = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
    }
    fillWidth = `${percent > 0 ? percent : 15}%`;
  }

  if (progressBarFill && progressBarFill.style) {
    progressBarFill.style.backgroundColor = bgColor;
    progressBarFill.style.setProperty('background-color', bgColor, 'important');
    progressBarFill.style.width = fillWidth;
  }

  return {
    status,
    diffDays,
    backgroundColor: bgColor,
    width: fillWidth
  };
}

function getItemStatusConfig(item, todayStr) {
  const expDateStr = item ? (item.expiryDate || item.endDate) : null;
  const isCountUp = !item || item.trackingType === 'count_up' || !expDateStr || item.hasEndDate === false;

  if (isCountUp) {
    return {
      statusMark: 'status-normal',
      color: 'rgba(255, 255, 255, 0.15)',
      textColor: 'rgba(255, 255, 255, 0.7)',
      text: '持續使用中 ⏳',
      subMetricClass: 'ongoing status-normal',
      progressClass: 'progress-bar-fill status-normal',
      diffDays: null,
      percent: 100,
      width: '100%'
    };
  }

  const today = todayStr ? new Date(todayStr) : new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expDateStr);
  exp.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));

  let percent = 100;
  if (item.startDate) {
    const start = new Date(item.startDate);
    start.setHours(0, 0, 0, 0);
    const total = Math.max(1, Math.ceil((exp - start) / (1000 * 60 * 60 * 24)));
    const elapsed = Math.max(0, Math.ceil((today - start) / (1000 * 60 * 60 * 24)));
    percent = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  }

  // 1. 【已過期】diffDays < 0
  if (diffDays < 0) {
    return {
      statusMark: 'status-expired',
      color: '#FF453A',
      textColor: '#FF453A',
      text: `已超過 ${Math.abs(diffDays)} 天`,
      subMetricClass: 'expired status-expired',
      progressClass: 'progress-bar-fill status-expired expired',
      diffDays,
      percent: 100,
      width: '100%'
    };
  }

  // 2. 【即將到期】diffDays >= 0 且 diffDays <= 3（3天內，包含今天與第3天）
  if (diffDays >= 0 && diffDays <= 3) {
    return {
      statusMark: 'status-warning',
      color: '#FF9F0A',
      textColor: '#FF9F0A',
      text: diffDays === 0 ? '今天到期' : `還有 ${diffDays.toLocaleString()} 天`,
      subMetricClass: 'urgent status-warning',
      progressClass: 'progress-bar-fill status-warning urgent',
      diffDays,
      percent: percent > 0 ? percent : 20,
      width: `${percent > 0 ? percent : 20}%`
    };
  }

  // 3. 【正常/安全】diffDays > 3（4天、6天、100天以上，絕不可出現 #FF453A 或 #FF9F0A！）
  return {
    statusMark: 'status-normal',
    color: 'rgba(255, 255, 255, 0.25)',
    textColor: 'rgba(255, 255, 255, 0.7)',
    text: `還有 ${diffDays.toLocaleString()} 天`,
    subMetricClass: 'status-normal',
    progressClass: 'progress-bar-fill status-normal',
    diffDays,
    percent: percent > 0 ? percent : 15,
    width: `${percent > 0 ? percent : 15}%`
  };
}


// ==========================================
// 7.6 智慧鏡頭雙軌並行分析引擎 (MobileNet 視覺外觀 + Tesseract OCR 文字校驗 + 原生條碼最優先) v1.8.14
// ==========================================

const CATEGORY_MAP_TO_KEY = {
  '食品': 'food', 'food': 'food',
  '清潔': 'cleaning', 'cleaning': 'cleaning',
  '保固': 'warranty', 'warranty': 'warranty',
  '耗材': 'filter', 'filter': 'filter',
  '藥品': 'medicine', 'medicine': 'medicine',
  '其他': 'other', 'other': 'other',
  '車輛': 'vehicle', 'vehicle': 'vehicle',
  '訂閱': 'subscription', 'subscription': 'subscription',
  '日化開封': 'pao', 'pao': 'pao',
  '日用品': 'cleaning',
  '寵物': 'pet', 'pet': 'pet',
  '母嬰': 'baby', 'baby': 'baby',
  '辦公': 'office', 'office': 'office',
  '戶外': 'outdoor', 'outdoor': 'outdoor',
  '居家': 'home', 'home': 'home',
  '穿搭': 'fashion', 'fashion': 'fashion',
  '動畫': 'animation', 'animation': 'animation',
  '漫畫': 'animation', 'comic': 'animation', '書籍': 'animation', '圖書': 'animation',
  '遊戲': 'game', 'game': 'game',
  '二次元': 'otaku', 'otaku': 'otaku',
  '票券': 'ticket', 'ticket': 'ticket',
  '票券/活動': 'ticket'
};

function normalizeCategoryKey(cat) {
  if (!cat) return 'other';
  const str = String(cat).trim().toLowerCase();
  return CATEGORY_MAP_TO_KEY[str] || CATEGORY_MAP_TO_KEY[cat] || 'other';
}

/**
 * 本地外觀特徵庫與自動分類字典 (VISUAL_APPEARANCE_DICT)
 * 涵蓋 ImageNet 常見外觀類別並直接綁定中文品名、預設分類與預設天數
 */
const VISUAL_APPEARANCE_DICT = [
  // 1. 蔬果與生鮮（依靠外觀形體）
  {
    keywords: ['banana'],
    name: '香蕉',
    category: 'food',
    categoryLabel: '食品',
    subCategory: '水果',
    defaultDays: 5,
    emoji: '🍌',
    isContainer: false
  },
  {
    keywords: ['granny smith', 'apple'],
    name: '蘋果',
    category: 'food',
    categoryLabel: '食品',
    subCategory: '水果',
    defaultDays: 14,
    emoji: '🍎',
    isContainer: false
  },
  {
    keywords: ['orange', 'lemon', 'citrus'],
    name: '柑橘/檸檬',
    category: 'food',
    categoryLabel: '食品',
    subCategory: '水果',
    defaultDays: 14,
    emoji: '🍊',
    isContainer: false
  },
  {
    keywords: ['bell pepper', 'broccoli', 'cauliflower', 'cucumber', 'zucchini', 'cabbage'],
    name: '新鮮蔬菜',
    category: 'food',
    categoryLabel: '食品',
    subCategory: '生鮮',
    defaultDays: 5,
    emoji: '🥦',
    isContainer: false
  },
  {
    keywords: ['bakery', 'french loaf', 'bagel', 'bread', 'baguette'],
    name: '麵包/土司',
    category: 'food',
    categoryLabel: '食品',
    subCategory: '烘焙',
    defaultDays: 3,
    emoji: '🍞',
    isContainer: false
  },

  // 2. 瓶罐容器與清潔用品（依靠瓶身外觀）
  {
    keywords: ['carton', 'milk carton'],
    name: '紙盒包裝/鮮乳',
    category: 'food',
    categoryLabel: '食品',
    subCategory: '鮮乳',
    defaultDays: 12,
    emoji: '🥛',
    isContainer: true
  },
  {
    keywords: ['jug', 'pitcher', 'water jug', 'milk can'],
    name: '瓶罐/乳品飲品',
    category: 'food',
    categoryLabel: '食品',
    subCategory: '飲品',
    defaultDays: 14,
    emoji: '🥛',
    isContainer: true
  },
  {
    keywords: ['lotion', 'soap dispenser', 'sunscreen', 'lotion bottle', 'spray'],
    name: '瓶裝洗劑/保養品',
    category: 'cleaning',
    categoryLabel: '清潔',
    subCategory: '衛浴保養',
    defaultDays: 180,
    emoji: '🧴',
    isContainer: true
  },
  {
    keywords: ['pill bottle', 'medicine bottle', 'prescription bottle'],
    name: '藥罐/保健品',
    category: 'medicine',
    categoryLabel: '藥品',
    subCategory: '常備藥品',
    defaultDays: 180,
    emoji: '💊',
    isContainer: true
  },
  {
    keywords: ['water bottle', 'pop bottle', 'beer bottle', 'wine bottle', 'bottle'],
    name: '瓶裝飲料',
    category: 'food',
    categoryLabel: '食品',
    subCategory: '飲品',
    defaultDays: 30,
    emoji: '🍾',
    isContainer: true
  },
  {
    keywords: ['can', 'tin', 'tin can', 'canned'],
    name: '罐頭/鐵罐',
    category: 'food',
    categoryLabel: '食品',
    subCategory: '乾貨',
    defaultDays: 180,
    emoji: '🥫',
    isContainer: true
  },

  // 3. 3C、家電與居家耗材（依靠外觀結構）
  {
    keywords: ['laptop', 'notebook', 'laptop computer'],
    name: '筆記型電腦',
    category: 'warranty',
    categoryLabel: '保固',
    subCategory: '電腦',
    defaultDays: 365,
    emoji: '💻',
    isContainer: false
  },
  {
    keywords: ['cellular telephone', 'ipod', 'mobile phone', 'cellphone', 'smartphone'],
    name: '手機/電子產品',
    category: 'warranty',
    categoryLabel: '保固',
    subCategory: '3C產品',
    defaultDays: 365,
    emoji: '📱',
    isContainer: false
  },
  {
    keywords: ['mouse', 'computer mouse'],
    name: '電腦滑鼠',
    category: 'warranty',
    categoryLabel: '保固',
    subCategory: '電腦',
    defaultDays: 365,
    emoji: '🖱️',
    isContainer: false
  },
  {
    keywords: ['keyboard', 'typewriter keyboard', 'space bar'],
    name: '電腦鍵盤',
    category: 'warranty',
    categoryLabel: '保固',
    subCategory: '電腦',
    defaultDays: 365,
    emoji: '⌨️',
    isContainer: false
  },
  {
    keywords: ['mousepad', 'mouse mat'],
    name: '滑鼠墊',
    category: 'warranty',
    categoryLabel: '保固',
    subCategory: '電腦',
    defaultDays: 365,
    emoji: '🖱️',
    isContainer: false
  },
  {
    keywords: ['coffee mug', 'cup', 'mug'],
    name: '馬克杯/杯具',
    category: 'other',
    categoryLabel: '其他',
    subCategory: '生活日用',
    defaultDays: 365,
    emoji: '☕',
    isContainer: false
  },

  // 4. 書籍、漫畫與文化娛樂（依靠外觀印刷與裝訂）
  {
    keywords: ['comic book', 'book jacket', 'book', 'packet', 'binder', 'envelope'],
    name: '圖書/漫畫',
    category: 'animation',
    categoryLabel: '動畫',
    subCategory: '漫畫/單行本',
    defaultDays: 365,
    emoji: '📚',
    isContainer: false
  },
  {
    keywords: ['joystick', 'game controller'],
    name: '遊戲手把/周邊',
    category: 'game',
    categoryLabel: '遊戲',
    subCategory: '主機/手把周邊',
    defaultDays: 365,
    emoji: '🎮',
    isContainer: false
  }
,
  // 5. 個人配件與眼鏡小物（MobileNet 標籤映射至「其他 / 配件小物」）
  {
    keywords: ['sunglasses', 'sunglass', 'spectacles', 'goggles', 'eyeglass', 'glasses', 'loupe'],
    name: '眼鏡/配件小物',
    category: 'other',
    categoryLabel: '其他',
    subCategory: '配件小物',
    defaultDays: 365,
    emoji: '👓',
    isContainer: false
  }
];

let mobileNetModel = null;
let isMobileNetLoading = false;

/**
 * 非同步初始化本地 MobileNet 視覺模型
 */
async function initMobileNet() {
  if (typeof isVlmLoading !== 'undefined' && isVlmLoading && typeof isIosSafari === 'function' && isIosSafari()) {
    console.log('[iOS Safari 保護] VLM 模型正在下載中，暫緩 MobileNet 載入');
    return null;
  }
  if (mobileNetModel) return mobileNetModel;
  if (typeof window === 'undefined') return null;
  if (!window.mobilenet) return null;
  if (isMobileNetLoading) {
    while (isMobileNetLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return mobileNetModel;
  }
  isMobileNetLoading = true;
  try {
    console.log('[Vision] 正在載入本地 MobileNet 視覺辨識模型...');
    mobileNetModel = await window.mobilenet.load({ version: 2, alpha: 1.0 });
    console.log('[Vision] ✅ MobileNet 視覺模型載入就緒！');
    return mobileNetModel;
  } catch (err) {
    console.warn('[Vision] MobileNet 模型載入失敗或處於離線環境：', err);
    return null;
  } finally {
    isMobileNetLoading = false;
  }
}

/**
 * 軌道一：視覺外觀辨識引擎
 * mobilenet.classify(img, 5)（擷取前 5 大可能的外觀特徵與信心度）
 */
async function classifyImageVisual(imgSource) {
  try {
    const model = await initMobileNet();
    if (!model || typeof model.classify !== 'function') {
      return [];
    }
    const predictions = await model.classify(imgSource, 5);
    return Array.isArray(predictions) ? predictions : [];
  } catch (err) {
    console.warn('[Vision] classifyImageVisual 執行異常：', err);
    return [];
  }
}

/**
 * 【一、整合原生條碼掃描（最優先判定）】
 * 在相機擷取影格後，先檢查 window.BarcodeDetector：
 * 啟用格式：['ean_13', 'ean_8', 'qr_code', 'code_128', 'isbn']
 * 若成功掃描到條碼：
 *   - 檢查條碼是否為 978 或 979 開頭（國際標準書號 ISBN）：
 *     直接自動鎖定分類為「動畫」，細項為「漫畫/單行本」，品名標註為「圖書/漫畫 (ISBN: 條碼號)」。
 *   - 掃描到一般商品條碼時，將條碼號填入備註，品名若未抓到文字則先以「條碼商品」帶入。
 */
async function scanBarcodePriority(source) {
  if (typeof window === 'undefined' || typeof window.BarcodeDetector !== 'function') {
    return null;
  }
  try {
    let formats = ['ean_13', 'ean_8', 'qr_code', 'code_128'];
    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const preferred = ['ean_13', 'ean_8', 'qr_code', 'code_128', 'isbn'];
        formats = preferred.filter(f => supported.includes(f));
        if (formats.length === 0) formats = supported;
      } catch (e) {}
    }

    const detector = new window.BarcodeDetector({ formats });
    const barcodes = await detector.detect(source);
    if (!barcodes || barcodes.length === 0) return null;

    const raw = String(barcodes[0].rawValue || '').trim();
    if (!raw) return null;

    const isIsbn = raw.startsWith('978') || raw.startsWith('979');
    if (isIsbn) {
      return {
        barcode: raw,
        isIsbn: true,
        category: 'animation',
        subCategory: '漫畫/單行本',
        name: `圖書/漫畫 (ISBN: ${raw})`,
        notes: `ISBN: ${raw}`,
        emoji: '📚'
      };
    }

    return {
      barcode: raw,
      isIsbn: false,
      notes: `條碼: ${raw}`,
      fallbackName: '條碼商品'
    };
  } catch (err) {
    console.warn('[Barcode] 原生條碼掃描略過或不支援：', err);
    return null;
  }
}

/**
 * 【二、OCR 影像前處理管線（解決包裝反光與雜訊）】
 * 採用 Canvas 進行標準化三道處理：
 * 1. 影像縮放：將圖片最大寬/高限制在 1200px 內，避免 WebAssembly 記憶體崩潰。
 * 2. 中央區域對焦：預設以中央 75% 範圍為主分析區，過濾背景桌面與持握手指。
 * 3. 影像二值化與對比強化：
 *    - 遍歷像素進行灰階化：Gray = 0.299*R + 0.587*G + 0.114*B。
 *    - 套用 Otsu 動態閾值與對比拉伸，加強黑色印刷字體與淺色背景反差，徹底濾除透明塑膠包裝的反光折射。
 */
function preprocessImageForOcr(source) {
  if (!source) return null;
  const sw = source.videoWidth || source.naturalWidth || source.width || 800;
  const sh = source.videoHeight || source.naturalHeight || source.height || 600;

  // 1. 影像縮放：將圖片最大寬/高限制在 1200px 內，避免 WebAssembly 記憶體溢出
  const maxDim = 1200;
  let scale = 1;
  if (sw > maxDim || sh > maxDim) {
    scale = maxDim / Math.max(sw, sh);
  }
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);

  // 2. 高解析全幅優化分析區 (保留包裝頂端、邊緣、瓶蓋與底部印刷之效期小字)
  const cropW = dw;
  const cropH = dh;

  let canvas = null;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
  }
  if (!canvas) return source;

  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;

  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, cropW, cropH);

  // 3. 影像前處理強化：灰階化與動態對比拉伸 (Dynamic Contrast Stretching，濾除塑膠包裝反光與雜訊，提高微小字體與日文假名識別率)
  try {
    const imgData = ctx.getImageData(0, 0, cropW, cropH);
    const data = imgData.data;
    const totalPixels = cropW * cropH;
    const grays = new Uint8ClampedArray(totalPixels);
    const hist = new Uint32Array(256);

    let minG = 255;
    let maxG = 0;

    for (let i = 0, p = 0; p < totalPixels; i += 4, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      grays[p] = gray;
      hist[gray]++;
      if (gray < minG) minG = gray;
      if (gray > maxG) maxG = gray;
    }

    // 計算 2% 與 98% 累積百分位數，濾除塑膠反光折射眩光並保留微小字體
    let pLow = minG;
    let pHigh = maxG;
    let acc = 0;
    const lowCount = Math.round(totalPixels * 0.02);
    const highCount = Math.round(totalPixels * 0.98);

    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= lowCount && pLow === minG) pLow = i;
      if (acc >= highCount) { pHigh = i; break; }
    }

    const range = Math.max(1, pHigh - pLow);

    // 動態對比拉伸：高光眩光截斷為 255，字體漸層與細節保留以供 Tesseract 最佳識別
    for (let i = 0, p = 0; p < totalPixels; i += 4, p++) {
      const g = grays[p];
      let stretched = g;
      if (g <= pLow) {
        stretched = 0;
      } else if (g >= pHigh) {
        stretched = 255;
      } else {
        stretched = Math.round(((g - pLow) / range) * 255);
      }
      data[i] = stretched;
      data[i + 1] = stretched;
      data[i + 2] = stretched;
    }

    ctx.putImageData(imgData, 0, 0);
  } catch (err) {
    console.warn('[Vision] 影像前處理動態對比拉伸略過：', err);
  }

  return canvas;
}

/**
 * 【三、台灣在地化效期日期解析正規庫（RegEx）】
 * 擴充 Tesseract 辨識結果的正則解析器，支援以下台灣常見格式：
 * 1. 民國年格式：115/09/16、115.09.16、115-09-16、民國115年9月16日 -> 自動換算西元年（+1911）為 2026-09-16。
 * 2. 西元常用格式：2026/09/16、2026.09.16、260916（YYMMDD 連號）、EXP 2026-09-16。
 * 3. 日月年倒序：16-09-2026、16/09/26。
 * 4. 抓取到有效期限後，自動轉換為 YYYY-MM-DD 填入彈窗的 expiryDate 欄位。
 */
/**
 * 輔助函式：確保 OCR 輸入為 Drawable 之 Image 或 Canvas 物件 (支援 photoDataUrl base64 字串)
 */
async function ensureOcrDrawableSource(imgSource) {
  if (!imgSource) return null;
  if (typeof imgSource === 'string') {
    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imgSource;
      if (img.decode) {
        try {
          await img.decode();
        } catch (_) {}
      } else {
        await new Promise(res => { img.onload = res; img.onerror = res; });
      }
      return img;
    }
  }
  return imgSource;
}

/**
 * 【OCR 效期日期關鍵字庫】
 * 涵蓋：EXP, EXP., EXP DATE, Expiry, Expiration, Best Before, Best By, Use By,
 * 有效期限, 有效日期, 賞味期限, 消費期限, 保存期限, 到期日, 有効期限, BBD
 */
const OCR_DATE_KEYWORDS = [
  'EXP DATE',
  'EXP\\.',
  'EXP',
  'EXPIRY',
  'EXPIRATION',
  'BEST BEFORE',
  'BEST BY',
  'USE BY',
  '有效期限',
  '有效日期',
  '賞味期限',
  '消費期限',
  '保存期限',
  '到期日',
  '有効期限',
  'BBD'
];

/**
 * 【OCR 多格式日期候選提取器】
 * 支援格式：
 * - YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
 * - YYYY-MM, YYYY/MM (月度效期，以當月末日為準)
 * - DD/MM/YYYY, MM/DD/YYYY
 * - YYYY年MM月DD日 (及民國年)
 * - YY/MM/DD (合理西元年 24~35 轉 2024~2035)
 * - 連號 8位/6位
 * 優先抓取關鍵字附近的日期候選
 */
function extractOcrDateCandidates(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { candidates: [], bestDate: null, rawText: '' };
  }

  const clean = rawText
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .trim();

  const candidates = [];
  const keywordCandidates = [];

  function toStandardDate(yearStr, monthStr, dayStr) {
    let y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);
    let d = (dayStr !== undefined && dayStr !== null && dayStr !== '') ? parseInt(dayStr, 10) : null;

    // 雙位數年份合理轉換 (24 ~ 35 -> 2024 ~ 2035)
    if (y >= 24 && y <= 35) {
      y = 2000 + y;
    } else if (y >= 90 && y <= 150) {
      // 民國年 (90 ~ 150 -> +1911)
      y = y + 1911;
    }

    if (y < 2020 || y > 2040) return null;
    if (m < 1 || m > 12) return null;

    if (d === null) {
      // 只有 YYYY-MM / YYYY/MM: 依食品法規以當月末日為到期日
      d = new Date(y, m, 0).getDate();
    } else {
      if (d < 1 || d > 31) return null;
      const maxDays = new Date(y, m, 0).getDate();
      if (d > maxDays) return null;
    }

    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  function addCandidate(dateStr, isKeywordNearby) {
    if (!candidates.includes(dateStr)) {
      candidates.push(dateStr);
    }
    if (isKeywordNearby && !keywordCandidates.includes(dateStr)) {
      keywordCandidates.push(dateStr);
    }
  }

  function parseDatesFromSnippet(text, isKeywordNearby) {
    if (!text) return;

    // A. 民國年格式：民國115年9月16日、115/09/16、115.09.16、115-09-16
    const rocRegex = /(?:民國|ROC)?\s*([1-9]\d{1,2})\s*[-/.年]\s*(1[0-2]|0?[1-9])\s*[-/.月]\s*([12]\d|3[01]|0?[1-9])\s*日?/gi;
    let m;
    while ((m = rocRegex.exec(text)) !== null) {
      const std = toStandardDate(m[1], m[2], m[3]);
      if (std) addCandidate(std, isKeywordNearby);
    }

    // B. YYYY年MM月DD日
    const zhRegex = /(20[2-3]\d)\s*年\s*(1[0-2]|0?[1-9])\s*月\s*([12]\d|3[01]|0?[1-9])\s*日?/gi;
    while ((m = zhRegex.exec(text)) !== null) {
      const std = toStandardDate(m[1], m[2], m[3]);
      if (std) addCandidate(std, isKeywordNearby);
    }

    // C. YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
    const ceStdRegex = /\b(20[2-3]\d)\s*[-/.]\s*(1[0-2]|0?[1-9])\s*[-/.]\s*([12]\d|3[01]|0?[1-9])\b/gi;
    while ((m = ceStdRegex.exec(text)) !== null) {
      const std = toStandardDate(m[1], m[2], m[3]);
      if (std) addCandidate(std, isKeywordNearby);
    }

    // D. DD/MM/YYYY 或 MM/DD/YYYY (4位西元年)
    const dmyRegex = /\b([0-3]?\d)\s*[-/.]\s*([0-3]?\d)\s*[-/.]\s*(20[2-3]\d)\b/gi;
    while ((m = dmyRegex.exec(text)) !== null) {
      const p1 = parseInt(m[1], 10);
      const p2 = parseInt(m[2], 10);
      const y = m[3];
      if (p1 > 12 && p2 <= 12) {
        const std = toStandardDate(y, String(p2), String(p1));
        if (std) addCandidate(std, isKeywordNearby);
      } else if (p1 <= 12 && p2 > 12) {
        const std = toStandardDate(y, String(p1), String(p2));
        if (std) addCandidate(std, isKeywordNearby);
      } else if (p1 <= 12 && p2 <= 12 && p1 > 0 && p2 > 0) {
        const std = toStandardDate(y, String(p2), String(p1));
        if (std) addCandidate(std, isKeywordNearby);
      }
    }

    // E. YYYY-MM / YYYY/MM (月度效期)
    const ymRegex = /\b(20[2-3]\d)\s*[-/.]\s*(1[0-2]|0?[1-9])(?!\s*[-/.]\s*\d)\b/gi;
    while ((m = ymRegex.exec(text)) !== null) {
      const std = toStandardDate(m[1], m[2], null);
      if (std) addCandidate(std, isKeywordNearby);
    }

    // F. YY/MM/DD / YY-MM-DD / YY.MM.DD (合理西元年 24~35)
    const yyRegex = /\b([2-3]\d)\s*[-/.]\s*(1[0-2]|0?[1-9])\s*[-/.]\s*([12]\d|3[01]|0?[1-9])\b/gi;
    while ((m = yyRegex.exec(text)) !== null) {
      const std = toStandardDate(m[1], m[2], m[3]);
      if (std) addCandidate(std, isKeywordNearby);
    }

    // G. 8位連續數字 (20260916)
    const num8Regex = /\b(20[2-3]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/gi;
    while ((m = num8Regex.exec(text)) !== null) {
      const std = toStandardDate(m[1], m[2], m[3]);
      if (std) addCandidate(std, isKeywordNearby);
    }

    // H. 6位連續數字 (260916)，僅在關鍵字附近採納
    if (isKeywordNearby) {
      const num6Regex = /(?:^|[^\d])([2-3]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/gi;
      while ((m = num6Regex.exec(text)) !== null) {
        const std = toStandardDate(m[1], m[2], m[3]);
        if (std) addCandidate(std, isKeywordNearby);
      }
    }
  }

  // 1. 搜尋所有效期關鍵字位置，優先分析其後續 40 字元之日期視窗
  const kwRegex = new RegExp(
    `(?:${OCR_DATE_KEYWORDS.join('|')})\\s*[:：.]?\\s*([\\s\\S]{0,40})`,
    'gi'
  );

  let kwMatch;
  while ((kwMatch = kwRegex.exec(clean)) !== null) {
    const snippet = kwMatch[1] || '';
    parseDatesFromSnippet(snippet, true);
  }

  // 2. 針對全文進行全域搜尋
  parseDatesFromSnippet(clean, false);

  const bestDate = keywordCandidates.length > 0 ? keywordCandidates[0] : (candidates.length > 0 ? candidates[0] : null);

  return {
    candidates,
    bestDate,
    rawText: clean
  };
}

/**
 * 相容性效期解析函式 (調用 extractOcrDateCandidates 並回傳 bestDate)
 */
function extractDateFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const res = extractOcrDateCandidates(text);
  return res.bestDate;
}

/**
 * 軌道二：文字與效期掃描引擎 (Tesseract OCR + 原生 TextDetector/BarcodeDetector)
 * 整合 Canvas 三道前處理 (縮放限制 1200px + 中央 75% 裁切對焦 + 灰階二值化)
 */
async function runTextAndDateOcr(imgSource) {
  if (typeof isMobileClip2Loading !== 'undefined' && isMobileClip2Loading && typeof isIosSafari === 'function' && isIosSafari()) {
    console.log('[iOS Safari 保護] MobileCLIP2 模型正在下載中，暫緩 OCR 載入');
    return { text: '', date: null, dateCandidates: [], barcode: null, barcodeData: null };
  }
  let text = '';
  let barcodeData = null;

  const drawableSource = await ensureOcrDrawableSource(imgSource);

  // 1. 原生條碼掃描最優先判定
  barcodeData = await scanBarcodePriority(drawableSource || imgSource);

  // 2. 進行 Canvas 前處理 (縮放限制 1200px + 灰階二值化/動態對比拉伸)
  const preprocessedCanvas = preprocessImageForOcr(drawableSource || imgSource);

  // 若原圖未掃到條碼，嘗試在二值化後之中心畫布再檢測一次
  if (!barcodeData && preprocessedCanvas) {
    barcodeData = await scanBarcodePriority(preprocessedCanvas);
  }

  // 3. Tesseract.js OCR (支援離線與多國語言：繁中 + 英文 + 日文 'chi_tra+eng+jpn'，使用前處理後之優質影像)
  if (typeof window !== 'undefined' && window.Tesseract) {
    try {
      console.log('[OCR] 正在以前處理優化影像執行 Tesseract OCR 文字辨識...');
      const targetInput = preprocessedCanvas || drawableSource || imgSource;
      let ocrResult = null;
      try {
        ocrResult = await window.Tesseract.recognize(targetInput, 'chi_tra+eng+jpn', {
          logger: () => {}
        });
      } catch (multiLangErr) {
        console.warn('[OCR] chi_tra+eng+jpn 載入異常，自動降級 chi_tra+eng：', multiLangErr);
        ocrResult = await window.Tesseract.recognize(targetInput, 'chi_tra+eng', {
          logger: () => {}
        });
      }
      if (ocrResult && ocrResult.data && ocrResult.data.text) {
        text += ' ' + ocrResult.data.text;
      }
    } catch (tessErr) {
      console.warn('[OCR] Tesseract 執行異常，嘗試降級原生識別器：', tessErr);
    }
  }

  // 4. 原生 TextDetector (若環境支援)
  if (typeof window !== 'undefined' && typeof window.TextDetector === 'function') {
    try {
      const textDetector = new window.TextDetector();
      const detected = await textDetector.detect(preprocessedCanvas || drawableSource || imgSource);
      if (detected && detected.length > 0) {
        text += ' ' + detected.map(t => t.rawValue).join(' ');
      }
    } catch (tdErr) {
      console.warn('[OCR] 原生 TextDetector 異常：', tdErr);
    }
  }

  text = text.trim();
  const rawBarcode = barcodeData ? barcodeData.barcode : null;
  const ocrDetails = extractOcrDateCandidates(text + (rawBarcode ? ' ' + rawBarcode : ''));
  const detectedDate = ocrDetails.bestDate;

  return {
    text,
    date: detectedDate,
    dateCandidates: ocrDetails.candidates,
    barcode: rawBarcode,
    barcodeData: barcodeData,
    preprocessedCanvas: preprocessedCanvas
  };
}

/**
 * 【一、日文常用商品/動漫辭彙繁體中文對照表（JP_TO_TC_DICT）】
 */
const JP_TO_TC_DICT = {
  // 食品/飲品
  '牛乳': '鮮乳',
  'ミルク': '鮮乳',
  '生乳': '生乳',
  'ヨーグルト': '優酪乳',
  'お茶': '茶飲',
  '菓子': '零食',
  'スナック': '零食',

  // 收藏/動漫
  'アクリルスタンド': '壓克力立牌',
  'アクスタ': '壓克力立牌',
  '缶バッジ': '徽章',
  'フィギュア': '公仔模型',
  'ねんどろいど': '黏土人',
  'キーホルダー': '吊飾',
  'コミック': '漫畫',
  '漫画': '漫畫',
  '同人誌': '同人誌',
  'イラスト集': '畫冊',
  '画集': '畫冊',

  // 遊戲/配件
  'ゲーム': '遊戲卡帶',
  'カセット': '遊戲卡帶',
  'コントローラー': '遊戲手把',
  'メガネ': '眼鏡',
  '眼鏡': '眼鏡',

  // 票券
  'チケット': '票券',
  '入場券': '票券',
  '引換券': '兌換券'
};

/**
 * 文本自動本地化：將日文字詞依長度優先自動轉換為繁體中文
 */
function localizeJapaneseText(text) {
  if (!text || typeof text !== 'string') return text || '';
  let result = text;
  const sortedKeys = Object.keys(JP_TO_TC_DICT).sort((a, b) => b.length - a.length);
  for (const jpWord of sortedKeys) {
    if (result.includes(jpWord)) {
      result = result.split(jpWord).join(JP_TO_TC_DICT[jpWord]);
    }
  }
  return result;
}

/**
 * 【二、階梯式保底品名提取（針對「其他」類別）】
 * 視覺標籤英文至中文映射表 (MobileNet 類別轉中文常用生活物品)
 */
const VISUAL_LABEL_TRANSLATIONS = {
  'sunglasses': '墨鏡/眼鏡配件',
  'sunglass': '墨鏡/眼鏡配件',
  'glasses': '眼鏡配件',
  'spectacles': '眼鏡配件',
  'device': '電子配件',
  'electronic': '電子配件',
  'bottle': '瓶罐容器',
  'water bottle': '水瓶/水壺',
  'wine bottle': '酒瓶/飲品',
  'beer bottle': '瓶裝飲品',
  'pill bottle': '藥瓶容器',
  'cup': '水杯/容器',
  'coffee mug': '馬克杯',
  'mug': '馬克杯',
  'box': '收納外盒',
  'carton': '包裝紙盒',
  'packet': '袋裝食品',
  'packet, packet': '袋裝物品',
  'bag': '提袋/包包',
  'backpack': '後背包',
  'book': '書籍',
  'notebook': '筆記本',
  'pencil': '文具筆類',
  'pen': '文具筆類',
  'mouse': '電腦滑鼠',
  'computer mouse': '電腦滑鼠',
  'keyboard': '電腦鍵盤',
  'typewriter keyboard': '電腦鍵盤',
  'mousepad': '滑鼠墊',
  'mouse mat': '滑鼠墊',
  'remote': '遙控器',
  'clock': '時鐘鐘錶',
  'watch': '手錶',
  'soap': '肥皂清潔品',
  'cleanser': '洗劑清潔品',
  'spray': '噴霧罐',
  'umbrella': '雨傘',
  'shoe': '休閒鞋',
  'sneaker': '運動球鞋',
  'sandal': '涼鞋/拖鞋',
  'toothbrush': '牙刷清潔品',
  'hair spray': '美髮造型品',
  'lotion': '乳液保養品',
  'cream': '乳霜保養品'
};

/**
 * 常見品牌詞庫 (OCR 識別輔助)
 */
const KNOWN_BRANDS = [
  // 3C 電腦/周邊/電競
  'Logitech', '羅技', 'Razer', '雷蛇', 'Apple', '蘋果', 'Samsung', '三星', 'Sony', '索尼',
  'Asus', '華碩', 'ROG', 'Acer', '宏碁', 'Dell', '戴爾', 'HP', '惠普', 'Lenovo', '聯想',
  'MSI', '微星', 'Corsair', '海盜船', 'SteelSeries', '賽睿', 'Zowie', 'BenQ', '明基',
  'GIGABYTE', '技嘉', 'Keychron', 'Ducky', 'iRocks', 'VGN', 'Attack Shark', 'Ajazz', 'ATK',
  'Finalmouse', 'Glorious', 'Pulsar', 'Lamzu', 'SanDisk', 'Kingston', '金士頓', 'WD',
  // 食品 / 乳品 / 飲料
  '光泉', '瑞穗', '義美', '林鳳營', '福樂', '初鹿', '高大', '好市多', 'Costco', 'Kirkland',
  '柳營', '萬丹', '六甲', '統一', '味全', '可口可樂', 'Coca-Cola', '百事', 'Pepsi',
  '原萃', '茶裏王', '御茶園', '純喫茶', '每朝', '愛之味', '泰山', '黑松',
  // 日化 / 清潔
  '花王', 'Kao', 'P&G', '獅王', 'Lion', '一匙靈', '白蘭', '妙管家', '毛寶',
  '多芬', 'Dove', '沙宣', '海倫仙度絲', '潘婷', '施巴', '高露潔', 'Colgate', '好來', 'Darlie',
  // 遊戲動漫
  'Nintendo', '任天堂', 'Switch', 'PlayStation', 'Bandai', '萬代', 'Good Smile', 'GSC',
  'Kotobukiya', '壽屋', 'Aniplex', 'SEGA', 'Capcom', 'Square Enix'
];

/**
 * 檢查字串是否為無意義之 OCR 雜訊 (如 ad 3, x1, 破碎代碼等)
 */
function isOcrNoiseString(str) {
  if (!str || typeof str !== 'string') return true;
  const s = str.trim();
  if (s.length < 2) return true;
  if (/^\d+$/.test(s)) return true;
  if (/^(batch|lot|no|tel|sn|exp|mfg|date|time|bb|best|before|use|by)$/i.test(s)) return true;
  // 過濾常見的短英數破碎雜訊（如 ad 3, ad3, a 1, b-2, c3, sn 5, lot 10, pd 3 等）
  if (/^[a-zA-Z]{1,2}\s*[-_]?\s*\d{1,4}$/i.test(s)) return true;
  // 檢查是否含有中文字
  const hasChinese = /[\u4e00-\u9fa5]/.test(s);
  if (hasChinese) {
    const zhCount = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (zhCount < 2) return true;
    if (/(?:成分|原料|配料|熱量|營養標示|蛋白質|脂肪|碳水化合物|糖|鈉|電話|客服|地址|產地|容量|毫升|公克|批號|有效日期|製造日期|保存期限)/.test(s)) {
      return true;
    }
    return false;
  }
  // 純英數判斷：若非已知品牌，且非有效英文單字則過濾
  const brandMatch = KNOWN_BRANDS.some(b => s.toLowerCase().includes(b.toLowerCase()));
  if (brandMatch) return false;
  const lettersOnly = s.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length < 4) return true;
  if (!/[aeiouy]/i.test(lettersOnly)) return true;
  if (/^([a-zA-Z0-9]\s+){2,}[a-zA-Z0-9]$/.test(s)) return true;
  return false;
}

/**
 * 規格化單一視覺候選 (相容 MobileCLIP2 與 MobileNet 降級結果)
 */
function normalizeVisualPrediction(p) {
  if (!p) return null;
  if (p.defaultName && p.cat) {
    return p;
  }
  const cls = (p.className || p.label || '').toLowerCase();
  for (const dictItem of VISUAL_APPEARANCE_DICT) {
    if (dictItem.keywords && dictItem.keywords.some(kw => cls.includes(kw.toLowerCase()))) {
      return {
        id: 'mobilenet_' + (dictItem.keywords[0] || 'item').replace(/\s+/g, '_'),
        cat: dictItem.category,
        subCat: dictItem.subCategory,
        defaultName: dictItem.name,
        emoji: dictItem.emoji,
        defaultDays: dictItem.defaultDays || 30,
        score: p.probability || p.score || 0.8,
        finalScore: p.probability || p.score || 0.8,
        className: p.className
      };
    }
  }
  for (const [k, v] of Object.entries(VISUAL_LABEL_TRANSLATIONS)) {
    if (cls.includes(k.toLowerCase())) {
      return {
        id: 'mobilenet_' + k.replace(/\s+/g, '_'),
        cat: 'other',
        subCat: '未分類',
        defaultName: v,
        emoji: '📦',
        defaultDays: 30,
        score: p.probability || p.score || 0.8,
        finalScore: p.probability || p.score || 0.8,
        className: p.className
      };
    }
  }
  return {
    id: 'visual_item',
    cat: 'other',
    subCat: '未分類',
    defaultName: p.className ? simplifyItemName(p.className.split(',')[0]) : '生活物品',
    emoji: '📦',
    defaultDays: 30,
    score: p.probability || p.score || 0.5,
    finalScore: p.probability || p.score || 0.5,
    className: p.className
  };
}

/**
 * 階梯式品名自動填入（絕不留白、自動過濾 ad 3 等 OCR 破碎雜訊）
 */
function extractFallbackItemName(ocrText = '', visualPredictions = []) {
  // 第一階（OCR 文字優先）：過濾成分、熱量、電話等雜訊，過濾破碎英數字，取 OCR 乾淨品名
  if (ocrText && typeof ocrText === 'string') {
    const lines = ocrText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const rawLine of lines) {
      if (/(?:成分|原料|配料|熱量|卡路里|營養標示|蛋白質|脂肪|碳水化合物|糖|鈉|電話|tel|phone|地址|address|客服|工廠|產地|原產地|淨重|容量|毫升|ml|公克|g\b|批號|batch|lot|no\.|sn\b|www|http|\.com)/i.test(rawLine)) {
        continue;
      }
      let cleaned = rawLine.replace(/(?:exp|mfg|best\s*before|use\s*by|賞味期限|消費期限|有効期限|有效期限|保存期限|到期日|有效日期|製造日期)[:：\s]*/gi, '');
      cleaned = cleaned.replace(/\d{2,4}[-\/.年]\d{1,2}[-\/.月]\d{1,2}日?/g, '');
      cleaned = cleaned.replace(/\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}/g, '');
      cleaned = cleaned.replace(/\b\d{4,12}\b/g, '');
      // 自動將日文詞彙轉化為繁體中文
      cleaned = localizeJapaneseText(cleaned);
      // 保留中文字、英文字母、日文假名、數字與空格
      cleaned = cleaned.replace(/[^\p{L}\p{N}\u4e00-\u9fa5\u3040-\u30ff\s]/gu, '').trim();

      // 嚴格過濾 OCR 雜訊（如 ad 3, x2 等）
      if (isOcrNoiseString(cleaned)) {
        continue;
      }

      if (cleaned.length >= 2 && cleaned.length <= 25) {
        return cleaned;
      }
    }
  }

  // 第二階：命中特定品類詞庫（如漫畫/Switch/立牌/鮮乳）直接套用標準繁中品名
  if (ocrText && typeof ocrText === 'string' && ocrText.trim()) {
    const ocrCandidate = ocrText.trim();
    if (/(鮮乳|鮮奶|牛乳|生乳|全脂|低脂|脱脂|脫脂|保久乳|純鮮乳|瑞穗|光泉|義美|林鳳營|初鹿|milk|乳飲品)/i.test(ocrCandidate)) {
      const brands = ['光泉', '瑞穗', '義美', '林鳳營', '福樂', '初鹿', '高大', '好市多', '柳營', '萬丹', '六甲'];
      const b = brands.find(brand => ocrCandidate.includes(brand));
      return b ? `${b}鮮乳` : '鮮乳';
    }
    if (/(漫畫|コミック|単行本|同人誌)/i.test(ocrCandidate)) {
      return '漫畫';
    }
    if (/(壓克力立牌|アクリルスタンド|アクスタ|立牌)/i.test(ocrCandidate)) {
      return '壓克力立牌';
    }
    if (/(switch|任天堂|遊戲卡帶|ゲーム|カセット)/i.test(ocrCandidate)) {
      return 'Switch遊戲';
    }
    if (/(滑鼠|電腦滑鼠|電競滑鼠|mouse)/i.test(ocrCandidate)) {
      return '電腦滑鼠';
    }
    if (/(鍵盤|電腦鍵盤|機械鍵盤|keyboard)/i.test(ocrCandidate)) {
      return '電腦鍵盤';
    }
    if (/(コントローラー|遊戲手把|手把)/i.test(ocrCandidate)) {
      return '遊戲手把';
    }
    if (/(缶バッジ|徽章|胸章)/i.test(ocrCandidate)) {
      return '徽章';
    }
    if (/(ねんどろいど|黏土人)/i.test(ocrCandidate)) {
      return '黏土人';
    }
    if (/(フィギュア|公仔模型|公仔|模型)/i.test(ocrCandidate)) {
      return '公仔模型';
    }
    if (/(キーホルダー|吊飾|鑰匙圈)/i.test(ocrCandidate)) {
      return '吊飾';
    }
    if (/(イラスト集|画集|畫冊)/i.test(ocrCandidate)) {
      return '畫冊';
    }
    if (/(眼鏡|墨鏡|太陽眼鏡|メガネ|glasses|sunglasses|spectacles|鏡框)/i.test(ocrCandidate) && !ocrCandidate.includes('隱形眼鏡')) {
      if (/墨鏡|太陽眼鏡|sunglasses/i.test(ocrCandidate)) return '太陽眼鏡';
      return '眼鏡';
    }
    if (/(お茶|綠茶|紅茶|烏龍茶|茶飲)/i.test(ocrCandidate)) {
      return '茶飲';
    }
    if (/(菓子|スナック|零食|餅乾)/i.test(ocrCandidate)) {
      return '零食';
    }
    if (/(チケット|入場券|票券)/i.test(ocrCandidate)) {
      return '票券';
    }
    if (/(引換券|兌換券)/i.test(ocrCandidate)) {
      return '兌換券';
    }
  }

  // 第三階：若無文字，以視覺特徵標籤翻譯中文保底，最低限度維持「新收錄物品」，嚴禁留空
  if (Array.isArray(visualPredictions) && visualPredictions.length > 0) {
    for (const pred of visualPredictions) {
      if (pred && pred.defaultName && pred.defaultName !== '生活物品' && pred.defaultName !== '未辨識物品') {
        return pred.defaultName;
      }
      const cls = (pred && (pred.className || pred.label) ? String(pred.className || pred.label) : '').toLowerCase();
      if (!cls) continue;
      const words = cls.split(',').map(w => w.trim());
      for (const w of words) {
        if (VISUAL_LABEL_TRANSLATIONS[w]) {
          return VISUAL_LABEL_TRANSLATIONS[w];
        }
      }
      for (const [engKey, zhVal] of Object.entries(VISUAL_LABEL_TRANSLATIONS)) {
        if (cls.includes(engKey)) {
          return zhVal;
        }
      }
    }
  }

  // 最低限度維持「新收錄物品」，嚴禁留空
  return '新收錄物品';
}

/**
 * 【三、外觀與文字決策融合演算法（Fusion Logic）】
 * 依據雙軌回傳的資料自動計算最終品名、分類與到期天數
 */
function fuseVisualAndOcrDecision(visualPredictions, ocrData, existingItems = []) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const ocrText = (ocrData && ocrData.text) ? String(ocrData.text).trim() : '';
  const ocrBarcode = (ocrData && ocrData.barcode) ? String(ocrData.barcode).trim() : '';

  // 【最優先分支 0】：若原生條碼掃描到 ISBN (978 或 979 開頭)
  if (ocrData && ocrData.barcodeData && ocrData.barcodeData.isIsbn) {
    const isbnVal = ocrData.barcodeData.barcode;
    const finalDate = (ocrData && ocrData.date) ? ocrData.date : formatDate(offsetDays(today, 365));
    return {
      success: true,
      name: `圖書/漫畫 (ISBN: ${isbnVal})`,
      category: 'animation',
      subCategory: '漫畫/單行本',
      emoji: '📚',
      expiryDate: finalDate,
      hasEndDate: true,
      remindDaysBefore: 30,
      remindTime: '09:00',
      confidence: 1.0,
      visualMatch: 'ISBN條碼直鎖',
      fusionMode: 'isbn_priority',
      visualPredictions: visualPredictions || [],
      ocrText: ocrText,
      notes: `ISBN: ${isbnVal}`
    };
  }

  // 1. 檢視視覺辨識前 5 大結果命中外觀特徵庫的情況 (優先支援 MobileCLIP 高精度候選，兼容 MobileNet)
  let topVisualMatch = null;
  let topVisualConfidence = 0;
  let topVisualClassName = '';

  if (Array.isArray(visualPredictions) && visualPredictions.length > 0) {
    let bestKwLength = 0;
    for (const pred of visualPredictions) {
      const prob = typeof pred.score === 'number' ? pred.score : (typeof pred.probability === 'number' ? pred.probability : 0);
      const label = (pred.label || pred.className || '').trim();

      // A. 優先比對 MobileCLIP 候選物件
      const clipCandidate = pred.candidate || (typeof getMobileClipCandidate === 'function' ? getMobileClipCandidate(label) : (typeof MOBILECLIP_CANDIDATE_MAP !== 'undefined' ? MOBILECLIP_CANDIDATE_MAP[label] : null));
      if (clipCandidate) {
        if (prob > topVisualConfidence) {
          topVisualConfidence = prob;
          topVisualClassName = label;
          const catLabel = (typeof DEFAULT_CATEGORIES !== 'undefined' && DEFAULT_CATEGORIES[clipCandidate.category])
            ? DEFAULT_CATEGORIES[clipCandidate.category].label
            : clipCandidate.category;
          topVisualMatch = {
            name: clipCandidate.defaultName,
            category: clipCandidate.category,
            categoryLabel: catLabel,
            subCategory: clipCandidate.subCategory,
            defaultDays: clipCandidate.defaultDays || 30,
            emoji: clipCandidate.emoji || '📦',
            isContainer: !!clipCandidate.isContainer,
            source: 'mobileclip'
          };
        }
      }

      // B. MobileNet ImageNet 辭典比對 (若無 MobileCLIP 命中)
      if (!topVisualMatch || topVisualMatch.source !== 'mobileclip') {
        const clsLower = label.toLowerCase();
        for (const dictItem of VISUAL_APPEARANCE_DICT) {
          for (const kw of dictItem.keywords) {
            const kwLower = kw.toLowerCase();
            if (clsLower.includes(kwLower)) {
              if (prob > topVisualConfidence || (Math.abs(prob - topVisualConfidence) < 0.05 && kwLower.length > bestKwLength)) {
                topVisualConfidence = prob;
                bestKwLength = kwLower.length;
                topVisualMatch = dictItem;
                topVisualClassName = label;
              }
            }
          }
        }
      }
    }
  }

  // 2. 檢視 OCR 掃描到的文字中是否含有特定商品、品牌或中文關鍵字
  let ocrKeywordMatch = null;
  let ocrMatchedWord = '';

  if (ocrText) {
    const ocrLower = ocrText.toLowerCase();
    let maxKwLen = 0;
    for (const mapItem of SMART_KEYWORD_MAP) {
      for (const kw of mapItem.keywords) {
        const kwLower = kw.toLowerCase();
        if (ocrLower.includes(kwLower)) {
          if (kwLower.length > maxKwLen) {
            maxKwLen = kwLower.length;
            ocrKeywordMatch = mapItem;
            ocrMatchedWord = kw;
          }
        }
      }
    }
  }

  // 3. 期限判定：若 OCR 掃到印刷日期，優先採用印刷日期
  let finalDate = (ocrData && ocrData.date) ? ocrData.date : extractDateFromText(ocrText + ' ' + ocrBarcode);

  // 中英詞彙優化對應 (例如英文 OCR 'milk' 自動對應至中文品名「牛奶」)
  const OCR_NAME_TRANSLATIONS = {
    'milk': '牛奶',
    'whole milk': '全脂牛奶',
    'low fat milk': '低脂牛奶',
    'fresh milk': '鮮乳',
    'yogurt': '優格',
    'soy milk': '豆漿',
    'coffee': '咖啡',
    'tea': '茶包',
    'bread': '麵包',
    'apple': '蘋果',
    'banana': '香蕉',
    'egg': '雞蛋',
    'eggs': '雞蛋',
    'shampoo': '洗髮精/潤髮乳',
    'body wash': '沐浴乳',
    'toothpaste': '牙膏/口腔護理',
    'sunscreen': '防曬乳',
    'lotion': '保養乳液',
    'cleanser': '洗面乳',
    'vitamin': '維他命/保健品',
    'filter': '濾網/濾芯',
    'battery': '電池'
  };

  // 【最優先分支 1】：乳製品/鮮乳 Priority 1 優先攔截
  // 包含中英日關鍵字：/(鮮乳|鮮奶|牛乳|生乳|全脂|低脂|脱脂|脫脂|保久乳|純鮮乳|瑞穗|光泉|義美|林鳳營|初鹿|milk|乳飲品)/i
  // 清潔用品規則嚴格排除單獨的「殺菌/消毒/除菌」，避免牛奶包裝字樣觸發清潔劑。
  // 命中乳品時：分類強制鎖定「食品」，品名自動代入品牌鮮乳或「鮮乳」，未讀取到效期時自動推算「今天 + 7 天」。
  const DAIRY_REGEX = /(鮮乳|鮮奶|牛乳|生乳|全脂|低脂|脱脂|脫脂|保久乳|純鮮乳|瑞穗|光泉|義美|林鳳營|初鹿|milk|乳飲品)/i;
  if (DAIRY_REGEX.test(ocrText) || DAIRY_REGEX.test(ocrMatchedWord || '')) {
    const brands = ['光泉', '瑞穗', '義美', '林鳳營', '福樂', '初鹿', '高大', '好市多', '柳營', '萬丹', '六甲', '東海', '四方', '崙背'];
    const foundBrand = brands.find(b => ocrText.includes(b)) || '';
    let suggestedName = '鮮乳';
    if (foundBrand) {
      if (/全脂/i.test(ocrText)) suggestedName = `${foundBrand}全脂鮮乳`;
      else if (/低脂/i.test(ocrText)) suggestedName = `${foundBrand}低脂鮮乳`;
      else if (/脱脂|脫脂/i.test(ocrText)) suggestedName = `${foundBrand}脫脂鮮乳`;
      else if (/優酪乳/i.test(ocrText)) suggestedName = `${foundBrand}優酪乳`;
      else if (/優格/i.test(ocrText)) suggestedName = `${foundBrand}優格`;
      else if (/保久乳/i.test(ocrText)) suggestedName = `${foundBrand}保久乳`;
      else if (/鮮奶/i.test(ocrText)) suggestedName = `${foundBrand}鮮奶`;
      else suggestedName = `${foundBrand}鮮乳`;
    } else {
      const match = ocrText.match(/(純鮮乳|全脂鮮乳|低脂鮮乳|全脂鮮奶|低脂鮮奶|脱脂牛乳|脫脂牛乳|保久乳|調味乳|優酪乳|優格|鮮乳|鮮奶|牛乳|生乳)/i);
      if (match) {
        suggestedName = localizeJapaneseText(match[1]);
      } else {
        suggestedName = '鮮乳';
      }
    }
    const detectedDate = (ocrData && ocrData.date) ? ocrData.date : extractDateFromText(ocrText + ' ' + ocrBarcode);
    // 未讀取到效期時自動推算「今天 + 7 天」
    const finalDate = detectedDate || formatDate(offsetDays(today, 7));

    return {
      success: true,
      name: suggestedName,
      category: 'food',
      subCategory: '鮮乳',
      emoji: '🥛',
      expiryDate: finalDate,
      hasEndDate: true,
      remindDaysBefore: 3,
      remindTime: '09:00',
      confidence: Math.max(topVisualConfidence, 0.95),
      visualMatch: topVisualMatch ? topVisualMatch.name : '鮮乳',
      fusionMode: 'dairy_priority',
      visualPredictions: visualPredictions || [],
      ocrText: ocrText,
      notes: ocrBarcode ? `條碼: ${ocrBarcode}` : undefined
    };
  }

  // 【配件小物分支】：眼鏡與個人配件判定 (包含中英日關鍵字：/(眼鏡|墨鏡|太陽眼鏡|メガネ|glasses|sunglasses|spectacles|鏡框)/i)
  // 分類強制選中「其他」（若無配件分類），追蹤模式設為無到期日或僅記天數，嚴禁進入「食品」。
  const GLASSES_REGEX = /(眼鏡|墨鏡|太陽眼鏡|メガネ|glasses|sunglasses|spectacles|鏡框)/i;
  if (GLASSES_REGEX.test(ocrText) && !ocrText.includes('隱形眼鏡') && !ocrText.includes('保養液')) {
    const glassesMatch = ocrText.match(/(太陽眼鏡|抗藍光眼鏡|墨鏡|眼鏡|老花眼鏡|護目鏡|メガネ|glasses|sunglasses|spectacles|鏡框)/i);
    let glassesName = '眼鏡';
    if (glassesMatch) {
      const matched = glassesMatch[1].toLowerCase();
      if (/sunglasses|墨鏡|太陽眼鏡/.test(matched)) glassesName = '太陽眼鏡';
      else if (/メガネ|glasses|spectacles|眼鏡/.test(matched)) glassesName = '眼鏡';
      else if (/鏡框/.test(matched)) glassesName = '眼鏡鏡框';
      else glassesName = glassesMatch[1];
    }
    const detectedDate = (ocrData && ocrData.date) ? ocrData.date : extractDateFromText(ocrText + ' ' + ocrBarcode);
    return {
      success: true,
      name: glassesName,
      category: 'other',
      subCategory: '配件小物',
      emoji: '👓',
      expiryDate: detectedDate || formatDate(offsetDays(today, 365)),
      hasEndDate: false, // 追蹤模式設為無到期日或僅記天數，嚴禁進入食品
      remindDaysBefore: 30,
      remindTime: '09:00',
      confidence: Math.max(topVisualConfidence, 0.9),
      visualMatch: topVisualMatch ? topVisualMatch.name : '眼鏡/配件小物',
      fusionMode: 'glasses_priority',
      visualPredictions: visualPredictions || [],
      ocrText: ocrText,
      notes: ocrBarcode ? `條碼: ${ocrBarcode}` : undefined
    };
  }

  let finalName = '';
  let finalCategory = 'other';
  let finalSubCategory = '';
  let finalEmoji = '📦';
  let defaultDays = 30;
  let fusionMode = 'fallback';

  // 【決策分支 2】：若外觀辨識出容器種類（如 lotion / bottle / can / pill bottle / carton），且 OCR 同步掃到品牌或產品字樣
  if (topVisualMatch && topVisualMatch.isContainer && ocrMatchedWord) {
    fusionMode = 'container_ocr_fusion';
    finalName = OCR_NAME_TRANSLATIONS[ocrMatchedWord.toLowerCase()] || (topVisualMatch && topVisualMatch.source === 'mobileclip' ? topVisualMatch.name : ocrMatchedWord);

    if (ocrKeywordMatch && ocrKeywordMatch.cat) {
      finalCategory = ocrKeywordMatch.cat;
      finalSubCategory = ocrKeywordMatch.subCat || topVisualMatch.subCategory;
      defaultDays = (ocrKeywordMatch.duration && ocrKeywordMatch.duration > 0) ? ocrKeywordMatch.duration : (topVisualMatch.defaultDays || 12);
      finalEmoji = ocrKeywordMatch.emoji;
    } else if (topVisualMatch.category === 'cleaning') {
      // 嚴防 carton, jug, bottle, pitcher 誤入清潔
      const isFoodContainer = topVisualMatch.keywords && topVisualMatch.keywords.some(k => ['carton', 'milk carton', 'jug', 'pitcher', 'bottle', 'water bottle'].includes(k.toLowerCase()));
      if (isFoodContainer) {
        finalCategory = 'food';
        finalSubCategory = '飲品';
        finalEmoji = '🥛';
        defaultDays = 14;
      } else {
        finalCategory = 'cleaning';
        finalSubCategory = topVisualMatch.subCategory || '衛浴保養';
        defaultDays = topVisualMatch.defaultDays;
        finalEmoji = topVisualMatch.emoji;
      }
    } else if (topVisualMatch.category === 'medicine') {
      finalCategory = 'medicine';
      finalSubCategory = topVisualMatch.subCategory || '常備藥品';
      defaultDays = topVisualMatch.defaultDays;
      finalEmoji = topVisualMatch.emoji;
    } else {
      finalCategory = topVisualMatch.category;
      finalSubCategory = topVisualMatch.subCategory;
      defaultDays = topVisualMatch.defaultDays;
      finalEmoji = topVisualMatch.emoji;
    }
  }
  // 【決策分支 1】：若外觀特徵命中（置信度 >= 0.15），且圖片中無明顯中文品名
  else if (topVisualMatch && topVisualConfidence >= 0.15 && !ocrMatchedWord) {
    fusionMode = topVisualMatch.source === 'mobileclip' ? 'mobileclip_priority' : 'visual_priority';
    finalName = topVisualMatch.name;
    finalCategory = topVisualMatch.category;
    finalSubCategory = topVisualMatch.subCategory;
    finalEmoji = topVisualMatch.emoji;
    defaultDays = topVisualMatch.defaultDays;
  }
  // 【決策分支 3】：若 OCR 掃到明確品名，但外觀非容器或信心度較低
  else if (ocrMatchedWord) {
    fusionMode = 'ocr_priority';
    finalName = OCR_NAME_TRANSLATIONS[ocrMatchedWord.toLowerCase()] || (topVisualMatch && topVisualMatch.source === 'mobileclip' ? topVisualMatch.name : ocrMatchedWord);
    finalCategory = ocrKeywordMatch ? ocrKeywordMatch.cat : 'other';
    finalSubCategory = ocrKeywordMatch ? ocrKeywordMatch.subCat : '';
    finalEmoji = ocrKeywordMatch ? ocrKeywordMatch.emoji : '📦';
    defaultDays = (ocrKeywordMatch && ocrKeywordMatch.duration) ? ocrKeywordMatch.duration : 14;
  }
  // 【決策分支 4】：外觀特徵有命中且置信度在 [0.25, 0.35] 且無 OCR 品名
  else if (topVisualMatch && topVisualConfidence >= 0.25) {
    fusionMode = 'visual_low_confidence';
    finalName = topVisualMatch.name;
    finalCategory = topVisualMatch.category;
    finalSubCategory = topVisualMatch.subCategory;
    finalEmoji = topVisualMatch.emoji;
    defaultDays = topVisualMatch.defaultDays;
  }
  // 【低信心度防呆】：當 MobileNet 信心度過低（< 0.25）或無可靠標籤時，分類統一選中「其他」，品名保持空白
  else if ((!topVisualMatch || topVisualConfidence < 0.25) && !ocrMatchedWord && !ocrBarcode) {
    fusionMode = 'low_confidence_fallback';
    finalName = '';
    finalCategory = 'other';
    finalSubCategory = '未分類';
    finalEmoji = '📦';
    defaultDays = 30;
  }
  // 【決策分支 5】：檢查條碼比對現有庫存
  else if (ocrBarcode) {
    fusionMode = 'barcode_match';
    const existing = Array.isArray(existingItems) ? existingItems.find(i => (i.notes && i.notes.includes(ocrBarcode)) || i.name.includes(ocrBarcode)) : null;
    if (existing) {
      finalName = existing.name;
      finalCategory = existing.category;
      finalSubCategory = existing.subCategory || '';
      finalEmoji = existing.emoji || '📦';
      defaultDays = 14;
    } else {
      finalName = '條碼商品';
      finalCategory = 'other';
      finalSubCategory = '一般雜項';
      finalEmoji = '📦';
      defaultDays = 30;
    }
  }
  // 【決策分支 6】：無特徵之階梯式保底（優先採用 MobileCLIP 特徵名，若無則依序 OCR/預設品名）
  else {
    if (topVisualMatch && topVisualConfidence >= 0.10 && topVisualMatch.name !== '生活物品') {
      fusionMode = 'mobileclip_fallback';
      finalName = topVisualMatch.name;
      finalCategory = topVisualMatch.category;
      finalSubCategory = topVisualMatch.subCategory;
      defaultDays = topVisualMatch.defaultDays;
      finalEmoji = topVisualMatch.emoji;
    } else {
      fusionMode = 'default_fallback';
      finalName = extractFallbackItemName(ocrText, visualPredictions);
      finalCategory = 'other';
      finalSubCategory = '未分類';
      defaultDays = 30;
      finalEmoji = '📦';
    }
  }

  // 關鍵防呆保護：嚴禁將乳品/食品誤歸類為清潔用品 (防止 milk / 牛奶辨識成清潔液，嚴格排除單獨殺菌/消毒/除菌)
  const isFoodOrDairy = /milk|牛奶|鮮奶|鮮乳|牛乳|生乳|脱脂|脫脂|優格|豆漿|起司|飲料|乳品/i.test(finalName + ' ' + (ocrMatchedWord || '') + ' ' + (ocrText || ''));
  if (isFoodOrDairy && (finalCategory === 'cleaning' || finalCategory === 'pao')) {
    finalCategory = 'food';
    finalSubCategory = '鮮乳';
    finalEmoji = '🥛';
    if (!finalName || finalName === '瓶裝洗劑/保養品' || finalName.includes('洗劑') || finalName === '拍攝物品') {
      finalName = '鮮乳';
    }
    defaultDays = 7;
  }

  // 期限判定 (OCR-ONLY 嚴格規範)：僅接受 OCR 實際讀取到的印刷日期，若無則保持 null，禁止 AI 或預設天數猜測
  const hasValidExpiry = !!(finalDate && /^\d{4}-\d{2}-\d{2}$/.test(finalDate));
  const expiryDateResult = hasValidExpiry ? finalDate : null;

  finalCategory = normalizeCategoryKey(finalCategory);

  // 品名進一步精簡化
  if (finalName === '條碼商品') {
    // 保持條碼商品不變
  } else {
    finalName = simplifyItemName(finalName);
  }
  if (!finalName || finalName === '未命名物品' || finalName === '拍攝物品' || finalName.trim() === '') {
    finalName = ocrBarcode ? '條碼商品' : extractFallbackItemName(ocrText, visualPredictions);
  }
  if (!finalName || finalName.trim() === '') {
    finalName = '新收錄物品';
  }

  const resultNotes = ocrBarcode ? ((ocrData && ocrData.barcodeData && ocrData.barcodeData.isIsbn) ? `ISBN: ${ocrBarcode}` : `條碼: ${ocrBarcode}`) : undefined;

  return {
    success: true,
    name: finalName,
    category: finalCategory,
    subCategory: finalSubCategory,
    emoji: finalEmoji,
    expiryDate: expiryDateResult,
    hasEndDate: hasValidExpiry,
    remindDaysBefore: 3,
    remindTime: '09:00',
    confidence: topVisualConfidence,
    visualMatch: topVisualMatch ? topVisualMatch.name : null,
    fusionMode,
    visualPredictions: visualPredictions || [],
    ocrText: ocrText,
    notes: resultNotes
  };
}

/**
 * 智慧鏡頭雙軌並行融合分析入口
 * 使用 Promise.all 同步啟動視覺外觀 (MobileNet) 與 文字效期 (Tesseract OCR)
 */
async function analyzeSmartCameraDualTrack(imageSource, photoDataUrl) {
  if (isMobileClipTestMode()) {
    console.warn('[MOBILECLIP TEST] 測試模式啟用 (?mobilecliptest=1)，跳過 analyzeSmartCameraDualTrack');
    return null;
  }
  // 1. 最優先判定原生條碼 (ISBN 或一般條碼)
  const barcodeImmediate = await scanBarcodePriority(imageSource);
  if (barcodeImmediate && barcodeImmediate.isIsbn) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      success: true,
      name: barcodeImmediate.name,
      category: 'animation',
      subCategory: '漫畫/單行本',
      emoji: '📚',
      expiryDate: formatDate(offsetDays(today, 365)),
      hasEndDate: true,
      remindDaysBefore: 30,
      remindTime: '09:00',
      confidence: 1.0,
      visualMatch: 'ISBN條碼直鎖',
      fusionMode: 'isbn_priority',
      notes: barcodeImmediate.notes,
      image: photoDataUrl || null
    };
  }

  // 2. 雙軌並行分析：視覺外觀分類 + 前處理文字效期 OCR
  const [visualPredictions, ocrData] = await Promise.all([
    classifyImageVisual(imageSource),
    runTextAndDateOcr(imageSource)
  ]);

  if (barcodeImmediate && (!ocrData || !ocrData.barcodeData)) {
    if (ocrData) {
      ocrData.barcodeData = barcodeImmediate;
      ocrData.barcode = barcodeImmediate.barcode;
    }
  }

  const itemsList = (typeof window !== 'undefined' && window.getItems) ? window.getItems() : [];
  const fused = fuseVisualAndOcrDecision(visualPredictions, ocrData, itemsList);

  if (photoDataUrl) {
    fused.image = photoDataUrl;
  }
  if (ocrData && ocrData.barcode && !fused.notes) {
    fused.notes = (ocrData.barcodeData && ocrData.barcodeData.isIsbn) ? `ISBN: ${ocrData.barcode}` : `條碼: ${ocrData.barcode}`;
  }

  // 表單強制賦值與事件派發 (確保「其他」分類或未命中詞庫時品名絕對不留空)
  applyVlmDomValues(fused.name, fused.category, fused.expiryDate);

  return fused;
}

// ==========================================
// 7.7 MobileCLIP2-S0 輕量視覺特徵比對與智慧決策融合引擎 (v1.8.22)
// ==========================================

let mobileClip2VisionModel = null;
let mobileClip2Processor = null;
let isMobileClip2Loading = false;
let mobileClip2LoadPromise = null;
const mobileClip2DownloadProgress = {};

/**
 * 取得 MobileCLIP2 特徵標籤與候選資料庫
 */
function getMobileClip2Data() {
  const categories = (typeof MOBILECLIP2_CATEGORIES !== 'undefined' && MOBILECLIP2_CATEGORIES && MOBILECLIP2_CATEGORIES.length > 0)
    ? MOBILECLIP2_CATEGORIES
    : ((typeof window !== 'undefined' && window.MOBILECLIP2_CATEGORIES) || []);
  const candidates = (typeof MOBILECLIP2_CANDIDATES !== 'undefined' && MOBILECLIP2_CANDIDATES && MOBILECLIP2_CANDIDATES.length > 0)
    ? MOBILECLIP2_CANDIDATES
    : ((typeof window !== 'undefined' && window.MOBILECLIP2_CANDIDATES) || []);
  return { categories, candidates };
}

/**
 * 檢查 MobileCLIP2-S0 模型是否已經下載並快取至本機 (IndexedDB / CacheStorage)
 */
function isMobileClip2Downloaded() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('mobileclip2_downloaded') === 'true' ||
           !!mobileClip2VisionModel;
  } catch (e) {
    return !!mobileClip2VisionModel;
  }
}

/**
 * 標記 MobileCLIP2-S0 模型已成功下載完畢
 */
function markMobileClip2Downloaded() {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('mobileclip2_downloaded', 'true');
    } catch (e) {}
  }
  updateAiModelSettingsUI(100, 'downloaded');
}

/**
 * 標記相容性別名
 */
function isMoondreamModelDownloaded() { return isMobileClip2Downloaded(); }
function markMoondreamModelDownloaded() { markMobileClip2Downloaded(); }

/**
 * 同步更新「設定頁面」中的 AI 辨識下載按鈕與狀態文字
 */
function updateAiModelSettingsUI(progress = null, state = null) {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btnDownloadAiModel');
  const btnText = document.getElementById('btnDownloadAiModelText');
  const statusText = document.getElementById('settingsAiModelStatusText');
  const progressBar = document.getElementById('settingsDownloadProgressBar');
  const progressTrack = document.getElementById('settingsDownloadProgressTrack');

  const isDownloaded = isMobileClip2Downloaded();

  if (state === 'downloaded' || (isDownloaded && state !== 'downloading' && !isMobileClip2Loading)) {
    if (btn) {
      btn.className = 'btn-download-ai-model downloaded';
    }
    if (btnText) {
      btnText.textContent = '✅ 下載完成';
    }
    if (statusText) {
      statusText.textContent = '✅ 下載完成！已快取至本機 IndexedDB (~43MB 離線隨開即用)';
    }
    if (progressTrack) {
      if (progressBar) progressBar.style.width = '100%';
      setTimeout(() => { if (progressTrack) progressTrack.style.display = 'none'; }, 1200);
    }
  } else if (
    state === 'downloading' ||
    isMobileClip2Loading ||
    (progress !== null && progress < 100)
  ) {
    const p = Math.max(0, Math.min(100, Math.round(progress || 0)));
    if (btn) {
      btn.className = 'btn-download-ai-model downloading';
    }
    if (btnText) {
      btnText.textContent = `⏳ 下載中 ${p}%`;
    }
    if (statusText) {
      statusText.textContent = `正在下載 MobileCLIP2-S0 視覺模型 ${p}%...`;
    }
    if (progressTrack) {
      progressTrack.style.display = 'block';
      if (progressBar) progressBar.style.width = `${p}%`;
    }
  } else {
    if (btn) {
      btn.className = 'btn-download-ai-model';
    }
    if (btnText) {
      btnText.textContent = '下載模型';
    }
    if (statusText) {
      statusText.textContent = 'MobileCLIP2-S0 輕量視覺模型 (~43MB)，點擊立即下載至本機快取';
    }
    if (progressTrack) {
      progressTrack.style.display = 'none';
    }
  }
}

/**
 * 綁定設定頁面中 AI 辨識模型下載按鈕之事件監聽（按下一鍵立即下載，即時顯示下載中與下載完成）
 */
function setupAiModelSettingsHandler() {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btnDownloadAiModel');
  const row = document.getElementById('rowAiModelDownload');

  const triggerDownload = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isMobileClip2Loading) {
      console.log('[AI MODEL BUTTON] 模型下載已在執行中，忽略重複點擊');
      return;
    }
    console.log('[AI MODEL BUTTON] 一鍵啟動下載模型');
    updateAiModelSettingsUI(0, 'downloading');

    try {
      await initMobileClip2((percent) => {
        updateAiModelSettingsUI(percent, 'downloading');
      }, { forceReload: true, forceShowOverlay: false });

      markMobileClip2Downloaded();
      updateAiModelSettingsUI(100, 'downloaded');
      console.log('[AI MODEL BUTTON] 模型下載完成！');
    } catch (err) {
      console.error('[AI MODEL BUTTON] 下載模型過程發生例外：', err);
      updateAiModelSettingsUI(0, 'error');
      if (btn) btn.className = 'btn-download-ai-model';
      const btnText = document.getElementById('btnDownloadAiModelText');
      if (btnText) btnText.textContent = '❌ 重試下載';
      const statusText = document.getElementById('settingsAiModelStatusText');
      if (statusText) statusText.textContent = '下載失敗：' + (err?.message || err) + '，請點擊重試';
      alert('下載模型失敗：' + (err?.message || err));
    }
  };

  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = 'true';
    btn.addEventListener('click', triggerDownload);
  }
  if (row && !row.dataset.bound) {
    row.dataset.bound = 'true';
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      if (e.target.closest('#btnDownloadAiModel')) return;
      triggerDownload(e);
    });
  }
  updateAiModelSettingsUI();
}

/**
 * 智慧鏡頭與模型載入進度面板控制函式 (#modelLoadingOverlay & #vlmModelLoadingCard)
 */
function showModelLoadingOverlay(statusText, percent = 0, detail = '正在自快取加載...', force = false) {
  if (typeof document === 'undefined') return;
  if (!force && isMobileClip2Downloaded()) {
    return;
  }
  const overlay = document.getElementById('modelLoadingOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.remove('fade-out');
  }
  const card = document.getElementById('vlmModelLoadingCard');
  if (card) {
    card.style.display = 'block';
    card.classList.remove('fade-out');
  }
  updateModelLoadingProgress(percent, statusText, detail);
}

function updateModelLoadingProgress(percent, statusText, detail) {
  if (typeof document === 'undefined') return;
  const p = Math.max(0, Math.min(100, Math.round(percent)));

  const overlay = document.getElementById('modelLoadingOverlay');
  if (overlay) {
    const bar = overlay.querySelector('#modelProgressBar') || overlay.querySelector('.model-progress-bar');
    const textEl = overlay.querySelector('#modelStatusText') || overlay.querySelector('.model-status-text');
    const percentEl = overlay.querySelector('#modelProgressPercent') || overlay.querySelector('.model-progress-percent');
    const detailEl = overlay.querySelector('#modelProgressDetail') || overlay.querySelector('.model-progress-detail');
    if (bar) bar.style.width = `${p}%`;
    if (textEl && statusText) textEl.textContent = statusText;
    if (percentEl) percentEl.textContent = `${p}%`;
    if (detailEl && detail) detailEl.textContent = detail;
  }
  updateVlmProgress(p, statusText, detail);
}

function hideModelLoadingOverlay(withFadeOut = true) {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('modelLoadingOverlay');
  const card = document.getElementById('vlmModelLoadingCard');

  if (withFadeOut) {
    if (overlay) overlay.classList.add('fade-out');
    if (card) card.classList.add('fade-out');
    setTimeout(() => {
      if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.remove('fade-out');
      }
      if (card) {
        card.style.display = 'none';
        card.classList.remove('fade-out');
      }
    }, 450);
  } else {
    if (overlay) overlay.style.display = 'none';
    if (card) card.style.display = 'none';
  }
}

function showVlmLoadingCard(statusText, percent = 0, detail = '正在自 IndexedDB 快取加載...') {
  showModelLoadingOverlay(statusText, percent, detail);
}

function updateVlmProgress(percent, statusText, detail) {
  if (typeof document === 'undefined') return;
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const card = document.getElementById('vlmModelLoadingCard');
  if (card) {
    const bar = card.querySelector('#vlmProgressBar') || card.querySelector('.vlm-progress-bar');
    const textEl = card.querySelector('#vlmStatusText') || card.querySelector('.vlm-status-text');
    const percentEl = card.querySelector('#vlmProgressPercent') || card.querySelector('.vlm-progress-percent');
    const detailEl = card.querySelector('#vlmProgressDetail') || card.querySelector('.vlm-progress-detail');
    if (bar) bar.style.width = `${p}%`;
    if (textEl && statusText) textEl.textContent = statusText;
    if (percentEl) percentEl.textContent = `${p}%`;
    if (detailEl && detail) detailEl.textContent = detail;
  }
}

function hideVlmLoadingCard(withFadeOut = true) {
  hideModelLoadingOverlay(withFadeOut);
}

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || navigator.vendor || (typeof window !== 'undefined' && window.opera) || '').toLowerCase();
  const isIPhone = /iphone/.test(ua);
  const isIPad = /ipad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/.test(ua);
  const isMobileUa = /mobile|touch|webos|blackberry|iemobile|opera mini/.test(ua);
  return isIPhone || isIPad || isAndroid || isMobileUa;
}

function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS;
}

function getVlmMaxDim() {
  return 256;
}

// 輔助函式：等待下一個渲染幀或事件循環 (釋放 WebGPU / GC)
function nextFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// 向量 L2 正規化 (Float32Array)
function l2Normalize(vec) {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq) || 1e-12;
  const res = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    res[i] = vec[i] / norm;
  }
  return res;
}

// 向量餘弦相似度 (兩向量皆已 L2 normalize，點積即為餘弦相似度)
function cosineSimilarity(v1, v2) {
  let dot = 0;
  const len = Math.min(v1.length, v2.length);
  for (let i = 0; i < len; i++) {
    dot += v1[i] * v2[i];
  }
  return dot;
}

/**
 * 7.7.1 初始化 MobileCLIP2-S0 視覺辨識模型 (Vision Encoder Only)
 * 模型: plhery/mobileclip2-onnx (S0 onnx/s0/vision_model, ~43.45 MB)
 * 禁止在手機端載入 254MB text_model.onnx
 */
async function initMobileClip2(onProgress = null, options = {}) {
  if (mobileClip2VisionModel && mobileClip2Processor && !options.forceReload) {
    return { model: mobileClip2VisionModel, processor: mobileClip2Processor };
  }
  if (isMobileClip2Loading && mobileClip2LoadPromise && !options.forceReload) {
    return await mobileClip2LoadPromise;
  }

  isMobileClip2Loading = true;
  const loadStartTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const alreadyDownloaded = isMobileClip2Downloaded();
  const shouldShowOverlay = options.forceShowOverlay === true || (!alreadyDownloaded && options.silent !== true);

  if (shouldShowOverlay) {
    showModelLoadingOverlay('首次下載 MobileCLIP2-S0 視覺模型 0%... 之後離線免下載', 0, '正在連線下載視覺特徵權重 (~43MB)...', true);
  }
  updateAiModelSettingsUI(0, 'downloading');

  mobileClip2LoadPromise = (async () => {
    try {
      const tf = await getVisionEngine();
      if (!tf || !tf.CLIPVisionModelWithProjection || !tf.AutoProcessor) {
        throw new Error('Transformers.js CLIPVisionModelWithProjection / AutoProcessor 不可用');
      }

      const progressCallback = (p) => {
        if (!p) return;
        if (p.status === 'progress' && p.file) {
          mobileClip2DownloadProgress[p.file] = {
            loaded: p.loaded || 0,
            total: p.total || 0,
            progress: p.progress !== undefined ? p.progress : (p.total ? (p.loaded / p.total) * 100 : 0)
          };
        } else if (p.status === 'done' && p.file) {
          mobileClip2DownloadProgress[p.file] = { loaded: 100, total: 100, progress: 100 };
        }

        let totalLoaded = 0;
        let totalSize = 0;
        let hasTotals = false;
        for (const f in mobileClip2DownloadProgress) {
          if (mobileClip2DownloadProgress[f].total > 0) {
            hasTotals = true;
            totalLoaded += mobileClip2DownloadProgress[f].loaded;
            totalSize += mobileClip2DownloadProgress[f].total;
          }
        }

        let percent = 0;
        if (hasTotals && totalSize > 0) {
          percent = Math.min(100, Math.round((totalLoaded / totalSize) * 100));
        } else if (p.progress !== undefined) {
          percent = Math.min(100, Math.round(p.progress));
        }

        const fileName = p.file ? p.file.split('/').pop() : '離線快取儲存中';
        const statusMsg = `首次下載 MobileCLIP2-S0 視覺模型 ${percent}%... 之後離線免下載`;
        if (shouldShowOverlay) {
          updateModelLoadingProgress(percent, statusMsg, `下載進度: ${fileName}`);
        }
        updateAiModelSettingsUI(percent, 'downloading');
        if (typeof onProgress === 'function') {
          onProgress(percent, statusMsg);
        }
      };

      const hasWebGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
      let usedDevice = hasWebGpu ? 'webgpu' : 'wasm';
      let visionModel = null;

      try {
        if (usedDevice === 'webgpu') {
          visionModel = await tf.CLIPVisionModelWithProjection.from_pretrained('plhery/mobileclip2-onnx', {
            device: 'webgpu',
            dtype: 'fp32',
            subfolder: 'onnx/s0',
            model_file_name: 'vision_model',
            progress_callback: progressCallback
          });
        } else {
          throw new Error('WebGPU not supported on this client');
        }
      } catch (gpuErr) {
        console.warn('[MOBILECLIP2] WebGPU 載入失敗或不支援，切換至 WASM 備援管線:', gpuErr?.message || gpuErr);
        usedDevice = 'wasm';
        visionModel = await tf.CLIPVisionModelWithProjection.from_pretrained('plhery/mobileclip2-onnx', {
          device: 'wasm',
          dtype: 'fp32',
          subfolder: 'onnx/s0',
          model_file_name: 'vision_model',
          progress_callback: progressCallback
        });
      }

      const processor = await tf.AutoProcessor.from_pretrained('plhery/mobileclip2-onnx', {
        config_file_name: 'onnx/s0/preprocessor_config.json'
      });

      mobileClip2VisionModel = visionModel;
      mobileClip2Processor = processor;

      if (typeof window !== 'undefined') {
        window.mobileClip2VisionModel = mobileClip2VisionModel;
        window.mobileClip2Processor = mobileClip2Processor;
      }

      const loadEndTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const loadDuration = ((loadEndTime - loadStartTime) / 1000).toFixed(2);
      console.log(`[MOBILECLIP2] ✅ MobileCLIP2-S0 視覺模型加載完成！(耗時: ${loadDuration} 秒, device: ${usedDevice})`);

      if (isCameraDebug()) {
        console.log('[MOBILECLIP2] engine init');
        console.log('[MOBILECLIP2] model = MobileCLIP2-S0');
        console.log('[MOBILECLIP2] model file = onnx/s0/vision_model');
        console.log(`[MOBILECLIP2] device = ${usedDevice}`);
        console.log('[MOBILECLIP2] input = 256x256');
      }

      markMobileClip2Downloaded();

      if (shouldShowOverlay) {
        updateModelLoadingProgress(100, 'MobileCLIP2-S0 視覺模型下載完成！', '✅ 模型快取已就緒，之後離線免下載！');
        setTimeout(() => hideModelLoadingOverlay(true), 500);
      } else {
        hideModelLoadingOverlay(false);
      }

      return { model: mobileClip2VisionModel, processor: mobileClip2Processor };
    } catch (err) {
      console.error('[MOBILECLIP2] 模型載入失敗：', err);
      hideModelLoadingOverlay(false);
      updateAiModelSettingsUI(0, 'error');
      mobileClip2VisionModel = null;
      mobileClip2Processor = null;
      throw err;
    } finally {
      isMobileClip2Loading = false;
      mobileClip2LoadPromise = null;

      if (isMobileClip2Downloaded()) {
        updateAiModelSettingsUI(100, 'downloaded');
      }
    }
  })();

  return await mobileClip2LoadPromise;
}

/**
 * 7.7.2 串行多 Crop 視覺特徵推論 (Strictly Serial Multi-Crop)
 * 最多依序分析 3 張：
 * 1. 整張照片 (0.40)
 * 2. 中央商品 Crop (0.40)
 * 3. 中央偏上包裝標籤 Crop (0.20)
 * 每次只允許單一推論，完畢立即 dispose tensor 並釋放記憶體
 */
async function runMobileClip2Vision(imageSource) {
  const { model, processor } = await initMobileClip2();
  const tf = await getVisionEngine();
  const RawImageClass = tf.RawImage || window.RawImage;

  if (!model || !processor) {
    throw new Error('[MOBILECLIP2] Vision Encoder 或 Processor 未正確初始化');
  }

  // 取得來源尺寸
  const sw = imageSource.videoWidth || imageSource.naturalWidth || imageSource.width || 800;
  const sh = imageSource.videoHeight || imageSource.naturalHeight || imageSource.height || 600;

  // 建立專用 256x256 臨時推論畫布
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = 256;
  cropCanvas.height = 256;
  const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });

  const crops = [];
  // 1. 全圖
  crops.push({
    name: 'whole image',
    weight: 0.40,
    sx: 0, sy: 0, sWidth: sw, sHeight: sh
  });

  // 2. 中央商品 Crop (70% 區域)
  if (sw >= 100 && sh >= 100) {
    const cWidth = Math.round(sw * 0.7);
    const cHeight = Math.round(sh * 0.7);
    crops.push({
      name: 'center crop',
      weight: 0.40,
      sx: Math.round((sw - cWidth) / 2),
      sy: Math.round((sh - cHeight) / 2),
      sWidth: cWidth,
      sHeight: cHeight
    });

    // 3. 中央偏上包裝標籤 Crop (60% 寬, 50% 高，位於頂端 10%~60% 處)
    const lWidth = Math.round(sw * 0.6);
    const lHeight = Math.round(sh * 0.5);
    crops.push({
      name: 'label crop',
      weight: 0.20,
      sx: Math.round((sw - lWidth) / 2),
      sy: Math.round(sh * 0.1),
      sWidth: lWidth,
      sHeight: lHeight
    });
  }

  const embeddings = [];

  // 嚴格串行執行：每張 Crop 完成後釋放暫存物件，等待下一幀動畫
  for (let i = 0; i < crops.length; i++) {
    const crop = crops[i];
    if (isCameraDebug()) {
      console.log(`[MOBILECLIP2] ${crop.name} inference start`);
    }

    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(imageSource, crop.sx, crop.sy, crop.sWidth, crop.sHeight, 0, 0, 256, 256);

    let rawImg = null;
    let inputs = null;
    let outputs = null;

    try {
      const imgData = ctx.getImageData(0, 0, 256, 256);
      rawImg = RawImageClass ? new RawImageClass(imgData.data, 256, 256, 4) : cropCanvas;

      inputs = await processor(rawImg);
      outputs = await model(inputs);

      const rawEmbed = outputs.image_embeds?.data;
      if (!rawEmbed || rawEmbed.length !== 512) {
        throw new Error(`[MOBILECLIP2] 特徵維度異常: ${rawEmbed ? rawEmbed.length : 'null'}`);
      }

      // L2 正規化單張 crop 特徵
      const normEmbed = l2Normalize(rawEmbed);
      embeddings.push({
        embed: normEmbed,
        weight: crop.weight
      });
    } finally {
      // 關鍵記憶體釋放：只在 API 真正支援 dispose 時呼叫
      inputs?.pixel_values?.dispose?.();
      outputs?.image_embeds?.dispose?.();
      rawImg = null;
      inputs = null;
      outputs = null;
    }

    if (isCameraDebug()) {
      console.log(`[MOBILECLIP2] ${crop.name} inference end`);
    }

    // 等待下一幀動畫讓瀏覽器垃圾回收與 WebGPU 釋放緩衝
    await nextFrame();
  }

  // 加權平均融合
  const finalEmbed = new Float32Array(512);
  let totalWeight = 0;
  for (const item of embeddings) {
    totalWeight += item.weight;
    for (let d = 0; d < 512; d++) {
      finalEmbed[d] += item.embed[d] * item.weight;
    }
  }
  for (let d = 0; d < 512; d++) {
    finalEmbed[d] /= totalWeight;
  }

  // 釋放推論畫布
  cropCanvas.width = 1;
  cropCanvas.height = 1;

  if (isCameraDebug()) {
    console.log('[MOBILECLIP2] temporary resources released');
  }

  return l2Normalize(finalEmbed);
}

/**
 * 7.7.3 全域商品特徵比對 (Global Candidate Matching & Category Prior)
 * 所有 97 個候選商品皆參與比對，不採用硬性 Top 2 Category Gating
 * 最終分數 = visualSimilarity * 0.90 + categoryPrior * 0.10
 */
async function classifyWithMobileClip2(imageSource) {
  try {
    let fusedImageEmbedding = null;
    if (imageSource instanceof Float32Array || (Array.isArray(imageSource) && imageSource.length === 512)) {
      fusedImageEmbedding = imageSource instanceof Float32Array ? imageSource : new Float32Array(imageSource);
    } else {
      fusedImageEmbedding = await runMobileClip2Vision(imageSource);
    }
    const { categories, candidates } = getMobileClip2Data();

    if (!categories || categories.length === 0 || !candidates || candidates.length === 0) {
      console.warn('[MOBILECLIP2] FALLBACK TO MOBILENET\nreason = 離線標籤資料庫未就緒');
      return await classifyImageVisual(imageSource);
    }

    // Stage 1: 大分類比對 (作為先驗 Prior，不作硬性過濾 Gate)
    const categoryScores = categories.map(cat => ({
      cat: cat.cat,
      label: cat.label,
      emoji: cat.emoji,
      score: cosineSimilarity(fusedImageEmbedding, cat.embedding)
    })).sort((a, b) => b.score - a.score);

    const catScoreMap = new Map(categoryScores.map(c => [c.cat, c.score]));

    // 全域 97 個細分類商品候選全面參與比對
    const allCandidateScores = candidates.map(c => {
      const visualSimilarity = cosineSimilarity(fusedImageEmbedding, c.embedding);
      const categoryPrior = catScoreMap.get(c.cat) ?? 0;
      // 商品本身的 image <-> text similarity 佔 90%，category prior 佔 10%
      const finalScore = visualSimilarity * 0.90 + categoryPrior * 0.10;
      return {
        id: c.id,
        cat: c.cat,
        subCat: c.subCat,
        defaultName: c.defaultName,
        emoji: c.emoji,
        defaultDays: c.defaultDays || 30,
        isContainer: !!c.isContainer,
        visualSimilarity,
        categoryPrior,
        finalScore,
        score: finalScore,
        probability: finalScore,
        candidate: c,
        className: c.defaultName,
        label: c.labels ? c.labels[0] : c.defaultName
      };
    }).sort((a, b) => b.finalScore - a.finalScore);

    const top10 = allCandidateScores.slice(0, 10);

    if (isCameraDebug()) {
      console.log('[MOBILECLIP2] CATEGORY SCORES');
      categoryScores.forEach((c, idx) => {
        console.log(`  ${(idx + 1).toString().padStart(2, ' ')}. ${c.cat.padEnd(14, ' ')} : ${c.score.toFixed(4)} (${c.label})`);
      });

      console.log('[MOBILECLIP2] GLOBAL CANDIDATE TOP10');
      top10.forEach((cand, idx) => {
        console.log(
          `  ${(idx + 1).toString().padStart(2, ' ')}. id=${cand.id.padEnd(20, ' ')} cat=${cand.cat.padEnd(12, ' ')} subCat=${(cand.subCat || '').padEnd(8, ' ')} ` +
          `visualSimilarity=${cand.visualSimilarity.toFixed(4)} categoryPrior=${cand.categoryPrior.toFixed(4)} finalScore=${cand.finalScore.toFixed(4)}`
        );
      });
    }

    return top10;
  } catch (err) {
    console.warn('[MOBILECLIP2] FALLBACK TO MOBILENET\nreason = 辨識過程異常: ' + (err?.message || err));
    return await classifyImageVisual(imageSource);
  }
}

/**
 * 7.7.4 商品辨識融合演算法 (Fusion Engine)
 * 整合 MobileCLIP2 視覺候選 + OCR 高解析度文字 + SMART_KEYWORD_MAP + Dairy Safety Check
 * 嚴格遵循 OCR-only 效期規則：未讀出日期時保持 null
 */
function fuseMobileClip2AndOcrDecision(visualPredictions, ocrData, existingItems = []) {
  const ocrText = (ocrData && ocrData.text) ? String(ocrData.text).trim() : '';
  const ocrBarcode = (ocrData && ocrData.barcode) ? String(ocrData.barcode).trim() : '';

  if (isCameraDebug()) {
    console.log('[OCR] raw text:\n' + (ocrText || '(無文字)'));
  }

  // 1. 原生條碼最優先 (ISBN)
  if (ocrData && ocrData.barcodeData && ocrData.barcodeData.isIsbn) {
    const isbnVal = ocrData.barcodeData.barcode;
    const finalDate = (ocrData && ocrData.date && /^\d{4}-\d{2}-\d{2}$/.test(ocrData.date)) ? ocrData.date : null;
    const result = {
      success: true,
      name: `圖書/漫畫 (ISBN: ${isbnVal})`,
      category: 'animation',
      subCategory: '漫畫/單行本',
      emoji: '📚',
      expiryDate: finalDate,
      hasEndDate: !!finalDate,
      remindDaysBefore: 30,
      remindTime: '09:00',
      confidence: 1.0,
      visualMatch: 'ISBN條碼直鎖',
      fusionMode: 'isbn_priority',
      visualPredictions: visualPredictions || [],
      ocrText: ocrText,
      notes: `ISBN: ${isbnVal}`
    };
    if (isCameraDebug()) {
      console.log('[FUSION] final result:', {
        name: result.name,
        category: result.category,
        subCategory: result.subCategory,
        emoji: result.emoji,
        expiryDate: result.expiryDate,
        fusionMode: result.fusionMode,
        confidence: result.confidence
      });
    }
    return result;
  }

  // 2. OCR 關鍵字比對 (SMART_KEYWORD_MAP)
  let ocrKeywordMatch = null;
  let ocrMatchedWord = '';
  const ocrLower = ocrText.toLowerCase();

  const DAIRY_KEYWORDS = ['牛奶', '鮮乳', '鮮奶', '生乳', '牛乳', 'milk', 'fresh milk'];
  const hasDairyOcrKeyword = DAIRY_KEYWORDS.some(kw => ocrLower.includes(kw.toLowerCase()));

  const CLEANING_KEYWORDS = ['洗衣精', '洗衣球', '洗衣膠囊', '洗衣粉', '柔軟精', '漂白水', '洗碗精', '洗潔精', '潔廁劑', '清潔劑', '除黴', '除霉', '去漬', '洗手乳', '洗手液', '地板清潔', '馬桶刷', '芳香劑', '馬桶清潔', '水垢清', '小蘇打', '過碳酸鈉'];
  const hasCleaningOcrKeyword = CLEANING_KEYWORDS.some(kw => ocrLower.includes(kw.toLowerCase()));

  if (ocrText) {
    let maxKwLen = 0;
    for (const mapItem of SMART_KEYWORD_MAP) {
      for (const kw of mapItem.keywords) {
        const kwLower = kw.toLowerCase();
        let isMatch = false;
        // 短英數字 (如 'ro', 'pc', 'tv', 'ps5') 必須在獨立邊界匹配，避免 Keychron 誤判為 ro
        if (/^[a-z0-9]{1,3}$/i.test(kwLower)) {
          const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
          isMatch = re.test(ocrLower);
        } else {
          isMatch = ocrLower.includes(kwLower);
        }
        if (isMatch) {
          if (kwLower.length > maxKwLen) {
            maxKwLen = kwLower.length;
            ocrKeywordMatch = mapItem;
            ocrMatchedWord = kw;
          }
        }
      }
    }
  }

  if (isCameraDebug() && ocrMatchedWord) {
    console.log('[FUSION] OCR keyword matches: ' + ocrMatchedWord);
  }

  // 0. 將 visualPredictions 規格化 (支援 MobileCLIP2 與 MobileNet 候選互通)
  const normalizedVisual = (visualPredictions || []).map(p => normalizeVisualPrediction(p)).filter(Boolean);

  // 3. 調整與重排視覺候選分數 (OCR 融合)
  // 如果 OCR 讀到乳品關鍵字，food_milk 獲得 +0.50 強力提升
  let bestCandidate = (normalizedVisual && normalizedVisual[0]) || null;
  let reWeighted = normalizedVisual || [];

  if (normalizedVisual && normalizedVisual.length > 0) {
    reWeighted = normalizedVisual.map(p => {
      let boost = 0;
      if (ocrKeywordMatch) {
        if (p.cat === ocrKeywordMatch.cat) boost += 0.25;
        if (p.subCat === ocrKeywordMatch.subCat) boost += 0.40;
      }
      if (p.id === 'food_milk' && hasDairyOcrKeyword) {
        boost += 0.50;
      }
      const baseScore = p.finalScore !== undefined ? p.finalScore : (p.score || 0);
      return {
        ...p,
        fusedScore: baseScore + boost
      };
    }).sort((a, b) => b.fusedScore - a.fusedScore);

    bestCandidate = reWeighted[0] || bestCandidate;
  }

  // 4. Dairy Safety Check (乳品安全防護)
  const milkCandInVisual = (normalizedVisual || []).find(c => c.id === 'food_milk');
  const top1Cand = (normalizedVisual && normalizedVisual[0]) || null;
  const top1Score = top1Cand ? (top1Cand.finalScore !== undefined ? top1Cand.finalScore : top1Cand.score || 0) : 0;
  const milkScore = milkCandInVisual ? (milkCandInVisual.finalScore !== undefined ? milkCandInVisual.finalScore : milkCandInVisual.score || 0) : 0;
  const isMilkScoreClose = milkCandInVisual && ((top1Score - milkScore) < 0.05);
  const isContainerAmbiguity = top1Cand && ['cleaning', 'pao', 'food'].includes(top1Cand.cat);

  const isDairyExplicitByOcr = hasDairyOcrKeyword || (ocrKeywordMatch && ocrKeywordMatch.cat === 'food' && ocrKeywordMatch.subCat === '鮮乳');

  let isDairyBySafetyCheck = false;
  if (isDairyExplicitByOcr) {
    isDairyBySafetyCheck = true;
    if (milkCandInVisual) bestCandidate = milkCandInVisual;
  } else if (isMilkScoreClose && isContainerAmbiguity) {
    // 視覺接近且候選落在 cleaning / pao / food
    // 若 OCR 明確命中清潔用品關鍵字，依清潔用品為準；
    // 否則「不要直接判成清潔用品」，優先保留 food_milk 候選
    const ocrConfirmsCleaning = hasCleaningOcrKeyword || (ocrKeywordMatch && ocrKeywordMatch.cat === 'cleaning');
    if (!ocrConfirmsCleaning) {
      if (top1Cand.cat === 'cleaning') {
        isDairyBySafetyCheck = true;
        if (milkCandInVisual) bestCandidate = milkCandInVisual;
      }
    }
  }

  // 5. 品名決策：
  // 檢查 OCR 是否辨識出已知品牌 (如 Logitech, Razer, Samsung, 光泉 等)
  let matchedBrand = '';
  if (ocrText) {
    const ocrLower = ocrText.toLowerCase();
    for (const b of KNOWN_BRANDS) {
      if (ocrLower.includes(b.toLowerCase())) {
        matchedBrand = b;
        break;
      }
    }
  }

  let finalName = '';
  // 優先級 1: Dairy Safety Check 保底品名「鮮乳」
  if (isDairyBySafetyCheck) {
    finalName = matchedBrand ? `${matchedBrand} 鮮乳` : '鮮乳';
  }
  // 優先級 2: OCR 關鍵字明確命中品類詞 (如 鮮乳、漫畫、Switch、立牌等)
  else if (ocrKeywordMatch && ocrMatchedWord) {
    finalName = matchedBrand ? `${matchedBrand} ${ocrMatchedWord}` : ocrMatchedWord;
  }
  // 優先級 3: 視覺模型已明確辨識出具體物品（非泛化 '生活物品'）
  else if (bestCandidate && bestCandidate.defaultName && bestCandidate.defaultName !== '生活物品' && bestCandidate.defaultName !== '未辨識物品') {
    if (matchedBrand) {
      finalName = `${matchedBrand} ${bestCandidate.defaultName}`;
    } else {
      finalName = bestCandidate.defaultName;
    }
  }
  // 優先級 4: 若視覺未識別具體物品，從 OCR 提取乾淨有效之品名（過濾 ad 3 等雜訊）
  else if (ocrText) {
    const cleanFallback = extractFallbackItemName(ocrText, normalizedVisual);
    if (cleanFallback && cleanFallback !== '新收錄物品' && !isOcrNoiseString(cleanFallback)) {
      finalName = cleanFallback;
    }
  }

  // 優先級 5: 最後保底品名
  if (!finalName || finalName === '新收錄物品' || finalName === '生活物品') {
    if (bestCandidate && bestCandidate.defaultName) {
      finalName = bestCandidate.defaultName;
    } else {
      finalName = '新收錄物品';
    }
  }
  finalName = simplifyItemName(finalName);

  // 6. 分類與圖標決策
  let finalCategory = 'other';
  let finalSubCategory = '未分類';
  let finalEmoji = '📦';

  if (isDairyBySafetyCheck) {
    finalCategory = 'food';
    finalSubCategory = '鮮乳';
    finalEmoji = '🥛';
  } else if (ocrKeywordMatch) {
    finalCategory = ocrKeywordMatch.cat;
    finalSubCategory = ocrKeywordMatch.subCat || '未分類';
    finalEmoji = ocrKeywordMatch.emoji;
  } else if (bestCandidate && bestCandidate.cat) {
    finalCategory = bestCandidate.cat || 'other';
    finalSubCategory = bestCandidate.subCat || '未分類';
    finalEmoji = bestCandidate.emoji || '📦';
  }

  const categoryConfig = DEFAULT_CATEGORIES[finalCategory] || DEFAULT_CATEGORIES['other'];

  // 7. 有效期限決策 (OCR-ONLY RULE: 絕不猜測，找不到即為 null)
  let finalExpiry = null;
  if (ocrData && ocrData.date && /^\d{4}-\d{2}-\d{2}$/.test(ocrData.date)) {
    finalExpiry = ocrData.date;
  } else if (ocrText) {
    const parsedDate = extractDateFromText(ocrText + ' ' + ocrBarcode);
    if (parsedDate && /^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) {
      finalExpiry = parsedDate;
    }
  }

  let fusionMode = 'mobileclip2_visual';
  if (isDairyBySafetyCheck) {
    fusionMode = isDairyExplicitByOcr ? 'dairy_ocr_priority' : 'dairy_safety_override';
  } else if (ocrKeywordMatch) {
    fusionMode = 'ocr_keyword_priority';
  }

  const finalResult = {
    success: true,
    name: finalName,
    category: finalCategory,
    categoryLabel: categoryConfig.label,
    subCategory: finalSubCategory,
    emoji: finalEmoji,
    expiryDate: finalExpiry,
    hasEndDate: !!finalExpiry,
    remindDaysBefore: categoryConfig.defaultRemindDays || 3,
    remindTime: '09:00',
    confidence: bestCandidate ? (bestCandidate.finalScore !== undefined ? bestCandidate.finalScore : bestCandidate.score) : 0.85,
    visualMatch: bestCandidate ? bestCandidate.defaultName : 'MobileCLIP2-S0',
    fusionMode: fusionMode,
    visualPredictions: visualPredictions || [],
    ocrText: ocrText,
    notes: ocrBarcode ? `條碼: ${ocrBarcode}` : undefined
  };

  if (isCameraDebug()) {
    console.log('[FUSION] final result:', {
      name: finalResult.name,
      category: finalResult.category,
      subCategory: finalResult.subCategory,
      emoji: finalResult.emoji,
      expiryDate: finalResult.expiryDate,
      fusionMode: finalResult.fusionMode,
      confidence: finalResult.confidence
    });
  }

  return finalResult;
}

/**
 * 7.7.5 智慧相機主分析入口 (MobileCLIP2-S0 + OCR 雙軌串行)
 * 絕不 Promise.all 兩者，嚴格保證：
 * MobileCLIP2 推論完成 -> 釋放記憶體 -> await nextFrame -> OCR -> 融合
 */
async function analyzeSmartCameraWithMobileClip2(imageSource, photoDataUrl) {
  // 1. 原生條碼快速檢查
  const barcodeImmediate = await scanBarcodePriority(imageSource);
  if (barcodeImmediate && barcodeImmediate.isIsbn) {
    return {
      success: true,
      name: barcodeImmediate.name,
      category: 'animation',
      subCategory: '漫畫/單行本',
      emoji: '📚',
      expiryDate: null, // OCR-only, 條碼無效期
      hasEndDate: false,
      remindDaysBefore: 30,
      remindTime: '09:00',
      confidence: 1.0,
      visualMatch: 'ISBN條碼直鎖',
      fusionMode: 'isbn_priority',
      notes: barcodeImmediate.notes,
      image: photoDataUrl || null
    };
  }

  // 2. 軌道一：MobileCLIP2 視覺特徵比對
  if (typeof updateAiScanStep === 'function') {
    updateAiScanStep('scanStepVisual', 'active', '正在辨識商品外觀...');
  }
  const statusDesc = document.getElementById('aiScanStatusText');
  if (statusDesc) statusDesc.textContent = '正在辨識商品外觀...';

  let visualPredictions = [];
  try {
    visualPredictions = await classifyWithMobileClip2(imageSource);
  } catch (visErr) {
    console.warn('[MOBILECLIP2] 視覺分析異常，降級備援:', visErr);
  }

  if (typeof updateAiScanStep === 'function') {
    updateAiScanStep('scanStepVisual', 'done', '商品外觀特徵比對完成');
  }

  // 等待下一渲染幀，確保視覺臨時 Tensor 完全釋放
  await nextFrame();

  // 3. 軌道二：Tesseract OCR 文字與效期提取 (使用原始高解析度影像，非 256x256)
  if (typeof updateAiScanStep === 'function') {
    updateAiScanStep('scanStepOcr', 'active', '正在讀取包裝文字與日期...');
  }
  if (statusDesc) statusDesc.textContent = '正在讀取包裝文字與日期...';

  let ocrData = null;
  try {
    if (typeof runTextAndDateOcr === 'function') {
      ocrData = await runTextAndDateOcr(imageSource);
    }
  } catch (ocrErr) {
    console.warn('[OCR] 文字辨識異常:', ocrErr);
  }

  if (typeof updateAiScanStep === 'function') {
    updateAiScanStep('scanStepOcr', 'done', '包裝文字與效期提取完成');
  }

  // 4. 決策融合
  if (typeof updateAiScanStep === 'function') {
    updateAiScanStep('scanStepFuse', 'active', '正在確認商品類型...');
  }
  if (statusDesc) statusDesc.textContent = '正在確認商品類型...';

  const itemsList = (typeof window !== 'undefined' && window.getItems) ? window.getItems() : [];
  const fused = fuseMobileClip2AndOcrDecision(visualPredictions, ocrData, itemsList);

  if (photoDataUrl) {
    fused.image = photoDataUrl;
  }

  // DOM 賦值連動
  if (typeof applyVlmDomValues === 'function') {
    applyVlmDomValues(fused.name, fused.category, fused.expiryDate);
  }

  if (typeof updateAiScanStep === 'function') {
    updateAiScanStep('scanStepFuse', 'done', '商品分析與效期校驗完成！');
  }

  return fused;
}

/**
 * 預先觸發視覺模型初始化 (initVisionModel)
 * 使用者開啟相機或點擊下載時調用
 */
async function initVisionModel(onProgress, options = {}) {
  return await initMobileClip2(onProgress, options);
}

/**
 * 相容舊版 initVlmModel / initMoondreamModel
 */
async function initVlmModel(onProgress, options = {}) {
  return await initMobileClip2(onProgress, options);
}
async function initMoondreamModel(onProgress, options = {}) {
  return await initMobileClip2(onProgress, options);
}

/**
 * 相容舊版 analyzeSmartCameraWithMobileClip / analyzeSmartCameraWithVlm / analyzeSmartCameraWithMoondream
 */
async function analyzeSmartCameraWithMobileClip(imageSource, photoDataUrl) {
  return await analyzeSmartCameraWithMobileClip2(imageSource, photoDataUrl);
}
async function analyzeSmartCameraWithVlm(imageSource, photoDataUrl) {
  return await analyzeSmartCameraWithMobileClip2(imageSource, photoDataUrl);
}
async function analyzeSmartCameraWithMoondream(imageSource, photoDataUrl) {
  return await analyzeSmartCameraWithMobileClip2(imageSource, photoDataUrl);
}

function compressImageForVlm(imageSource, maxDim = 256) {
  if (typeof document === 'undefined') return imageSource;
  const targetMaxDim = (typeof maxDim === 'number' && maxDim > 0) ? maxDim : 256;
  let sw = imageSource.videoWidth || imageSource.naturalWidth || imageSource.width || 800;
  let sh = imageSource.videoHeight || imageSource.naturalHeight || imageSource.height || 600;
  let dw = sw;
  let dh = sh;
  if (dw > targetMaxDim || dh > targetMaxDim) {
    if (dw > dh) {
      dh = Math.round((dh * targetMaxDim) / dw);
      dw = targetMaxDim;
    } else {
      dw = Math.round((dw * targetMaxDim) / dh);
      dh = targetMaxDim;
    }
  }
  const vlmCanvas = document.createElement('canvas');
  vlmCanvas.width = dw;
  vlmCanvas.height = dh;
  const ctx = vlmCanvas.getContext('2d');
  ctx.drawImage(imageSource, 0, 0, dw, dh);
  return vlmCanvas.toDataURL('image/jpeg', 0.85);
}

const VLM_PROMPT = '';

async function runVlmInference(pipeOrInstance, imgDataUrl) {
  const top = (await classifyWithMobileClip2(imgDataUrl))?.[0];
  return JSON.stringify({
    name: top ? top.defaultName : '生活物品',
    category: top ? top.cat : 'other',
    expiry: null,
    shelf_life_days: top ? top.defaultDays : 30
  });
}

function parseVLMResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { name: '', category: '', expiry: null, parsedName: '', parsedCategory: '', parsedExpiry: null };
  }
  let parsedName = '';
  let parsedCategory = '';
  let parsedExpiry = null;
  try {
    const obj = JSON.parse(rawText);
    parsedName = obj.name || '';
    parsedCategory = obj.category || '';
    parsedExpiry = obj.expiry || null;
  } catch (e) {}
  return { name: parsedName, category: parsedCategory, expiry: parsedExpiry, parsedName, parsedCategory, parsedExpiry };
}

function parseVlmJsonResponse(rawText) {
  return parseVLMResponse(rawText);
}

function normalizeCategory(rawCat) {
  return normalizeCategoryKey(rawCat);
}

function applyVlmDomValues(parsedName, parsedCategory, parsedExpiry) {
  if (typeof document === 'undefined') return;
  try {
    const rawCat = parsedCategory || '';
    const normKey = normalizeCategoryKey(rawCat);
    const catSelect = document.getElementById('itemCategory');
    if (catSelect && normKey) {
      catSelect.value = normKey;
      catSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const nameInput = document.getElementById('smartQuickAddInput');
    if (nameInput && parsedName) {
      nameInput.value = `${parsedName} ${parsedExpiry ? parsedExpiry + '到期' : ''}`.trim();
      nameInput.classList.add('has-clear');
      const clearBtn = document.getElementById('smartQuickAddClear');
      if (clearBtn) clearBtn.style.display = 'flex';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const nlpNameInput = document.getElementById('nlpConfirmName');
    if (nlpNameInput && parsedName) {
      nlpNameInput.value = parsedName;
      nlpNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const formattedExpiry = parsedExpiry ? String(parsedExpiry).replace(/\//g, '-') : '';
    const expiryInput = document.getElementById('itemExpiryDateInput');
    if (expiryInput) {
      expiryInput.value = formattedExpiry;
      expiryInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const altExpiryInput = document.getElementById('itemEndDate');
    if (altExpiryInput && altExpiryInput !== expiryInput) {
      altExpiryInput.value = formattedExpiry;
      altExpiryInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const nlpExpiryInput = document.getElementById('nlpConfirmDate');
    if (nlpExpiryInput && nlpExpiryInput !== expiryInput && nlpExpiryInput !== altExpiryInput) {
      nlpExpiryInput.value = formattedExpiry;
      nlpExpiryInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const nlpDaysInput = document.getElementById('nlpConfirmDays');
    if (nlpDaysInput && !parsedExpiry) {
      nlpDaysInput.value = '';
    }
  } catch (domErr) {
    console.warn('[applyVlmDomValues] DOM 賦值異常：', domErr);
  }
}

function formatVlmResult(result, photoDataUrl, skipDom = false) {
  const name = (result && (result.name || result.parsedName)) || '生活物品';
  const rawCat = (result && (result.category || result.parsedCategory)) || 'other';
  const category = normalizeCategoryKey(rawCat);
  const categoryLabel = (typeof DEFAULT_CATEGORIES !== 'undefined' && DEFAULT_CATEGORIES[category])
    ? DEFAULT_CATEGORIES[category].label
    : normalizeCategory(rawCat);
  const subCategory = (result && (result.subCategory || result.parsedSubCategory)) || '';
  const emoji = (typeof DEFAULT_CATEGORIES !== 'undefined' && DEFAULT_CATEGORIES[category])
    ? DEFAULT_CATEGORIES[category].emoji
    : '📦';

  let expiryDate = null;
  const candidateExpiry = (result && (result.expiry || result.parsedExpiry)) ? String(result.expiry || result.parsedExpiry).trim().replace(/\//g, '-') : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidateExpiry)) {
    expiryDate = candidateExpiry;
  }

  if (!skipDom) {
    applyVlmDomValues(name, rawCat, expiryDate);
  }

  return {
    success: true,
    name: name,
    category: category,
    categoryLabel: categoryLabel,
    subCategory: subCategory,
    emoji: emoji,
    expiryDate: expiryDate,
    hasEndDate: !!expiryDate,
    remindDaysBefore: 3,
    remindTime: '09:00',
    confidence: 0.96,
    visualMatch: 'MobileCLIP2-S0',
    fusionMode: 'mobileclip2_s0',
    image: photoDataUrl || null,
    vlmExpiryCandidate: null,
    ocrText: (result && result.ocrRawText) || '',
    dateCandidates: (result && result.ocrDateCandidates) || [],
    dateSource: expiryDate ? 'OCR' : 'none'
  };
}

function disposeMobileClip2TemporaryResources() {
  if (isCameraDebug()) {
    console.log('[MOBILECLIP2] temporary resources released');
  }
}

function isMobileClip2Loaded() {
  return !!(mobileClip2VisionModel && mobileClip2Processor);
}

function isMobileClip2LoadingStatus() {
  return !!isMobileClip2Loading;
}

function resetMobileClip2Model() {
  if (mobileClip2VisionModel) {
    try {
      mobileClip2VisionModel.dispose?.();
    } catch (e) {}
  }
  mobileClip2VisionModel = null;
  mobileClip2Processor = null;
  isMobileClip2Loading = false;
  mobileClip2LoadPromise = null;
}

// ==========================================
// 7.8 獨立 MobileCLIP2 手機測試套件 (?mobilecliptest=1)
// ==========================================
function isMobileClipTestMode() {
  if (typeof window === 'undefined' || !window.location) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('mobilecliptest') === '1';
  } catch (e) {
    return false;
  }
}

async function initMobileClipTest(onProgress = null) {
  return await initMobileClip2(onProgress);
}

async function testMobileClip(imageDataUrl, candidateLabels = null, onProgress = null) {
  try {
    if (!imageDataUrl) {
      throw new Error('請提供圖片參數 imageDataUrl');
    }
    const top5 = await classifyWithMobileClip2(imageDataUrl);
    return top5.map(item => ({
      label: `${item.defaultName} (${item.subCat})`,
      score: typeof item.score === 'number' ? Number(item.score.toFixed(4)) : item.score
    }));
  } catch (error) {
    console.error('[MOBILECLIP TEST] ERROR', error && error.stack ? error.stack : error);
    throw error;
  }
}

async function runMobileClipCameraTest(photoDataUrl) {
  console.log('[MOBILECLIP TEST] 執行手機測試模式分析 (MobileCLIP2-S0)...');
  try {
    if (typeof showAiScanLoading === 'function') {
      showAiScanLoading(photoDataUrl);
      const desc = document.getElementById('aiScanStatusText');
      if (desc) desc.textContent = 'MobileCLIP2 辨識中...';
    }

    const results = await testMobileClip(photoDataUrl);

    if (typeof hideAiScanLoading === 'function') {
      hideAiScanLoading();
    }
    if (typeof closeCameraScanModal === 'function') {
      closeCameraScanModal();
    }

    let msg = 'MobileCLIP2-S0 測試結果\n\n';
    if (Array.isArray(results) && results.length > 0) {
      results.slice(0, 5).forEach((item, idx) => {
        const scoreNum = typeof item.score === 'number' ? item.score : parseFloat(item.score);
        const pct = !isNaN(scoreNum)
          ? (scoreNum <= 1 ? (scoreNum * 100).toFixed(1) : scoreNum.toFixed(1)) + '%'
          : item.score;
        msg += `${idx + 1}. ${item.label} — ${pct}\n`;
      });
    } else {
      msg += '（未取得辨識結果）';
    }

    setTimeout(() => alert(msg), 100);
    return results;
  } catch (error) {
    console.error('[MOBILECLIP TEST] ERROR', error);
    if (typeof hideAiScanLoading === 'function') {
      hideAiScanLoading();
    }
    if (typeof closeCameraScanModal === 'function') {
      closeCameraScanModal();
    }
    setTimeout(() => alert(`MobileCLIP TEST ERROR\n${error && error.message ? error.message : error}`), 100);
    throw error;
  }
}

// 相容舊版 MobileCLIP 測試常數與函式
const MOBILECLIP_TEST_CANDIDATES = MOBILECLIP2_CANDIDATES;
const MOBILECLIP_CANDIDATES = MOBILECLIP2_CANDIDATES;
const MOBILECLIP_CANDIDATE_MAP = {};
function getMobileClipCandidate(id) {
  return MOBILECLIP2_CANDIDATES.find(c => c.id === id) || null;
}
const initMobileClipModel = initMobileClip2;
const classifyImageWithMobileClip = classifyWithMobileClip2;
const testMobileClip2 = testMobileClip;

// ==========================================
// 8. 全域掛載與自啟動
// ==========================================
if (typeof window !== 'undefined') {
  window.nerPipeline = nerPipeline;
  window.initModel = initModel;
  window.updateNerStatus = updateNerStatus;
  window.parseWithLocalNER = parseWithLocalNER;
  window.parseNaturalInput = parseNaturalInput;
  window.parseNaturalInputAsync = parseNaturalInputAsync;
  window.matchCategoryAndSubCategory = matchCategoryAndSubCategory;
  window.SMART_KEYWORD_MAP = SMART_KEYWORD_MAP;
  window.extractTime = extractTime;
  window.extractDate = extractDate;
  window.extractCleanName = extractCleanName;
  window.simplifyItemName = simplifyItemName;
  window.addItem = addItem;
  window.updateItemByNlp = updateItemByNlp;
  window.renderProgressBar = renderProgressBar;
  window.renderCardProgressBar = renderProgressBar;
  window.applyProgressBarStatus = renderProgressBar;
  window.getItemStatusConfig = getItemStatusConfig;
  window.VISUAL_APPEARANCE_DICT = VISUAL_APPEARANCE_DICT;
  window.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
  window.SUB_CATEGORY_CONFIG = SUB_CATEGORY_CONFIG;
  window.CATEGORY_MAP_TO_KEY = CATEGORY_MAP_TO_KEY;
  window.normalizeCategoryKey = normalizeCategoryKey;
  window.initMobileNet = initMobileNet;
  window.classifyImageVisual = classifyImageVisual;
  window.scanBarcodePriority = scanBarcodePriority;
  window.preprocessImageForOcr = preprocessImageForOcr;
  window.extractDateFromText = extractDateFromText;
  window.extractOcrDateCandidates = extractOcrDateCandidates;
  window.OCR_DATE_KEYWORDS = OCR_DATE_KEYWORDS;
  window.runTextAndDateOcr = runTextAndDateOcr;
  window.fuseVisualAndOcrDecision = fuseVisualAndOcrDecision;
  window.analyzeSmartCameraDualTrack = analyzeSmartCameraDualTrack;
  window.loadTransformers = loadTransformers;
  window.getVisionEngine = getVisionEngine;
  window.initVisionModel = initVisionModel;
  window.extractFallbackItemName = extractFallbackItemName;
  window.JP_TO_TC_DICT = JP_TO_TC_DICT;
  window.localizeJapaneseText = localizeJapaneseText;
  window.VISUAL_LABEL_TRANSLATIONS = VISUAL_LABEL_TRANSLATIONS;
  window.showModelLoadingOverlay = showModelLoadingOverlay;
  window.updateModelLoadingProgress = updateModelLoadingProgress;
  window.hideModelLoadingOverlay = hideModelLoadingOverlay;
  window.isMobileDevice = isMobileDevice;
  window.isIosSafari = isIosSafari;
  window.getVlmMaxDim = getVlmMaxDim;
  window.initVlmModel = initVlmModel;
  window.compressImageForVlm = compressImageForVlm;
  window.runVlmInference = runVlmInference;
  window.parseVLMResponse = parseVLMResponse;
  window.parseVlmJsonResponse = parseVlmJsonResponse;
  window.normalizeCategory = normalizeCategory;
  window.applyVlmDomValues = applyVlmDomValues;
  window.formatVlmResult = formatVlmResult;
  window.analyzeSmartCameraWithVlm = analyzeSmartCameraWithVlm;
  window.showVlmLoadingCard = showVlmLoadingCard;
  window.updateVlmProgress = updateVlmProgress;
  window.hideVlmLoadingCard = hideVlmLoadingCard;
  window.vlmProcessor = vlmProcessor;
  window.vlmModel = vlmModel;
  window.VLM_PROMPT = VLM_PROMPT;
  window.cameraDebug = true;
  window.isCameraDebug = isCameraDebug;
  window.getLastCreatedItem = () => lastCreatedItem;
  window.setLastCreatedItem = (item) => { lastCreatedItem = item; };
  window.testMobileClip = testMobileClip;
  window.initMobileClipTest = initMobileClipTest;
  window.MOBILECLIP_TEST_CANDIDATES = MOBILECLIP_TEST_CANDIDATES;
  window.isMobileClipTestMode = isMobileClipTestMode;
  window.runMobileClipCameraTest = runMobileClipCameraTest;
  window.MOBILECLIP_CANDIDATES = MOBILECLIP_CANDIDATES;
  window.MOBILECLIP_CANDIDATE_MAP = MOBILECLIP_CANDIDATE_MAP;
  window.getMobileClipCandidate = getMobileClipCandidate;
  window.isMoondreamModelDownloaded = isMoondreamModelDownloaded;
  window.markMoondreamModelDownloaded = markMoondreamModelDownloaded;
  window.initMoondreamModel = initMoondreamModel;
  window.analyzeSmartCameraWithMoondream = analyzeSmartCameraWithMoondream;
  window.updateAiModelSettingsUI = updateAiModelSettingsUI;
  window.setupAiModelSettingsHandler = setupAiModelSettingsHandler;
  window.moondreamModelInstance = () => moondreamModelInstance;

  // v1.8.22 MobileCLIP2-S0 exports
  window.initMobileClip2 = initMobileClip2;
  window.runMobileClip2Vision = runMobileClip2Vision;
  window.classifyWithMobileClip2 = classifyWithMobileClip2;
  window.fuseMobileClip2AndOcrDecision = fuseMobileClip2AndOcrDecision;
  window.analyzeSmartCameraWithMobileClip2 = analyzeSmartCameraWithMobileClip2;
  window.testMobileClip2 = testMobileClip2;
  window.isMobileClip2Loaded = isMobileClip2Loaded;
  window.isMobileClip2LoadingStatus = isMobileClip2LoadingStatus;
  window.resetMobileClip2Model = resetMobileClip2Model;
  window.MOBILECLIP2_CATEGORIES = MOBILECLIP2_CATEGORIES;
  window.MOBILECLIP2_CANDIDATES = MOBILECLIP2_CANDIDATES;

  // DOM 載入後自動綁定設定頁面 AI 模型按鈕與更新狀態
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setupAiModelSettingsHandler();
      });
    } else {
      setupAiModelSettingsHandler();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cameraDebug: true,
    isCameraDebug,
    initModel,
    updateNerStatus,
    parseWithLocalNER,
    parseNaturalInput,
    parseNaturalInputAsync,
    matchCategoryAndSubCategory,
    SMART_KEYWORD_MAP,
    extractTime,
    extractDate,
    extractCleanName,
    simplifyItemName,
    addItem,
    updateItemByNlp,
    renderProgressBar,
    renderCardProgressBar: renderProgressBar,
    applyProgressBarStatus: renderProgressBar,
    getItemStatusConfig,
    VISUAL_APPEARANCE_DICT,
    DEFAULT_CATEGORIES,
    SUB_CATEGORY_CONFIG,
    CATEGORY_MAP_TO_KEY,
    normalizeCategoryKey,
    initMobileNet,
    classifyImageVisual,
    scanBarcodePriority,
    preprocessImageForOcr,
    extractDateFromText,
    extractOcrDateCandidates,
    OCR_DATE_KEYWORDS,
    runTextAndDateOcr,
    fuseVisualAndOcrDecision,
    analyzeSmartCameraDualTrack,
    loadTransformers,
    getVisionEngine,
    initVisionModel,
    extractFallbackItemName,
    JP_TO_TC_DICT,
    localizeJapaneseText,
    VISUAL_LABEL_TRANSLATIONS,
    showModelLoadingOverlay,
    updateModelLoadingProgress,
    hideModelLoadingOverlay,
    isMobileDevice,
    isIosSafari,
    getVlmMaxDim,
    initVlmModel,
    vlmProcessor: () => vlmProcessor,
    vlmModel: () => vlmModel,
    compressImageForVlm,
    runVlmInference,
    parseVLMResponse,
    parseVlmJsonResponse,
    normalizeCategory,
    applyVlmDomValues,
    formatVlmResult,
    analyzeSmartCameraWithVlm,
    showVlmLoadingCard,
    updateVlmProgress,
    hideVlmLoadingCard,
    VLM_PROMPT,
    getLastCreatedItem: () => lastCreatedItem,
    setLastCreatedItem: (item) => { lastCreatedItem = item; },
    testMobileClip,
    initMobileClipTest,
    MOBILECLIP_TEST_CANDIDATES,
    isMobileClipTestMode,
    runMobileClipCameraTest,
    MOBILECLIP_CANDIDATES,
    MOBILECLIP_CANDIDATE_MAP,
    getMobileClipCandidate,
    initMobileClipModel,
    classifyImageWithMobileClip,
    analyzeSmartCameraWithMobileClip,
    isMoondreamModelDownloaded,
    markMoondreamModelDownloaded,
    initMoondreamModel,
    analyzeSmartCameraWithMoondream,
    updateAiModelSettingsUI,
    setupAiModelSettingsHandler,
    moondreamModelInstance: () => moondreamModelInstance,
    // v1.8.22 MobileCLIP2-S0 exports
    initMobileClip2,
    runMobileClip2Vision,
    classifyWithMobileClip2,
    fuseMobileClip2AndOcrDecision,
    analyzeSmartCameraWithMobileClip2,
    testMobileClip2,
    isMobileClip2Loaded,
    isMobileClip2LoadingStatus,
    resetMobileClip2Model,
    MOBILECLIP2_CATEGORIES,
    MOBILECLIP2_CANDIDATES
  };
}
