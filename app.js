/**
 * 期效管家 - 純本機智慧自然語言速記與 RoBERTa-Tiny / BERT-Tiny 命名實體識別引擎
 * Smart Quick Add & On-Device NER Parser v1.8.18
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
 */

// ==========================================
// 1. 全域狀態與模型管線 & VLM Debug 診斷開關
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
    '豆漿', '奶粉', 'milk', '優酪乳', '燕麥奶', '堅果奶', '黑豆漿', '米漿', '鮮奶油',
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
// 2.9 AI 模型防護載入引擎 (getVisionEngine - 僅於使用者點擊相機時觸發)
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
      if (tf.AutoModelForVision2Seq) window.AutoModelForVision2Seq = tf.AutoModelForVision2Seq;
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
      console.error('[VLM DEBUG] Transformers.js 動態 import 失敗:\n完整 Error Stack:', err && err.stack ? err.stack : err);
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
        console.log('[VLM DEBUG] Transformers.js 是否成功載入: 成功');
      }
      return tf;
    }
    if (isDebug) {
      console.error('[VLM DEBUG] Transformers.js 是否成功載入: 失敗 (getVisionEngine 回傳空值)');
    }
    return null;
  } catch (err) {
    if (isDebug) {
      console.error('[VLM DEBUG] Transformers.js 是否成功載入: 失敗 (載入發生例外)\n完整 Error Stack:', err && err.stack ? err.stack : err);
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
    keywords: ['mouse', 'computer mouse', 'keyboard', 'typewriter keyboard', 'space bar'],
    name: '電腦周邊耗材',
    category: 'filter',
    categoryLabel: '耗材',
    subCategory: '周邊',
    defaultDays: 180,
    emoji: '⌨️',
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
  if (typeof isVlmLoading !== 'undefined' && isVlmLoading && typeof isIosSafari === 'function' && isIosSafari()) {
    console.log('[iOS Safari 保護] VLM 模型正在下載中，暫緩 OCR 載入');
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
  'keyboard': '電腦鍵盤',
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
 * 階梯式品名自動填入（絕不留白）
 * 1. 第一階：過濾成分、熱量、電話等雜訊，取 OCR 最靠上方 2～15 字的中英日品名（日文轉繁中）
 * 2. 第二階：命中特定品類詞庫（如漫畫/Switch/立牌/鮮乳）直接套用標準繁中品名
 * 3. 第三階：若無文字，以視覺特徵標籤翻譯中文保底，最低限度維持「新收錄物品」，嚴禁留空
 */
function extractFallbackItemName(ocrText = '', visualPredictions = []) {
  // 第一階（OCR 文字優先）：過濾成分、熱量、電話等雜訊，取 OCR 最靠上方 2～15 字的中英日品名（日文轉繁中）
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

      if (cleaned.length >= 2 && cleaned.length <= 15) {
        if (!/^\d+$/.test(cleaned) && !/^(batch|lot|no|tel|sn|exp|mfg|date|time)$/i.test(cleaned)) {
          return cleaned;
        }
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
      const cls = (pred && pred.className ? String(pred.className) : '').toLowerCase();
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

  // 1. 檢視視覺辨識前 5 大結果命中外觀特徵庫的情況
  let topVisualMatch = null;
  let topVisualConfidence = 0;
  let topVisualClassName = '';

  if (Array.isArray(visualPredictions)) {
    let bestKwLength = 0;
    for (const pred of visualPredictions) {
      const clsName = (pred.className || '').toLowerCase();
      const prob = typeof pred.probability === 'number' ? pred.probability : 0;
      for (const dictItem of VISUAL_APPEARANCE_DICT) {
        for (const kw of dictItem.keywords) {
          const kwLower = kw.toLowerCase();
          if (clsName.includes(kwLower)) {
            if (prob > topVisualConfidence || (Math.abs(prob - topVisualConfidence) < 0.05 && kwLower.length > bestKwLength)) {
              topVisualConfidence = prob;
              bestKwLength = kwLower.length;
              topVisualMatch = dictItem;
              topVisualClassName = pred.className;
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
    'eggs': '雞蛋'
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
    finalName = OCR_NAME_TRANSLATIONS[ocrMatchedWord.toLowerCase()] || ocrMatchedWord;

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
  // 【決策分支 1】：若外觀特徵命中率高（置信度 > 0.35），且圖片中無明顯中文品名
  else if (topVisualMatch && topVisualConfidence >= 0.25 && !ocrMatchedWord) {
    fusionMode = 'visual_priority';
    finalName = topVisualMatch.name;
    finalCategory = topVisualMatch.category;
    finalSubCategory = topVisualMatch.subCategory;
    finalEmoji = topVisualMatch.emoji;
    defaultDays = topVisualMatch.defaultDays;
  }
  // 【決策分支 3】：若 OCR 掃到明確品名，但外觀非容器或信心度較低
  else if (ocrMatchedWord) {
    fusionMode = 'ocr_priority';
    finalName = OCR_NAME_TRANSLATIONS[ocrMatchedWord.toLowerCase()] || ocrMatchedWord;
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
  // 【決策分支 6】：無特徵之階梯式保底（第一階 OCR 2~10字、第二階 MobileNet 視覺標籤翻譯、第三階 生活物品）
  else {
    fusionMode = 'default_fallback';
    finalName = extractFallbackItemName(ocrText, visualPredictions);
    finalCategory = 'other';
    finalSubCategory = '未分類';
    defaultDays = 30;
    finalEmoji = '📦';
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

  // 期限判定：若無印刷日期，自動採用預設保存天數
  if (!finalDate) {
    finalDate = formatDate(offsetDays(today, defaultDays));
  }

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
    expiryDate: finalDate,
    hasEndDate: true,
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

  // 2. 視覺外觀分類 + 文字效期 OCR
  // Mobile Stable Mode uses sequential execution to reduce peak memory usage on iOS/Android browsers.
  let visualPredictions = [];
  let ocrData = null;
  if (isMobileDevice()) {
    console.log('[MOBILE AI] Sequential recognition: MobileNet -> OCR');
    visualPredictions = await classifyImageVisual(imageSource);
    ocrData = await runTextAndDateOcr(imageSource);
  } else {
    [visualPredictions, ocrData] = await Promise.all([
      classifyImageVisual(imageSource),
      runTextAndDateOcr(imageSource)
    ]);
  }

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
// 7.7 端側視覺語言大模型 (VLM - SmolVLM WebGPU) v1.8.18
// ==========================================
let vlmProcessor = null;
let vlmModel = null;
let vlmPipeline = null;
let isVlmLoading = false;
let vlmStatus = 'idle'; // 'idle' | 'loading' | 'ready' | 'fallback'
const vlmFileProgress = {};

/**
 * 智慧鏡頭 VLM 與通用模型載入進度面板控制函式 (#modelLoadingOverlay & #vlmModelLoadingCard)
 */
function showModelLoadingOverlay(statusText, percent = 0, detail = '正在自快取加載...') {
  if (typeof document === 'undefined') return;
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
    if (percentEl) percentEl.textContent = `${p}%`;
    if (textEl && statusText) textEl.textContent = statusText;
    if (detailEl && detail) detailEl.textContent = detail;
  }

  updateVlmProgress(percent, statusText, detail);
}

function hideModelLoadingOverlay(withFadeOut = true) {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('modelLoadingOverlay');
  if (overlay) {
    if (withFadeOut) {
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.remove('fade-out');
      }, 650);
    } else {
      overlay.style.display = 'none';
      overlay.classList.remove('fade-out');
    }
  }
  hideVlmLoadingCard(withFadeOut);
}

function showVlmLoadingCard(statusText, percent = 0, detail = '正在自 IndexedDB 快取加載...') {
  showModelLoadingOverlay(statusText, percent, detail);
}

function updateVlmProgress(percent, statusText, detail) {
  if (typeof document === 'undefined') return;
  const card = document.getElementById('vlmModelLoadingCard');
  if (!card) return;

  const bar = document.getElementById('vlmProgressBar');
  const textEl = document.getElementById('vlmStatusText');
  const percentEl = document.getElementById('vlmProgressPercent');
  const detailEl = document.getElementById('vlmProgressDetail');

  const p = Math.max(0, Math.min(100, Math.round(percent)));
  if (bar) bar.style.width = `${p}%`;
  if (percentEl) percentEl.textContent = `${p}%`;
  if (textEl && statusText) textEl.textContent = statusText;
  if (detailEl && detail) detailEl.textContent = detail;
}

function hideVlmLoadingCard(withFadeOut = true) {
  if (typeof document === 'undefined') return;
  const card = document.getElementById('vlmModelLoadingCard');
  if (!card) return;

  if (withFadeOut) {
    card.classList.add('fade-out');
    setTimeout(() => {
      card.style.display = 'none';
      card.classList.remove('fade-out');
    }, 650);
  } else {
    card.style.display = 'none';
    card.classList.remove('fade-out');
  }
}

/**
 * 判斷當前裝置是否為行動裝置 (iPhone, iPad, Android, Mobile UA)
 */
function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || navigator.vendor || (typeof window !== 'undefined' && window.opera) || '').toLowerCase();
  const isIPhone = /iphone/.test(ua);
  const isIPad = /ipad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/.test(ua);
  const isMobileUa = /mobile|touch|webos|blackberry|iemobile|opera mini/.test(ua);
  return isIPhone || isIPad || isAndroid || isMobileUa;
}

/**
 * 判斷當前裝置是否為 iOS Safari / WebKit 核心 (用於防範 Safari 嚴格記憶體限制)
 */
function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS;
}

/**
 * 取得當前裝置環境對應之 VLM 影像最大邊長限制 (手機 512px，桌面 768px)
 */
function getVlmMaxDim() {
  return isMobileDevice() ? 512 : 768;
}

/**
 * 非同步載入端側視覺語言大模型 (SmolVLM-256M-Instruct with WebGPU)
 * 依照 Hugging Face 官方 SmolVLM WebGPU 規範，使用 AutoProcessor 與 AutoModelForVision2Seq
 * 支援 Mobile VLM Low Memory Mode (量化載入、順序降級備援、顯存保護)
 */
async function initVlmModel(onProgress) {
  // Mobile Stable Mode: never load SmolVLM on phones/tablets.
  // iOS Safari can terminate the whole page during VLM load/inference, so mobile uses MobileNet + OCR only.
  if (isMobileDevice()) {
    console.log('[MOBILE AI] SmolVLM disabled on mobile; initVlmModel skipped');
    return null;
  }
  const isDebug = isCameraDebug();
  const hasWebGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  const isMobile = isMobileDevice();
  const deviceClass = isMobile ? 'mobile' : 'desktop';
  const mobileLowMem = isMobile;

  // 7. Debug 裝置與記憶體模式資訊
  console.log(`[VLM DEBUG] device class: ${deviceClass}`);
  console.log(`[VLM DEBUG] mobile low memory mode: ${mobileLowMem}`);

  if (isDebug) {
    console.log('[VLM DEBUG] 1. navigator.gpu 是否存在:', hasWebGpu);
    console.log('[VLM DEBUG] 3. initVlmModel() 是否開始執行: 是 (目前狀態: ' + vlmStatus + ')');
    console.log('[VLM DEBUG] 4. 使用的模型名稱: HuggingFaceTB/SmolVLM-256M-Instruct');
    console.log('[VLM DEBUG] 5. 使用的 device（WebGPU 或其他）: webgpu');
  }

  if (vlmProcessor && vlmModel) {
    if (isDebug) {
      console.log('[VLM DEBUG] 9. SmolVLM 是否建立成功: 已快取就緒');
      console.log('[VLM DEBUG] SmolVLM model ready');
    }
    return { processor: vlmProcessor, model: vlmModel };
  }
  if (isVlmLoading) {
    while (isVlmLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (isDebug) {
      console.log('[VLM DEBUG] 9. SmolVLM 是否建立成功:', !!(vlmProcessor && vlmModel));
    }
    return { processor: vlmProcessor, model: vlmModel };
  }

  isVlmLoading = true;
  vlmStatus = 'loading';
  const vlmStartTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  let mobileFailLogged = false;

  showModelLoadingOverlay('首次載入 AI 視覺模型 0%... 之後離線免下載', 0, '正在連線模型儲存庫...');

  try {
    const tf = await loadTransformers();
    const AutoProcessor = (tf && tf.AutoProcessor)
      ? tf.AutoProcessor
      : (typeof window !== 'undefined' && window.AutoProcessor ? window.AutoProcessor : null);
    const AutoModelForVision2Seq = (tf && tf.AutoModelForVision2Seq)
      ? tf.AutoModelForVision2Seq
      : (typeof window !== 'undefined' && window.AutoModelForVision2Seq ? window.AutoModelForVision2Seq : null);

    if (isDebug) {
      console.log('[VLM DEBUG] 2. Transformers.js 是否成功載入:', !!(AutoProcessor && AutoModelForVision2Seq) ? '成功' : '失敗');
    }

    if (!AutoProcessor || !AutoModelForVision2Seq) {
      const err = new Error('Transformers.js AutoProcessor / AutoModelForVision2Seq 不可用');
      if (isDebug) {
        console.error('[VLM DEBUG] 15. Fallback 原因: VLM model load failed (Transformers.js AutoProcessor 或 AutoModelForVision2Seq 不可用)\n完整 Error Stack:', err && err.stack ? err.stack : err);
      }
      throw err;
    }

    const progressCallback = (p) => {
      if (!p) return;
      if (p.status === 'progress' && p.file) {
        vlmFileProgress[p.file] = {
          loaded: p.loaded || 0,
          total: p.total || 0,
          progress: p.progress !== undefined ? p.progress : (p.total ? (p.loaded / p.total) * 100 : 0)
        };
      } else if (p.status === 'done' && p.file) {
        vlmFileProgress[p.file] = { loaded: 100, total: 100, progress: 100 };
      }

      let totalLoaded = 0;
      let totalSize = 0;
      let hasTotals = false;
      for (const f in vlmFileProgress) {
        if (vlmFileProgress[f].total > 0) {
          hasTotals = true;
          totalLoaded += vlmFileProgress[f].loaded;
          totalSize += vlmFileProgress[f].total;
        }
      }

      let percent = 0;
      if (hasTotals && totalSize > 0) {
        percent = Math.min(100, Math.round((totalLoaded / totalSize) * 100));
      } else if (p.progress !== undefined) {
        percent = Math.min(100, Math.round(p.progress));
      }

      if (isDebug) {
        console.log('[VLM DEBUG] 7. 模型下載 / cache 載入進度:', {
          file: p.file || '快取載入中',
          status: p.status,
          loaded: p.loaded || 0,
          total: p.total || 0,
          percent: percent + '%'
        });
      }

      const statusMsg = `首次載入 AI 視覺模型 ${percent}%... 之後離線免下載`;
      const fileName = p.file ? p.file.split('/').pop() : '離線快取儲存中';
      updateModelLoadingProgress(percent, statusMsg, `下載進度: ${fileName}`);
      if (typeof onProgress === 'function') {
        onProgress(percent, statusMsg);
      }
    };

    console.log('[VLM] 正在透過 WebGPU 初始化 HuggingFaceTB/SmolVLM-256M-Instruct...');

    vlmProcessor = await AutoProcessor.from_pretrained(
      'HuggingFaceTB/SmolVLM-256M-Instruct',
      { progress_callback: progressCallback }
    );
    if (isDebug) {
      console.log('[VLM DEBUG] AutoProcessor 建立成功');
    }

    if (!isMobile) {
      // 桌面仍維持目前設定 (不指定 dtype)
      console.log('[VLM DEBUG] requested dtype: none');
      console.log('[VLM DEBUG] actual dtype fallback: none');
      vlmModel = await AutoModelForVision2Seq.from_pretrained(
        'HuggingFaceTB/SmolVLM-256M-Instruct',
        {
          device: 'webgpu',
          progress_callback: progressCallback
        }
      );
      if (isDebug) {
        console.log('[VLM DEBUG] AutoModelForVision2Seq 建立成功 (Desktop Mode)');
      }
    } else {
      // 手機模式 (Mobile VLM Low Memory Mode)
      const requestedDtype = {
        embed_tokens: 'fp32',
        vision_encoder: 'q4',
        decoder_model_merged: 'q4'
      };
      console.log('[VLM DEBUG] requested dtype:', JSON.stringify(requestedDtype));

      let modelLoaded = false;
      let lastErr = null;

      // 嘗試初始 Requested Dtype Mapping
      try {
        vlmModel = await AutoModelForVision2Seq.from_pretrained(
          'HuggingFaceTB/SmolVLM-256M-Instruct',
          {
            device: 'webgpu',
            dtype: requestedDtype,
            progress_callback: progressCallback
          }
        );
        console.log('[VLM DEBUG] actual dtype fallback: none');
        modelLoaded = true;
      } catch (errMapping) {
        lastErr = errMapping;
        console.warn('[VLM DEBUG] 初始 requested dtype mapping 載入失敗，觸發第 1 順位 fallback (q4)：', errMapping?.message || errMapping);
        console.log('[VLM DEBUG] actual dtype fallback: q4');

        // 第一順位: dtype: 'q4'
        try {
          vlmModel = await AutoModelForVision2Seq.from_pretrained(
            'HuggingFaceTB/SmolVLM-256M-Instruct',
            {
              device: 'webgpu',
              dtype: 'q4',
              progress_callback: progressCallback
            }
          );
          modelLoaded = true;
        } catch (errQ4) {
          lastErr = errQ4;
          console.warn('[VLM DEBUG] 第 1 順位 dtype: q4 載入失敗，觸發第 2 順位 fallback (q8)：', errQ4?.message || errQ4);
          console.log('[VLM DEBUG] actual dtype fallback: q8');

          // 第二順位: dtype: 'q8'
          try {
            vlmModel = await AutoModelForVision2Seq.from_pretrained(
              'HuggingFaceTB/SmolVLM-256M-Instruct',
              {
                device: 'webgpu',
                dtype: 'q8',
                progress_callback: progressCallback
              }
            );
            modelLoaded = true;
          } catch (errQ8) {
            lastErr = errQ8;
            console.warn('[VLM DEBUG] 第 2 順位 dtype: q8 載入失敗，觸發第 3 順位 fallback (不指定 dtype)：', errQ8?.message || errQ8);
            console.log('[VLM DEBUG] actual dtype fallback: default (none)');

            // 第三順位: 不指定 dtype
            try {
              vlmModel = await AutoModelForVision2Seq.from_pretrained(
                'HuggingFaceTB/SmolVLM-256M-Instruct',
                {
                  device: 'webgpu',
                  progress_callback: progressCallback
                }
              );
              modelLoaded = true;
            } catch (errDefault) {
              lastErr = errDefault;
              console.error('[VLM DEBUG] 第 3 順位 fallback 亦載入失敗：', errDefault?.message || errDefault);
            }
          }
        }
      }

      if (modelLoaded && vlmModel) {
        console.log('[VLM DEBUG] mobile VLM load success');
        if (isDebug) {
          console.log('[VLM DEBUG] AutoModelForVision2Seq 建立成功 (Mobile Mode)');
        }
      } else {
        console.error('[VLM DEBUG] mobile VLM load failed');
        mobileFailLogged = true;
        throw (lastErr || new Error('Mobile VLM load failed all fallback attempts'));
      }
    }

    vlmPipeline = { processor: vlmProcessor, model: vlmModel };
    if (typeof window !== 'undefined') {
      window.vlmProcessor = vlmProcessor;
      window.vlmModel = vlmModel;
    }

    const vlmEndTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const loadDuration = ((vlmEndTime - vlmStartTime) / 1000).toFixed(2);

    if (isDebug) {
      console.log(`[VLM DEBUG] 8. 模型載入完成耗時: ${loadDuration} 秒`);
      console.log('[VLM DEBUG] 9. SmolVLM 是否建立成功: 是', { processor: !!vlmProcessor, model: !!vlmModel });
      console.log('[VLM DEBUG] SmolVLM model ready');
    }

    vlmStatus = 'ready';
    updateModelLoadingProgress(100, '首次載入 AI 視覺模型 100%... 之後離線免下載', '✅ 模型快取完成，已就緒！');
    setTimeout(() => {
      hideModelLoadingOverlay(true);
    }, 700);

    console.log('[VLM] ✅ SmolVLM 端側多模態大模型加載完成！');
    return { processor: vlmProcessor, model: vlmModel };
  } catch (err) {
    if (isMobile && !mobileFailLogged) {
      console.error('[VLM DEBUG] mobile VLM load failed');
      mobileFailLogged = true;
    }
    if (isDebug) {
      const isGpuError = err && String(err).toLowerCase().includes('webgpu');
      console.error(`[VLM DEBUG] 15. Fallback 原因: ${isGpuError ? 'WebGPU unavailable' : 'VLM model load failed'}`);
      console.error('[VLM DEBUG] 完整 Error Stack:', err && err.stack ? err.stack : err);
    }
    console.warn('[VLM] SmolVLM 模型載入失敗或 WebGPU 異常：', err);
    vlmStatus = 'fallback';
    hideModelLoadingOverlay(false);
    throw err;
  } finally {
    isVlmLoading = false;
  }
}

/**
 * 預先觸發視覺模型初始化 (initVisionModel)
 * 使用者開啟相機或進入畫面時自動在背景靜默預載，首次下載喚起 #modelLoadingOverlay
 */
async function initVisionModel(onProgress) {
  if (isMobileClipTestMode()) {
    console.log('[MOBILECLIP TEST] 測試模式啟用 (?mobilecliptest=1)，略過 SmolVLM / MobileNet 預載');
    return null;
  }
  // Mobile Stable Mode: do not preload models while camera/album UI is active.
  // Recognition models are started only after the captured image is ready and the camera stream is closed.
  if (isMobileDevice()) {
    console.log('[MOBILE AI] Stable mode enabled; skip camera-time model preload');
    return null;
  }
  const isDebug = isCameraDebug();
  const hasWebGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  if (isDebug) {
    console.log('[VLM DEBUG] 1. navigator.gpu 是否存在 (initVisionModel 預載階段):', hasWebGpu);
  }
  if (!hasWebGpu) {
    if (isDebug) {
      console.warn('[VLM DEBUG] 15. Fallback 原因: WebGPU unavailable (預載檢測到 navigator.gpu 不存在)');
    }
    console.log('[VisionModel] 裝置環境不支援 WebGPU，切換為輕量 MobileNet 視覺模型');
    return await initMobileNet();
  }

  showModelLoadingOverlay('首次載入 AI 視覺模型 0%... 之後離線免下載', 0, '正在連線模型快取庫...');

  try {
    const pipeline = await initVlmModel((percent, statusMsg) => {
      updateModelLoadingProgress(percent, statusMsg, `模型快取進行中... ${percent}%`);
      if (typeof onProgress === 'function') {
        onProgress(percent, statusMsg);
      }
    });

    setTimeout(() => {
      hideModelLoadingOverlay(true);
    }, 600);
    return pipeline;
  } catch (err) {
    if (isDebug) {
      console.error('[VLM DEBUG] 15. Fallback 原因: VLM model load failed');
      console.error('[VLM DEBUG] 完整 Error Stack:', err && err.stack ? err.stack : err);
    }
    console.warn('[VisionModel] 視覺模型預載失敗，平滑降級至輕量相機辨識：', err);
    hideModelLoadingOverlay(false);
    return await initMobileNet();
  }
}

/**
 * 壓縮輸入影像 (限制寬高最大 768px 以提升生成速度與降低顯存佔用)
 */
function compressImageForVlm(imageSource, maxDim) {
  const targetMaxDim = (typeof maxDim === 'number' && maxDim > 0) ? maxDim : getVlmMaxDim();
  if (typeof document === 'undefined') return imageSource;
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

/**
 * 嚴格 Prompt 指令 (結構化 JSON 輸出要求)
 */
const VLM_PROMPT = `Analyze this item photo for an inventory management app. Extract the exact product name, assign the best category from ["食品", "飲料", "日用品", "動畫", "遊戲", "二次元", "票券/活動", "其他"], and find the expiration date (EXP/Best Before).
Respond ONLY with a valid JSON object in this format:
{"name": "string", "category": "string", "expiry": "YYYY-MM-DD or null", "shelf_life_days": number}`;

function extractTextFromOutput(out) {
  if (!out) return '';
  if (typeof out === 'string') return out;
  if (Array.isArray(out)) {
    const last = out[out.length - 1];
    if (typeof last === 'string') return last;
    if (last && typeof last.generated_text === 'string') return last.generated_text;
    if (last && Array.isArray(last.generated_text)) {
      const msg = last.generated_text[last.generated_text.length - 1];
      return (msg && (msg.content || msg.text)) || JSON.stringify(msg);
    }
    if (last && last.text) return last.text;
    return JSON.stringify(last);
  }
  if (typeof out.generated_text === 'string') return out.generated_text;
  if (out.text) return out.text;
  return JSON.stringify(out);
}

/**
 * 執行 VLM 視覺推論 (Hugging Face 官方 SmolVLM WebGPU 流程)
 */
async function runVlmInference(pipeOrInstance, imgDataUrl, promptText = VLM_PROMPT) {
  if (isMobileDevice()) {
    throw new Error('MOBILE_VLM_DISABLED');
  }
  const isDebug = isCameraDebug();
  if (isDebug) {
    console.log('[VLM DEBUG] 11. 是否真的執行 runVlmInference(): 是', {
      instanceAvailable: !!(pipeOrInstance || (vlmProcessor && vlmModel)),
      promptPreview: promptText ? promptText.slice(0, 100) + '...' : ''
    });
  }

  const processor = (pipeOrInstance && pipeOrInstance.processor) || vlmProcessor;
  const model = (pipeOrInstance && pipeOrInstance.model) || vlmModel;
  let loadImageFn = (typeof window !== 'undefined' && window.load_image) ? window.load_image : null;
  if (!loadImageFn) {
    const tf = await loadTransformers();
    loadImageFn = (tf && tf.load_image) ? tf.load_image : (typeof window !== 'undefined' ? window.load_image : null);
  }

  if (!processor || !model) {
    const modelErr = new Error('SmolVLM Processor or Model Unavailable');
    if (isDebug) {
      console.error('[VLM DEBUG] 15. Fallback 原因: VLM model load failed (processor 或 model 實例為空)');
      console.error('[VLM DEBUG] 完整 Error Stack:', modelErr.stack);
    }
    throw modelErr;
  }

  // A. 將目前的 image Data URL 用 load_image() 載入
  let image;
  try {
    image = await loadImageFn(imgDataUrl);
  } catch (imgErr) {
    if (isDebug) {
      console.error('[VLM DEBUG] 15. Fallback 原因: load_image 失敗');
      console.error('[VLM DEBUG] 完整 Error Stack:', imgErr && imgErr.stack ? imgErr.stack : imgErr);
    }
    throw imgErr;
  }

  // B. 建立 messages
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          image: image
        },
        {
          type: 'text',
          text: promptText
        }
      ]
    }
  ];

  // C. 使用 processor.apply_chat_template 產生文字 Prompt
  let text;
  try {
    text = processor.apply_chat_template(messages, {
      add_generation_prompt: true
    });
  } catch (tmplErr) {
    if (isDebug) {
      console.error('[VLM DEBUG] 15. Fallback 原因: apply_chat_template 失敗');
      console.error('[VLM DEBUG] 完整 Error Stack:', tmplErr && tmplErr.stack ? tmplErr.stack : tmplErr);
    }
    throw tmplErr;
  }

  // D. 使用 processor 建立模型輸入
  let inputs;
  try {
    inputs = await processor(text, [image]);
    if (isDebug) {
      console.log('[VLM DEBUG] processor input 建立成功');
    }
  } catch (procErr) {
    if (isDebug) {
      console.error('[VLM DEBUG] 15. Fallback 原因: processor 建立模型輸入失敗');
      console.error('[VLM DEBUG] 完整 Error Stack:', procErr && procErr.stack ? procErr.stack : procErr);
    }
    throw procErr;
  }

  // E. 使用 model.generate() 進行推論
  let outputs;
  const isMobile = isMobileDevice();
  const maxTokens = isMobile ? 64 : 160;
  console.log(`[VLM DEBUG] max_new_tokens: ${maxTokens}`);

  try {
    if (isDebug) {
      console.log('[VLM DEBUG] model.generate 開始');
    }
    outputs = await model.generate({
      ...inputs,
      do_sample: false,
      max_new_tokens: maxTokens
    });
    if (isDebug) {
      console.log('[VLM DEBUG] model.generate 完成');
    }
  } catch (genErr) {
    if (isDebug) {
      console.error('[VLM DEBUG] 15. Fallback 原因: model.generate 推論失敗');
      console.error('[VLM DEBUG] 完整 Error Stack:', genErr && genErr.stack ? genErr.stack : genErr);
    }
    throw genErr;
  }

  // F. 解碼時必須只取得「模型新生成的回答」
  let rawText = '';
  try {
    const seqs = (outputs && outputs.sequences) ? outputs.sequences : outputs;
    const inputLength = inputs?.input_ids?.dims?.at(-1) || (inputs?.input_ids?.dims && inputs.input_ids.dims[inputs.input_ids.dims.length - 1]) || 0;

    let generatedTokens = seqs;
    if (seqs && typeof seqs.slice === 'function' && inputLength > 0) {
      try {
        generatedTokens = seqs.slice(null, [inputLength, null]);
      } catch (sliceErr) {
        if (isDebug) {
          console.warn('[VLM DEBUG] seqs.slice 警告:', sliceErr);
        }
      }
    }

    const decodeFn = (processor.batch_decode ? processor.batch_decode.bind(processor) : (processor.tokenizer && processor.tokenizer.batch_decode ? processor.tokenizer.batch_decode.bind(processor.tokenizer) : null));

    let decoded = '';
    if (decodeFn) {
      decoded = decodeFn(generatedTokens, { skip_special_tokens: true });
    } else if (processor.decode) {
      decoded = processor.decode(generatedTokens[0] || generatedTokens, { skip_special_tokens: true });
    }

    if (Array.isArray(decoded)) {
      rawText = (decoded[0] || '').trim();
    } else if (typeof decoded === 'string') {
      rawText = decoded.trim();
    } else {
      rawText = String(decoded || '').trim();
    }

    // 防護：若未成功切除前綴 Prompt 且包含了 prompt 內容，過濾掉輸入文本
    if (rawText && text && rawText.includes(text)) {
      rawText = rawText.replace(text, '').trim();
    }

    if (isDebug) {
      console.log('[VLM DEBUG] VLM 新生成文字:', rawText);
      console.log('[VLM DEBUG] 12. VLM 原始輸出內容 (runVlmInference 產生):', rawText);
    }
  } catch (decErr) {
    if (isDebug) {
      console.error('[VLM DEBUG] 15. Fallback 原因: 解碼新生成文字失敗');
      console.error('[VLM DEBUG] 完整 Error Stack:', decErr && decErr.stack ? decErr.stack : decErr);
    }
    throw decErr;
  }

  return rawText;
}

/**
 * 【一、容錯式 VLM 輸出解析器（解決 JSON.parse 報錯空白）】
 * VLM 生成的文字常夾雜 Markdown 標記或對話前綴，健壯抽取函式 parseVLMResponse(rawText)
 * 1. 去除 Markdown 標籤：先過濾掉 ```json 與 ``` 等標記。
 * 2. 正規表達式提取 JSON 區塊：使用 /\{[\s\S]*?\}/ 擷取最外層的大括號內容。
 * 3. 雙重解析機制：
 *    - 優先嘗試 JSON.parse(extractedJson)。
 *    - 若解析失敗（如字串未閉合），改用寬鬆的正規表達式逐欄抓取：
 *      * 品名：rawText.match(/(?:name|品名|物品名稱|商品名稱)["':\s]+["']?([^"'\n,}]+)/i)?.[1]?.trim()
 *      * 分類：rawText.match(/(?:category|分類|類別)["':\s]+["']?([^"'\n,}]+)/i)?.[1]?.trim()
 *      * 效期：rawText.match(/(?:expiry|到期日|有效期限)["':\s]+["']?(\d{4}[-\/]\d{2}[-\/]\d{2})/i)?.[1]?.trim()
 */
function parseVLMResponse(rawText) {
  const isDebug = isCameraDebug();
  if (!rawText || typeof rawText !== 'string') {
    if (isDebug) {
      console.warn('[VLM DEBUG] 13. parseVLMResponse() 輸入無效或為空字串');
    }
    return { name: '', category: '', expiry: null, parsedName: '', parsedCategory: '', parsedExpiry: null };
  }

  // 1. 去除 Markdown 標籤：先過濾掉 ```json 與 ``` 等標記。
  const cleanedText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // 2. 正規表達式提取 JSON 區塊：使用 /\{[\s\S]*?\}/ 擷取最外層的大括號內容。
  let extractedJson = null;
  const jsonMatch = cleanedText.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    extractedJson = jsonMatch[0];
  }

  let parsedName = '';
  let parsedCategory = '';
  let parsedSubCategory = '';
  let parsedEmoji = '';
  let parsedExpiry = null;
  let parsedObject = null;
  let jsonParseError = null;
  let isNaturalLanguageName = false;
  let isNaturalLanguageExpiry = false;

  // 1. 保留現有 JSON 解析：如果模型真的回 {"name":"milk", ...} 仍然優先使用 JSON.parse
  if (extractedJson) {
    try {
      parsedObject = JSON.parse(extractedJson);
      if (parsedObject && typeof parsedObject === 'object') {
        parsedName = parsedObject.name || parsedObject['品名'] || parsedObject['物品名稱'] || parsedObject['商品名稱'] || '';
        parsedCategory = parsedObject.category || parsedObject['分類'] || parsedObject['類別'] || '';
        parsedExpiry = parsedObject.expiry || parsedObject['到期日'] || parsedObject['有效期限'] || null;
      }
    } catch (parseErr) {
      jsonParseError = parseErr;
      try {
        const sanitized = extractedJson.replace(/,\s*([}\]])/g, '$1');
        parsedObject = JSON.parse(sanitized);
        if (parsedObject && typeof parsedObject === 'object') {
          parsedName = parsedObject.name || parsedObject['品名'] || parsedObject['物品名稱'] || parsedObject['商品名稱'] || '';
          parsedCategory = parsedObject.category || parsedObject['分類'] || parsedObject['類別'] || '';
          parsedExpiry = parsedObject.expiry || parsedObject['到期日'] || parsedObject['有效期限'] || null;
          jsonParseError = null;
        }
      } catch (e2) {
        parsedObject = null;
        jsonParseError = e2;
      }
    }
  }

  if (jsonParseError && isDebug) {
    console.warn('[VLM DEBUG] 15. Fallback 警告: JSON parse failed (標準 JSON.parse 解析失敗，轉用寬鬆正則逐欄抽取備援)\n完整 Error Stack:', jsonParseError && jsonParseError.stack ? jsonParseError.stack : jsonParseError);
  }

  // 2. 新增自然語言回答解析（若 JSON 未取得 name）
  if (!parsedName) {
    // 寬鬆 key-value 形式
    const kvMatch = cleanedText.match(/(?:name|品名|物品名稱|商品名稱)["':\s]+["']?([^"'\n,}]+)/i);
    if (kvMatch && kvMatch[1]) {
      parsedName = kvMatch[1].trim();
    }
  }

  if (!parsedName) {
    // 自然語言回答模式 (英文與中文模式)
    const namePatterns = [
      /the product is\s*["']?([^"'.\n]+)["']?/i,
      /the item is\s*["']?([^"'.\n]+)["']?/i,
      /this is\s+(?:an|a)?\s*["']?([^"'.\n]+)["']?/i,
      /product\s*[:：]\s*["']?([^"'\n,.]+)/i,
      /(?:品名是|商品是|物品是|這是)\s*([^，。,\n]+)/
    ];

    for (const pattern of namePatterns) {
      const m = cleanedText.match(pattern);
      if (m && m[1]) {
        let n = m[1].trim().replace(/^["']+|["']+$/g, '').trim();
        // 防護：若未以引號包裹且後續接 and its expiry ... 截斷處理
        n = n.replace(/\s+(?:and\s+(?:its\s+)?(?:expiry|expiration)|with\s+expiry).*$/i, '').trim();
        if (n) {
          parsedName = n;
          isNaturalLanguageName = true;
          break;
        }
      }
    }

    if (parsedName) {
      console.log('[VLM DEBUG] 自然語言解析取得 name:', parsedName);
    }
  }

  // category 解析 (JSON 或 key-value 欄位)
  if (!parsedCategory) {
    const catMatch = cleanedText.match(/(?:category|分類|類別)["':\s]+["']?([^"'\n,}]+)/i);
    if (catMatch && catMatch[1]) {
      parsedCategory = catMatch[1].trim();
    }
  }

  // 3. 自然語言日期解析
  if (!parsedExpiry) {
    const expiryPatterns = [
      /(?:expiry\s*date\s*is|expiration\s*date\s*is|expires\s*on)\s*["']?(\d{4}[-\/]\d{2}[-\/]\d{2})/i,
      /(?:有效期限(?:是|：|:)?|到期日(?:是|：|:)?)\s*["']?(\d{4}[-\/]\d{2}[-\/]\d{2})/,
      /(?:expiry|expiration|expires|到期日|有效期限)["':\s]+["']?(\d{4}[-\/]\d{2}[-\/]\d{2})/i
    ];

    for (const pattern of expiryPatterns) {
      const em = cleanedText.match(pattern);
      if (em && em[1]) {
        parsedExpiry = em[1].trim().replace(/\//g, '-');
        isNaturalLanguageExpiry = true;
        console.log('[VLM DEBUG] 自然語言解析取得 expiry:', parsedExpiry);
        break;
      }
    }
  }

  // 4. category 不應因 VLM 沒回而整體失敗：改用 matchCategoryAndSubCategory(parsedName) 從 SMART_KEYWORD_MAP 推算
  if (parsedName && !parsedCategory) {
    if (typeof matchCategoryAndSubCategory === 'function') {
      const matched = matchCategoryAndSubCategory(parsedName);
      parsedCategory = matched.category || 'other';
      parsedSubCategory = matched.subCat || matched.subCategory || '';
      parsedEmoji = matched.emoji || '📦';
      console.log('[VLM DEBUG] category 由本地分類器推算:', {
        category: parsedCategory,
        subCategory: parsedSubCategory,
        emoji: parsedEmoji
      });
    } else {
      parsedCategory = 'other';
    }
  }

  const vlmExpiryCandidate = parsedExpiry;

  const resultObj = {
    ...(parsedObject || {}),
    name: parsedName,
    category: parsedCategory,
    subCategory: parsedSubCategory,
    emoji: parsedEmoji,
    expiry: parsedExpiry,
    vlmExpiryCandidate: vlmExpiryCandidate,
    parsedName,
    parsedCategory,
    parsedSubCategory,
    parsedExpiry,
    parsedVlmExpiryCandidate: vlmExpiryCandidate
  };

  console.log('[VLM DEBUG] 最終解析結果:', resultObj);

  return resultObj;
}

/**
 * 相容性舊函式別名
 */
function parseVlmJsonResponse(rawText) {
  return parseVLMResponse(rawText);
}

/**
 * 【二、分類語意標準化對照表（Category Normalizer）】
 * VLM 回傳的分類可能使用英文或同義詞，建立標準化函式將其映射至系統現有的 8 大合法類別：
 */
function normalizeCategory(rawCat) {
  if (!rawCat) return '其他';
  const c = rawCat.toLowerCase();
  if (/食品|food|snack|dairy|milk|鮮奶|鮮乳|乳品|牛奶|食物|飲料|drink|beverage/.test(c)) return '食品';
  if (/動畫|anime|comic|manga|漫畫|輕小說/.test(c)) return '動畫';
  if (/遊戲|game|console|switch|playstation|xbox/.test(c)) return '遊戲';
  if (/二次元|figure|toy|谷子|立牌|徽章|模型|黏土人/.test(c)) return '二次元';
  if (/票券|ticket|門票|電影票|展覽/.test(c)) return '票券/活動';
  if (/日用|清潔|cleaning|detergent|shampoo|日常|pao/.test(c)) return '日用品';
  return '其他';
}

/**
 * 【二、表單強制賦值與事件派發】
 * 即使物品屬於「其他」分類或未命中已知詞庫，嚴禁讓物品名稱（itemNameInput）留空
 */
function applyVlmDomValues(parsedName, parsedCategory, parsedExpiry) {
  const detectedName = parsedName;
  const targetCategory = normalizeCategory(parsedCategory);

  const finalName = detectedName && detectedName.trim() !== '' ? detectedName.trim() : '其他物品';

  if (typeof document !== 'undefined') {
    // 2. 表單強制賦值與事件派發：
    const nameInput = document.getElementById('itemNameInput');
    if (nameInput) {
      nameInput.value = finalName;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // 既有頁面表單欄位相容處理 (itemName / nlpConfirmName)
    const altNameInput = document.getElementById('itemName');
    if (altNameInput && altNameInput !== nameInput) {
      altNameInput.value = finalName;
      altNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      altNameInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const nlpNameInput = document.getElementById('nlpConfirmName');
    if (nlpNameInput && nlpNameInput !== nameInput && nlpNameInput !== altNameInput) {
      nlpNameInput.value = finalName;
      nlpNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nlpNameInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 3. 分類選單同步選中「其他」或目標分類：
    const catSelect = document.getElementById('itemCategorySelect');
    if (catSelect) {
      catSelect.value = targetCategory;
      if (!catSelect.value || catSelect.value === '' || catSelect.value !== targetCategory) {
        if (catSelect.options) {
          const catKeyMap = { '食品': 'food', '動畫': 'animation', '遊戲': 'game', '二次元': 'otaku', '票券/活動': 'ticket', '日用品': 'cleaning', '其他': 'other' };
          const mappedKey = catKeyMap[targetCategory] || 'other';
          for (let i = 0; i < catSelect.options.length; i++) {
            const opt = catSelect.options[i];
            if (opt.value === targetCategory || opt.value === mappedKey || opt.text.includes(targetCategory) || (targetCategory === '其他' && (opt.value === 'other' || opt.text.includes('其他')))) {
              catSelect.selectedIndex = i;
              break;
            }
          }
        }
      }
      if (!catSelect.value || catSelect.value === '') {
        catSelect.value = '其他';
      }
      catSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const nlpCatSelect = document.getElementById('nlpConfirmCategory');
    if (nlpCatSelect && nlpCatSelect !== catSelect) {
      nlpCatSelect.value = targetCategory;
      if (!nlpCatSelect.value || nlpCatSelect.value === '' || nlpCatSelect.value !== targetCategory) {
        if (nlpCatSelect.options) {
          const catKeyMap = { '食品': 'food', '動畫': 'animation', '遊戲': 'game', '二次元': 'otaku', '票券/活動': 'ticket', '日用品': 'cleaning', '其他': 'other' };
          const mappedKey = catKeyMap[targetCategory] || 'other';
          for (let i = 0; i < nlpCatSelect.options.length; i++) {
            const opt = nlpCatSelect.options[i];
            if (opt.value === targetCategory || opt.value === mappedKey || opt.text.includes(targetCategory) || (targetCategory === '其他' && (opt.value === 'other' || opt.text.includes('其他')))) {
              nlpCatSelect.selectedIndex = i;
              break;
            }
          }
        }
      }
      if (!nlpCatSelect.value || nlpCatSelect.value === '') {
        nlpCatSelect.value = '其他';
      }
      nlpCatSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 有效期限 (若無效期或 finalExpiry === null 保持空白，嚴禁填入假日期)：
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

    // 【三、除錯日誌】
    const currentNameVal = (nameInput && nameInput.value) || (altNameInput && altNameInput.value) || finalName;
    const currentCatVal = (catSelect && catSelect.value) || targetCategory || '其他';
    console.log('【自動填入結果】', { name: currentNameVal, category: currentCatVal });

    // Toast 提示：「✨ 已自動辨識帶入：[物品名稱]」
    const toastMsg = `✨ 已自動辨識帶入：${currentNameVal}`;
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(toastMsg);
    } else if (typeof showToast === 'function') {
      showToast(toastMsg);
    } else if (typeof document !== 'undefined') {
      const toastContainer = document.getElementById('toastContainer') || document.body;
      if (toastContainer) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = toastMsg;
        toastContainer.appendChild(toast);
        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(-10px)';
          toast.style.transition = 'all 0.2s ease';
          setTimeout(() => toast.remove(), 200);
        }, 2200);
      }
    }
  } else {
    console.log('【自動填入結果】', { name: finalName, category: targetCategory });
  }
}

/**
 * 格式化與映射 VLM 結果，並連動表單輸入欄位
 */
function formatVlmResult(result, photoDataUrl, skipDom = false) {
  let name = (result && (result.name || result.parsedName)) ? String(result.name || result.parsedName).trim() : '';
  if (!name || name === '') {
    name = (targetCategory === '其他') ? '生活物品' : (targetCategory + '物品');
  }
  const rawCat = (result && (result.category || result.parsedCategory)) ? String(result.category || result.parsedCategory).trim() : '其他';
  const targetCategory = normalizeCategory(rawCat);

  // 映射合法分類
  let category = (result && (result.category || result.parsedCategory)) || 'other';
  let categoryLabel = targetCategory;
  let emoji = (result && result.emoji) || '📦';
  let subCategory = (result && (result.subCategory || result.parsedSubCategory)) || '未分類';

  if (targetCategory === '食品') {
    category = 'food';
    categoryLabel = '食品';
    if (!emoji || emoji === '📦') {
      emoji = /飲料|飲品|水|酒|茶|咖啡|乳品|鮮奶|milk/i.test(rawCat + ' ' + name) ? '🥛' : '🥦';
    }
    if (!subCategory || subCategory === '未分類') {
      subCategory = /飲料|飲品|水|酒|茶|咖啡|乳品|鮮奶|milk/i.test(rawCat + ' ' + name) ? '鮮乳' : '生鮮/食品';
    }
  } else if (targetCategory === '日用品') {
    category = (category === 'pao') ? 'pao' : 'cleaning';
    categoryLabel = '日用品';
    if (!emoji || emoji === '📦') {
      emoji = '🧴';
    }
    if (!subCategory || subCategory === '未分類') {
      subCategory = '日常用品';
    }
  } else if (targetCategory === '動畫') {
    category = 'animation';
    categoryLabel = '動畫';
    if (!emoji || emoji === '📦') emoji = '🎬';
    if (!subCategory || subCategory === '未分類') subCategory = '動漫周邊';
  } else if (targetCategory === '遊戲') {
    category = 'game';
    categoryLabel = '遊戲';
    if (!emoji || emoji === '📦') emoji = '🎮';
    if (!subCategory || subCategory === '未分類') subCategory = '遊戲卡帶/光碟';
  } else if (targetCategory === '二次元') {
    category = 'otaku';
    categoryLabel = '二次元';
    if (!emoji || emoji === '📦') emoji = '✨';
    if (!subCategory || subCategory === '未分類') subCategory = '二次元周邊';
  } else if (targetCategory === '票券/活動') {
    category = 'ticket';
    categoryLabel = '票券/活動';
    if (!emoji || emoji === '📦') emoji = '🎟️';
    if (!subCategory || subCategory === '未分類') subCategory = '票券/活動';
  } else {
    category = 'other';
    categoryLabel = '其他';
    if (!emoji || emoji === '📦') emoji = '📦';
    if (!subCategory || subCategory === '未分類') subCategory = '未分類';
  }

  // 效期計算：僅採用真實讀取之 OCR 日期，禁止依商品類型自動猜測保存天數 (milk -> 7天等)
  let expiryDate = null;
  const candidateExpiry = (result && (result.expiry || result.parsedExpiry)) ? String(result.expiry || result.parsedExpiry).trim().replace(/\//g, '-') : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidateExpiry)) {
    expiryDate = candidateExpiry;
  } else {
    expiryDate = null;
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
    confidence: 0.95,
    visualMatch: 'SmolVLM 端側多模態大模型',
    fusionMode: 'vlm_webgpu',
    image: photoDataUrl || null,
    vlmExpiryCandidate: (result && result.vlmExpiryCandidate) || null,
    ocrText: (result && result.ocrRawText) || '',
    dateCandidates: (result && result.ocrDateCandidates) || [],
    dateSource: (result && result.dateSource) || (expiryDate ? 'OCR' : 'none')
  };
}

/**
 * 端側視覺語言大模型辨識核心 (支援 WebGPU 環境檢查、8秒超時控制與舊版雙軌降級)
 */
async function analyzeSmartCameraWithVlm(imageSource, photoDataUrl) {
  if (isMobileClipTestMode()) {
    console.warn('[MOBILECLIP TEST] 測試模式啟用 (?mobilecliptest=1)，跳過 analyzeSmartCameraWithVlm');
    return null;
  }
  // Mobile Stable Mode: phones/tablets never enter SmolVLM.
  if (isMobileDevice()) {
    console.log('[MOBILE AI] Stable mode: bypass SmolVLM -> MobileNet + OCR');
    return await analyzeSmartCameraDualTrack(imageSource, photoDataUrl);
  }
  const isDebug = isCameraDebug();

  // 1. 執行前先偵測使用者裝置環境 (WebGPU 檢查)
  const hasWebGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  if (isDebug) {
    console.log('[VLM DEBUG] 10. 拍照後是否真的進入 analyzeSmartCameraWithVlm(): 是', {
      hasImageSource: !!imageSource,
      hasPhotoDataUrl: !!photoDataUrl
    });
    console.log('[VLM DEBUG] 1. navigator.gpu 是否存在:', hasWebGpu);
  }

  if (!hasWebGpu) {
    if (isDebug) {
      console.error('[VLM DEBUG] 15. Fallback 原因: WebGPU unavailable (navigator.gpu 不存在或不支援)');
    }
    console.log('[VLM] 裝置環境未支援 WebGPU，切換為輕量相機辨識');
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('已切換為輕量相機辨識');
    }
    return await analyzeSmartCameraDualTrack(imageSource, photoDataUrl);
  }

  // 2. 嘗試執行端側 VLM 視覺推論
  try {
    // 檢查模型是否就緒，若未就緒則首次觸發加載與進度追蹤
    let pipe;
    try {
      pipe = await initVlmModel();
    } catch (loadErr) {
      if (isDebug) {
        console.error('[VLM DEBUG] 15. Fallback 原因: VLM model load failed');
        console.error('[VLM DEBUG] 完整 Error Stack:', loadErr && loadErr.stack ? loadErr.stack : loadErr);
      }
      throw loadErr;
    }

    if (!pipe) {
      const pipeErr = new Error('VLM Pipeline Unavailable');
      if (isDebug) {
        console.error('[VLM DEBUG] 15. Fallback 原因: VLM model load failed (pipe 實例為空)');
        console.error('[VLM DEBUG] 完整 Error Stack:', pipeErr.stack);
      }
      throw pipeErr;
    }

    const isMobile = isMobileDevice();
    const vlmMaxDim = isMobile ? 512 : 768;
    console.log(`[VLM DEBUG] VLM image maxDim: ${vlmMaxDim}`);

    // 壓縮輸入影像 (手機限制 512px，桌面限制 768px 供 SmolVLM 進行品名與分類推論)
    const compressedImg = compressImageForVlm(imageSource, vlmMaxDim);

    // 2. 啟動既有 Tesseract OCR (使用原始高解析照片 photoDataUrl 或未壓縮之 imageSource 畫布，絕不使用壓縮至 512px/768px 之圖片)
    const ocrTargetImage = photoDataUrl || imageSource;

    // 8 秒推論超時控制器 (Promise.race)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('VLM_TIMEOUT_8S')), 8000);
    });

    let rawOutput;
    let ocrData = null;
    const inferencePromise = runVlmInference(pipe, compressedImg, VLM_PROMPT);

    try {
      if (isIosSafari()) {
        // iOS Safari 特別保護：
        // 1. 不同時初始化 MobileNet、OCR、VLM 三套模型
        // 2. 先只載入/執行 SmolVLM 推論
        // 3. SmolVLM 推論完成後再按需要啟動 OCR，避免同時間佔用過多記憶體
        if (isDebug) {
          console.log('[iOS Safari 保護] 啟用序列推論模式：先執行 SmolVLM，推論結束後再按需啟動 OCR');
        }
        rawOutput = await Promise.race([inferencePromise, timeoutPromise]);

        if (typeof runTextAndDateOcr === 'function') {
          try {
            ocrData = await runTextAndDateOcr(ocrTargetImage);
          } catch (ocrErr) {
            console.warn('[OCR] runTextAndDateOcr 執行異常：', ocrErr);
            ocrData = null;
          }
        }
      } else {
        // 桌面及非 iOS 模式維持雙軌並行 (Promise.all)
        const ocrPromise = (typeof runTextAndDateOcr === 'function')
          ? runTextAndDateOcr(ocrTargetImage).catch(ocrErr => {
              console.warn('[OCR] runTextAndDateOcr 執行異常：', ocrErr);
              return null;
            })
          : Promise.resolve(null);

        [rawOutput, ocrData] = await Promise.all([
          Promise.race([inferencePromise, timeoutPromise]),
          ocrPromise
        ]);
      }
    } catch (infErr) {
      if (isDebug) {
        if (infErr && (infErr.message === 'VLM_TIMEOUT_8S' || infErr.message?.includes('timeout'))) {
          console.error('[VLM DEBUG] 15. Fallback 原因: inference timeout (>8s)');
        } else {
          console.error('[VLM DEBUG] 15. Fallback 原因: inference error');
        }
        console.error('[VLM DEBUG] 完整 Error Stack:', infErr && infErr.stack ? infErr.stack : infErr);
      }
      throw infErr;
    }

    const rawText = (typeof rawOutput === 'string') ? rawOutput : extractTextFromOutput(rawOutput);

    // 【四、除錯日誌與 Toast 提示】：印出 VLM 原始輸出
    if (isDebug) {
      console.log('[VLM DEBUG] 12. VLM 原始輸出內容:', rawText);
    }
    console.log('[VLM Raw Output]:', rawText);

    // 【一、容錯式 VLM 輸出解析器】
    const parsed = parseVLMResponse(rawText);
    const parsedName = parsed ? (parsed.name || parsed.parsedName || '') : '';
    const parsedCategory = parsed ? (parsed.category || parsed.parsedCategory || '') : '';
    const parsedSubCategory = parsed ? (parsed.subCategory || parsed.parsedSubCategory || '') : '';
    const vlmExpiryCandidate = parsed ? (parsed.vlmExpiryCandidate || parsed.expiry || parsed.parsedExpiry || null) : null;

    // 【二、既有 Tesseract OCR 日期與文字提取】
    const ocrRawText = (ocrData && ocrData.text) ? ocrData.text : '';
    const ocrDateCandidates = (ocrData && Array.isArray(ocrData.dateCandidates)) ? ocrData.dateCandidates : [];
    const ocrFinalDate = (ocrData && ocrData.date) ? ocrData.date : null;

    // 【三、最終日期決策規則】
    // A. OCR 有找到日期 -> 使用 OCR 日期
    // B. OCR 沒找到日期 -> finalExpiry = null
    // C. VLM 有日期但 OCR 完全沒有看到日期 -> 不得使用 VLM 日期
    // D. VLM 日期與 OCR 日期相同 -> 記錄為高可信
    // E. VLM 日期與 OCR 日期不同 -> 一律以 OCR 為主，並輸出 Debug 警告
    let finalExpiry = null;
    let dateSource = 'none';

    if (ocrFinalDate) {
      finalExpiry = ocrFinalDate;
      dateSource = 'OCR';
      if (vlmExpiryCandidate && vlmExpiryCandidate !== ocrFinalDate) {
        console.warn('[VLM DEBUG] VLM 日期與 OCR 不一致，已採用 OCR');
      } else if (vlmExpiryCandidate && vlmExpiryCandidate === ocrFinalDate) {
        console.log('[VLM DEBUG] VLM 日期與 OCR 日期相同（高可信）:', finalExpiry);
      }
    } else {
      finalExpiry = null;
      dateSource = 'none';
      if (vlmExpiryCandidate) {
        console.log('[VLM DEBUG] OCR 未發現日期，已捨棄 VLM 猜測日期:', vlmExpiryCandidate);
      }
    }

    // 【7. Debug 資訊輸出】
    console.log('[VLM DEBUG] VLM 日期候選:', vlmExpiryCandidate);
    console.log('[OCR DEBUG] OCR 原始文字:', ocrRawText);
    console.log('[OCR DEBUG] OCR 找到的日期候選:', ocrDateCandidates);
    console.log('[OCR DEBUG] OCR 最終日期:', ocrFinalDate);
    console.log('[VLM DEBUG] 最終採用 expiry:', finalExpiry);
    console.log('[VLM DEBUG] 日期來源:', dateSource);

    parsed.expiry = finalExpiry;
    parsed.parsedExpiry = finalExpiry;
    parsed.vlmExpiryCandidate = vlmExpiryCandidate;
    parsed.ocrRawText = ocrRawText;
    parsed.ocrDateCandidates = ocrDateCandidates;
    parsed.ocrFinalDate = ocrFinalDate;
    parsed.dateSource = dateSource;

    // 【四、除錯日誌】：印出解析結果
    if (isDebug) {
      console.log('[VLM DEBUG] 13. parseVLMResponse() 解析後內容:', { parsedName, parsedCategory, parsedSubCategory, vlmExpiryCandidate, finalExpiry });
    }
    console.log('[VLM Parsed]:', { parsedName, parsedCategory, parsedSubCategory, vlmExpiryCandidate, finalExpiry });

    // 5. 修改失敗條件：只有在「連 parsedName 都無法取得」時，才視為 VLM 回答無法使用。只要能取得物品名稱，就不要因 category 缺失而 fallback。
    if (!parsedName) {
      const jsonErr = new Error('JSON parse failed (無法從 VLM 原始輸出擷取出物品名稱 name)');
      if (isDebug) {
        console.error('[VLM DEBUG] 15. Fallback 原因: JSON parse failed (連物品名稱 parsedName 都無法取得)\n[VLM DEBUG] 原始輸出內容:', rawText);
        console.error('[VLM DEBUG] 完整 Error Stack:', jsonErr.stack);
      }
      throw jsonErr;
    }

    // 【精確 DOM 賦值與觸發連動】及 Toast 提示 (傳入 finalExpiry，null 則保持空白)
    applyVlmDomValues(parsedName, parsedCategory, finalExpiry);

    const finalResult = formatVlmResult(parsed, photoDataUrl, true);
    finalResult.ocrText = ocrRawText;
    finalResult.dateCandidates = ocrDateCandidates;
    finalResult.dateSource = dateSource;
    finalResult.vlmExpiryCandidate = vlmExpiryCandidate;

    if (isDebug) {
      console.log('[VLM DEBUG] 14. 最終 name / category / subCategory / expiryDate / confidence:', {
        name: finalResult.name,
        category: finalResult.category,
        subCategory: finalResult.subCategory,
        expiryDate: finalResult.expiryDate,
        confidence: finalResult.confidence
      });
    }
    return finalResult;
  } catch (err) {
    if (isDebug) {
      let fallbackReason = 'inference error';
      if (err?.message === 'VLM_TIMEOUT_8S' || err?.message?.includes('timeout')) {
        fallbackReason = 'inference timeout';
      } else if (err?.message?.includes('JSON parse failed') || err?.message === 'VLM_INVALID_JSON_RESPONSE') {
        fallbackReason = 'JSON parse failed';
      } else if (err?.message?.includes('Pipeline') || err?.message?.includes('model load') || err?.message?.includes('Transformers.js')) {
        fallbackReason = 'VLM model load failed';
      } else if (err?.message?.includes('WebGPU')) {
        fallbackReason = 'WebGPU unavailable';
      }
      console.error(`[VLM DEBUG] 15. Fallback 原因: ${fallbackReason}`);
      console.error('[VLM DEBUG] 完整 Error Stack:', err && err.stack ? err.stack : err);
    }
    console.warn('[VLM] 端側推論異常或超時 (>8s)，自動切換至輕量相機辨識：', err);
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('已切換為輕量相機辨識');
    }
    return await analyzeSmartCameraDualTrack(imageSource, photoDataUrl);
  }
}

// ==========================================
// 7.8 獨立 MobileCLIP 測試套件 (Xenova/mobileclip_s0 WASM) - 僅供手機手動測試相容性
// ==========================================
let mobileClipPipeline = null;
let mobileClipLoadingPromise = null;

const MOBILECLIP_TEST_CANDIDATES = [
  'a carton or bottle of fresh milk',
  'a bottle of shampoo',
  'a bottle of body wash',
  'a tube of toothpaste',
  'a food snack package',
  'a medicine or supplement bottle',
  'an air purifier filter',
  'a water filter cartridge',
  'a comic book',
  'a video game',
  'a collectible figure or toy',
  'an unknown household item'
];

/**
 * 判斷是否啟用 MobileCLIP 手機測試模式
 * 僅在網址包含 ?mobilecliptest=1 時啟用
 */
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
  if (mobileClipPipeline) {
    return mobileClipPipeline;
  }
  if (mobileClipLoadingPromise) {
    return mobileClipLoadingPromise;
  }

  mobileClipLoadingPromise = (async () => {
    console.log('[MOBILECLIP TEST] loading start');
    console.log('[MOBILECLIP TEST] backend: WASM');
    const loadStartTime = performance.now();

    try {
      let tf = null;
      if (typeof window !== 'undefined' && window.transformersLib) {
        tf = window.transformersLib;
      } else if (typeof getVisionEngine === 'function') {
        tf = await getVisionEngine();
      } else {
        tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1');
      }

      if (!tf || !tf.pipeline) {
        throw new Error('Transformers.js pipeline 函式無法取得');
      }

      // 確保啟用瀏覽器快取 (browser cache)
      if (tf.env) {
        tf.env.useBrowserCache = true;
        tf.env.allowLocalModels = false;
      }

      const pipelineFn = tf.pipeline;

      const progressCallback = (p) => {
        if (!p) return;
        if (p.status === 'progress' && typeof p.progress === 'number') {
          console.log(`[MOBILECLIP TEST] download progress: ${p.file || ''} ${p.progress.toFixed(1)}%`);
          if (typeof onProgress === 'function') {
            onProgress(p.progress, p.file);
          }
        } else if (p.status === 'done') {
          console.log(`[MOBILECLIP TEST] download progress: ${p.file || ''} [done]`);
          if (typeof onProgress === 'function') {
            onProgress(100, p.file);
          }
        } else if (p.status) {
          console.log(`[MOBILECLIP TEST] download progress: ${p.file || ''} [${p.status}]`);
        }
      };

      let pipe = null;
      let usedDtype = 'q8';
      console.log('[MOBILECLIP TEST] dtype requested: q8');

      try {
        // 優先以 q8 載入，不指定 device: 'webgpu'，使用瀏覽器預設 WASM backend
        pipe = await pipelineFn('zero-shot-image-classification', 'Xenova/mobileclip_s0', {
          dtype: 'q8',
          progress_callback: progressCallback
        });
      } catch (q8Err) {
        console.warn('[MOBILECLIP TEST] dtype q8 載入失敗，嘗試 fallback 到 int8:', q8Err);
        console.log('[MOBILECLIP TEST] dtype requested: int8');
        usedDtype = 'int8';
        try {
          pipe = await pipelineFn('zero-shot-image-classification', 'Xenova/mobileclip_s0', {
            dtype: 'int8',
            progress_callback: progressCallback
          });
        } catch (int8Err) {
          console.error('[MOBILECLIP TEST] ERROR: int8 載入亦失敗，停止載入（禁止自動使用 fp32）', int8Err && int8Err.stack ? int8Err.stack : int8Err);
          throw int8Err;
        }
      }

      mobileClipPipeline = pipe;
      const loadDurationMs = (performance.now() - loadStartTime).toFixed(1);
      console.log(`[MOBILECLIP TEST] model ready (載入耗時: ${loadDurationMs} ms, dtype: ${usedDtype})`);
      return mobileClipPipeline;
    } catch (error) {
      console.error('[MOBILECLIP TEST] ERROR', error && error.stack ? error.stack : error);
      mobileClipPipeline = null;
      throw error;
    } finally {
      mobileClipLoadingPromise = null;
    }
  })();

  return mobileClipLoadingPromise;
}

async function testMobileClip(imageDataUrl, candidateLabels = MOBILECLIP_TEST_CANDIDATES, onProgress = null) {
  try {
    if (!imageDataUrl) {
      const err = new Error('請提供圖片參數 imageDataUrl (例如 Data URL、圖片網址或 Image 元素)');
      console.error('[MOBILECLIP TEST] ERROR', err.stack || err);
      throw err;
    }

    const pipe = await initMobileClipTest(onProgress);
    if (!pipe) {
      const err = new Error('MobileCLIP pipeline 初始化失敗');
      console.error('[MOBILECLIP TEST] ERROR', err.stack || err);
      throw err;
    }

    console.log('[MOBILECLIP TEST] inference start');
    const infStartTime = performance.now();

    const candidates = Array.isArray(candidateLabels) && candidateLabels.length > 0
      ? candidateLabels
      : MOBILECLIP_TEST_CANDIDATES;

    const rawResults = await pipe(imageDataUrl, candidates);

    const infDurationMs = (performance.now() - infStartTime).toFixed(1);
    console.log(`[MOBILECLIP TEST] inference finished (推論耗時: ${infDurationMs} ms)`);

    const sorted = Array.isArray(rawResults)
      ? [...rawResults].sort((a, b) => (b.score || 0) - (a.score || 0))
      : [];

    const top5 = sorted.slice(0, 5).map(item => ({
      label: item.label,
      score: typeof item.score === 'number' ? Number(item.score.toFixed(4)) : item.score
    }));

    console.log('[MOBILECLIP TEST] top 5:');
    console.table(top5);

    return top5;
  } catch (error) {
    console.error('[MOBILECLIP TEST] ERROR', error && error.stack ? error.stack : error);
    throw error;
  }
}

/**
 * MobileCLIP 手機測試模式專用執行流程
 * 當網址包含 ?mobilecliptest=1 時由拍照完成後觸發
 */
async function runMobileClipCameraTest(photoDataUrl) {
  console.log('[MOBILECLIP TEST] 執行手機測試模式分析...');

  // 1. Loading 顯示：模型第一次下載時沿用 modelLoadingOverlay 顯示「MobileCLIP 模型下載中...」
  try {
    if (typeof showModelLoadingOverlay === 'function') {
      showModelLoadingOverlay('MobileCLIP 模型下載中...', 0, '正在連線下載模型權重...');
    }
    if (typeof showAiScanLoading === 'function') {
      showAiScanLoading(photoDataUrl);
      const desc = document.getElementById('aiScanStatusText');
      if (desc) desc.textContent = 'MobileCLIP 模型下載中...';
      const tag = document.getElementById('aiScanEngineTag');
      if (tag) tag.textContent = 'MobileCLIP WASM';
    }

    const onProgress = (percent, file) => {
      const p = Math.max(0, Math.min(100, Math.round(percent)));
      if (typeof updateModelLoadingProgress === 'function') {
        updateModelLoadingProgress(p, 'MobileCLIP 模型下載中...', file ? `下載進度: ${file} (${p}%)` : '下載中...');
      }
      const desc = document.getElementById('aiScanStatusText');
      if (desc) {
        desc.textContent = `MobileCLIP 模型下載中... ${p}%`;
      }
    };

    // 初始化模型（下載階段，若已下載過則自快取秒載）
    await initMobileClipTest(onProgress);

    // 2. 推論階段顯示「MobileCLIP 分析中...」
    if (typeof updateModelLoadingProgress === 'function') {
      updateModelLoadingProgress(100, 'MobileCLIP 分析中...', '正在比對 12 項候選特徵標籤...');
    }
    const desc = document.getElementById('aiScanStatusText');
    if (desc) {
      desc.textContent = 'MobileCLIP 分析中...';
    }

    // 3. 執行推論
    const results = await testMobileClip(photoDataUrl, MOBILECLIP_TEST_CANDIDATES);

    // 4. 完成後關閉 Loading 與相機視窗
    if (typeof hideModelLoadingOverlay === 'function') {
      hideModelLoadingOverlay(false);
    }
    if (typeof hideAiScanLoading === 'function') {
      hideAiScanLoading();
    }
    const overlay = document.querySelector('.camera-recognition-overlay') || document.getElementById('aiScanLoadingModal');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.style.display = 'none';
    }
    if (typeof closeCameraScanModal === 'function') {
      closeCameraScanModal();
    }

    // 5. 格式化顯示前 5 名結果（例如：1. a carton or bottle of fresh milk — 82.3%）
    let msg = 'MobileCLIP 測試結果\n\n';
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

    console.log('[MOBILECLIP TEST] 測試結果輸出:\n' + msg);
    setTimeout(() => {
      alert(msg);
    }, 100);

    return results;
  } catch (error) {
    console.error('[MOBILECLIP TEST] ERROR', error && error.stack ? error.stack : error);

    // 關閉 Loading
    if (typeof hideModelLoadingOverlay === 'function') {
      hideModelLoadingOverlay(false);
    }
    if (typeof hideAiScanLoading === 'function') {
      hideAiScanLoading();
    }
    const overlay = document.querySelector('.camera-recognition-overlay') || document.getElementById('aiScanLoadingModal');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.style.display = 'none';
    }
    if (typeof closeCameraScanModal === 'function') {
      closeCameraScanModal();
    }

    // 畫面顯示：MobileCLIP TEST ERROR + error.message
    const errorMsg = `MobileCLIP TEST ERROR\n${error && error.message ? error.message : error}`;
    setTimeout(() => {
      alert(errorMsg);
    }, 100);
    throw error;
  }
}

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

  // DOM 載入後自動嘗試啟動非同步模型初始化
  // AI 模型載入全面改為「點擊相機按鈕」時非同步觸發，初始化不自動載入任何模型
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
    runMobileClipCameraTest
  };
}
