const express = require('express');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const { parseStandingsFromHtml, parseAllStandingsFromHtml } = require('./lib/standings');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Helper: make an HTTPS GET request, returns a Promise ────
// Automatically decompresses gzip / deflate / br responses.
// Rejects if the accumulated payload exceeds MAX_RESPONSE_BYTES (10 MB).
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

function httpsGet(options, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn) => { if (!done) { done = true; fn(); } };
    const req = https.request(options, (res) => {
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      res.on('error', (e) => finish(() => reject(e)));
      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress());
      }
      const chunks = [];
      let totalBytes = 0;
      stream.on('data', (c) => {
        totalBytes += c.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          req.destroy();
          finish(() => reject(new Error('Response too large')));
          return;
        }
        chunks.push(c);
      });
      stream.on('end', () => finish(() => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') })));
      stream.on('error', (e) => finish(() => reject(e)));
    });
    req.on('error', (e) => finish(() => reject(e)));
    req.setTimeout(timeoutMs, () => { req.destroy(); finish(() => reject(new Error('timeout'))); });
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

// ── GoldPrice.org proxy — real-time spot gold & silver prices ──
// GET /api/goldprice — returns { xauPrice, xagPrice, pcXau, pcXag, chgXau, chgXag }
app.get('/api/goldprice', async (req, res) => {
  const options = {
    hostname: 'data-asg.goldprice.org',
    path: '/dbXRates/USD',
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://goldprice.org',
      'Referer': 'https://goldprice.org/',
    },
  };
  const start = Date.now();
  try {
    const { status, body } = await httpsGet(options, 15000);
    console.log(`[goldprice] Status: ${status} | ${Date.now() - start}ms`);
    try {
      const parsed = JSON.parse(body);
      const entry = parsed?.items?.[0];
      if (!entry) return res.status(502).json({ error: 'No data in goldprice.org response' });
      res.json({
        xauPrice: entry.xauPrice,
        xagPrice: entry.xagPrice,
        chgXau:   entry.chgXau,
        chgXag:   entry.chgXag,
        pcXau:    entry.pcXau,
        pcXag:    entry.pcXag,
        ts:       parsed.ts,
      });
    } catch (parseErr) {
      console.warn(`[goldprice] JSON parse error: ${parseErr.message}`);
      res.status(502).json({ error: 'Invalid JSON from goldprice.org' });
    }
  } catch (err) {
    console.error(`[goldprice] error: ${err.message}`);
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

// ── Football Standings proxy (懂球帝 / Dongqiudi) ─────────────
// GET /api/standings/:league  (laliga | premierleague | ucl)
// The page at m.dongqiudi.com/statTC/{tabId}/rankingTeam returns HTML that
// embeds window.__INITIAL_STATE__ JSON; we parse league standings from that.
const STANDINGS_LEAGUE_MAP = {
  premierleague: '1',  // 英超
  laliga:        '3',  // 西甲
  ucl:           '5',  // 欧冠
};

app.get('/api/standings/:league', async (req, res) => {
  const leagueId = STANDINGS_LEAGUE_MAP[req.params.league];
  if (!leagueId) return res.status(400).json({ error: 'Unknown league. Use: laliga, premierleague, ucl' });

  const options = {
    hostname: 'm.dongqiudi.com',
    path: `/statTC/${leagueId}/rankingTeam`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': 'https://m.dongqiudi.com/',
    },
  };

  const start = Date.now();
  try {
    const { status, body } = await httpsGet(options, 15000);
    console.log(`[standings/${req.params.league}] Status: ${status} | ${Date.now() - start}ms`);

    const allGroups = parseAllStandingsFromHtml(body);
    if (!allGroups.length) {
      console.error(`[standings/${req.params.league}] No standings data – body snippet: ${JSON.stringify(body.slice(0, 200))}`);
      return res.status(502).json({ error: 'No standings data found in dongqiudi response' });
    }

    const mapEntry = (entry) => {
      const gf = parseInt(entry.goals_pro, 10) || 0;
      const ga = parseInt(entry.goals_against, 10) || 0;
      return {
        pos:    parseInt(entry.rank, 10)          || 0,
        team:   entry.team_name                   || '',
        logo:   entry.team_logo                   || '',
        pts:    parseInt(entry.points, 10)        || 0,
        wins:   parseInt(entry.matches_won, 10)   || 0,
        draws:  parseInt(entry.matches_draw, 10)  || 0,
        losses: parseInt(entry.matches_lost, 10)  || 0,
        played: parseInt(entry.matches_total, 10) || 0,
        gd:     gf - ga,
      };
    };

    const groups = allGroups.map((g) => ({
      group:     g.group,
      standings: g.data.map(mapEntry).sort((a, b) => a.pos - b.pos || b.pts - a.pts),
    }));

    // Provide a flat standings list for backward compatibility
    const standings = groups.length === 1
      ? groups[0].standings
      : groups.flatMap((g) => g.standings);

    res.json({ standings, groups });
  } catch (err) {
    console.error(`[standings/${req.params.league}] error: ${err.message}`);
    res.status(504).json({ error: err.message === 'timeout' ? 'Request timed out' : `Request failed: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`\n  💰 Gold-Price server running at http://localhost:${PORT}\n`);
});
