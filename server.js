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
const CACHE_DURATION = 3 * 60 * 1000; // 3 دقائق

// ─── دالة تحويل الأرقام العربية/الإنجليزية مع الفواصل لرقم ───
function parseNumber(text) {
  if (!text) return null;
  const cleaned = text.replace(/[,٬\s]/g, '').replace(/[^\d.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ─── Scraping أسعار الذهب ───
async function scrapeGold() {
  const { data: html } = await axios.get('https://gold-price-egypt.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.google.com/',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  // نلاقي كل الجداول في الصفحة ونفحص الصفوف اللي فيها "عيار"
  const result = {
    24: null, 22: null, 21: null, 18: null, 14: null,
    ounceBuy: null, ounceSell: null,
    source: 'gold-price-egypt.com',
    fetchedAt: new Date().toISOString(),
  };

  // الطريقة: نلف على كل الـ <tr> أو نص الصفحة، ونلاقي الأرقام بعد "عيار X"
  const karatPatterns = [
    { key: 24, regex: /عيار\s*24[\s\S]{0,60}?([\d,]{3,7})[\s\S]{0,40}?([\d,]{1,7})?/ },
    { key: 22, regex: /عيار\s*22[\s\S]{0,60}?([\d,]{3,7})[\s\S]{0,40}?([\d,]{1,7})?/ },
    { key: 21, regex: /عيار\s*21[\s\S]{0,60}?([\d,]{3,7})[\s\S]{0,40}?([\d,]{1,7})?/ },
    { key: 18, regex: /عيار\s*18[\s\S]{0,60}?([\d,]{3,7})[\s\S]{0,40}?([\d,]{1,7})?/ },
    { key: 14, regex: /عيار\s*14[\s\S]{0,60}?([\d,]{3,7})[\s\S]{0,40}?([\d,]{1,7})?/ },
  ];

  // أدق طريقة: نلاقي الجدول اللي فيه "سعر جرام الذهب عيار" ونمشي صف صف
  $('table').each((i, table) => {
    $(table).find('tr').each((j, row) => {
      const cells = $(row).find('td, th').map((k, cell) => $(cell).text().trim()).get();
      if (cells.length >= 2) {
        const label = cells[0];
        for (const k of [24, 22, 21, 18, 14]) {
          if (label.includes(`عيار ${k}`) && result[k] === null) {
            // أول رقم في الصف بعد التسمية = السعر بالجنيه
            const priceEgp = parseNumber(cells[1]);
            if (priceEgp && priceEgp > 500) {
              result[k] = priceEgp;
            }
          }
        }
      }
    });
  });

  // Fallback: لو الجداول مش واضحة، نستخدم regex على نص الصفحة كامل
  if (!result[24]) {
    for (const p of karatPatterns) {
      const m = bodyText.match(p.regex);
      if (m && m[1]) {
        const val = parseNumber(m[1]);
        if (val && val > 500) result[p.key] = val;
      }
    }
  }

  return result;
}

// ─── Scraping أسعار الفضة ───
async function scrapeSilver() {
  const { data: html } = await axios.get('https://gold-price-egypt.com/silverprice/', {
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
    999: null, 958: null, 925: null, 900: null, 800: null, 880: null,
    ounce: null,
    source: 'gold-price-egypt.com',
    fetchedAt: new Date().toISOString(),
  };

  const labelMap = {
    'عيار999': 999,
    'عيار 999': 999,
    'عيار958': 958,
    'عيار 958': 958,
    'عيار925': 925,
    'عيار 925': 925,
    'عيار900': 900,
    'عيار 900': 900,
    'عيار800': 800,
    'عيار 800': 800,
    'عيار880': 880,
    'عيار 880': 880,
  };

  $('table').each((i, table) => {
    $(table).find('tr').each((j, row) => {
      const cells = $(row).find('td, th').map((k, cell) => $(cell).text().trim()).get();
      if (cells.length >= 2) {
        const label = cells[0];
        if (label.includes('أونصة الفضة') && !result.ounce) {
          const v = parseNumber(cells[1]);
          if (v && v > 1000) result.ounce = v;
        }
        for (const key in labelMap) {
          if (label.includes(key)) {
            const karat = labelMap[key];
            const v = parseNumber(cells[1]);
            if (v && v > 10 && result[karat] === null) result[karat] = v;
          }
        }
      }
    });
  });

  return result;
}

// ─── Endpoint: الذهب ───
app.get('/api/gold', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.gold && (now - cache.goldTimestamp) < CACHE_DURATION) {
      return res.json({ ...cache.gold, cached: true });
    }
    const data = await scrapeGold();
    cache.gold = data;
    cache.goldTimestamp = now;
    res.json({ ...data, cached: false });
  } catch (err) {
    console.error('Gold scrape error:', err.message);
    res.status(500).json({ error: 'فشل جلب أسعار الذهب', details: err.message });
  }
});

// ─── Endpoint: الفضة ───
app.get('/api/silver', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.silver && (now - cache.silverTimestamp) < CACHE_DURATION) {
      return res.json({ ...cache.silver, cached: true });
    }
    const data = await scrapeSilver();
    cache.silver = data;
    cache.silverTimestamp = now;
    res.json({ ...data, cached: false });
  } catch (err) {
    console.error('Silver scrape error:', err.message);
    res.status(500).json({ error: 'فشل جلب أسعار الفضة', details: err.message });
  }
});

// ─── Endpoint: الاثنين مع بعض ───
app.get('/api/prices', async (req, res) => {
  try {
    const now = Date.now();
    let gold, silver;

    if (cache.gold && (now - cache.goldTimestamp) < CACHE_DURATION) {
      gold = cache.gold;
    } else {
      gold = await scrapeGold();
      cache.gold = gold;
      cache.goldTimestamp = now;
    }

    if (cache.silver && (now - cache.silverTimestamp) < CACHE_DURATION) {
      silver = cache.silver;
    } else {
      silver = await scrapeSilver();
      cache.silver = silver;
      cache.silverTimestamp = now;
    }

    res.json({ gold, silver });
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب الأسعار', details: err.message });
  }
});

// ─── صفحة رئيسية بسيطة ───
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: 'سيرفر سعر النهارده شغال ✅',
    endpoints: ['/api/gold', '/api/silver', '/api/prices'],
  });
});

app.listen(PORT, () => {
  console.log(`✅ السيرفر شغال على بورت ${PORT}`);
});
