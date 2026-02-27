# 💰 Golden-Price

A **Progressive Web App (PWA)** for real-time financial data including gold, silver, crude oil, exchange rates, US stocks, Shanghai Composite, and Hang Seng — powered by the **Brave Search API**.

Key features:
- 🥇 **Gold, Silver, Crude Oil** spot prices
- 💵 **USD/CNY, EUR/USD, GBP/USD** exchange rates
- 📈 **S&P 500, Dow Jones, NASDAQ** US indices
- 🐉 **Shanghai Composite (SSE)** and 🌸 **Hang Seng (HSI)** Asian indices
- 🇨🇳 Automatic **gold price in CNY/gram** conversion
- 📊 **Trend sparklines** on every card + full interactive chart on tap
- ⚙️ **Configurable Brave API key** — stored locally, never sent elsewhere
- ⏱️ Configurable **auto-refresh** interval (5 min → 1 hr)
- 📱 **Installable PWA** — works offline (serves cached UI)
- 🌙 Dark gold theme, responsive grid layout, rounded cards

---

## Quick Start

### Prerequisites
- Node.js ≥ 18
- A free [Brave Search API key](https://api.search.brave.com)

### Installation

```bash
git clone https://github.com/su600/Golden-Price.git
cd Golden-Price
npm install
npm start
```

Open **http://localhost:3000** in your browser.

On first launch the settings panel opens automatically — paste your Brave API key and tap **Save**.

### Install as PWA (Mobile)

1. Open `http://<your-server>:3000` in Chrome/Safari on your phone.
2. Chrome → "Add to Home screen"; Safari → Share → "Add to Home Screen".

---

## Architecture

```
Golden-Price/
├── server.js          # Express server — proxies Brave API (solves CORS)
├── package.json
└── public/
    ├── index.html     # App shell
    ├── styles.css     # Dark gold theme
    ├── app.js         # Data fetching, parsing, charts, history
    ├── manifest.json  # PWA manifest
    ├── sw.js          # Service worker (offline caching)
    └── icons/
        └── icon.svg   # App icon
```

The browser talks only to `localhost:3000/api/search`.  
The Express server adds your Brave API key header and forwards to `api.search.brave.com`.  
**Your API key never leaves your own server.**

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | HTTP port   |

---

## Data Parsing

Financial prices are extracted from Brave Search result snippets using item-specific regex patterns with a valid-range guard.  
Historical data points (up to 48 per metric) are stored in `localStorage` for sparkline and trend charts.

