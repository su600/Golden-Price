const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Helper: make an HTTPS GET request, returns a Promise ────
function httpsGet(options, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── Sina Finance proxy — no API key, works in China ─────────
// GET /api/sina/quotes — returns { symbol: { price, changePct } }
const SINA_SYMBOLS = [
  'XAUUSD',      // Gold spot USD
  'XAGUSD',      // Silver spot USD
  'gb_cl',       // WTI Crude Oil
  'fx_susdcny',  // USD/CNY
  'fx_seurusd',  // EUR/USD
  'fx_sgbpusd',  // GBP/USD
  'gb_inx',      // S&P 500
  'gb_dji',      // Dow Jones
  'gb_ixic',     // NASDAQ
  'sh000001',    // Shanghai Composite
  'hkHSI',       // Hang Seng
];

// Parse a single Sina Finance line:  var hq_str_SYMBOL="f0,f1,...";
function parseSinaLine(symbol, fields) {
  if (!fields || fields.length < 4) return null;
  const sym = symbol.toLowerCase();
  let price = null, changePct = null;

  if (sym === 'xauusd' || sym === 'xagusd') {
    // "time,0,0,price,vol,bid,high,low,prevclose,name,..."
    price = parseFloat(fields[3]);
    const prev = parseFloat(fields[8]);
    if (!isNaN(prev) && prev !== 0) changePct = (price - prev) / prev * 100;
  } else if (sym.startsWith('fx_s')) {
    // "time,prev_bid,prev_ask,price,vol,bid,ask,low,ema,name,weekly,day_change,day_changePct,..."
    price = parseFloat(fields[3]);
    changePct = parseFloat(fields[12]);
  } else if (sym === 'sh000001') {
    // "name,open,prevclose,price,high,low,..."
    price = parseFloat(fields[3]);
    const prev = parseFloat(fields[2]);
    if (!isNaN(prev) && prev !== 0) changePct = (price - prev) / prev * 100;
  } else if (sym === 'hkhsi') {
    // "name_en,name_zh,price,prevclose,high,low,open,,change,changePct,..."
    price = parseFloat(fields[2]);
    changePct = parseFloat(fields[9]);
  } else {
    // gb_cl, gb_inx, gb_dji, gb_ixic: "name,price,changePct,datetime,change,..."
    price = parseFloat(fields[1]);
    changePct = parseFloat(fields[2]);
  }

  if (isNaN(price)) return null;
  return { price, changePct: isNaN(changePct) ? null : changePct };
}

app.get('/api/sina/quotes', async (req, res) => {
  const symbolList = SINA_SYMBOLS.join(',');
  const options = {
    hostname: 'hq.sinajs.cn',
    path: `/list=${symbolList}`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://finance.sina.com.cn/',
      'Accept': '*/*',
    },
  };

  const start = Date.now();
  try {
    const { status, body } = await httpsGet(options, 15000);
    console.log(`[sina] Status: ${status} | ${Date.now() - start}ms`);

    const result = {};
    // Each line: var hq_str_SYMBOL="f0,f1,...";
    const lineRe = /hq_str_(\w+)="([^"]*)"/g;
    let m;
    while ((m = lineRe.exec(body)) !== null) {
      const sym = m[1];
      const raw = m[2];
      if (!raw) continue;
      const fields = raw.split(',');
      const parsed = parseSinaLine(sym, fields);
      if (parsed) result[sym] = parsed;
    }
    res.json(result);
  } catch (err) {
    console.error(`[sina] error: ${err.message}`);
    res.status(504).json({ error: err.message === 'timeout' ? 'Request timed out' : `Request failed: ${err.message}` });
  }
});

// ── Connectivity ping ─────────────────────────────────────── 
// GET /api/ping?host=sina|yahoo|brave
app.get('/api/ping', async (req, res) => {
  const hostMap = {
    sina:  'hq.sinajs.cn',
    yahoo: 'query1.finance.yahoo.com',
    brave: 'api.search.brave.com',
  };
  const host = hostMap[req.query.host] || hostMap.sina;
  const options = {
    hostname: host,
    path: '/',
    method: 'HEAD',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn/' },
  };
  const start = Date.now();
  try {
    const { status } = await httpsGet(options, 8000);
    res.json({ host, reachable: true, status, ms: Date.now() - start });
  } catch (err) {
    res.json({ host, reachable: false, error: err.message, ms: Date.now() - start });
  }
});

// ── Yahoo Finance proxy (fallback, may be blocked in China) ──
// GET /api/quote/:symbol  e.g. /api/quote/GC%3DF
app.get('/api/quote/:symbol', async (req, res) => {
  const symbol = req.params.symbol;
  const options = {
    hostname: 'query1.finance.yahoo.com',
    path: `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
  const start = Date.now();
  try {
    const { status, body } = await httpsGet(options, 15000);
    console.log(`[yahoo] ${symbol} | Status: ${status} | ${Date.now() - start}ms`);
    try {
      const parsed = JSON.parse(body);
      res.status(status).json(parsed);
    } catch (_) {
      res.status(502).json({ error: 'Invalid JSON from Yahoo Finance' });
    }
  } catch (err) {
    console.error(`[yahoo] ${symbol} error: ${err.message}`);
    res.status(504).json({ error: err.message === 'timeout' ? 'Request timed out' : `Request failed: ${err.message}` });
  }
});

// ── Brave Search proxy ───────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { q, count = '5' } = req.query;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(400).json({ error: 'Missing API key. Provide it via the X-Api-Key request header.' });
  }
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter q' });
  }

  const params = new URLSearchParams({
    q,
    count: String(Math.min(parseInt(count, 10) || 5, 10)),
    search_lang: 'en',
    country: 'us',
    result_filter: 'web,infobox',
    extra_snippets: 'true',
  });

  const options = {
    hostname: 'api.search.brave.com',
    path: `/res/v1/web/search?${params.toString()}`,
    method: 'GET',
    headers: {
      'X-Subscription-Token': apiKey,
      Accept: 'application/json',
    },
  };

  const start = Date.now();
  try {
    const { status, body } = await httpsGet(options, 30000);
    console.log(`[brave] "${q}" | Status: ${status} | ${Date.now() - start}ms`);
    try {
      const parsed = JSON.parse(body);
      res.status(status).json(parsed);
    } catch (_) {
      res.status(502).json({ error: 'Invalid JSON from Brave API' });
    }
  } catch (err) {
    console.error(`[brave] "${q}" error: ${err.message}`);
    res.status(504).json({ error: err.message === 'timeout' ? 'Request timed out' : `Request failed: ${err.message}` });
  }
});

// ── Yahoo Finance historical data proxy ──────────────────────
// GET /api/history/:symbol?interval=5m&range=1d
app.get('/api/history/:symbol', async (req, res) => {
  const symbol   = req.params.symbol;
  const interval = req.query.interval || '5m';
  const range    = req.query.range    || '1d';
  const options = {
    hostname: 'query1.finance.yahoo.com',
    path: `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
  const start = Date.now();
  try {
    const { status, body } = await httpsGet(options, 20000);
    console.log(`[history] ${symbol} ${interval}/${range} | Status: ${status} | ${Date.now() - start}ms`);
    try {
      res.status(status).json(JSON.parse(body));
    } catch (parseErr) {
      console.error(`[history] ${symbol} JSON parse error: ${parseErr.message} | body snippet: ${body.slice(0, 120)}`);
      res.status(502).json({ error: 'Invalid JSON from Yahoo Finance' });
    }
  } catch (err) {
    console.error(`[history] ${symbol} error: ${err.message}`);
    res.status(504).json({ error: err.message === 'timeout' ? 'Request timed out' : `Request failed: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`\n  💰 Golden-Price server running at http://localhost:${PORT}\n`);
});
