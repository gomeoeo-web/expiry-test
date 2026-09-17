import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// 1. 定義 Stage 1 大分類候選 (18 類別)
// ==========================================
export const BROAD_CATEGORIES = [
  {
    id: 'cat_food',
    cat: 'food',
    label: '食品',
    emoji: '🥦',
    labels: [
      'a food product',
      'packaged food or groceries',
      'fresh food or drink product',
      'edible supermarket grocery item'
    ]
  },
  {
    id: 'cat_pao',
    cat: 'pao',
    label: '日用',
    emoji: '🧴',
    labels: [
      'a personal care product',
      'toiletries and cosmetics bottle or tube',
      'body care or facial skincare product',
      'personal hygiene toiletry'
    ]
  },
  {
    id: 'cat_cleaning',
    cat: 'cleaning',
    label: '清潔',
    emoji: '🧼',
    labels: [
      'a cleaning product',
      'household detergent or cleaning supply',
      'disinfectant or surface cleaner bottle',
      'sanitizing cleaning supplies'
    ]
  },
  {
    id: 'cat_medicine',
    cat: 'medicine',
    label: '藥品',
    emoji: '💊',
    labels: [
      'a medicine product',
      'dietary supplements or vitamins bottle',
      'pharmaceutical pills or medical bottle',
      'healthcare pharmaceutical medicine'
    ]
  },
  {
    id: 'cat_filter',
    cat: 'filter',
    label: '耗材',
    emoji: '🔄',
    labels: [
      'a replacement filter cartridge',
      'air purifier filter or water filter',
      'consumable replacement part',
      'filtration cartridge replacement'
    ]
  },
  {
    id: 'cat_warranty',
    cat: 'warranty',
    label: '保固',
    emoji: '🛡️',
    labels: [
      'an electronic device',
      'computer hardware or smartphone',
      'consumer electronic home appliance',
      'digital electronic gadget'
    ]
  },
  {
    id: 'cat_pet',
    cat: 'pet',
    label: '寵物',
    emoji: '🐾',
    labels: [
      'a pet product',
      'pet food bag or pet food can',
      'dog or cat pet care supplies',
      'pet accessory or animal food'
    ]
  },
  {
    id: 'cat_baby',
    cat: 'baby',
    label: '母嬰',
    emoji: '🍼',
    labels: [
      'a baby product',
      'infant formula can or baby bottle',
      'baby wet wipes or disposable diapers',
      'infant baby care supply'
    ]
  },
  {
    id: 'cat_office',
    cat: 'office',
    label: '辦公',
    emoji: '💼',
    labels: [
      'an office supply',
      'stationery notebook or writing pens',
      'battery pack or printer toner cartridge',
      'desk office accessories'
    ]
  },
  {
    id: 'cat_outdoor',
    cat: 'outdoor',
    label: '戶外',
    emoji: '⛺',
    labels: [
      'outdoor sports gear',
      'camping equipment or tent',
      'sports water bottle or fitness supplement',
      'outdoor recreational gear'
    ]
  },
  {
    id: 'cat_home',
    cat: 'home',
    label: '居家',
    emoji: '🪴',
    labels: [
      'a household home item',
      'indoor potted houseplant or garden supplies',
      'home decoration lamp or bedding',
      'living room household item'
    ]
  },
  {
    id: 'cat_fashion',
    cat: 'fashion',
    label: '穿搭',
    emoji: '👗',
    labels: [
      'a fashion item',
      'pair of shoes or sneakers',
      'handbag or backpack purse',
      'clothing accessory or footwear'
    ]
  },
  {
    id: 'cat_animation',
    cat: 'animation',
    label: '動畫',
    emoji: '🎬',
    labels: [
      'a comic book or manga volume',
      'light novel paperback book',
      'anime bluray disc or art illustration book',
      'Japanese manga or anime media'
    ]
  },
  {
    id: 'cat_game',
    cat: 'game',
    label: '遊戲',
    emoji: '🎮',
    labels: [
      'a video game',
      'game cartridge or disc case',
      'video game console controller gamepad',
      'gaming console peripheral'
    ]
  },
  {
    id: 'cat_otaku',
    cat: 'otaku',
    label: '二次元',
    emoji: '✨',
    labels: [
      'an anime character figure statue',
      'acrylic character stand or badge pin',
      'anime character plush doll toy',
      'collectible anime character merchandise'
    ]
  },
  {
    id: 'cat_ticket',
    cat: 'ticket',
    label: '票券/活動',
    emoji: '🎟️',
    labels: [
      'a paper ticket or coupon voucher',
      'cinema movie ticket or concert ticket',
      'event admission pass ticket',
      'paper entry ticket stub'
    ]
  },
  {
    id: 'cat_vehicle',
    cat: 'vehicle',
    label: '車輛',
    emoji: '🚗',
    labels: [
      'vehicle maintenance product',
      'motor engine oil bottle jug',
      'car tire or automotive battery',
      'windshield wiper blade'
    ]
  },
  {
    id: 'cat_other',
    cat: 'other',
    label: '其他',
    emoji: '📦',
    labels: [
      'a packaged household product',
      'general miscellaneous item in a box',
      'everyday household item',
      'unclassified packaged object'
    ]
  }
];

// ==========================================
// 2. 定義 Stage 2 細分類商品候選
// ==========================================
export const PRODUCT_CANDIDATES = [
  // --- 1. 食品 (food) ---
  {
    id: 'food_milk',
    cat: 'food',
    subCat: '鮮乳',
    defaultName: '鮮乳',
    emoji: '🥛',
    defaultDays: 14,
    isContainer: true,
    labels: [
      'a carton of fresh milk',
      'a bottle of fresh cow milk',
      'fresh dairy milk carton',
      'pure fresh milk product'
    ]
  },
  {
    id: 'food_soymilk',
    cat: 'food',
    subCat: '鮮乳',
    defaultName: '豆漿/燕麥奶',
    emoji: '🥛',
    defaultDays: 14,
    isContainer: true,
    labels: [
      'a bottle of soy milk drink',
      'carton of oat milk drink',
      'soybean milk beverage bottle',
      'plant based milk carton'
    ]
  },
  {
    id: 'food_yogurt',
    cat: 'food',
    subCat: '鮮乳',
    defaultName: '優格/布丁',
    emoji: '🍮',
    defaultDays: 21,
    isContainer: true,
    labels: [
      'a cup of yogurt',
      'a bottle of drinking yogurt',
      'sweet dairy pudding cup',
      'fermented yogurt dessert'
    ]
  },
  {
    id: 'food_cheese',
    cat: 'food',
    subCat: '鮮乳',
    defaultName: '起司/乳酪',
    emoji: '🧀',
    defaultDays: 60,
    labels: [
      'a package of sliced cheese',
      'a block of dairy butter',
      'dairy cheese slices pack',
      'yellow cheese package'
    ]
  },
  {
    id: 'food_coffee',
    cat: 'food',
    subCat: '咖啡',
    defaultName: '咖啡飲品',
    emoji: '☕',
    defaultDays: 180,
    isContainer: true,
    labels: [
      'a cup or can of coffee drink',
      'a bag of roasted coffee beans',
      'bottle of cold brew coffee',
      'ground coffee package'
    ]
  },
  {
    id: 'food_tea',
    cat: 'food',
    subCat: '茶包',
    defaultName: '茶包/茶飲',
    emoji: '🍵',
    defaultDays: 180,
    isContainer: true,
    labels: [
      'a bottle of iced green tea',
      'a box of tea bags',
      'can of black tea drink',
      'packaged dried tea leaves'
    ]
  },
  {
    id: 'food_eggs',
    cat: 'food',
    subCat: '雞蛋',
    defaultName: '生鮮雞蛋',
    emoji: '🥚',
    defaultDays: 21,
    labels: [
      'a carton of chicken eggs',
      'fresh raw chicken eggs in a box',
      'brown chicken eggs carton',
      'farm fresh eggs package'
    ]
  },
  {
    id: 'food_bread',
    cat: 'food',
    subCat: '麵包烘焙',
    defaultName: '麵包/烘焙',
    emoji: '🍞',
    defaultDays: 5,
    labels: [
      'a loaf of sliced toast bread',
      'package of bakery bread or pastry',
      'freshly baked croissant or bun',
      'sliced white sandwich bread'
    ]
  },
  {
    id: 'food_chips',
    cat: 'food',
    subCat: '零食',
    defaultName: '洋芋片/零食',
    emoji: '🍟',
    defaultDays: 180,
    labels: [
      'a bag of potato chips snack',
      'crispy snack food bag',
      'packaged savory potato chips'
    ]
  },
  {
    id: 'food_cookies',
    cat: 'food',
    subCat: '零食',
    defaultName: '餅乾/點心',
    emoji: '🍪',
    defaultDays: 180,
    labels: [
      'a package of cookies or biscuits',
      'crispy crackers box',
      'baked sweet cookies pack'
    ]
  },
  {
    id: 'food_chocolate',
    cat: 'food',
    subCat: '零食',
    defaultName: '巧克力/糖果',
    emoji: '🍫',
    defaultDays: 365,
    labels: [
      'a chocolate bar or candy package',
      'bag of sweet candy sweets',
      'sweet chocolate confectionery'
    ]
  },
  {
    id: 'food_nuts',
    cat: 'food',
    subCat: '零食',
    defaultName: '堅果/點心',
    emoji: '🥜',
    defaultDays: 180,
    labels: [
      'a bag of mixed edible nuts',
      'jar of roasted almonds or cashews',
      'packaged crunchy nuts'
    ]
  },
  {
    id: 'food_instant_noodles',
    cat: 'food',
    subCat: '零食',
    defaultName: '泡麵/速食麵',
    emoji: '🍜',
    defaultDays: 180,
    labels: [
      'a cup or bowl of instant ramen noodles',
      'package of instant noodles ramen',
      'instant ramen noodle bowl'
    ]
  },
  {
    id: 'food_canned',
    cat: 'food',
    subCat: '調味料',
    defaultName: '罐頭食品',
    emoji: '🥫',
    defaultDays: 730,
    isContainer: true,
    labels: [
      'a tin can of canned food',
      'canned tuna or meat tin',
      'preserved food metal can'
    ]
  },
  {
    id: 'food_meat',
    cat: 'food',
    subCat: '生鮮肉品',
    defaultName: '生鮮肉品',
    emoji: '🥩',
    defaultDays: 4,
    labels: [
      'a tray of fresh raw beef steak or pork',
      'package of fresh raw chicken meat',
      'refrigerated raw meat tray'
    ]
  },
  {
    id: 'food_seafood',
    cat: 'food',
    subCat: '生鮮肉品',
    defaultName: '生鮮海鮮',
    emoji: '🐟',
    defaultDays: 3,
    labels: [
      'fresh raw fish on a tray',
      'package of raw fresh shrimp prawns',
      'uncooked seafood fish fillet'
    ]
  },
  {
    id: 'food_vegetables',
    cat: 'food',
    subCat: '青菜',
    defaultName: '生鮮蔬菜',
    emoji: '🥬',
    defaultDays: 5,
    labels: [
      'fresh green leafy vegetables',
      'package of fresh salad vegetables',
      'raw green broccoli or spinach'
    ]
  },
  {
    id: 'food_fruits',
    cat: 'food',
    subCat: '水果',
    defaultName: '生鮮水果',
    emoji: '🍎',
    defaultDays: 7,
    labels: [
      'fresh fruits such as apples or bananas',
      'box of fresh oranges or berries',
      'fresh fruit produce pack'
    ]
  },
  {
    id: 'food_seasoning',
    cat: 'food',
    subCat: '調味料',
    defaultName: '醬料/調味料',
    emoji: '🧂',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a bottle of soy sauce or salad dressing',
      'jar of cooking spices or salt pepper',
      'cooking condiment sauce bottle'
    ]
  },
  {
    id: 'food_soda',
    cat: 'food',
    subCat: '零食',
    defaultName: '汽水/碳酸飲料',
    emoji: '🥤',
    defaultDays: 180,
    isContainer: true,
    labels: [
      'a can of soda carbonated drink',
      'plastic bottle of soft drink soda',
      'fizzy sparkling soda can'
    ]
  },
  {
    id: 'food_water',
    cat: 'food',
    subCat: '零食',
    defaultName: '礦泉水',
    emoji: '💧',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a plastic bottle of drinking mineral water',
      'clear bottled water bottle',
      'purified drinking water bottle'
    ]
  },
  {
    id: 'food_beer',
    cat: 'food',
    subCat: '零食',
    defaultName: '啤酒/酒類',
    emoji: '🍺',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a can or bottle of beer',
      'glass bottle of wine or alcoholic beverage',
      'canned beer beverage'
    ]
  },

  // --- 2. 日化個人護理 (pao) ---
  {
    id: 'pao_shampoo',
    cat: 'pao',
    subCat: '洗沐',
    defaultName: '洗髮精/潤髮乳',
    emoji: '🧴',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a bottle of shampoo',
      'hair shampoo bottle',
      'hair conditioner pump bottle',
      'shampoo product'
    ]
  },
  {
    id: 'pao_bodywash',
    cat: 'pao',
    subCat: '洗沐',
    defaultName: '沐浴乳',
    emoji: '🧼',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a bottle of body wash shower gel',
      'liquid bath soap bottle',
      'shower gel pump bottle'
    ]
  },
  {
    id: 'pao_toothpaste',
    cat: 'pao',
    subCat: '牙膏',
    defaultName: '牙膏/口腔護理',
    emoji: '🪥',
    defaultDays: 365,
    labels: [
      'a tube of toothpaste',
      'dental toothpaste product tube',
      'toothpaste product'
    ]
  },
  {
    id: 'pao_cleanser',
    cat: 'pao',
    subCat: '保養',
    defaultName: '洗面乳/潔顏乳',
    emoji: '🫧',
    defaultDays: 180,
    isContainer: true,
    labels: [
      'a tube of facial cleanser wash',
      'bottle of face washing foam',
      'facial cleansing foam tube'
    ]
  },
  {
    id: 'pao_sunscreen',
    cat: 'pao',
    subCat: '防曬',
    defaultName: '防曬乳',
    emoji: '☀️',
    defaultDays: 180,
    labels: [
      'a bottle or tube of sunscreen lotion',
      'sunblock cream tube',
      'sunscreen UV protection lotion'
    ]
  },
  {
    id: 'pao_toner',
    cat: 'pao',
    subCat: '保養',
    defaultName: '化妝水/精華液',
    emoji: '💧',
    defaultDays: 180,
    isContainer: true,
    labels: [
      'a bottle of skincare toner or lotion',
      'facial serum essence dropper bottle',
      'skincare liquid toner bottle'
    ]
  },
  {
    id: 'pao_cream',
    cat: 'pao',
    subCat: '保養',
    defaultName: '保濕面霜/乳液',
    emoji: '🧴',
    defaultDays: 180,
    isContainer: true,
    labels: [
      'a jar of moisturizing face cream',
      'hydrating facial cream tub',
      'moisturizer cream container'
    ]
  },
  {
    id: 'pao_mask',
    cat: 'pao',
    subCat: '保養',
    defaultName: '面膜/護膚',
    emoji: '🧖',
    defaultDays: 365,
    labels: [
      'a package of facial sheet masks',
      'beauty sheet mask pouch pack',
      'facial cosmetic sheet mask'
    ]
  },
  {
    id: 'pao_handcream',
    cat: 'pao',
    subCat: '護手霜',
    defaultName: '護手霜/乳液',
    emoji: '🧴',
    defaultDays: 365,
    labels: [
      'a tube of hand cream lotion',
      'moisturizing hand cream tube',
      'nourishing hand lotion'
    ]
  },
  {
    id: 'pao_makeup',
    cat: 'pao',
    subCat: '彩妝',
    defaultName: '美妝彩妝品',
    emoji: '💄',
    defaultDays: 365,
    labels: [
      'a lipstick tube cosmetic',
      'foundation makeup compact or powder',
      'cosmetic makeup beauty product'
    ]
  },
  {
    id: 'pao_perfume',
    cat: 'pao',
    subCat: '香水',
    defaultName: '香水/香氛',
    emoji: '✨',
    defaultDays: 1095,
    isContainer: true,
    labels: [
      'a glass bottle of perfume fragrance',
      'cologne spray bottle',
      'fragrance perfume flacon'
    ]
  },
  {
    id: 'pao_razor',
    cat: 'pao',
    subCat: '刮鬍刀',
    defaultName: '刮鬍刀',
    emoji: '🪒',
    defaultDays: 90,
    labels: [
      'a shaving razor blade',
      'manual safety razor handle',
      'disposable shaving razor'
    ]
  },

  // --- 3. 清潔用品 (cleaning) ---
  {
    id: 'cleaning_laundry',
    cat: 'cleaning',
    subCat: '洗衣精',
    defaultName: '洗衣精/洗衣膠囊',
    emoji: '🧺',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a bottle of laundry detergent',
      'container of laundry detergent pods capsules',
      'liquid laundry soap bottle'
    ]
  },
  {
    id: 'cleaning_dish',
    cat: 'cleaning',
    subCat: '洗碗精',
    defaultName: '洗碗精',
    emoji: '🍽️',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a bottle of dishwashing liquid soap',
      'dish soap squeeze bottle',
      'kitchen dish detergent bottle'
    ]
  },
  {
    id: 'cleaning_sponge',
    cat: 'cleaning',
    subCat: '菜瓜布',
    defaultName: '菜瓜布/海綿',
    emoji: '🧼',
    defaultDays: 30,
    labels: [
      'a yellow and green kitchen dish sponge',
      'scouring pad dish scrubber',
      'cleaning sponge pad'
    ]
  },
  {
    id: 'cleaning_toilet',
    cat: 'cleaning',
    subCat: '潔廁劑',
    defaultName: '清潔劑/除菌液',
    emoji: '🚽',
    defaultDays: 730,
    isContainer: true,
    labels: [
      'a bottle of toilet bowl cleaner',
      'bathroom disinfectant cleaner spray bottle',
      'household bleach cleaning bottle'
    ]
  },
  {
    id: 'cleaning_cloth',
    cat: 'cleaning',
    subCat: '抹布',
    defaultName: '衛生紙/面紙/抹布',
    emoji: '🧻',
    defaultDays: 1095,
    labels: [
      'a roll of paper toilet tissue towels',
      'box of facial tissue wipes',
      'microfiber cleaning cloth towel'
    ]
  },
  {
    id: 'cleaning_alcohol',
    cat: 'cleaning',
    subCat: '酒精',
    defaultName: '消毒酒精/噴霧',
    emoji: '🧴',
    defaultDays: 730,
    isContainer: true,
    labels: [
      'a bottle of rubbing alcohol sanitizer',
      'disinfectant alcohol spray bottle',
      'antibacterial hand sanitizer bottle'
    ]
  },
  {
    id: 'cleaning_mite',
    cat: 'cleaning',
    subCat: '除蟎',
    defaultName: '除蟎噴霧',
    emoji: '💨',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'an anti-dust mite spray bottle',
      'dust mite repellent spray bottle'
    ]
  },

  // --- 4. 常備藥品 (medicine) ---
  {
    id: 'med_eyedrops',
    cat: 'medicine',
    subCat: '眼藥水',
    defaultName: '眼藥水/人工淚液',
    emoji: '👁️',
    defaultDays: 90,
    isContainer: true,
    labels: [
      'a small bottle of eye drops',
      'eyedrop dispenser medicine bottle',
      'ophthalmic eye solution bottle'
    ]
  },
  {
    id: 'med_vitamins',
    cat: 'medicine',
    subCat: '維他命',
    defaultName: '綜合維他命/保健品',
    emoji: '💊',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a bottle of dietary vitamins or mineral pills',
      'multivitamin supplement tablets bottle',
      'vitamin capsule medicine bottle'
    ]
  },
  {
    id: 'med_fishoil',
    cat: 'medicine',
    subCat: '魚油',
    defaultName: '魚油/益生菌',
    emoji: '🐟',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a bottle of fish oil softgel capsules',
      'omega 3 dietary supplement bottle',
      'probiotics health supplement container'
    ]
  },
  {
    id: 'med_ointment',
    cat: 'medicine',
    subCat: '藥膏',
    defaultName: '外用藥膏',
    emoji: '🩹',
    defaultDays: 180,
    labels: [
      'a medical ointment tube',
      'topical antiseptic skin cream tube',
      'healing antibiotic ointment tube'
    ]
  },
  {
    id: 'med_pills',
    cat: 'medicine',
    subCat: '成藥',
    defaultName: '常備成藥/藥丸',
    emoji: '🩺',
    defaultDays: 365,
    labels: [
      'a blister pack of medicine tablets pills',
      'box of pharmacy over the counter medicine',
      'pharmaceutical pill capsule box'
    ]
  },
  {
    id: 'med_lens_solution',
    cat: 'medicine',
    subCat: '保養液',
    defaultName: '隱形眼鏡保養液',
    emoji: '👁️',
    defaultDays: 90,
    isContainer: true,
    labels: [
      'a bottle of contact lens care solution',
      'contact lens disinfectant fluid bottle',
      'saline lens wash bottle'
    ]
  },

  // --- 5. 耗材濾網 (filter) ---
  {
    id: 'filter_air',
    cat: 'filter',
    subCat: '濾網',
    defaultName: '空氣清淨機濾網',
    emoji: '🌀',
    defaultDays: 180,
    labels: [
      'an air purifier HEPA filter replacement',
      'cylindrical pleated air filter',
      'clean air filter cartridge'
    ]
  },
  {
    id: 'filter_water',
    cat: 'filter',
    subCat: '濾芯',
    defaultName: '淨水器濾芯',
    emoji: '💧',
    defaultDays: 180,
    labels: [
      'a water purifier filter cartridge',
      'water filter pitcher replacement cartridge',
      'reverse osmosis filter cylinder'
    ]
  },
  {
    id: 'filter_toothbrush',
    cat: 'filter',
    subCat: '牙刷',
    defaultName: '牙刷更換',
    emoji: '🪥',
    defaultDays: 90,
    labels: [
      'a manual toothbrush or electric toothbrush replacement head',
      'toothbrush bristles head',
      'oral toothbrush in package'
    ]
  },
  {
    id: 'filter_dehumidifier',
    cat: 'filter',
    subCat: '除濕盒',
    defaultName: '除濕盒/防潮包',
    emoji: '🌧️',
    defaultDays: 90,
    isContainer: true,
    labels: [
      'a moisture absorber dehumidifier container box',
      'desiccant moisture collector tub',
      'closet humidity absorber'
    ]
  },
  {
    id: 'filter_robot_vacuum',
    cat: 'filter',
    subCat: '掃地耗材',
    defaultName: '掃地機耗材',
    emoji: '🧹',
    defaultDays: 90,
    labels: [
      'a robot vacuum roller brush replacement',
      'sweeper robot dust bag or filter',
      'robot vacuum cleaning accessories'
    ]
  },
  {
    id: 'filter_coffee_descaler',
    cat: 'filter',
    subCat: '咖啡保養',
    defaultName: '咖啡機除鈣劑',
    emoji: '☕',
    defaultDays: 90,
    isContainer: true,
    labels: [
      'a coffee machine descaling cleaner liquid',
      'coffee maker descaler bottle',
      'espresso machine cleaning tablets'
    ]
  },

  // --- 6. 保固與3C (warranty) ---
  {
    id: 'warranty_phone',
    cat: 'warranty',
    subCat: '手機',
    defaultName: '智慧型手機',
    emoji: '📱',
    defaultDays: 365,
    labels: [
      'a smartphone mobile phone screen or back',
      'iPhone or Android mobile device',
      'modern cellular smartphone'
    ]
  },
  {
    id: 'warranty_laptop',
    cat: 'warranty',
    subCat: '電腦',
    defaultName: '筆記型電腦/平板',
    emoji: '💻',
    defaultDays: 365,
    labels: [
      'a laptop notebook computer',
      'tablet computer iPad device',
      'personal computer screen keyboard'
    ]
  },
  {
    id: 'warranty_headphones',
    cat: 'warranty',
    subCat: '耳機',
    defaultName: '無線耳機',
    emoji: '🎧',
    defaultDays: 365,
    labels: [
      'a pair of wireless earbuds in charging case',
      'over ear audio headphones',
      'bluetooth wireless earphones case'
    ]
  },
  {
    id: 'warranty_appliance',
    cat: 'warranty',
    subCat: '家電',
    defaultName: '家用電器',
    emoji: '📺',
    defaultDays: 365,
    labels: [
      'a home electric appliance',
      'electric kitchen blender or toaster',
      'microwave oven or dehumidifier unit'
    ]
  },
  {
    id: 'warranty_watch',
    cat: 'warranty',
    subCat: '手錶',
    defaultName: '智慧手錶/腕錶',
    emoji: '⌚',
    defaultDays: 365,
    labels: [
      'a smartwatch digital wrist watch',
      'smart wrist watch on band',
      'electronic smart watch device'
    ]
  },
  {
    id: 'warranty_charger',
    cat: 'warranty',
    subCat: '手機',
    defaultName: '充電器/充電線',
    emoji: '🔌',
    defaultDays: 365,
    labels: [
      'a phone wall charger power adapter block',
      'USB-C charging cable cord',
      'portable battery power bank'
    ]
  },
  {
    id: 'warranty_mouse',
    cat: 'warranty',
    subCat: '電腦',
    defaultName: '電腦滑鼠',
    emoji: '🖱️',
    defaultDays: 365,
    labels: [
      'a computer mouse on a desk',
      'a gaming mouse or wireless mouse',
      'an optical computer mouse device',
      'a PC computer mouse'
    ]
  },
  {
    id: 'warranty_keyboard',
    cat: 'warranty',
    subCat: '電腦',
    defaultName: '電腦鍵盤',
    emoji: '⌨️',
    defaultDays: 365,
    labels: [
      'a computer keyboard on desk',
      'a mechanical typing keyboard',
      'a wireless PC keyboard with keys',
      'an office computer keyboard'
    ]
  },
  {
    id: 'warranty_mousepad',
    cat: 'warranty',
    subCat: '電腦',
    defaultName: '滑鼠墊',
    emoji: '🖱️',
    defaultDays: 365,
    labels: [
      'a computer mouse pad or desk mat',
      'a gaming mousepad on a computer desk',
      'a large rubber desk mat'
    ]
  },
  {
    id: 'warranty_monitor',
    cat: 'warranty',
    subCat: '電腦',
    defaultName: '電腦螢幕',
    emoji: '🖥️',
    defaultDays: 365,
    labels: [
      'a computer monitor screen on desk',
      'a desktop PC display monitor',
      'an LCD computer screen'
    ]
  },

  // --- 7. 寵物 (pet) ---
  {
    id: 'pet_kibble',
    cat: 'pet',
    subCat: '乾糧',
    defaultName: '寵物乾糧',
    emoji: '🐾',
    defaultDays: 60,
    labels: [
      'a bag of dry cat food or dog food kibble',
      'pet dry food kibble bag',
      'packaged pet food sack'
    ]
  },
  {
    id: 'pet_can',
    cat: 'pet',
    subCat: '罐頭',
    defaultName: '寵物罐頭',
    emoji: '🥫',
    defaultDays: 730,
    isContainer: true,
    labels: [
      'a tin can of wet cat or dog food',
      'pet canned food tin',
      'canned wet pet food'
    ]
  },
  {
    id: 'pet_litter',
    cat: 'pet',
    subCat: '貓砂尿墊',
    defaultName: '貓砂/尿墊',
    emoji: '🐾',
    defaultDays: 30,
    labels: [
      'a bag of cat litter pellets',
      'pet training pee pads package',
      'hygienic cat litter bag'
    ]
  },
  {
    id: 'pet_treats',
    cat: 'pet',
    subCat: '零食凍乾',
    defaultName: '寵物零食/凍乾',
    emoji: '🥩',
    defaultDays: 90,
    labels: [
      'a pouch of freeze dried pet treats',
      'dog chew snack bag pouch',
      'pet meat snack treats'
    ]
  },

  // --- 8. 母嬰 (baby) ---
  {
    id: 'baby_formula',
    cat: 'baby',
    subCat: '配方奶',
    defaultName: '嬰兒配方奶粉',
    emoji: '🍼',
    defaultDays: 30,
    isContainer: true,
    labels: [
      'a metal tin can of infant baby formula powder',
      'baby milk powder tin',
      'infant formula nutrition container'
    ]
  },
  {
    id: 'baby_diapers',
    cat: 'baby',
    subCat: '尿布',
    defaultName: '嬰幼兒尿布',
    emoji: '👶',
    defaultDays: 365,
    labels: [
      'a package of disposable baby diapers',
      'baby diapers pack',
      'toddler diaper package'
    ]
  },
  {
    id: 'baby_wipes',
    cat: 'baby',
    subCat: '濕紙巾',
    defaultName: '嬰兒純水濕紙巾',
    emoji: '🧻',
    defaultDays: 180,
    labels: [
      'a pack of baby wet wipes with plastic lid',
      'gentle baby cleansing wipes pouch',
      'baby wipes package'
    ]
  },
  {
    id: 'baby_bottle',
    cat: 'baby',
    subCat: '奶嘴用品',
    defaultName: '奶瓶/奶嘴',
    emoji: '🍼',
    defaultDays: 90,
    isContainer: true,
    labels: [
      'a baby feeding milk bottle',
      'silicone baby pacifier dummy',
      'baby nursing bottle'
    ]
  },

  // --- 9. 辦公 (office) ---
  {
    id: 'office_batteries',
    cat: 'office',
    subCat: '電池',
    defaultName: '乾電池組',
    emoji: '🔋',
    defaultDays: 1825,
    labels: [
      'a pack of AA or AAA batteries in blister pack',
      'cylindrical alkaline batteries pack',
      'household dry cell batteries'
    ]
  },
  {
    id: 'office_stationery',
    cat: 'office',
    subCat: '筆記文具',
    defaultName: '文具用品/筆記本',
    emoji: '✏️',
    defaultDays: 365,
    labels: [
      'stationery ballpoint pens markers or pencils',
      'paper notebook or notepad journal',
      'desk stationery office supplies'
    ]
  },
  {
    id: 'office_ink',
    cat: 'office',
    subCat: '耗材墨水',
    defaultName: '印表機墨水/碳粉匣',
    emoji: '🖨️',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a printer ink cartridge box',
      'laser printer toner cartridge',
      'ink bottle refill for printer'
    ]
  },

  // --- 10. 戶外 (outdoor) ---
  {
    id: 'outdoor_protein',
    cat: 'outdoor',
    subCat: '高蛋白',
    defaultName: '乳清蛋白粉',
    emoji: '💪',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a large plastic tub of whey protein powder',
      'fitness protein shake powder container',
      'nutrition protein supplement tub'
    ]
  },
  {
    id: 'outdoor_bottle',
    cat: 'outdoor',
    subCat: '水壺配件',
    defaultName: '運動水壺/保溫瓶',
    emoji: '🍶',
    defaultDays: 365,
    isContainer: true,
    labels: [
      'a stainless steel sports water bottle flask',
      'insulated thermal drinking flask',
      'sports outdoor water shaker bottle'
    ]
  },
  {
    id: 'outdoor_camping',
    cat: 'outdoor',
    subCat: '露營裝備',
    defaultName: '露營戶外裝備',
    emoji: '⛺',
    defaultDays: 365,
    labels: [
      'camping equipment lantern or tent gear',
      'outdoor backpacking cooking stove or gear',
      'camping supplies equipment'
    ]
  },

  // --- 11. 居家 (home) ---
  {
    id: 'home_plant',
    cat: 'home',
    subCat: '植栽綠化',
    defaultName: '盆栽植栽',
    emoji: '🪴',
    defaultDays: 30,
    labels: [
      'a small indoor potted green houseplant',
      'potted succulent or flower plant',
      'indoor gardening potted plant'
    ]
  },
  {
    id: 'home_light',
    cat: 'home',
    subCat: '燈具照明',
    defaultName: 'LED 燈泡/照明',
    emoji: '💡',
    defaultDays: 730,
    labels: [
      'an LED light bulb in cardboard packaging',
      'replacement household light bulb box',
      'desk reading light lamp'
    ]
  },
  {
    id: 'home_bedding',
    cat: 'home',
    subCat: '寢具家飾',
    defaultName: '寢具家飾',
    emoji: '🛏️',
    defaultDays: 365,
    labels: [
      'a sleeping bed pillow or folded blanket',
      'home textile bed sheet linen',
      'cushion pillow home decor'
    ]
  },

  // --- 12. 穿搭 (fashion) ---
  {
    id: 'fashion_shoes',
    cat: 'fashion',
    subCat: '精品鞋靴',
    defaultName: '休閒鞋/球鞋',
    emoji: '👟',
    defaultDays: 365,
    labels: [
      'a pair of running shoes or athletic sneakers',
      'casual sneakers or leather shoes',
      'footwear athletic sneakers'
    ]
  },
  {
    id: 'fashion_bag',
    cat: 'fashion',
    subCat: '皮革保養',
    defaultName: '包袋/背包',
    emoji: '🎒',
    defaultDays: 365,
    labels: [
      'a leather handbag or shoulder tote bag',
      'travel rucksack backpack',
      'fashionable purse or messenger bag'
    ]
  },
  {
    id: 'fashion_glasses',
    cat: 'fashion',
    subCat: '珠寶飾品',
    defaultName: '眼鏡/墨鏡',
    emoji: '👓',
    defaultDays: 365,
    labels: [
      'a pair of optical eyeglasses with frame',
      'dark lens sunglasses',
      'fashion spectacles eyewear'
    ]
  },

  // --- 13. 動漫與書籍 (animation) ---
  {
    id: 'anim_manga',
    cat: 'animation',
    subCat: '漫畫/單行本',
    defaultName: '漫畫/單行本',
    emoji: '📚',
    defaultDays: 365,
    labels: [
      'a Japanese manga comic book volume',
      'manga tankobon book cover',
      'comic graphic novel book'
    ]
  },
  {
    id: 'anim_novel',
    cat: 'animation',
    subCat: '輕小說',
    defaultName: '輕小說/書籍',
    emoji: '📖',
    defaultDays: 365,
    labels: [
      'a light novel paperback fiction book',
      'Japanese novel book cover',
      'paperback novel reading book'
    ]
  },
  {
    id: 'anim_bluray',
    cat: 'animation',
    subCat: 'BD/影音',
    defaultName: '動畫影音/BD',
    emoji: '💿',
    defaultDays: 1825,
    labels: [
      'an anime Blu-ray or DVD video disc case',
      'animated movie disc case box',
      'anime collector media case'
    ]
  },
  {
    id: 'anim_artbook',
    cat: 'animation',
    subCat: '畫冊/設定集',
    defaultName: '動畫畫冊/設定集',
    emoji: '🎨',
    defaultDays: 1825,
    labels: [
      'an anime illustration artbook',
      'concept art illustration setting collection book',
      'large visual artbook'
    ]
  },

  // --- 14. 遊戲 (game) ---
  {
    id: 'game_switch',
    cat: 'game',
    subCat: 'Switch 卡帶',
    defaultName: 'Switch 遊戲卡帶',
    emoji: '🎮',
    defaultDays: 365,
    labels: [
      'a Nintendo Switch game plastic case',
      'Switch game cartridge box cover',
      'video game cartridge case'
    ]
  },
  {
    id: 'game_disc',
    cat: 'game',
    subCat: 'PS/Xbox 光碟',
    defaultName: '主機遊戲光碟',
    emoji: '💿',
    defaultDays: 365,
    labels: [
      'a PlayStation or Xbox game disc case',
      'console video game disc box',
      'video game disc cover'
    ]
  },
  {
    id: 'game_controller',
    cat: 'game',
    subCat: '主機/手把周邊',
    defaultName: '遊戲手把/周邊',
    emoji: '🕹️',
    defaultDays: 730,
    labels: [
      'a video game console controller gamepad',
      'wireless gaming controller peripheral',
      'gamepad joystick controller'
    ]
  },

  // --- 15. 二次元周邊 (otaku) ---
  {
    id: 'otaku_figure',
    cat: 'otaku',
    subCat: '模型/黏土人/景品',
    defaultName: '動漫公仔模型',
    emoji: '✨',
    defaultDays: 365,
    labels: [
      'an anime scale figure statue toy',
      'Japanese anime collectible figurine',
      'nendoroid figure statue toy'
    ]
  },
  {
    id: 'otaku_acrylic',
    cat: 'otaku',
    subCat: '壓克力立牌/磚',
    defaultName: '動漫壓克力立牌',
    emoji: '✨',
    defaultDays: 365,
    labels: [
      'an anime character acrylic stand',
      'clear acrylic character standee',
      'acrylic stand anime merchandise'
    ]
  },
  {
    id: 'otaku_badge',
    cat: 'otaku',
    subCat: '徽章/吧唧',
    defaultName: '動漫徽章/胸章',
    emoji: '✨',
    defaultDays: 365,
    labels: [
      'an anime character round pin badge button',
      'tinplate character can badge pin',
      'anime collector badge button'
    ]
  },
  {
    id: 'otaku_plush',
    cat: 'otaku',
    subCat: '棉花娃/玩偶',
    defaultName: '動漫玩偶/棉花娃',
    emoji: '🧸',
    defaultDays: 365,
    labels: [
      'an anime character plush doll toy',
      'stuffed character plushie soft toy',
      'anime cotton character doll'
    ]
  },
  {
    id: 'otaku_shikishi',
    cat: 'otaku',
    subCat: '色紙/相卡',
    defaultName: '動漫色紙/相卡',
    emoji: '🖼️',
    defaultDays: 365,
    labels: [
      'an anime shikishi illustration art board',
      'square anime character art board card',
      'collectible anime shikishi print'
    ]
  },

  // --- 16. 票券 (ticket) ---
  {
    id: 'ticket_paper',
    cat: 'ticket',
    subCat: '電影票',
    defaultName: '活動票券/門票',
    emoji: '🎟️',
    defaultDays: 30,
    labels: [
      'a paper cinema movie admission ticket',
      'concert live event paper ticket stub',
      'printed event entry pass ticket'
    ]
  },

  // --- 17. 車輛 (vehicle) ---
  {
    id: 'vehicle_oil',
    cat: 'vehicle',
    subCat: '機油',
    defaultName: '機油/齒輪油',
    emoji: '🚗',
    defaultDays: 180,
    isContainer: true,
    labels: [
      'a plastic bottle of motor engine oil',
      'car engine motor oil jug',
      'synthetic automotive lubricant bottle'
    ]
  },
  {
    id: 'vehicle_tire',
    cat: 'vehicle',
    subCat: '輪胎',
    defaultName: '汽車/機車輪胎',
    emoji: '🛞',
    defaultDays: 730,
    labels: [
      'a black rubber automobile car tire',
      'motorcycle tire rubber wheel',
      'automotive rubber tire tread'
    ]
  },
  {
    id: 'vehicle_battery',
    cat: 'vehicle',
    subCat: '電瓶',
    defaultName: '車用電瓶',
    emoji: '🔋',
    defaultDays: 730,
    isContainer: true,
    labels: [
      'a 12 volt automotive car battery',
      'lead acid vehicle battery box',
      'car engine starter battery'
    ]
  },
  {
    id: 'vehicle_wiper',
    cat: 'vehicle',
    subCat: '雨刷',
    defaultName: '車窗雨刷片',
    emoji: '🌧️',
    defaultDays: 365,
    labels: [
      'a car windshield wiper blade in package',
      'automotive wiper blade packaging',
      'windshield wiper blade replacement'
    ]
  },

  // --- 18. 其他保底 (other) ---
  {
    id: 'other_general',
    cat: 'other',
    subCat: '未分類',
    defaultName: '生活物品',
    emoji: '📦',
    defaultDays: 30,
    labels: [
      'a packaged household item in box',
      'general consumer goods package',
      'unidentified everyday household object'
    ]
  }
];

// ==========================================
// 3. 離線生成 Text Embeddings 主函式
// ==========================================
export async function buildEmbeddings() {
  console.log('[BUILD EMBEDDINGS] 正在載入 @huggingface/transformers...');
  const { AutoTokenizer, CLIPTextModelWithProjection } = await import('@huggingface/transformers');

  console.log('[BUILD EMBEDDINGS] 正在初始化 Tokenizer (plhery/mobileclip2-onnx)...');
  const tokenizer = await AutoTokenizer.from_pretrained('plhery/mobileclip2-onnx');

  console.log('[BUILD EMBEDDINGS] 正在初始化 S0 Text Encoder (onnx/s0/text_model)...');
  const textModel = await CLIPTextModelWithProjection.from_pretrained('plhery/mobileclip2-onnx', {
    model_file_name: 's0/text_model',
    dtype: 'fp32'
  });

  /**
   * L2 正規化純數值陣列
   */
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

  /**
   * 將單一字串編碼為 512 維 L2 normalized embedding
   */
  async function encodeText(prompt) {
    const inputs = await tokenizer([prompt], {
      padding: 'max_length',
      max_length: 77,
      truncation: true
    });
    const outputs = await textModel(inputs);
    const data = outputs.text_embeds.data;
    inputs.input_ids?.dispose?.();
    inputs.attention_mask?.dispose?.();
    outputs.text_embeds?.dispose?.();
    return l2Normalize(data);
  }

  /**
   * 多 prompt 計算平均並再次 L2 normalize
   */
  async function computeAveragedEmbedding(labels) {
    const dim = 512;
    const sumVec = new Float32Array(dim);
    for (const p of labels) {
      const v = await encodeText(p);
      for (let i = 0; i < dim; i++) {
        sumVec[i] += v[i];
      }
    }
    const avgVec = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      avgVec[i] = sumVec[i] / labels.length;
    }
    const finalNorm = l2Normalize(avgVec);
    // 保留 6 位小數以大幅壓縮 JSON / JS 大小同時維持 99.9999% 餘弦比對精度
    return Array.from(finalNorm).map(n => Number(n.toFixed(6)));
  }

  console.log(`\n[BUILD EMBEDDINGS] 開始計算 ${BROAD_CATEGORIES.length} 個 Stage 1 大分類 Text Embeddings...`);
  for (let i = 0; i < BROAD_CATEGORIES.length; i++) {
    const item = BROAD_CATEGORIES[i];
    process.stdout.write(`  [${i + 1}/${BROAD_CATEGORIES.length}] 計算大分類: ${item.label} (${item.cat})... `);
    item.embedding = await computeAveragedEmbedding(item.labels);
    console.log(`完成 (${item.embedding.length} 維)`);
  }

  console.log(`\n[BUILD EMBEDDINGS] 開始計算 ${PRODUCT_CANDIDATES.length} 個 Stage 2 細分類商品 Text Embeddings...`);
  for (let i = 0; i < PRODUCT_CANDIDATES.length; i++) {
    const item = PRODUCT_CANDIDATES[i];
    process.stdout.write(`  [${i + 1}/${PRODUCT_CANDIDATES.length}] 計算商品: ${item.defaultName} (${item.subCat})... `);
    item.embedding = await computeAveragedEmbedding(item.labels);
    console.log(`完成 (${item.embedding.length} 維)`);
  }

  // 生成輸出檔案
  const outputData = {
    version: '1.8.26',
    model: 'plhery/mobileclip2-onnx',
    variant: 's0',
    embeddingDim: 512,
    generatedAt: new Date().toISOString(),
    categories: BROAD_CATEGORIES,
    candidates: PRODUCT_CANDIDATES
  };

  const jsonContent = JSON.stringify(outputData, null, 2);
  const jsContent = `/**
 * MobileCLIP2-S0 預先計算商品特徵向量資料庫 (Offline Text Embeddings)
 * 模型: plhery/mobileclip2-onnx (S0)
 * 向量維度: 512 (L2 Normalized)
 * 版本: v1.8.26
 * 
 * 手機端與瀏覽器禁止載入 254MB text_model.onnx，僅需載入此特徵庫與 S0 vision_model.onnx。
 */

export const MOBILECLIP2_EMBEDDING_DIM = 512;
export const MOBILECLIP2_CATEGORIES = ${JSON.stringify(BROAD_CATEGORIES, null, 2)};
export const MOBILECLIP2_CANDIDATES = ${JSON.stringify(PRODUCT_CANDIDATES, null, 2)};

if (typeof window !== 'undefined') {
  window.MOBILECLIP2_EMBEDDING_DIM = MOBILECLIP2_EMBEDDING_DIM;
  window.MOBILECLIP2_CATEGORIES = MOBILECLIP2_CATEGORIES;
  window.MOBILECLIP2_CANDIDATES = MOBILECLIP2_CANDIDATES;
}
`;

  // 寫入專案根目錄與 www 目錄
  const rootDir = path.resolve(__dirname, '..');
  const wwwDir = path.resolve(rootDir, 'www');

  fs.writeFileSync(path.join(rootDir, 'mobileclip2-labels.json'), jsonContent, 'utf8');
  fs.writeFileSync(path.join(rootDir, 'mobileclip2-labels.js'), jsContent, 'utf8');
  console.log(`\n✅ 已成功寫入 ${path.join(rootDir, 'mobileclip2-labels.js')} 與 .json`);

  if (fs.existsSync(wwwDir)) {
    fs.writeFileSync(path.join(wwwDir, 'mobileclip2-labels.json'), jsonContent, 'utf8');
    fs.writeFileSync(path.join(wwwDir, 'mobileclip2-labels.js'), jsContent, 'utf8');
    console.log(`✅ 已成功同步複製至 ${wwwDir}`);
  }

  console.log(`\n🎉 MobileCLIP2 離線特徵資料庫建置完成！共 ${BROAD_CATEGORIES.length} 個大類別 + ${PRODUCT_CANDIDATES.length} 個商品細分類。`);
}

// 若直接以 node 執行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildEmbeddings().catch(err => {
    console.error('\n❌ 建立 Embeddings 過程失敗:', err);
    process.exit(1);
  });
}
