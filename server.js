const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Proxy endpoint for Brave Search API — avoids CORS restrictions in the browser
app.get('/api/search', (req, res) => {
  const { q, count = '5' } = req.query;
  // API key must be provided via the X-Api-Key header
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

  const proxyReq = https.request(options, (proxyRes) => {
    let chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(body);
        res.status(proxyRes.statusCode).json(parsed);
      } catch (parseErr) {
        console.error('[proxy] JSON parse error:', parseErr.message, '| raw:', body.slice(0, 100));
        res.status(502).json({ error: 'Invalid JSON from Brave API' });
      }
    });
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: `Request failed: ${err.message}` });
  });

  proxyReq.setTimeout(15000, () => {
    proxyReq.destroy();
    res.status(504).json({ error: 'Request timed out' });
  });

  proxyReq.end();
});

app.listen(PORT, () => {
  console.log(`\n  💰 Golden-Price server running at http://localhost:${PORT}\n`);
});
