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
      <canvas class="card-sparkline" id="spark-${item.id}" aria-hidden="true"></canvas>
    `;

    card.addEventListener('click', () => openTrendChart(item.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openTrendChart(item.id); });

    grid.appendChild(card);
    initSparkline(item.id, item.accent);
  });
}

function initSparkline(id, accent) {
  const canvas = document.getElementById(`spark-${id}`);
  if (!canvas || typeof Chart === 'undefined') return;

  const ctx = canvas.getContext('2d');
  sparkCharts[id] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: accent,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        backgroundColor: `${accent}18`,
        tension: 0.4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      interaction: { mode: 'none' },
    },
  });
}

function updateSparkline(id) {
  const chart = sparkCharts[id];
  if (!chart) return;
  const pts = (history[id] || []).slice(-24);
  chart.data.labels   = pts.map((p) => p.t);
  chart.data.datasets[0].data = pts.map((p) => p.v);
  chart.update('none');
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
  const data = await searchBrave(item.query);
  const price  = extractPrice(data, item);
  const change = extractChange(data);
  return { price, change };
}

async function refreshData() {
  if (isRefreshing) return;
  if (!config.apiKey) {
    document.getElementById('noApiAlert').hidden = false;
    return;
  }

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
function openTrendChart(id) {
  const item = ITEMS.find((i) => i.id === id);
  if (!item) return;

  const pts = history[id] || [];
  document.getElementById('chartTitle').textContent = `${item.emoji} ${item.name} (${item.name_zh})`;

  const modal = document.getElementById('chartModal');
  modal.classList.add('open');

  // Meta info
  const meta = document.getElementById('chartMeta');
  meta.textContent = pts.length > 0
    ? `${pts.length} data points · ${fmtTime(pts[0].t)} – ${fmtTime(pts[pts.length - 1].t)}`
    : 'No history yet — refresh to collect data.';

  // Stats
  const statsEl = document.getElementById('chartStats');
  if (pts.length > 1) {
    const values = pts.map((p) => p.v);
    const minV   = Math.min(...values);
    const maxV   = Math.max(...values);
    const latest = values[values.length - 1];
    const first  = values[0];
    const change = ((latest - first) / first) * 100;
    statsEl.innerHTML = `
      <div class="stat-item">
        <div class="stat-label">Min</div>
        <div class="stat-value" style="color:#ff8a9b">${fmt(minV)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Max</div>
        <div class="stat-value" style="color:#00e676">${fmt(maxV)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Change</div>
        <div class="stat-value" style="color:${change >= 0 ? '#00e676' : '#ff8a9b'}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</div>
      </div>
    `;
  } else {
    statsEl.innerHTML = '';
  }

  // Destroy previous chart instance
  if (trendChart) { trendChart.destroy(); trendChart = null; }

  const canvas = document.getElementById('trendChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const gradient = canvas.getContext('2d').createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, `${item.accent}44`);
  gradient.addColorStop(1, `${item.accent}00`);

  trendChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: pts.map((p) => fmtTime(p.t)),
      datasets: [{
        label: `${item.name} (${item.unit})`,
        data: pts.map((p) => p.v),
        borderColor: item.accent,
        borderWidth: 2,
        pointRadius: pts.length > 12 ? 0 : 3,
        pointBackgroundColor: item.accent,
        fill: true,
        backgroundColor: gradient,
        tension: 0.4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(15,20,48,0.92)',
          borderColor: item.accent,
          borderWidth: 1,
          titleColor: '#b0b8d0',
          bodyColor: '#f0f0f0',
          callbacks: {
            label: (ctx) => ` ${fmt(ctx.parsed.y)} ${item.unit}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#4a5268', maxTicksLimit: 6, font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          ticks: { color: '#4a5268', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
      },
    },
  });
}

function closeTrendChart() {
  document.getElementById('chartModal').classList.remove('open');
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
