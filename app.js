/**
 * 期效管家 - 純本機智慧自然語言速記與 RoBERTa-Tiny / BERT-Tiny 命名實體識別引擎
 * Smart Quick Add & On-Device NER Parser v1.9.18
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
 * 7. 相機辨識由 cloud-camera.js 呼叫雲端服務，不載入手機視覺模型。
 */

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
  food: { label: '食品', emoji: '🥛' },
  drinks: { label: '飲品', emoji: '🥤' },
  snack: { label: '零食', emoji: '🍪' },
  fresh: { label: '生鮮', emoji: '🐟' },
  medicine: { label: '藥品', emoji: '💊' },
  supplement: { label: '保健', emoji: '💊' },
  beauty: { label: '美妝', emoji: '💄' },
  pao: { label: '日用', emoji: '🧴' },
  cleaning: { label: '清潔', emoji: '🧽' },
  filter: { label: '耗材', emoji: '🌀' },
  warranty: { label: '保固', emoji: '🛡️' },
  digital: { label: '數位', emoji: '📱' },
  stationery: { label: '文具', emoji: '✏️' },
  sports: { label: '運動', emoji: '🏋️' },
  tools: { label: '五金', emoji: '🔧' },
  pet: { label: '寵物', emoji: '🐾' },
  baby: { label: '母嬰', emoji: '🍼' },
  office: { label: '辦公', emoji: '💼' },
  outdoor: { label: '戶外', emoji: '⛺' },
  home: { label: '居家', emoji: '🏠' },
  fashion: { label: '穿搭', emoji: '👕' },
  animation: { label: '動畫', emoji: '🎬' },
  game: { label: '遊戲', emoji: '🎮' },
  otaku: { label: '二次元', emoji: '✨' },
  vehicle: { label: '車輛', emoji: '🚗' },
  subscription: { label: '訂閱', emoji: '📅' },
  ticket: { label: '票券/活動', emoji: '🎟️' },
  other: {
    label: '其他',
    emoji: '📦',
    items: [
      { name: '日常生活用品', subCat: '一般雜項', emoji: '📦' },
      { name: '未分類備忘物品', subCat: '未分類', emoji: '📦' },
      { name: '商務背包', subCat: '包袋', emoji: '🎒' },
      { name: '日常工作會議', subCat: '會議', emoji: '📅' },
      { name: '各類生活備忘', subCat: '備忘', emoji: '📌' }
    ]
  }
};

const SUB_CATEGORY_CONFIG = {
  food: ['青菜', '水果', '鮮乳', '雞蛋', '豆製品', '起司乳酪', '生鮮肉品', '水產海鮮', '麵包烘焙', '調味料', '食用油', '米麵穀物', '南北乾貨', '熟食料理'],
  drinks: ['咖啡豆', '濾掛咖啡', '茶葉茶包', '手搖飲品', '果汁蔬果汁', '包裝水', '氣泡水', '碳酸飲料', '啤酒烈酒', '紅白酒', '沖泡飲品', '乳清飲品'],
  snack: ['餅乾米果', '洋芋片脆片', '巧克力可可', '堅果果乾', '糖果軟糖', '肉乾肉條', '即食泡麵', '海苔點心', '果凍布丁', '傳統糕餅'],
  fresh: ['牛肉羊肉', '生鮮豬肉', '雞肉禽肉', '海鮮魚類', '蝦蟹貝類', '火鍋肉片', '冷凍調理包', '微波熟食', '水餃湯圓', '生鮮時蔬'],
  medicine: ['眼藥水', '人工淚液', '外用藥膏', '感冒退燒', '消炎止痛', '腸胃整腸', '處方藥', '醫療敷料', '隱眼保養液', '防蚊止癢', '常備成藥'],
  supplement: ['綜合維他命', 'B群活力', '維生素C', '深海魚油', '葉黃素', '活性益生菌', '膠原蛋白', '鈣片D3', '滴雞精', '高蛋白粉', '機能保健'],
  beauty: ['精華液', '乳液面霜', '保濕面膜', '卸妝潔顏', '化妝水噴霧', '緊緻眼霜', '防曬隔離', '唇膏口紅', '粉底彩妝', '美甲護理', '香水香氛'],
  pao: ['洗髮沐浴', '潤髮護髮', '牙膏口腔', '洗手香皂', '身體乳液', '護手滋潤', '刮鬍刀具', '女性護理', '毛巾面巾', '日常消耗'],
  cleaning: ['菜瓜布海綿', '菜瓜布', '洗碗精洗劑', '洗衣精洗衣球', '抹布抹巾', '潔廁去垢', '水垢油垢清', '消毒酒精', '除塵防塵', '除濕防潮', '除蟎噴霧', '地板清潔', '疏通清潔'],
  filter: ['清淨機濾網', '淨水器濾芯', '音波牙刷頭', '集水除濕盒', '掃地機主刷邊刷', '吸塵器耗材', '咖啡機除鈣', '冷氣濾網', '通風濾材'],
  warranty: ['智慧手機', '筆記型電腦', '平板電腦', '藍牙耳機', '家用電器', '電視螢幕', '人體工學家具', '智慧手錶', '遊戲主機', '攝影器材', '保固維修'],
  digital: ['充電器快充', '傳輸充電線', '行動電源', '耳機周邊', '保護貼保護殼', '記憶卡隨身碟', '鍵盤滑鼠', '智慧穿戴', '擴充轉接HUB'],
  stationery: ['手帳筆記', '書籍雜誌', '簽字鋼筆', '墨水替芯', '膠帶黏著', '檔案夾收納', '繪畫美術', '裁切工具', '辦公文具'],
  sports: ['運動護具', '瑜珈墊', '彈力帶拉力繩', '啞鈴重訓', '機能水壺', '跑鞋運動鞋', '球鞋', '運動補給', '運動包袋', '球拍線路'],
  tools: ['螺絲工具組', '手電筒照明', '防水絕緣膠帶', '接著快乾膠', '修繕五金', '量尺測量', '潤滑防鏽油', '五金耗材'],
  pet: ['乾糧飼料', '主食罐頭', '副食肉泥', '原肉凍乾', '體內外驅蟲', '核心疫苗', '貓砂尿墊', '寵物潔牙', '洗毛護理', '寵物保健品'],
  baby: ['配方奶粉', '成長奶粉', '透氣尿布', '純水濕紙巾', '副食品常溫粥', '奶瓶奶嘴', '米餅副食', '幼兒常規疫苗', '兒童餐具'],
  vehicle: ['機油', '機油芯', '齒輪油', '輪胎對調', '電瓶', '雨刷', '煞車油皮', '火星塞', '空氣濾清器', '定檢驗車', '車險強制險'],
  subscription: ['影音串流', '音樂串流', '雲端空間', '專業軟體', '健身會籍', '寬頻電信', '房屋租約', '訂閱服務', '年約保險'],
  outdoor: ['露營天幕', '登山裝備', '戶外炊具', '機能水壺', '防潮地墊', '登山手杖', '能量果膠', '防寒睡袋'],
  home: ['室內植栽', '花草肥料', 'LED照明', '防蟎寢具', '住警消防', '香氛擴香', '水電修繕', '收納整理'],
  fashion: ['換季送洗', '真皮皮革保養', '珠寶首飾', '衣物防護防蛀', '精品鞋靴', '名牌包袋', '飾品小物', '太陽眼鏡'],
  animation: ['漫畫單行本', '輕小說', 'BD藍光影音', '畫冊設定集', '周邊特典', '海報掛軸', '同人周邊'],
  game: ['Switch卡帶', 'PSXbox光碟', '主機手把', '點數卡序號', '特典周邊', '典藏套裝', 'Amiibo'],
  otaku: ['徽章吧唧', '壓克力立牌磚', '色紙相卡', '手辦模型景品', '棉花娃玩偶', '一番賞獎品', '痛包配件'],
  ticket: ['電影票', '演唱會門票', '動漫展覽票', '活動兌換券', '餐券住宿券', '高鐵車票', '商品禮券'],
  other: ['一般雜項', '配件小物', '未分類', '包袋', '工作會議', '各類備忘']
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
  { keywords: ['藥膏', '皮膚膏', '抗生素', '曼秀雷敦', '眼藥膏', '蚊蟲膏', 'ok繃', '創口貼', '優碘', '碘酒'], emoji: '🩹', cat: 'medicine', subCat: '藥膏' },
  { keywords: ['止痛藥', '感冒藥', '胃藥', '成藥', '膠囊', '錠', '藥', '普拿疼', '退燒藥', '胃散', '正露丸', '止咳藥', '消炎藥'], emoji: '🩺', cat: 'medicine', subCat: '成藥' },
  { keywords: ['牙醫', '洗牙', '看診', '診所', '醫院', '看牙', '牙齒', '補牙'], emoji: '🦷', cat: 'medicine', subCat: '醫療' },
  { keywords: ['隱形眼鏡', '保養液', '隱眼', '生理食鹽水'], emoji: '👁️', cat: 'medicine', subCat: '保養液' },

  // 清潔 (cleaning)
  { keywords: ['菜瓜布', '海綿', '科技海綿', '洗碗海綿'], emoji: '🧽', cat: 'cleaning', subCat: '菜瓜布' },
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
  ], emoji: '☕', cat: 'drinks', subCat: '咖啡豆' },

  { keywords: [
    '蛋', '雞蛋', '鴨蛋', '茶葉蛋', '皮蛋', '鹹蛋', '生鮮蛋', '洗選蛋', '放牧蛋',
    '土雞蛋', '烏骨雞蛋', '溏心蛋', '溫泉蛋', '水煮蛋', '鵪鶉蛋'
  ], emoji: '🥚', cat: 'food', subCat: '雞蛋' },

  { keywords: [
    '茶', '茶葉', '茶包', '烏龍茶', '綠茶', '紅茶', '普洱茶',
    '四季春', '青茶', '鐵觀音', '包種茶', '奶茶', '花茶', '菊花茶', '麥茶', '玄米茶'
  ], emoji: '🍵', cat: 'drinks', subCat: '茶葉茶包' },

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

  // 飲品 (drinks)
  { keywords: ['咖啡豆', '咖啡粉', '濾掛', '濾掛咖啡', '手沖咖啡', '即溶咖啡', '濃縮咖啡', '拿鐵', '美式咖啡', '冷萃'], emoji: '☕', cat: 'drinks', subCat: '咖啡豆', duration: 30 },
  { keywords: ['茶葉', '茶包', '高山茶', '烏龍茶', '紅茶', '綠茶', '四季春', '包種茶', '鐵觀音', '普洱茶', '花草茶', '麥茶'], emoji: '🍵', cat: 'drinks', subCat: '茶葉茶包', duration: 180 },
  { keywords: ['手搖', '手搖飲', '珍奶', '珍珠奶茶', '綠茶多多', '清心', '五十嵐', '麻古', '可不可', '得正'], emoji: '🧋', cat: 'drinks', subCat: '手搖飲品', duration: 1 },
  { keywords: ['果汁', '柳橙汁', '蘋果汁', '蔬果汁', '芭樂汁', '番茄汁', '胡蘿蔔汁'], emoji: '🧃', cat: 'drinks', subCat: '果汁蔬果汁', duration: 7 },
  { keywords: ['礦泉水', '純水', '瓶裝水', '飲用水', '多喝水', '泰山純水'], emoji: '💧', cat: 'drinks', subCat: '包裝水', duration: 365 },
  { keywords: ['氣泡水', '聖沛黎洛', '舒味思', '沛綠雅', '氣泡飲'], emoji: '🫧', cat: 'drinks', subCat: '氣泡水', duration: 180 },
  { keywords: ['可樂', '雪碧', '沙士', '汽水', '碳酸飲料', '黑松沙士', '芬達'], emoji: '🥤', cat: 'drinks', subCat: '碳酸飲料', duration: 180 },
  { keywords: ['啤酒', '台啤', '海尼根', '百威', '精釀啤酒', 'asahi', 'kirin', 'sapporo', '低酒精'], emoji: '🍺', cat: 'drinks', subCat: '啤酒烈酒', duration: 180 },
  { keywords: ['紅酒', '白酒', '威士忌', '白蘭地', '伏特加', '琴酒', '葡萄酒', '清酒', '高粱酒', '香檳'], emoji: '🍷', cat: 'drinks', subCat: '紅白酒', duration: 365 },
  { keywords: ['沖泡飲', '阿華田', '美祿', '杏仁粉', '黑芝麻糊', '穀粉', '桂格麥片飲'], emoji: '🥣', cat: 'drinks', subCat: '沖泡飲品', duration: 180 },
  { keywords: ['乳清蛋白飲', '高蛋白飲', '蛋白水', '能量飲', '紅牛', '怪獸能量', 'red bull', 'monster'], emoji: '⚡', cat: 'drinks', subCat: '乳清飲品', duration: 90 },

  // 零食 (snack)
  { keywords: ['洋芋片', '薯片', '樂事', '波卡', '卡迪那', '多力多滋', '可樂果', '蝦味先', '脆片'], emoji: '🥔', cat: 'snack', subCat: '洋芋片脆片', duration: 60 },
  { keywords: ['餅乾', '米果', '蘇打餅', '夾心餅', '蛋捲', '仙貝', '雪餅', '曲奇', '威化餅', 'oreo'], emoji: '🍪', cat: 'snack', subCat: '餅乾米果', duration: 60 },
  { keywords: ['巧克力', '生巧克力', '黑巧克力', '金莎', 'godiva', '明治巧克力', '雷神', '可可球'], emoji: '🍫', cat: 'snack', subCat: '巧克力可可', duration: 180 },
  { keywords: ['堅果', '腰果', '核桃', '杏仁果', '開心果', '夏威夷豆', '花生', '綜合堅果', '蔓越莓乾', '葡萄乾', '果乾'], emoji: '🥜', cat: 'snack', subCat: '堅果果乾', duration: 90 },
  { keywords: ['糖果', '軟糖', '小熊軟糖', '喉糖', '口香糖', '棒棒糖', '薄荷糖', '牛奶糖'], emoji: '🍬', cat: 'snack', subCat: '糖果軟糖', duration: 180 },
  { keywords: ['肉乾', '豬肉乾', '牛肉乾', '肉條', '肉鬆', '魷魚絲', '鱈魚香絲', '魚酥'], emoji: '🥩', cat: 'snack', subCat: '肉乾肉條', duration: 45 },
  { keywords: ['泡麵', '即食麵', '杯麵', '統一麵', '滿漢大餐', '維力炸醬麵', '拉麵', '辛拉麵', '乾拌麵'], emoji: '🍜', cat: 'snack', subCat: '即食泡麵', duration: 180 },
  { keywords: ['海苔', '元本山', '高麗海苔', '海苔酥', '海苔片'], emoji: '🍙', cat: 'snack', subCat: '海苔點心', duration: 90 },
  { keywords: ['布丁', '果凍', '統一布丁', '茶凍', '咖啡凍', '豆花', '愛玉'], emoji: '🍮', cat: 'snack', subCat: '果凍布丁', duration: 14 },
  { keywords: ['鳳梨酥', '蛋黃酥', '太陽餅', '綠豆椪', '糕餅', '月餅', '麻糬'], emoji: '🥮', cat: 'snack', subCat: '傳統糕餅', duration: 21 },

  // 生鮮 (fresh)
  { keywords: ['牛肉', '牛排', '牛絞肉', '和牛', '羊肉', '羊排', '牛肉片'], emoji: '🥩', cat: 'fresh', subCat: '牛肉羊肉', duration: 3 },
  { keywords: ['豬肉', '梅花肉', '五花肉', '松阪豬', '豬絞肉', '豬排', '排骨', '里肌肉'], emoji: '🥓', cat: 'fresh', subCat: '生鮮豬肉', duration: 3 },
  { keywords: ['雞肉', '雞胸肉', '雞腿', '雞翅', '土雞', '烏骨雞', '鴨肉', '鵝肉'], emoji: '🍗', cat: 'fresh', subCat: '雞肉禽肉', duration: 3 },
  { keywords: ['鮮魚', '鮭魚', '鱸魚', '鯖魚', '鱈魚', '虱目魚', '生魚片', '鮮蚵', '蚵仔'], emoji: '🐟', cat: 'fresh', subCat: '海鮮魚類', duration: 2 },
  { keywords: ['蝦', '白蝦', '草蝦', '明蝦', '龍蝦', '螃蟹', '紅蟳', '蛤蜊', '文蛤', '干貝', '透抽', '花枝', '軟絲'], emoji: '🦐', cat: 'fresh', subCat: '蝦蟹貝類', duration: 2 },
  { keywords: ['火鍋肉片', '培根牛', '梅花豬肉片', '冷凍肉', '肉卷'], emoji: '🍲', cat: 'fresh', subCat: '火鍋肉片', duration: 60 },
  { keywords: ['冷凍食品', '冷凍調理包', '披薩', '雞塊', '薯條', '冷凍炒飯', '微波食品', '調理包'], emoji: '🧊', cat: 'fresh', subCat: '冷凍調理包', duration: 90 },
  { keywords: ['水餃', '鍋貼', '湯圓', '餛飩', '冷凍水餃'], emoji: '🥟', cat: 'fresh', subCat: '水餃湯圓', duration: 60 },

  // 保健 (supplement)
  { keywords: ['綜合維他命', '綜合維生素', '善存', '克補', '綜合營養'], emoji: '💊', cat: 'supplement', subCat: '綜合維他命', duration: 180 },
  { keywords: ['b群', '維他命b', '維生素b', '合利他命', 'b12', 'b6', '葉酸'], emoji: '⚡', cat: 'supplement', subCat: 'B群活力', duration: 180 },
  { keywords: ['維他命c', '維生素c', '發泡錠', 'c發泡錠', '抗氧化'], emoji: '🍊', cat: 'supplement', subCat: '維生素C', duration: 180 },
  { keywords: ['魚油', '深海魚油', 'omega3', 'dha', 'epa', '磷蝦油'], emoji: '🐟', cat: 'supplement', subCat: '深海魚油', duration: 180 },
  { keywords: ['葉黃素', '玉米黃素', '護眼錠', '晶亮'], emoji: '👁️', cat: 'supplement', subCat: '葉黃素', duration: 180 },
  { keywords: ['益生菌', '乳酸菌', '腸胃益生菌', '娘家益生菌', '阿德比'], emoji: '🦠', cat: 'supplement', subCat: '活性益生菌', duration: 180 },
  { keywords: ['膠原蛋白', '膠原蛋白粉', '膠原蛋白飲', '玻尿酸飲'], emoji: '✨', cat: 'supplement', subCat: '膠原蛋白', duration: 180 },
  { keywords: ['鈣片', '檸檬酸鈣', '海藻鈣', '維生素d3', 'd3', '鋅錠', '補鋅', '鐵劑', '補鐵'], emoji: '🦴', cat: 'supplement', subCat: '鈣片D3', duration: 180 },
  { keywords: ['滴雞精', '雞精', '蜆精', '燕窩', '人蔘飲', '冬蟲夏草', '補品'], emoji: '🥣', cat: 'supplement', subCat: '滴雞精', duration: 180 },
  { keywords: ['乳清', '高蛋白粉', '分離乳清', '乳清蛋白', 'myprotein', 'on乳清', '肌酸'], emoji: '🥤', cat: 'supplement', subCat: '高蛋白粉', duration: 180 },

  // 美妝 (beauty)
  { keywords: ['精華液', '小黑瓶', '小棕瓶', '精華露', '安瓶', '玻尿酸精華', '抗老精華', '美白精華'], emoji: '💧', cat: 'beauty', subCat: '精華液', duration: 180 },
  { keywords: ['乳液', '面霜', '乳霜', '保濕霜', '水凝霜', '日霜', '晚霜'], emoji: '🧴', cat: 'beauty', subCat: '乳液面霜', duration: 180 },
  { keywords: ['面膜', '保濕面膜', '泥膜', '凍膜', '黑面膜', '早安面膜'], emoji: '🧖', cat: 'beauty', subCat: '保濕面膜', duration: 180 },
  { keywords: ['卸妝', '卸妝水', '卸妝油', '卸妝乳', '卸妝膏', '眼唇卸妝', '洗面乳', '洗顏霜', '潔面慕斯'], emoji: '🫧', cat: 'beauty', subCat: '卸妝潔顏', duration: 180 },
  { keywords: ['化妝水', '保濕水', '爽膚水', '精華水', '噴霧', '活泉水', '保濕噴霧'], emoji: '💦', cat: 'beauty', subCat: '化妝水噴霧', duration: 180 },
  { keywords: ['眼霜', '眼膠', '眼部精華'], emoji: '👁️', cat: 'beauty', subCat: '緊緻眼霜', duration: 180 },
  { keywords: ['防曬乳', '防曬露', '隔離霜', '防曬噴霧', '防曬棒', '安耐曬'], emoji: '☀️', cat: 'beauty', subCat: '防曬隔離', duration: 180 },
  { keywords: ['唇膏', '口紅', '唇釉', '潤唇膏', '護唇膏', '唇蜜', '唇泥'], emoji: '💄', cat: 'beauty', subCat: '唇膏口紅', duration: 365 },
  { keywords: ['粉底', '粉底液', '氣墊', '氣墊粉餅', '蜜粉', '遮瑕', '腮紅', '眼影', '眉筆', '睫毛膏', '眼線筆'], emoji: '🎨', cat: 'beauty', subCat: '粉底彩妝', duration: 365 },
  { keywords: ['指甲油', '光療膠', '美甲片', '護甲油', '指緣油'], emoji: '💅', cat: 'beauty', subCat: '美甲護理', duration: 365 },
  { keywords: ['香水', '淡香水', '香精', '古龍水', '香氛噴霧', 'jo malone', 'diptyque', 'chanel香水'], emoji: '🌸', cat: 'beauty', subCat: '香水香氛', duration: 730 },

  // 數位 (digital)
  { keywords: ['快充頭', '充電頭', '豆腐頭', 'gan快充', '充電器', '旅充'], emoji: '🔌', cat: 'digital', subCat: '充電器快充', duration: 730 },
  { keywords: ['充電線', '傳輸線', 'type-c', 'lightning線', 'usb線', '編織線', '快充線'], emoji: '🪢', cat: 'digital', subCat: '傳輸充電線', duration: 365 },
  { keywords: ['行動電源', '行電', '磁吸行充', 'magsafe電池', '快充行動電源'], emoji: '🔋', cat: 'digital', subCat: '行動電源', duration: 730 },
  { keywords: ['手機殼', '保護殼', '保護貼', '玻璃貼', '防摔殼', '鏡頭貼'], emoji: '🛡️', cat: 'digital', subCat: '保護貼保護殼', duration: 180 },
  { keywords: ['記憶卡', 'sd卡', 'tf卡', 'microsd', '隨身碟', 'usb隨身碟', '外接硬碟', 'ssd'], emoji: '💾', cat: 'digital', subCat: '記憶卡隨身碟', duration: 1095 },
  { keywords: ['滑鼠', '鍵盤', '機械鍵盤', '無線鍵盤', '滑鼠墊', '軌跡球'], emoji: '🖱️', cat: 'digital', subCat: '鍵盤滑鼠', duration: 730 },
  { keywords: ['轉接頭', 'hub', '集線器', 'hdmi線', '讀卡機', '擴充座'], emoji: '🎛️', cat: 'digital', subCat: '擴充轉接HUB', duration: 730 },

  // 文具 (stationery)
  { keywords: ['手帳', '筆記本', '日記本', '便條紙', '便利貼', '方格本', '活頁本'], emoji: '📓', cat: 'stationery', subCat: '手帳筆記', duration: 365 },
  { keywords: ['書籍', '書本', '圖書', '雜誌', '課本', '小說', '散文', '工具書', '字典'], emoji: '📚', cat: 'stationery', subCat: '書籍雜誌', duration: 730 },
  { keywords: ['鋼筆', '原子筆', '簽字筆', '中性筆', '螢光筆', '自動鉛筆', '百樂', '三菱', '斑馬筆'], emoji: '🖊️', cat: 'stationery', subCat: '簽字鋼筆', duration: 365 },
  { keywords: ['墨水', '鋼筆墨水', '筆芯', '原子筆芯', '鉛筆芯', '替芯'], emoji: '🖋️', cat: 'stationery', subCat: '墨水替芯', duration: 365 },
  { keywords: ['膠帶', '紙膠帶', '雙面膠', '封箱膠帶', '固體膠', '口紅膠', '白膠'], emoji: '🩹', cat: 'stationery', subCat: '膠帶黏著', duration: 365 },
  { keywords: ['資料夾', '公文夾', '風琴夾', '檔案袋', '收納盒', '筆筒', '文件欄'], emoji: '📁', cat: 'stationery', subCat: '檔案夾收納', duration: 730 },
  { keywords: ['色鉛筆', '水彩', '彩色筆', '畫筆', '素描本', '印泥', '印章'], emoji: '🎨', cat: 'stationery', subCat: '繪畫美術', duration: 730 },
  { keywords: ['剪刀', '美工刀', '釘書機', '打孔機', '美工刀片', '尺', '圓規'], emoji: '✂️', cat: 'stationery', subCat: '裁切工具', duration: 730 },

  // 運動 (sports)
  { keywords: ['護膝', '護腕', '護踝', '運動護具', '護腰', '壓力褲', '束褲'], emoji: '🦵', cat: 'sports', subCat: '運動護具', duration: 365 },
  { keywords: ['瑜珈墊', '瑜伽墊', '滾筒', '瑜珈磚', '拉筋板'], emoji: '🧘', cat: 'sports', subCat: '瑜珈墊', duration: 365 },
  { keywords: ['彈力帶', '拉力繩', '阻力帶', '訓練帶', '拉力帶'], emoji: '🎗️', cat: 'sports', subCat: '彈力帶拉力繩', duration: 365 },
  { keywords: ['啞鈴', '槓鈴', '壺鈴', '重訓手套', '握力器', '健腹輪'], emoji: '🏋️', cat: 'sports', subCat: '啞鈴重訓', duration: 1095 },
  { keywords: ['運動水壺', '搖搖杯', '蛋白搖搖杯', '水袋', '保溫運動瓶'], emoji: '🍶', cat: 'sports', subCat: '機能水壺', duration: 365 },
  { keywords: ['球鞋', '運動鞋', '跑鞋', '慢跑鞋', '籃球鞋', '羽球鞋', '登山鞋', '鞋墊'], emoji: '👟', cat: 'sports', subCat: '跑鞋運動鞋', duration: 365 },
  { keywords: ['能量膠', '果膠', '電解質', '鹽錠', '運動補給', '能量棒'], emoji: '⚡', cat: 'sports', subCat: '運動補給', duration: 180 },
  { keywords: ['運動包', '健身包', '運動腰包', '水壺腰包'], emoji: '🎒', cat: 'sports', subCat: '運動包袋', duration: 730 },
  { keywords: ['球拍', '穿線', '網球拍', '羽球拍', '拍線', '握把皮'], emoji: '🏸', cat: 'sports', subCat: '球拍線路', duration: 90 },

  // 五金 (tools)
  { keywords: ['螺絲起子', '工具組', '板手', '六角板手', '鉗子', '老虎鉗', '斜口鉗', '電鑽'], emoji: '🪛', cat: 'tools', subCat: '螺絲工具組', duration: 1825 },
  { keywords: ['手電筒', '探照燈', '工作燈', '頭燈'], emoji: '🔦', cat: 'tools', subCat: '手電筒照明', duration: 730 },
  { keywords: ['絕緣膠帶', '電火布', '防水膠帶', '管路修補膠帶'], emoji: '🩹', cat: 'tools', subCat: '防水絕緣膠帶', duration: 730 },
  { keywords: ['快乾膠', '三秒膠', '接著劑', 'ab膠', '強力膠', '矽利康', '填縫劑'], emoji: '🧪', cat: 'tools', subCat: '接著快乾膠', duration: 180 },
  { keywords: ['螺絲', '壁虎', '膨脹螺絲', '鐵釘', '五金零件', '鉸鏈', '滑軌'], emoji: '🔩', cat: 'tools', subCat: '修繕五金', duration: 1825 },
  { keywords: ['捲尺', '皮尺', '量尺', '水平尺', '游標卡尺'], emoji: '📏', cat: 'tools', subCat: '量尺測量', duration: 1825 },
  { keywords: ['wd40', '潤滑油', '防鏽油', '黃油', '針車油'], emoji: '🛢️', cat: 'tools', subCat: '潤滑防鏽油', duration: 730 },

  // 其他 (other)
  { keywords: ['一般雜項', '雜項', '雜物', '日用品', '生活用品'], emoji: '📦', cat: 'other', subCat: '一般雜項' },
  { keywords: ['眼鏡', '墨鏡', '太陽眼鏡', '抗藍光', '鏡框', '鏡片', '老花眼鏡', '護目鏡'], emoji: '🕶️', cat: 'fashion', subCat: '太陽眼鏡', duration: 365 },
  { keywords: ['配件小物', '飾品小物', '隨身配件', '小物'], emoji: '💍', cat: 'fashion', subCat: '飾品小物' },
  { keywords: ['未分類', '其他物品', '待整理'], emoji: '📦', cat: 'other', subCat: '未分類' },
  { keywords: ['背包', '後背包', '公事包', '手提包'], emoji: '🎒', cat: 'other', subCat: '包袋' },
  { keywords: ['衣服', '褲子', '襯衫', '外套', '洋裝'], emoji: '👕', cat: 'fashion', subCat: '換季送洗' },
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
    return { category: 'fashion', subCategory: '太陽眼鏡', emoji: '🕶️' };
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
// 1.6 物品使用期限推算與難以判斷轉使用日期引擎 (inferItemLifespanOrUsageDate)
// ==========================================
function inferItemLifespanOrUsageDate(name, category, subCategory, baseDate = new Date()) {
  const text = `${name || ''} ${subCategory || ''} ${category || ''}`.toLowerCase();
  const todayStr = formatDate(baseDate);

  // 1. 明確無效期 / 難以判斷 / 耐用物品 -> 自動改為「記錄使用日期」
  const isDurableOrNoExpiry = /(?:球鞋|慢跑鞋|運動鞋|布鞋|涼鞋|拖鞋|高跟鞋|皮鞋|靴子|背包|後背包|公事包|手提包|皮夾|錢包|皮包|衣服|外套|褲子|襯衫|洋裝|毛衣|內衣|襪子|圍巾|帽子|飾品|項鍊|戒指|手鍊|耳環|眼鏡|墨鏡|鏡框|鏡片|老花眼鏡|護目鏡|書|書籍|漫畫|小說|雜誌|單行本|繪本|畫冊|筆記本|手帳|資料夾|公文|印章|文具|剪刀|美工刀|玩具|公仔|模型|手辦|黏土人|景品|立牌|徽章|吧唧|色紙|相卡|棉花娃|玩偶|娃娃|一番賞|收藏|掛畫|海報|痛包|家具|沙發|桌|椅|床|櫃子|置物架|鍋具|餐具|杯子|碗盤|工具|螺絲起子|鉗子|板手|捲尺|隨身配件|一般雜項|未分類|備忘|生活備忘)/i;

  // 2. 具有常態生命週期/保存期限之規則庫 (由短至長排列)
  const LIFESPAN_RULES = [
    { regex: /生鮮肉|牛肉|豬肉|雞肉|絞肉|生肉|生鮮魚|生鮮蝦|生魚片|海鮮|生干貝|鮮魚|鮮蝦|吐司|生吐司|麵包|三明治|沙拉|即食熟食|熟食便當|剩菜/i, days: 3, label: '生鮮肉品/短效麵包' },
    { regex: /青菜|蔬菜|葉菜|菠菜|地瓜葉|空心菜|小白菜|萵苣|水蓮|香蕉|熟成木瓜|草莓|水蜜桃/i, days: 5, label: '葉菜生鮮/熟成水果' },
    { regex: /水果|蘋果|芭樂|柑橘|柳丁|西瓜|芒果|葡萄|奇異果|高麗菜|包菜|菇|金針菇|杏鮑菇|豆腐|豆干/i, days: 7, label: '當季水果/常備冷藏' },
    { regex: /鮮乳|鮮奶|牛乳|生乳|全脂乳|低脂乳|豆漿|優酪乳|燕麥奶/i, days: 12, label: '鮮乳/冷藏豆乳' },
    { regex: /優格|布丁|奶酪/i, days: 14, label: '優格/冷藏點心' },
    { regex: /蛋|雞蛋|鴨蛋|洗選蛋|放牧蛋/i, days: 21, label: '產地鮮蛋' },
    { regex: /菜瓜布|洗碗海綿|科技海綿|抹布|擦拭布|刮鬍刀片|刮鬍刀頭|冷氣濾網清洗/i, days: 30, label: '廚衛清潔耗材' },
    { regex: /眼藥水|人工淚液|洗眼液/i, days: 30, label: '眼藥水開封保存' },
    { regex: /配方奶粉|嬰兒奶粉/i, days: 30, label: '嬰幼配方奶開罐' },
    { regex: /貓砂|寵物尿墊|驅蟲滴劑|驅蟲藥/i, days: 30, label: '寵物月度護理' },
    { regex: /咖啡豆|現烘咖啡/i, days: 30, label: '咖啡豆賞味期' },
    { regex: /起司|乳酪|起司片/i, days: 30, label: '起司乳酪' },
    { regex: /訂閱|netflix|spotify|disney|youtube|月費|電信費|寬頻|房租|健身房/i, days: 30, label: '月度定期訂閱' },
    { regex: /電影票/i, days: 7, label: '電影票券' },
    { regex: /展覽門票|演唱會/i, days: 30, label: '活動票券' },
    { regex: /純水濕紙巾|濕紙巾/i, days: 45, label: '柔濕紙巾' },
    { regex: /寵物主糧|狗飼料|貓飼料|凍乾零食|寵物凍乾/i, days: 60, label: '寵物乾糧/凍乾' },
    { regex: /洗碗精|洗潔精|果醬|抹醬|花生醬|零食|洋芋片|餅乾|點心|除濕盒|除濕劑|克潮靈/i, days: 60, label: '常備清潔/除濕盒' },
    { regex: /矽膠奶嘴|安撫奶嘴|固齒器/i, days: 60, label: '嬰幼奶嘴耗材' },
    { regex: /音波牙刷|電動牙刷|牙刷|刷頭/i, days: 90, label: '牙刷刷頭' },
    { regex: /淨水器濾芯|活性碳濾芯|濾水壺濾芯|brita/i, days: 90, label: '淨水活性碳濾芯' },
    { regex: /洗衣精|洗衣球|洗衣膠囊|潔廁劑|除蟎噴霧|牙膏|齒輪油|機車齒輪油/i, days: 90, label: '清潔洗沐/齒輪油' },
    { regex: /保養液|隱形眼鏡保養液|生理食鹽水/i, days: 90, label: '隱眼保養液開瓶' },
    { regex: /咖啡機除鈣|水垢清潔劑/i, days: 90, label: '咖啡機除鈣' },
    { regex: /紙尿褲|尿布/i, days: 90, label: '嬰兒紙尿褲' },
    { regex: /濾網|清淨機濾網|hepa|空氣濾網/i, days: 180, label: '清淨機HEPA濾網' },
    { regex: /機油|機油芯|汽車機油/i, days: 180, label: '汽車定期保養機油' },
    { regex: /雨刷|汽車雨刷|輪胎|胎壓/i, days: 180, label: '車輛耗材定期檢測' },
    { regex: /維他命|維生素|b群|魚油|葉黃素|益生菌|保健品|膠原蛋白|鈣片/i, days: 180, label: '保健營養品開封' },
    { regex: /藥膏|外用藥膏|皮膚膏|曼秀雷敦|抗生素藥膏/i, days: 180, label: '外用藥膏' },
    { regex: /沐浴乳|洗髮精|洗髮露|洗沐|精華液|保養品|乳液|面霜|防曬|防曬乳|護手霜|面膜/i, days: 180, label: '洗沐美妝保養品' },
    { regex: /調味料|醬油|食用油|橄欖油|米酒|醋|味噌|茶葉|茶包|泡麵|乾拌麵/i, days: 180, label: '調味乾貨/油品' },
    { regex: /墨水|印表機墨水|碳粉匣/i, days: 180, label: '印表機耗材' },
    { regex: /掃地機|掃地機器人|主刷|邊刷/i, days: 180, label: '掃地機耗材' },
    { regex: /消毒酒精|酒精噴霧/i, days: 180, label: '75%消毒酒精' },
    { regex: /成藥|感冒藥|止痛藥|胃藥|急救箱/i, days: 365, label: '家庭常備成藥' },
    { regex: /香水|淡香水|唇膏|口紅|彩妝/i, days: 365, label: '香水彩妝' },
    { regex: /手機|iphone|android|耳機|airpods|手錶|apple watch|garmin|點數卡|序號/i, days: 365, label: '原廠有限保固 1 年' },
    { regex: /驗車|定檢|強制險|車險|疫苗|寵物疫苗|狂犬疫苗/i, days: 365, label: '年度定檢/保險' },
    { regex: /罐頭|主食罐|機能罐/i, days: 365, label: '常規密封罐頭' },
    { regex: /電瓶|汽車電瓶|agm電瓶|鉛酸電瓶|煞車皮|煞車來令片/i, days: 730, label: '電瓶/煞車耐用期' },
    { regex: /電腦|筆電|macbook|ipad|平板/i, days: 730, label: '筆電/平板保固 2 年' },
    { regex: /家電|電視|冰箱|洗衣機|冷氣|除濕機|烤箱|微波爐/i, days: 1095, label: '家電核心保固 3 年' }
  ];

  const matchedRule = LIFESPAN_RULES.find(r => r.regex.test(text));

  // A. 若命中耐用品/無期限標籤，且沒有明確消耗規則，一律記錄使用日期
  if (isDurableOrNoExpiry.test(text) && !matchedRule) {
    return {
      hasEndDate: false,
      durationDays: 0,
      expiryDate: null,
      startDate: todayStr,
      mode: 'elapsed',
      reason: '此物品無固定到期日或難以判斷，已自動切換為「記錄使用日期」。',
      isEstimated: false
    };
  }

  // B. 命中具體物品生命週期規則
  if (matchedRule) {
    const exp = formatDate(offsetDays(baseDate, matchedRule.days));
    return {
      hasEndDate: true,
      durationDays: matchedRule.days,
      expiryDate: exp,
      startDate: todayStr,
      mode: 'expiry',
      reason: `依「${matchedRule.label}」自動估算建議使用期限（約 ${matchedRule.days} 天）。`,
      isEstimated: true
    };
  }

  // C. 依分類大項預設週期
  const CAT_DEFAULT_DURATIONS = {
    fresh: { days: 3, label: '生鮮肉品海鮮' },
    food: { days: 7, label: '常態生鮮食品' },
    drinks: { days: 30, label: '飲品/咖啡茶飲' },
    snack: { days: 60, label: '常備零食點心' },
    cleaning: { days: 60, label: '清潔日用品' },
    pao: { days: 90, label: '洗沐日化品' },
    beauty: { days: 180, label: '美妝護膚品' },
    medicine: { days: 180, label: '醫藥常備品' },
    supplement: { days: 180, label: '保健營養品' },
    filter: { days: 90, label: '定期更換耗材' },
    pet: { days: 60, label: '寵物消耗用品' },
    baby: { days: 60, label: '母嬰消耗用品' },
    vehicle: { days: 180, label: '車輛定期保養' },
    subscription: { days: 30, label: '定期訂閱服務' },
    ticket: { days: 30, label: '活動票券' },
    warranty: { days: 365, label: '硬體保固 1 年' },
    digital: { days: 365, label: '3C配件保固' }
  };

  const catRule = CAT_DEFAULT_DURATIONS[category];
  if (catRule) {
    const exp = formatDate(offsetDays(baseDate, catRule.days));
    return {
      hasEndDate: true,
      durationDays: catRule.days,
      expiryDate: exp,
      startDate: todayStr,
      mode: 'expiry',
      reason: `依「${catRule.label}」分類自動估算建議期限（約 ${catRule.days} 天）。`,
      isEstimated: true
    };
  }

  // D. 其他難以判斷之物品 -> 預設記錄使用日期 (hasEndDate: false)
  return {
    hasEndDate: false,
    durationDays: 0,
    expiryDate: null,
    startDate: todayStr,
    mode: 'elapsed',
    reason: '此物品無特定到期日，自動切換為「記錄使用日期」（累計陪伴天數）。',
    isEstimated: false
  };
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
    const brandMatch = clean.match(/(好市多|光泉|瑞穗|義美|福樂|林鳳營|高大|初鹿|柳營|四方|東海|萬丹|六甲|崙背)?\s*([^\s]{0,6})(?:鮮奶|牛奶|鮮乳)/);
    if (brandMatch && (brandMatch[1] || brandMatch[0])) {
      const b = brandMatch[1] || '';
      const m = (brandMatch[2] || '').replace(/^[買了大瓶小瓶一兩三]+/g, '').trim();
      const res = (b + ' ' + m + '鮮乳').replace(/\s+/g, ' ').trim();
      if (res.length >= 2) return res;
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

  // F. 智慧分類與細項項目自動對應 (若無對應則自動選 other 其他)
  const matched = matchCategoryAndSubCategory(text + ' ' + refinedName, 'other');
  const category = matched.category || 'other';
  const subCategory = matched.subCategory || '';
  const emoji = matched.emoji || '📌';

  // G. 補齊預設到期日 (若未輸入時間，自動判斷使用期限；若難以判斷則轉為記錄使用日期)
  const isElapsedExplicit = /(?:謹記|僅記|記|紀錄|記錄)?\s*(?:使用天數|陪伴天數|天數)|不設(?:定)?(?:到期|效期|時間|日)|無到期|不限期|永久/i.test(text);
  let finalDate = parsedDate;
  let hasEndDate = true;
  let autoInferred = null;

  if (isElapsedExplicit) {
    hasEndDate = false;
    finalDate = null;
  } else if (!finalDate) {
    autoInferred = inferItemLifespanOrUsageDate(refinedName, category, subCategory, baseDate);
    if (autoInferred.hasEndDate && autoInferred.expiryDate) {
      hasEndDate = true;
      finalDate = autoInferred.expiryDate;
    } else {
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
    autoInferred: autoInferred,
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
  const cleanName = extractCleanName(text);

  // 分類與細項項目自動對應（若無對應則預設選 other 其他）
  const matched = matchCategoryAndSubCategory(text + ' ' + cleanName, 'other');
  const category = matched.category || 'other';
  const subCategory = matched.subCategory || '';
  const emoji = matched.emoji || '📌';

  const isElapsedExplicit = /(?:謹記|僅記|記|紀錄|記錄)?\s*(?:使用天數|陪伴天數|天數)|不設(?:定)?(?:到期|效期|時間|日)|無到期|不限期|永久/i.test(text);
  let finalDate = parsedDate;
  let hasEndDate = true;
  let autoInferred = null;

  if (isElapsedExplicit) {
    hasEndDate = false;
    finalDate = null;
  } else if (!finalDate) {
    autoInferred = inferItemLifespanOrUsageDate(cleanName, category, subCategory, baseDate);
    if (autoInferred.hasEndDate && autoInferred.expiryDate) {
      hasEndDate = true;
      finalDate = autoInferred.expiryDate;
    } else {
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
    autoInferred: autoInferred,
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

  const theme = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : 'dark';
  const isLight = theme === 'light';
  const colors = theme === 'light'
    ? { normal: '#52796f', warning: '#c87d55', expired: '#ff453a', muted: 'rgba(140,125,110,.18)' }
    : theme === 'amoled'
      ? { normal: '#9eb8aa', warning: '#e0a477', expired: '#ff453a', muted: 'rgba(158,184,170,.18)' }
      : { normal: '#8fa89d', warning: '#d99a6c', expired: '#ff453a', muted: 'rgba(143,168,157,.16)' };
  const expDateStr = item.expiryDate || item.endDate;
  const isCountUp = item.trackingType === 'count_up' || !expDateStr || item.hasEndDate === false;

  // 1. 排除無到期日／僅記使用天數的項目
  if (isCountUp) {
    const defaultColor = colors.muted;
    if (progressBarFill && progressBarFill.style) {
      progressBarFill.style.backgroundColor = defaultColor;
      progressBarFill.style.setProperty('background-color', defaultColor, 'important');
      progressBarFill.style.width = '100%';
    }
    return {
      status: 'count_up',
      diffDays: null,
      backgroundColor: defaultColor,
      width: '100%'
    };
  }

  // 2. 有到期日項目的嚴格三段天數判定（以毫秒相除轉為整數天數）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expDateStr);
  exp.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));

  let bgColor = colors.normal;
  let fillWidth = '100%';
  let status = 'normal';

  if (diffDays < 0) {
    // 【情況 A：已過期】diffDays < 0
    status = 'expired';
    bgColor = colors.expired;
    fillWidth = '100%';
  } else if (diffDays >= 0 && diffDays <= 3) {
    // 【情況 B：即將到期】diffDays >= 0 且 diffDays <= 3（3天內，包含今天與第3天）
    status = 'warning';
    bgColor = colors.warning;
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
    // 【情況 C：安全正常】diffDays > 3（4天、6天、100天以上）
    status = 'normal';
    bgColor = colors.normal;
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
    progressBarFill.style.setProperty('background-color', status === 'expired' ? '#ff453a' : bgColor, 'important');
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
  const theme = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : 'dark';
  const isLight = theme === 'light';
  const colors = theme === 'light'
    ? { normal: '#52796f', warning: '#c87d55', expired: '#ff453a', muted: 'rgba(140,125,110,.18)', text: '#7d756d' }
    : theme === 'amoled'
      ? { normal: '#9eb8aa', warning: '#e0a477', expired: '#ff453a', muted: 'rgba(158,184,170,.18)', text: '#b6c5bd' }
      : { normal: '#8fa89d', warning: '#d99a6c', expired: '#ff453a', muted: 'rgba(143,168,157,.16)', text: 'rgba(255,255,255,.72)' };
  const expDateStr = item ? (item.expiryDate || item.endDate) : null;
  const isCountUp = !item || item.trackingType === 'count_up' || !expDateStr || item.hasEndDate === false;

  if (isCountUp) {
    return {
      statusMark: 'status-normal',
      color: colors.muted,
      textColor: colors.text,
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
    const color = colors.expired;
    return {
      statusMark: 'status-expired',
      color,
      textColor: color,
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
    const color = colors.warning;
    return {
      statusMark: 'status-warning',
      color,
      textColor: color,
      text: diffDays === 0 ? '今天到期' : `還有 ${diffDays.toLocaleString()} 天`,
      subMetricClass: 'urgent status-warning',
      progressClass: 'progress-bar-fill status-warning urgent',
      diffDays,
      percent: percent > 0 ? percent : 20,
      width: `${percent > 0 ? percent : 20}%`
    };
  }

  // 3. 【正常/安全】diffDays > 3（4天、6天、100天以上）
  return {
    statusMark: 'status-normal',
    color: colors.normal,
    textColor: colors.text,
    text: `還有 ${diffDays.toLocaleString()} 天`,
    subMetricClass: 'status-normal',
    progressClass: 'progress-bar-fill status-normal',
    diffDays,
    percent: percent > 0 ? percent : 15,
    width: `${percent > 0 ? percent : 15}%`
  };
}



const CATEGORY_MAP_TO_KEY = {
  '食品': 'food', 'food': 'food',
  '飲品': 'drinks', 'drinks': 'drinks', '飲料': 'drinks', '咖啡': 'drinks', '茶': 'drinks', '酒': 'drinks',
  '零食': 'snack', 'snack': 'snack', '點心': 'snack', '餅乾': 'snack',
  '生鮮': 'fresh', 'fresh': 'fresh', '生鮮冷凍': 'fresh', '肉品': 'fresh', '海鮮': 'fresh',
  '藥品': 'medicine', 'medicine': 'medicine',
  '保健': 'supplement', 'supplement': 'supplement', '保健品': 'supplement', '營養品': 'supplement',
  '美妝': 'beauty', 'beauty': 'beauty', '護膚': 'beauty', '保養': 'beauty', '化妝品': 'beauty',
  '清潔': 'cleaning', 'cleaning': 'cleaning',
  '保固': 'warranty', 'warranty': 'warranty',
  '耗材': 'filter', 'filter': 'filter',
  '數位': 'digital', 'digital': 'digital', '3c': 'digital', '電子': 'digital',
  '文具': 'stationery', 'stationery': 'stationery', '圖書': 'stationery', '書籍': 'stationery',
  '運動': 'sports', 'sports': 'sports', '健身': 'sports',
  '五金': 'tools', 'tools': 'tools', '修繕': 'tools', '工具': 'tools',
  '其他': 'other', 'other': 'other',
  '車輛': 'vehicle', 'vehicle': 'vehicle',
  '訂閱': 'subscription', 'subscription': 'subscription',
  '日化開封': 'pao', 'pao': 'pao', '日用': 'pao', '日用品': 'pao',
  '寵物': 'pet', 'pet': 'pet',
  '母嬰': 'baby', 'baby': 'baby',
  '辦公': 'office', 'office': 'office',
  '戶外': 'outdoor', 'outdoor': 'outdoor',
  '居家': 'home', 'home': 'home',
  '穿搭': 'fashion', 'fashion': 'fashion',
  '動畫': 'animation', 'animation': 'animation',
  '漫畫': 'animation', 'comic': 'animation',
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

if (typeof window !== "undefined") {
 Object.assign(window, { initModel, updateNerStatus, parseWithLocalNER, parseNaturalInput, parseNaturalInputAsync, matchCategoryAndSubCategory, inferItemLifespanOrUsageDate, SMART_KEYWORD_MAP, extractTime, extractDate, extractCleanName, simplifyItemName, renderProgressBar, getItemStatusConfig, DEFAULT_CATEGORIES, SUB_CATEGORY_CONFIG, CATEGORY_MAP_TO_KEY, normalizeCategoryKey });
 window.applyProgressBarStatus = renderProgressBar;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    initModel, updateNerStatus, parseWithLocalNER, parseNaturalInput, parseNaturalInputAsync, matchCategoryAndSubCategory, inferItemLifespanOrUsageDate, SMART_KEYWORD_MAP, extractTime, extractDate, extractCleanName, simplifyItemName, renderProgressBar, getItemStatusConfig, DEFAULT_CATEGORIES, SUB_CATEGORY_CONFIG, CATEGORY_MAP_TO_KEY, normalizeCategoryKey
  };
}
