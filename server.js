// ════════════════════════════════════════════════
// سيرفر سعر النهارده — Scraper لأسعار الذهب والفضة المصرية
// ════════════════════════════════════════════════

const express = require('express');
const cors = require('cors'); // تأكد من تثبيت هذه المكتبة: npm install cors
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

// ─── الإضافة المطلوبة لحل مشكلة الـ CORS ───
app.use(cors({
  origin: '*', // يسمح لأي موقع بالاتصال، وهذا هو الحل لمشكلتك
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors()); 
// ──────────────────────────────────────────

const PORT = process.env.PORT || 3000;

// كاش بسيط للبيانات
let cache = {
  gold: null,
  silver: null,
  goldTimestamp: 0,
  silverTimestamp: 0,
};
const CACHE_DURATION = 5 * 60 * 1000; // 5 دقائق

let lastKnownGood = {
  gold: null,
  silver: null,
};

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

function parseNumber(text) {
  if (!text) return null;
  const cleaned = text.replace(/[,٬\s]/g, '').replace(/[^\d.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ─── Scraping Logic (الذهب) ───
async function scrapeGold() {
  const { data: html } = await axios.get('https://market.isagha.com/prices', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000,
  });

  const $ = cheerio.load(html);
  const result = { fetchedAt: new Date().toISOString() };

  $('table tr').each((i, row) => {
    const cells = $(row).find('td').map((k, c) => $(c).text().trim()).get();
    if (cells.length >= 3) {
      const label = cells[0];
      const sellVal = parseNumber(cells[1]);
      const buyVal = parseNumber(cells[2]);
      for (const k of [24, 22, 21, 18, 14]) {
        if (label.includes(`عيار ${k}`)) {
          result[k] = buyVal;
          result[`${k}_sell`] = sellVal;
        }
      }
    }
  });
  return result;
}

// ─── Scraping Logic (الفضة) ───
async function scrapeSilver() {
  const { data: html } = await axios.get('https://market.isagha.com/prices', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000,
  });

  const $ = cheerio.load(html);
  const result = { fetchedAt: new Date().toISOString() };
  
  $('table tr').each((i, row) => {
    const cells = $(row).find('td').map((k, c) => $(c).text().trim()).get();
    if (cells.length >= 3) {
      const label = cells[0];
      const sellVal = parseNumber(cells[1]);
      const buyVal = parseNumber(cells[2]);
      [999, 925, 800].forEach(k => {
        if (label.includes(`عيار ${k}`)) {
          result[k] = buyVal;
          result[`${k}_sell`] = sellVal;
        }
      });
    }
  });
  return result;
}

// ─── Endpoints ───
app.get('/api/gold', async (req, res) => {
  try {
    const data = await withRetry(scrapeGold);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب الذهب' });
  }
});

app.get('/api/silver', async (req, res) => {
  try {
    const data = await withRetry(scrapeSilver);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب الفضة' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ السيرفر يعمل على بورت ${PORT}`);
});
