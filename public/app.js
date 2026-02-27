/* ============================================================
   Golden-Price — Main Application
   Fetches financial data via Brave Search API proxy,
   renders cards with sparklines, and manages history/settings.
   ============================================================ */

'use strict';

// ── Constants ────────────────────────────────────────────────
const CONFIG_KEY   = 'gp_config_v1';
const HISTORY_KEY  = 'gp_history_v1';
const MAX_HISTORY  = 48;   // data points kept per item
const TROY_OZ_GRAM = 31.1035; // grams per troy ounce

// ── Financial Items Definition ───────────────────────────────
const ITEMS = [
  {
    id: 'gold',
    emoji: '🥇',
    name: 'Gold',
    name_zh: '黄金',
    ticker: 'GC=F',
    sina: 'XAUUSD',
    query: 'gold price per troy ounce USD today spot XAU',
    unit: 'USD/oz',
    accent: '#FFD700',
    showCNYperGram: true,
    range: [500, 5000],
  },
  {
    id: 'silver',
    emoji: '🥈',
    name: 'Silver',
    name_zh: '白银',
    ticker: 'SI=F',
    sina: 'XAGUSD',
    query: 'silver price per troy ounce USD today spot XAG',
    unit: 'USD/oz',
    accent: '#C0C0C0',
    range: [5, 200],
  },
  {
    id: 'oil',
    emoji: '🛢️',
    name: 'Crude Oil',
    name_zh: '原油',
    ticker: 'CL=F',
    sina: 'gb_cl',
    query: 'WTI crude oil price per barrel USD today',
    unit: 'USD/bbl',
    accent: '#8B4513',
    range: [20, 300],
  },
  {
    id: 'usdcny',
    emoji: '💵',
    name: 'USD/CNY',
    name_zh: '美元/人民币',
    ticker: 'USDCNY=X',
    sina: 'fx_susdcny',
    query: '1 US Dollar to Chinese Yuan exchange rate today USD CNY',
    unit: 'CNY',
    accent: '#DC143C',
    range: [5, 10],
  },
  {
    id: 'eurusd',
    emoji: '💶',
    name: 'EUR/USD',
    name_zh: '欧元/美元',
    ticker: 'EURUSD=X',
    sina: 'fx_seurusd',
    query: '1 Euro to US Dollar exchange rate today EUR USD',
    unit: 'USD',
    accent: '#4169E1',
    range: [0.8, 1.6],
  },
  {
    id: 'gbpusd',
    emoji: '💷',
    name: 'GBP/USD',
    name_zh: '英镑/美元',
    ticker: 'GBPUSD=X',
    sina: 'fx_sgbpusd',
    query: '1 British Pound to US Dollar exchange rate today GBP USD',
    unit: 'USD',
    accent: '#6A0DAD',
    range: [1.0, 2.0],
  },
  {
    id: 'sp500',
    emoji: '📈',
    name: 'S&P 500',
    name_zh: '标普500',
    ticker: '^GSPC',
    sina: 'gb_inx',
    query: 'S&P 500 index SPX price today stock market',
    unit: 'pts',
    accent: '#228B22',
    range: [2000, 8000],
  },
  {
    id: 'dow',
    emoji: '🏭',
    name: 'Dow Jones',
    name_zh: '道琼斯',
    ticker: '^DJI',
    sina: 'gb_dji',
    query: 'Dow Jones Industrial Average DJIA index today',
    unit: 'pts',
    accent: '#4169E1',
    range: [20000, 60000],
  },
  {
    id: 'nasdaq',
    emoji: '💻',
    name: 'NASDAQ',
    name_zh: '纳斯达克',
    ticker: '^IXIC',
    sina: 'gb_ixic',
    query: 'NASDAQ Composite index IXIC today stock market',
    unit: 'pts',
    accent: '#9370DB',
    range: [5000, 25000],
  },
  {
    id: 'sse',
    emoji: '🐉',
    name: 'Shanghai',
    name_zh: '上证指数',
    ticker: '000001.SS',
    sina: 'sh000001',
    query: 'Shanghai Composite SSE index 000001.SS 上证综指 today',
    unit: 'pts',
    accent: '#FF4500',
    range: [1500, 8000],
  },
  {
    id: 'hsi',
    emoji: '🌸',
    name: 'Hang Seng',
    name_zh: '恒生指数',
    ticker: '^HSI',
    sina: 'hkHSI',
    query: 'Hang Seng Index HSI Hong Kong stock market today',
    unit: 'pts',
    accent: '#FF6347',
    range: [8000, 40000],
  },
];

// ── State ────────────────────────────────────────────────────
let config = {
  apiKey: '',
  refreshInterval: 1800,
  enabledItems: ITEMS.map((i) => i.id),
};

let history = {};      // { [itemId]: Array<{ v: number, t: number }> }
let sparkCharts = {};  // Chart.js instances for sparklines
let trendChart  = null;
let refreshTimer = null;
let apiCallsMade = 0;
let isRefreshing = false;

// ── Utilities ────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmt(value, decimals = 2) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  if (value >= 10000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (value >= 100)   return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function showError(msg) {
  const el = document.getElementById('errorAlert');
  document.getElementById('errorMsg').textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 8000);
}

// ── LocalStorage helpers ─────────────────────────────────────
function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) Object.assign(config, JSON.parse(raw));
  } catch (err) {
    console.warn('[config] Failed to load config from localStorage:', err.message);
  }
}

function saveConfig() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function loadHistory() {
  try {
    history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
  } catch (err) {
    console.warn('[history] Failed to load history from localStorage:', err.message);
    history = {};
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function pushHistory(id, value) {
  if (!history[id]) history[id] = [];
  // Avoid duplicates in the same minute
  const last = history[id][history[id].length - 1];
  if (last && Date.now() - last.t < 60000) {
    last.v = value; // update in place
  } else {
    history[id].push({ v: value, t: Date.now() });
    if (history[id].length > MAX_HISTORY) history[id].shift();
  }
  saveHistory();
}

// ── Price Parsing ────────────────────────────────────────────

/**
 * Extract a plausible numeric price from a Brave Search API response object.
 * Strategy: infobox data → web result titles + descriptions.
 * Uses item-specific regex patterns and a valid-range guard.
 */
function extractPrice(braveData, item) {
  const texts = buildTextCorpus(braveData);
  const fullText = texts.join(' ');

  const patterns = getPricePatterns(item.id);

  for (const re of patterns) {
    const m = fullText.match(re);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val >= item.range[0] && val <= item.range[1]) {
        return val;
      }
    }
  }

  // Fallback: find any decimal number in range
  const generic = fullText.matchAll(/([\d,]{1,10}\.?\d{0,4})/g);
  for (const m of generic) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(val) && val >= item.range[0] && val <= item.range[1]) {
      return val;
    }
  }

  return null;
}

function buildTextCorpus(braveData) {
  const texts = [];
  // Infobox structured data
  if (braveData.infobox?.data) {
    for (const entry of braveData.infobox.data) {
      texts.push(`${entry.key || ''}: ${entry.value || ''}`);
    }
  }
  if (braveData.infobox?.long_desc) texts.push(braveData.infobox.long_desc);
  // Web results
  if (braveData.web?.results) {
    for (const r of braveData.web.results.slice(0, 5)) {
      if (r.title)       texts.push(r.title);
      if (r.description) texts.push(r.description);
      if (r.extra_snippets) texts.push(...r.extra_snippets);
    }
  }
  return texts;
}

function getPricePatterns(id) {
  const DOLLAR  = /\$\s*/;
  switch (id) {
    case 'gold':
      return [
        /gold\s+(?:price|spot)[^\d]*([\d,]+\.?\d*)/i,
        /xauusd[:\s]*([\d,]+\.?\d*)/i,
        /\$\s*([\d,]+\.?\d*)\s*(?:per\s+(?:troy\s+)?ounce|\/(?:troy\s+)?oz)/i,
        /spot\s+gold[:\s]*([\d,]+\.?\d*)/i,
      ];
    case 'silver':
      return [
        /silver\s+(?:price|spot)[^\d]*([\d.]+)/i,
        /xagusd[:\s]*([\d.]+)/i,
        /\$\s*([\d.]+)\s*(?:per\s+(?:troy\s+)?ounce|\/(?:troy\s+)?oz)/i,
      ];
    case 'oil':
      return [
        /wti[:\s]*([\d.]+)/i,
        /crude\s+oil[^\d]*([\d.]+)/i,
        /\$\s*([\d.]+)\s*(?:per\s+barrel|\/bbl)/i,
      ];
    case 'usdcny':
      return [
        /1\s+(?:us\s+dollar|usd)[^=\d]*=?\s*([\d.]+)\s*(?:chinese\s+yuan|cny|rmb)/i,
        /usd\s*[\/to]+\s*cny[:\s]*([\d.]+)/i,
        /usdcny[:\s]*([\d.]+)/i,
        /(7\.\d{2,4})/,   // CNY rates are typically 7.xx
      ];
    case 'eurusd':
      return [
        /1\s+(?:euro?|eur)[^=\d]*=?\s*([\d.]+)\s*(?:us\s+dollar|usd)/i,
        /eur\s*[\/to]+\s*usd[:\s]*([\d.]+)/i,
        /eurusd[:\s]*([\d.]+)/i,
        /(1\.\d{2,4})/,   // EUR/USD near 1.0x
      ];
    case 'gbpusd':
      return [
        /1\s+(?:british\s+pound|gbp)[^=\d]*=?\s*([\d.]+)\s*(?:us\s+dollar|usd)/i,
        /gbp\s*[\/to]+\s*usd[:\s]*([\d.]+)/i,
        /gbpusd[:\s]*([\d.]+)/i,
      ];
    case 'sp500':
      return [
        /s\s*&\s*p\s*500[^\d]*([\d,]+\.?\d*)/i,
        /spx[:\s]*([\d,]+\.?\d*)/i,
        /s&p500[:\s]*([\d,]+\.?\d*)/i,
      ];
    case 'dow':
      return [
        /dow\s+jones[^\d]*([\d,]+\.?\d*)/i,
        /djia[:\s]*([\d,]+\.?\d*)/i,
        /dow\s+industrial[^\d]*([\d,]+\.?\d*)/i,
      ];
    case 'nasdaq':
      return [
        /nasdaq\s+composite[^\d]*([\d,]+\.?\d*)/i,
        /nasdaq[:\s]*([\d,]+\.?\d*)/i,
        /ixic[:\s]*([\d,]+\.?\d*)/i,
      ];
    case 'sse':
      return [
        /shanghai\s+composite[^\d]*([\d,]+\.?\d*)/i,
        /sse[:\s]*([\d,]+\.?\d*)/i,
        /000001[:\s]*([\d,]+\.?\d*)/i,
        /上证综指[^\d]*([\d,]+\.?\d*)/i,
      ];
    case 'hsi':
      return [
        /hang\s+seng[^\d]*([\d,]+\.?\d*)/i,
        /hsi[:\s]*([\d,]+\.?\d*)/i,
        /hong\s+kong\s+index[^\d]*([\d,]+\.?\d*)/i,
      ];
    default:
      return [];
  }
}

/**
 * Extract percentage change from result text.
 * Returns a number or null.
 */
function extractChange(braveData) {
  const texts = buildTextCorpus(braveData);
  const text = texts.join(' ');

  // Patterns like "+0.45%", "-1.20%", "up 0.45%", "down 1.2 percent"
  const patterns = [
    /([+\-]\d{1,3}\.\d{1,4})\s*%/,
    /(?:up|▲)\s*([\d.]+)\s*%/i,
    /(?:down|▼)\s*([\d.]+)\s*%/i,
    /([\d.]+)\s*%\s*(?:up|gain|rise|higher)/i,
    /([\d.]+)\s*%\s*(?:down|loss|fall|lower)/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      let val = parseFloat(m[1]);
      if (!isNaN(val) && Math.abs(val) < 25) {
        // Adjust sign for "down" patterns
        if (/(?:down|▼|loss|fall|lower)/i.test(m[0]) && val > 0) val = -val;
        return val;
      }
    }
  }
  return null;
}

// ── DOM: Card Generation ─────────────────────────────────────
function generateCards() {
  const grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';
  sparkCharts = {};

  const enabled = config.enabledItems;
  ITEMS.filter((i) => enabled.includes(i.id)).forEach((item) => {
    const card = document.createElement('article');
    card.className = 'fin-card';
    card.id = `card-${item.id}`;
    card.style.setProperty('--card-accent', item.accent);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${item.name} price chart`);

    card.innerHTML = `
      <div class="card-header">
        <div class="card-label">
          <span class="card-emoji">${item.emoji}</span>
          <span>${item.name}</span>
        </div>
        <span class="card-badge">${item.unit}</span>
      </div>
      <div class="card-price skeleton" id="price-${item.id}">...</div>
      <div class="card-sub" id="sub-${item.id}"></div>
      <div class="card-change neutral" id="change-${item.id}">—</div>
      <div class="card-sparkline" id="spark-${item.id}" aria-hidden="true"></div>
    `;

    card.addEventListener('click', () => openTrendChart(item.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openTrendChart(item.id); });

    grid.appendChild(card);
    initSparkline(item.id, item.accent);
  });
}

function initSparkline(id, accent) {
  const container = document.getElementById(`spark-${id}`);
  if (!container || typeof Highcharts === 'undefined') return;

  sparkCharts[id] = Highcharts.chart(container, {
    chart: {
      backgroundColor: null,
      borderWidth: 0,
      margin: [2, 0, 2, 0],
      height: 32,
      animation: false,
    },
    title: { text: null },
    credits: { enabled: false },
    xAxis: { visible: false },
    yAxis: { visible: false, endOnTick: false, startOnTick: false },
    legend: { enabled: false },
    tooltip: { enabled: false },
    plotOptions: {
      area: {
        animation: false,
        lineWidth: 1.5,
        marker: { enabled: false },
        states: { hover: { enabled: false } },
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, accent + '30'],
            [1, accent + '00'],
          ],
        },
      },
    },
    series: [{ type: 'area', color: accent, data: [] }],
  });
}

function updateSparkline(id) {
  const chart = sparkCharts[id];
  if (!chart) return;
  const pts = (history[id] || []).slice(-24);
  chart.series[0].setData(pts.map((p) => p.v), true, false);
}

// ── DOM: Card Data Update ────────────────────────────────────
function setCardLoading(id) {
  const priceEl = document.getElementById(`price-${id}`);
  if (priceEl) {
    priceEl.textContent = '...';
    priceEl.classList.add('skeleton');
  }
  const changeEl = document.getElementById(`change-${id}`);
  if (changeEl) { changeEl.textContent = '—'; changeEl.className = 'card-change neutral'; }
  const subEl = document.getElementById(`sub-${id}`);
  if (subEl) subEl.textContent = '';
}

function updateCard(id, price, change, sub) {
  const priceEl = document.getElementById(`price-${id}`);
  if (!priceEl) return;

  priceEl.classList.remove('skeleton');
  if (price !== null) {
    priceEl.textContent = fmt(price);
  } else {
    priceEl.textContent = 'N/A';
  }

  const subEl = document.getElementById(`sub-${id}`);
  if (subEl) subEl.textContent = sub || '';

  const changeEl = document.getElementById(`change-${id}`);
  if (changeEl) {
    if (change !== null && change !== undefined) {
      const sign = change >= 0 ? '▲ +' : '▼ ';
      changeEl.textContent = `${sign}${Math.abs(change).toFixed(2)}%`;
      changeEl.className = `card-change ${change >= 0 ? 'positive' : 'negative'}`;
    } else {
      changeEl.textContent = '—';
      changeEl.className = 'card-change neutral';
    }
  }

  if (price !== null) {
    pushHistory(id, price);
    updateSparkline(id);
  }
}

function setCardError(id, msg) {
  const priceEl = document.getElementById(`price-${id}`);
  if (priceEl) { priceEl.textContent = 'Error'; priceEl.classList.remove('skeleton'); }
  const changeEl = document.getElementById(`change-${id}`);
  if (changeEl) { changeEl.textContent = msg.slice(0, 30); changeEl.className = 'card-change negative'; }
}

// ── Data Fetching ────────────────────────────────────────────
// Sina Finance bulk fetch — single request for all items, works in China
let sinaCache = null;  // { data, ts }
async function fetchSinaAll() {
  // Reuse data if fetched within the last 5 s (multiple cards call this in a loop)
  if (sinaCache && Date.now() - sinaCache.ts < 5000) return sinaCache.data;
  const res = await fetch('/api/sina/quotes');
  if (!res.ok) throw new Error(`Sina API error: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  sinaCache = { data, ts: Date.now() };
  return data;
}

async function fetchYahoo(item) {
  const res = await fetch(`/api/quote/${encodeURIComponent(item.ticker)}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('No data from Yahoo Finance');
  const meta = result.meta;
  const price = meta.regularMarketPrice;
  if (price == null) throw new Error('Price missing in Yahoo response');
  // change as a number (percent)
  let change = meta.regularMarketChangePercent ?? null;
  if (change == null && meta.previousClose && meta.previousClose !== 0) {
    change = ((price - meta.previousClose) / meta.previousClose) * 100;
  }
  return { price, change };
}

async function searchBrave(query) {
  const url = `/api/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, {
    headers: { 'X-Api-Key': config.apiKey },
  });
  apiCallsMade++;
  document.getElementById('apiCallCount').textContent = `${apiCallsMade} API calls`;

  let data;
  try {
    data = await res.json();
  } catch (_e) {
    throw new Error(`HTTP ${res.status}: Failed to parse API response`);
  }

  // Propagate both HTTP-error and application-level error payloads
  if (!res.ok || (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'error'))) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

async function fetchItem(item) {
  // 1. Try Sina Finance (no API key, fast, works in China)
  if (item.sina) {
    try {
      const all = await fetchSinaAll();
      const d = all[item.sina];
      if (d && d.price != null) return { price: d.price, change: d.changePct ?? null };
      throw new Error('No data for symbol');
    } catch (sinaErr) {
      console.warn(`[${item.id}] Sina failed (${sinaErr.message}), trying Yahoo`);
    }
  }
  // 2. Try Yahoo Finance
  if (item.ticker) {
    try {
      return await fetchYahoo(item);
    } catch (yahooErr) {
      console.warn(`[${item.id}] Yahoo failed (${yahooErr.message}), falling back to Brave`);
    }
  }
  // 3. Fall back to Brave Search
  const data = await searchBrave(item.query);
  const price  = extractPrice(data, item);
  const change = extractChange(data);
  return { price, change };
}

async function refreshData() {
  if (isRefreshing) return;
  // Show advisory if no Brave API key, but still proceed via Yahoo Finance
  document.getElementById('noApiAlert').hidden = !!config.apiKey;

  isRefreshing = true;
  const refreshIcon = document.getElementById('refreshIcon');
  refreshIcon.classList.add('spinning');

  const enabled = ITEMS.filter((i) => config.enabledItems.includes(i.id));
  const prices  = {};

  for (const item of enabled) {
    setCardLoading(item.id);
    try {
      const { price, change } = await fetchItem(item);
      prices[item.id] = price;
      updateCard(item.id, price, change);
    } catch (err) {
      setCardError(item.id, err.message);
      showError(`${item.emoji} ${item.name}: ${err.message}`);
      console.error(`[${item.id}]`, err);
    }
    await sleep(400); // gentle throttle between requests
  }

  // Gold → CNY/g sub-label
  const goldPrice  = prices['gold'];
  const usdcnyRate = prices['usdcny'];
  if (goldPrice && usdcnyRate) {
    const cnyPerGram = (goldPrice * usdcnyRate) / TROY_OZ_GRAM;
    const subEl = document.getElementById('sub-gold');
    if (subEl) subEl.textContent = `≈ ¥${cnyPerGram.toFixed(2)}/g`;
  }

  document.getElementById('lastUpdated').textContent =
    `🕐 Updated: ${fmtTime(Date.now())}`;
  document.getElementById('noApiAlert').hidden = true;

  refreshIcon.classList.remove('spinning');
  isRefreshing = false;
}

// ── Auto-refresh ─────────────────────────────────────────────
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (config.refreshInterval > 0) {
    refreshTimer = setInterval(refreshData, config.refreshInterval * 1000);
  }
}

// ── Trend Chart Modal ────────────────────────────────────────
// Range → [interval, yahooRange]
const CHART_RANGES = {
  '1d':  ['5m',  '1d'],
  '5d':  ['30m', '5d'],
  '1mo': ['1d',  '1mo'],
  '1y':  ['1d',  '1y'],
  '5y':  ['1wk', '5y'],
  'max': ['1mo', 'max'],
};

let currentChartItem = null;

function formatChartLabel(ts, range) {
  const d = new Date(ts * 1000);
  if (range === '1d') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (range === '5d') {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

async function fetchChartHistory(ticker, range) {
  const [interval, r] = CHART_RANGES[range] || CHART_RANGES['1d'];
  const res = await fetch(`/api/history/${encodeURIComponent(ticker)}?interval=${interval}&range=${r}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('No data');
  return result;
}

function buildStatsHTML(meta, dayHigh, dayLow, dayOpen, totalVol) {
  const f = (v) => (v != null ? fmt(v) : '—');
  const fVol = (v) => {
    if (v == null) return '—';
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return v.toLocaleString();
  };
  return `
    <div class="stat-item">
      <div class="stat-label">高</div>
      <div class="stat-value" style="color:var(--negative)">${f(dayHigh)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">开盘</div>
      <div class="stat-value">${f(dayOpen)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">近52周最高</div>
      <div class="stat-value" style="color:var(--negative)">${f(meta?.fiftyTwoWeekHigh)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">低</div>
      <div class="stat-value" style="color:var(--positive)">${f(dayLow)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">成交量</div>
      <div class="stat-value">${fVol(totalVol ?? meta?.regularMarketVolume)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">近52周最低</div>
      <div class="stat-value" style="color:var(--positive)">${f(meta?.fiftyTwoWeekLow)}</div>
    </div>
  `;
}

function renderYahooChart(item, chartData, meta, range) {
  const container = document.getElementById('trendChart');
  if (!container || typeof Highcharts === 'undefined') return;
  if (trendChart) { trendChart.destroy(); trendChart = null; }

  const labels  = chartData.map((d) => formatChartLabel(d.ts, range));
  const prices  = chartData.map((d) => d.close);
  const volumes = chartData.map((d) => d.volume ?? 0);

  const prevClose = meta.previousClose ?? meta.chartPreviousClose;
  const lastPrice = prices[prices.length - 1];
  const chartColor = (lastPrice != null && prevClose != null)
    ? (lastPrice >= prevClose ? '#0DAD5C' : '#E53935')
    : item.accent;

  const hasVolume = volumes.some((v) => v > 0);
  const priceHeight = hasVolume ? '72%' : '100%';
  const priceBottom = hasVolume ? '28%' : '0%';

  const yAxes = [
    {
      title: { text: null },
      labels: { style: { color: '#5A6478', fontSize: '10px' } },
      gridLineColor: 'rgba(0,0,0,0.06)',
      height: priceHeight,
      plotLines: prevClose ? [{
        value: prevClose,
        color: 'rgba(0,0,0,0.22)',
        dashStyle: 'Dash',
        width: 1,
        label: {
          text: `前收: ${fmt(prevClose)}`,
          align: 'right',
          style: { color: '#9BA3B2', fontSize: '9px' },
        },
        zIndex: 3,
      }] : [],
    },
  ];

  const series = [
    {
      type: 'area',
      name: item.name,
      color: chartColor,
      data: prices,
      yAxis: 0,
      zIndex: 2,
    },
  ];

  if (hasVolume) {
    yAxes.push({
      title: { text: null },
      labels: { enabled: false },
      gridLineWidth: 0,
      top: priceBottom,
      height: '24%',
      offset: 0,
    });
    series.push({
      type: 'column',
      name: '成交量',
      color: chartColor + '55',
      data: volumes,
      yAxis: 1,
      zIndex: 1,
    });
  }

  trendChart = Highcharts.chart(container, {
    chart: {
      backgroundColor: null,
      animation: { duration: 400 },
      margin: [8, 8, 24, 54],
    },
    title: { text: null },
    credits: { enabled: false },
    xAxis: {
      categories: labels,
      labels: {
        style: { color: '#5A6478', fontSize: '10px' },
        step: Math.max(1, Math.floor(labels.length / 6)),
      },
      lineColor: 'rgba(0,0,0,0.1)',
      tickColor: 'transparent',
      crosshair: { color: 'rgba(0,0,0,0.12)', width: 1 },
    },
    yAxis: yAxes,
    tooltip: {
      backgroundColor: 'rgba(15,20,48,0.92)',
      borderColor: chartColor,
      borderWidth: 1,
      style: { color: '#f0f0f0', fontSize: '11px' },
      shared: true,
      formatter: function () {
        let s = `<b>${this.x}</b>`;
        this.points.forEach((pt) => {
          if (pt.series.type === 'area') {
            s += `<br/>价格: <b>${fmt(pt.y)}</b> ${item.unit}`;
          } else if (pt.series.type === 'column') {
            s += `<br/>成交量: <b>${(pt.y || 0).toLocaleString()}</b>`;
          }
        });
        return s;
      },
    },
    legend: { enabled: false },
    plotOptions: {
      area: {
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, chartColor + '44'],
            [1, chartColor + '00'],
          ],
        },
        lineWidth: 1.5,
        marker: {
          enabled: chartData.length <= 30,
          radius: 3,
          fillColor: chartColor,
          symbol: 'circle',
        },
        states: { hover: { lineWidth: 1.5 } },
        threshold: null,
      },
      column: {
        borderWidth: 0,
        pointPadding: 0.05,
        groupPadding: 0,
      },
    },
    series,
  });
}

function renderHistoryChart(item) {
  const pts       = history[item.id] || [];
  const metaEl    = document.getElementById('chartMeta');
  const statsEl   = document.getElementById('chartStats');
  const priceEl   = document.getElementById('chartPriceDisplay');

  metaEl.textContent = pts.length > 0
    ? `${pts.length} 个历史记录 · ${fmtTime(pts[0].t)} – ${fmtTime(pts[pts.length - 1].t)}`
    : '暂无历史数据 — 请刷新以收集数据。';

  if (pts.length > 1) {
    const values = pts.map((p) => p.v);
    const minV   = Math.min(...values);
    const maxV   = Math.max(...values);
    const latest = values[values.length - 1];
    const first  = values[0];
    const change = ((latest - first) / first) * 100;
    priceEl.innerHTML = `
      <span class="chart-price-val">${fmt(latest)}</span>
      <span class="chart-price-change ${change >= 0 ? 'pos' : 'neg'}">
        ${change >= 0 ? '+' : ''}${change.toFixed(2)}%
      </span>`;
    statsEl.innerHTML = `
      <div class="stat-item">
        <div class="stat-label">最低</div>
        <div class="stat-value" style="color:var(--positive)">${fmt(minV)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">最高</div>
        <div class="stat-value" style="color:var(--negative)">${fmt(maxV)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">涨跌幅</div>
        <div class="stat-value" style="color:${change >= 0 ? 'var(--positive)' : 'var(--negative)'}">
          ${change >= 0 ? '+' : ''}${change.toFixed(2)}%</div>
      </div>`;
  } else {
    priceEl.innerHTML = '';
    statsEl.innerHTML = '';
  }

  const container = document.getElementById('trendChart');
  if (!container || typeof Highcharts === 'undefined') return;
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  if (pts.length === 0) return;

  const accent = item.accent;
  trendChart = Highcharts.chart(container, {
    chart: { backgroundColor: null, animation: { duration: 300 } },
    title: { text: null },
    credits: { enabled: false },
    xAxis: {
      categories: pts.map((p) => fmtTime(p.t)),
      labels: {
        style: { color: '#5A6478', fontSize: '10px' },
        step: Math.max(1, Math.floor(pts.length / 6)),
      },
      lineColor: 'rgba(0,0,0,0.1)',
      tickColor: 'transparent',
    },
    yAxis: {
      title: { text: null },
      labels: { style: { color: '#5A6478', fontSize: '10px' } },
      gridLineColor: 'rgba(0,0,0,0.06)',
    },
    tooltip: {
      backgroundColor: 'rgba(15,20,48,0.92)',
      borderColor: accent,
      borderWidth: 1,
      style: { color: '#f0f0f0' },
      formatter: function () { return `<b>${this.x}</b><br/>${fmt(this.y)} ${item.unit}`; },
    },
    legend: { enabled: false },
    plotOptions: {
      area: {
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [[0, accent + '44'], [1, accent + '00']],
        },
        lineWidth: 2,
        marker: { enabled: pts.length <= 12, radius: 3, fillColor: accent },
        states: { hover: { lineWidth: 2 } },
      },
    },
    series: [{ type: 'area', color: accent, data: pts.map((p) => p.v) }],
  });
}

async function loadChartRange(item, range) {
  const metaEl  = document.getElementById('chartMeta');
  const statsEl = document.getElementById('chartStats');
  const priceEl = document.getElementById('chartPriceDisplay');

  metaEl.textContent = '加载中…';
  priceEl.innerHTML  = '';
  statsEl.innerHTML  = '';
  if (trendChart) { trendChart.destroy(); trendChart = null; }

  if (!item.ticker) { renderHistoryChart(item); return; }

  try {
    const result = await fetchChartHistory(item.ticker, range);
    const meta       = result.meta || {};
    const timestamps = result.timestamp || [];
    const quote      = result.indicators?.quote?.[0] || {};
    const closes  = quote.close  || [];
    const volumes = quote.volume || [];
    const highs   = quote.high   || [];
    const lows    = quote.low    || [];
    const opens   = quote.open   || [];

    const chartData = timestamps.map((ts, i) => ({
      ts, close: closes[i], volume: volumes[i],
      high: highs[i], low: lows[i], open: opens[i],
    })).filter((d) => d.close != null);

    if (chartData.length === 0) { renderHistoryChart(item); return; }

    // Price header
    const price     = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prevClose = meta.previousClose ?? meta.chartPreviousClose;
    const change    = prevClose ? price - prevClose : 0;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    const isUp      = change >= 0;
    priceEl.innerHTML = `
      <span class="chart-price-val">${fmt(price)}</span>
      <span class="chart-price-change ${isUp ? 'pos' : 'neg'}">
        ${isUp ? '▲' : '▼'} ${isUp ? '+' : ''}${fmt(Math.abs(change))}
        (${isUp ? '+' : ''}${changePct.toFixed(2)}%) 今日
      </span>`;

    metaEl.textContent = `${chartData.length} 个数据点`;

    // Stats
    const validHighs = highs.filter((v) => v != null);
    const validLows  = lows.filter((v) => v != null);
    const totalVol   = volumes.filter((v) => v != null).reduce((s, v) => s + v, 0) || null;
    const dayHigh    = validHighs.length ? Math.max(...validHighs) : null;
    const dayLow     = validLows.length  ? Math.min(...validLows)  : null;
    const dayOpen    = opens.find((v) => v != null) ?? null;
    statsEl.innerHTML = buildStatsHTML(meta, dayHigh, dayLow, dayOpen, totalVol);

    renderYahooChart(item, chartData, meta, range);
  } catch (err) {
    console.warn(`[chart] range ${range} failed:`, err.message);
    metaEl.textContent = '无法加载数据，显示历史记录';
    renderHistoryChart(item);
  }
}

function openTrendChart(id) {
  const item = ITEMS.find((i) => i.id === id);
  if (!item) return;
  currentChartItem = item;

  // Reset range tabs to 1d
  const tabsEl = document.getElementById('chartRangeTabs');
  tabsEl.querySelectorAll('.range-tab').forEach((btn) => {
    const active = btn.dataset.range === '1d';
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.onclick = () => {
      tabsEl.querySelectorAll('.range-tab').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      loadChartRange(currentChartItem, btn.dataset.range);
    };
  });

  document.getElementById('chartTitle').textContent = `${item.emoji} ${item.name_zh || item.name}`;
  document.getElementById('chartPriceDisplay').innerHTML = '';
  document.getElementById('chartMeta').textContent = '';
  document.getElementById('chartStats').innerHTML = '';
  document.getElementById('chartModal').classList.add('open');

  loadChartRange(item, '1d');
}

function closeTrendChart() {
  document.getElementById('chartModal').classList.remove('open');
  if (trendChart) { trendChart.destroy(); trendChart = null; }
}

// ── Settings Modal ───────────────────────────────────────────
function openSettings() {
  document.getElementById('apiKeyInput').value    = config.apiKey;
  document.getElementById('refreshInterval').value = String(config.refreshInterval);

  // Build checkbox list
  const grid = document.getElementById('enabledItemsGrid');
  grid.innerHTML = '';
  ITEMS.forEach((item) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = item.id;
    cb.checked = config.enabledItems.includes(item.id);
    cb.id = `cb-${item.id}`;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${item.emoji} ${item.name}`));
    grid.appendChild(label);
  });

  document.getElementById('settingsModal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function saveSettings() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key) { alert('Please enter your Brave API key.'); return; }

  config.apiKey          = key;
  config.refreshInterval = parseInt(document.getElementById('refreshInterval').value, 10);
  config.enabledItems    = ITEMS
    .filter((item) => document.getElementById(`cb-${item.id}`)?.checked)
    .map((item) => item.id);

  saveConfig();
  closeSettings();
  generateCards();

  // Restore cached values from history
  ITEMS.filter((i) => config.enabledItems.includes(i.id)).forEach((item) => {
    const pts = history[item.id];
    if (pts && pts.length > 0) {
      const last = pts[pts.length - 1];
      updateCard(item.id, last.v, null);
      updateSparkline(item.id);
    }
  });

  startAutoRefresh();
  refreshData();
}

// ── Bootstrap ────────────────────────────────────────────────
function init() {
  loadConfig();
  loadHistory();
  generateCards();

  // Restore cached prices from history before first network call
  ITEMS.forEach((item) => {
    const pts = history[item.id];
    if (pts && pts.length > 0) {
      const last = pts[pts.length - 1];
      updateCard(item.id, last.v, null);
      updateSparkline(item.id);
    }
  });

  // Restore gold CNY sub-label from history
  const goldPts   = history['gold'];
  const usdcnyPts = history['usdcny'];
  if (goldPts?.length && usdcnyPts?.length) {
    const g = goldPts[goldPts.length - 1].v;
    const r = usdcnyPts[usdcnyPts.length - 1].v;
    const sub = document.getElementById('sub-gold');
    if (sub) sub.textContent = `≈ ¥${((g * r) / TROY_OZ_GRAM).toFixed(2)}/g`;
  }

  // Event listeners
  document.getElementById('refreshBtn').addEventListener('click', refreshData);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('closeSettings').addEventListener('click', closeSettings);
  document.getElementById('settingsBackdrop').addEventListener('click', closeSettings);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('alertSettingsBtn').addEventListener('click', openSettings);
  document.getElementById('closeChart').addEventListener('click', closeTrendChart);
  document.getElementById('chartBackdrop').addEventListener('click', closeTrendChart);
  document.getElementById('toggleApiKey').addEventListener('click', () => {
    const inp = document.getElementById('apiKeyInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('clearHistory').addEventListener('click', () => {
    if (confirm('Clear all price history? This cannot be undone.')) {
      history = {};
      saveHistory();
      generateCards();
      alert('History cleared.');
    }
  });

  if (!config.apiKey) {
    document.getElementById('noApiAlert').hidden = false;
    // Auto-open settings on first visit
    setTimeout(openSettings, 300);
  } else {
    startAutoRefresh();
    refreshData();
  }
}

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.warn);
  });
}

document.addEventListener('DOMContentLoaded', init);
