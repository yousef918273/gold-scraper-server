// ════════════════════════════════════════════════
// سيرفر سعر النهارده — Scraper لأسعار الذهب والفضة المصرية
// المصدر: gold-price-egypt.com
// ════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors()); // يسمح لأي موقع يكلم السيرفر ده (التطبيق بتاعك)

const PORT = process.env.PORT || 3000;

// كاش بسيط عشان منضربش الموقع المصدر كل ثانية (يحدث كل 3 دقايق)
let cache = {
  gold: null,
  silver: null,
  goldTimestamp: 0,
  silverTimestamp: 0,
};
const CACHE_DURATION = 5 * 60 * 1000; // 5 دقائق (زودناها لتقليل الضغط على المصدر وتقليل احتمال الحظر)

// ─── شبكة الأمان: آخر سعر ناجح اتسحب، بنحتفظ بيه دايماً مهما طال الوقت ───
// لو الـ scraping فشل (الموقع وقع، تغيّر شكله، إلخ)، بنرجّع آخر سعر معروف
// بدل ما نرجّع Error ونوقف التطبيق بتاع المستخدم
let lastKnownGood = {
  gold: null,
  silver: null,
};

// محاولة مرة واحدة + إعادة محاولة سريعة لو فشلت (شبكة أو الموقع بطيء)
async function withRetry(fn, retries = 2, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// ─── دالة تحويل الأرقام العربية/الإنجليزية مع الفواصل لرقم ───
function parseNumber(text) {
  if (!text) return null;
  const cleaned = text.replace(/[,٬\s]/g, '').replace(/[^\d.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ─── Scraping أسعار الذهب (المصدر: iSagha - أقرب مصدر لسوق الذهب الفعلي) ───
async function scrapeGold() {
  const { data: html } = await axios.get('https://market.isagha.com/prices', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.google.com/',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(html);

  const result = {
    24: null, 22: null, 21: null, 18: null, 14: null,
    '24_sell': null, '22_sell': null, '21_sell': null, '18_sell': null, '14_sell': null,
    poundBuy: null, poundSell: null,
    ounceUsd: null,
    source: 'isagha.com',
    fetchedAt: new Date().toISOString(),
  };

  // الجدول بيكون فيه: العيار | بيع | شراء | ... (بيع = أعلى، شراء = أقل)
  $('table tr').each((i, row) => {
    const cells = $(row).find('td').map((k, c) => $(c).text().trim()).get();
    if (cells.length >= 3) {
      const label = cells[0];
      const sellVal = parseNumber(cells[1]);
      const buyVal = parseNumber(cells[2]);

      for (const k of [24, 22, 21, 18, 14]) {
        if (label.includes(`عيار ${k}`) && result[k] === null) {
          if (buyVal && buyVal > 500) result[k] = buyVal;
          if (sellVal && sellVal > 500) result[`${k}_sell`] = sellVal;
        }
      }
      if (label.includes('جنيه ذهب') || label.includes('الجنيه الذهب')) {
        if (sellVal && sellVal > 1000) result.poundSell = sellVal;
        if (buyVal && buyVal > 1000) result.poundBuy = buyVal;
      }
      if (label.includes('أوقية الذهب') || label.includes('اوقية الذهب')) {
        if (sellVal) result.ounceUsd = sellVal;
      }
    }
  });

  // ── Fallback: لو الجدول مش واضح بالـ <table>، نفتش سطر-بسطر زي نظام الفضة ──
  if (!result[24]) {
    const bodyText = $('body').text();
    const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
    const findTwoValuesAfterLabel = (labelVariants) => {
      for (let i = 0; i < lines.length; i++) {
        for (const variant of labelVariants) {
          if (lines[i].includes(variant)) {
            const nums = [];
            for (let j = i + 1; j < Math.min(i + 6, lines.length) && nums.length < 2; j++) {
              const num = parseNumber(lines[j]);
              if (num && num > 500) nums.push(num);
            }
            if (nums.length >= 2) return { sell: nums[0], buy: nums[1] };
          }
        }
      }
      return null;
    };
    for (const k of [24, 22, 21, 18, 14]) {
      const found = findTwoValuesAfterLabel([`عيار ${k}`]);
      if (found) {
        result[k] = found.buy;
        result[`${k}_sell`] = found.sell;
      }
    }
  }

  return result;
}

// ─── Scraping أسعار الفضة (المصدر: iSagha - نفس الصفحة فيها جدول الفضة) ───
async function scrapeSilver() {
  const { data: html } = await axios.get('https://market.isagha.com/prices', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.google.com/',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(html);

  const result = {
    999: null, 958: null, 925: null, 900: null, 800: null, 880: null, 600: null,
    '999_sell': null, '925_sell': null, '900_sell': null, '800_sell': null, '600_sell': null,
    poundBuy: null, poundSell: null,
    ounceUsd: null,
    source: 'isagha.com',
    fetchedAt: new Date().toISOString(),
  };

  const karatList = [999, 958, 925, 900, 800, 880, 600];

  $('table tr').each((i, row) => {
    const cells = $(row).find('td').map((k, c) => $(c).text().trim()).get();
    if (cells.length >= 3) {
      const label = cells[0];
      const sellVal = parseNumber(cells[1]);
      const buyVal = parseNumber(cells[2]);

      for (const k of karatList) {
        if (label.includes(`عيار ${k}`) && result[k] === null) {
          if (buyVal && buyVal > 10) result[k] = buyVal;
          if (sellVal && sellVal > 10) result[`${k}_sell`] = sellVal;
        }
      }
      if (label.includes('الجنيه الفضة') || label.includes('جنيه الفضة')) {
        if (sellVal && sellVal > 100) result.poundSell = sellVal;
        if (buyVal && buyVal > 100) result.poundBuy = buyVal;
      }
      if (label.includes('أوقية الفضة') || label.includes('اوقية الفضة')) {
        if (sellVal) result.ounceUsd = sellVal;
      }
    }
  });

  // ── Fallback: فحص سطر-بسطر لو الجدول مش واضح ──
  if (result[999] === null) {
    const bodyText = $('body').text();
    const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
    const findTwoValuesAfterLabel = (labelVariants) => {
      for (let i = 0; i < lines.length; i++) {
        for (const variant of labelVariants) {
          if (lines[i].includes(variant)) {
            const nums = [];
            for (let j = i + 1; j < Math.min(i + 6, lines.length) && nums.length < 2; j++) {
              const num = parseNumber(lines[j]);
              if (num && num > 10) nums.push(num);
            }
            if (nums.length >= 2) return { sell: nums[0], buy: nums[1] };
          }
        }
      }
      return null;
    };
    for (const k of karatList) {
      const found = findTwoValuesAfterLabel([`عيار ${k}`]);
      if (found) {
        result[k] = found.buy;
        result[`${k}_sell`] = found.sell;
      }
    }
  }

  return result;
}

// ─── Endpoint: الذهب ───
app.get('/api/gold', async (req, res) => {
  const now = Date.now();
  if (cache.gold && (now - cache.goldTimestamp) < CACHE_DURATION) {
    return res.json({ ...cache.gold, cached: true });
  }
  try {
    const data = await withRetry(scrapeGold);
    cache.gold = data;
    cache.goldTimestamp = now;
    lastKnownGood.gold = data; // نحدّث شبكة الأمان كل ما ننجح
    res.json({ ...data, cached: false });
  } catch (err) {
    console.error('Gold scrape error:', err.message);
    if (lastKnownGood.gold) {
      // فشل السحب الجديد، نرجّع آخر سعر معروف بدل ما نوقف التطبيق
      return res.json({ ...lastKnownGood.gold, stale: true, staleReason: err.message });
    }
    res.status(500).json({ error: 'فشل جلب أسعار الذهب', details: err.message });
  }
});

// ─── Endpoint: الفضة ───
app.get('/api/silver', async (req, res) => {
  const now = Date.now();
  if (cache.silver && (now - cache.silverTimestamp) < CACHE_DURATION) {
    return res.json({ ...cache.silver, cached: true });
  }
  try {
    const data = await withRetry(scrapeSilver);
    cache.silver = data;
    cache.silverTimestamp = now;
    lastKnownGood.silver = data;
    res.json({ ...data, cached: false });
  } catch (err) {
    console.error('Silver scrape error:', err.message);
    if (lastKnownGood.silver) {
      return res.json({ ...lastKnownGood.silver, stale: true, staleReason: err.message });
    }
    res.status(500).json({ error: 'فشل جلب أسعار الفضة', details: err.message });
  }
});

// ─── Endpoint: الاثنين مع بعض ───
app.get('/api/prices', async (req, res) => {
  const now = Date.now();
  let gold, silver;

  // الذهب
  if (cache.gold && (now - cache.goldTimestamp) < CACHE_DURATION) {
    gold = cache.gold;
  } else {
    try {
      gold = await withRetry(scrapeGold);
      cache.gold = gold;
      cache.goldTimestamp = now;
      lastKnownGood.gold = gold;
    } catch (err) {
      gold = lastKnownGood.gold ? { ...lastKnownGood.gold, stale: true } : null;
    }
  }

  // الفضة
  if (cache.silver && (now - cache.silverTimestamp) < CACHE_DURATION) {
    silver = cache.silver;
  } else {
    try {
      silver = await withRetry(scrapeSilver);
      cache.silver = silver;
      cache.silverTimestamp = now;
      lastKnownGood.silver = silver;
    } catch (err) {
      silver = lastKnownGood.silver ? { ...lastKnownGood.silver, stale: true } : null;
    }
  }

  if (!gold && !silver) {
    return res.status(500).json({ error: 'فشل جلب الأسعار ولا يوجد سعر سابق محفوظ' });
  }
  res.json({ gold, silver });
});

// ─── صفحة رئيسية بسيطة ───
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: 'سيرفر سعر النهارده شغال ✅',
    endpoints: ['/api/gold', '/api/silver', '/api/prices', '/health'],
  });
});

// ─── مراقبة حالة السيرفر (هل عنده بيانات صالحة محفوظة؟) ───
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGoldCache: !!cache.gold,
    hasSilverCache: !!cache.silver,
    hasLastKnownGoodGold: !!lastKnownGood.gold,
    hasLastKnownGoodSilver: !!lastKnownGood.silver,
    goldCacheAge: cache.goldTimestamp ? Math.round((Date.now() - cache.goldTimestamp) / 1000) + 's' : null,
    silverCacheAge: cache.silverTimestamp ? Math.round((Date.now() - cache.silverTimestamp) / 1000) + 's' : null,
  });
});

app.listen(PORT, () => {
  console.log(`✅ السيرفر شغال على بورت ${PORT}`);

  // ── منع السيرفر من النوم (مشكلة شائعة في خطة Render المجانية) ──
  // بنعمل طلب لنفسنا كل 10 دقايق عشان السيرفر يفضل صاحي ومايبقاش
  // أول طلب من المستخدم بياخد 30-50 ثانية عشان السيرفر "بيصحى"
  const SELF_URL = process.env.RENDER_EXTERNAL_URL; // Render بيوفر ده تلقائياً
  if (SELF_URL) {
    setInterval(() => {
      axios.get(SELF_URL).catch(() => {}); // بنتجاهل أي خطأ، الهدف بس إبقاء السيرفر صاحي
    }, 10 * 60 * 1000); // كل 10 دقايق
    console.log(`🔄 Self-ping مفعّل على: ${SELF_URL}`);
  }

  // ── نسحب الأسعار فوراً عند بدء التشغيل عشان يكون عندنا بيانات جاهزة من أول لحظة ──
  scrapeGold().then(d => { cache.gold = d; cache.goldTimestamp = Date.now(); lastKnownGood.gold = d; }).catch(() => {});
  scrapeSilver().then(d => { cache.silver = d; cache.silverTimestamp = Date.now(); lastKnownGood.silver = d; }).catch(() => {});
});
