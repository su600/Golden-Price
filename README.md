# 💰 Golden-Price

A **Progressive Web App (PWA)** for real-time financial data including gold, silver, crude oil, exchange rates, US stocks, Shanghai Composite, and Hang Seng — powered by the **Brave Search API**.

Key features:
- 🥇 **Gold, Silver, Crude Oil** spot prices
- 💵 **USD/CNY, EUR/USD, GBP/USD** exchange rates
- 📈 **S&P 500, Dow Jones, NASDAQ** US indices
- 🐉 **Shanghai Composite (SSE)** and 🌸 **Hang Seng (HSI)** Asian indices
- 🇨🇳 Automatic **gold price in CNY/gram** conversion
- 📊 **Trend sparklines** on every card + full interactive chart on tap
- 🧩 **Two-row card layout** with smooth horizontal scrolling for dense market overviews
- 📐 **Optimized trend chart sizing** for better readability on both mobile and desktop
- ⚙️ **Configurable Brave API key** — stored locally in `localStorage`, sent only to your own server (as a request header) which forwards it to the Brave API; never placed in URLs or server logs
- ⏱️ Configurable **auto-refresh** interval (5 min → 1 hr)
- 📱 **Installable PWA** — works offline (serves cached UI)
- 🎨 **Premium light UI** with responsive spacing, polished cards, and mobile/PC adaptive styling

---

## Quick Start

### Prerequisites
- Node.js ≥ 18
- A free [Brave Search API key](https://api.search.brave.com)
- 科学上网

### Installation

```bash
git clone https://github.com/su600/Golden-Price.git
cd Golden-Price
npm install
npm start
```

Open **http://localhost:3000** in your browser.

On first launch the settings panel opens automatically — paste your Brave API key and tap **Save**.

### Docker 部署

**前提条件：** 已安装 [Docker](https://docs.docker.com/get-docker/)

**构建镜像**

```bash
docker build -t golden-price .
```

**运行容器（映射到宿主机 7000 端口）**

```bash
docker run -d --name golden-price -p 7000:7000 golden-price
```

访问 **http://localhost:7000** 即可打开应用。

**常用命令**

```bash
# 查看容器状态
docker ps

# 查看日志
docker logs -f golden-price

# 停止容器
docker stop golden-price

# 删除容器
docker rm golden-price
```

> 镜像基于 `node:18-alpine`，体积约 60–70 MB，无多余依赖。

### Install as PWA (Mobile)

1. Open `http://<your-server>:7000` in Chrome/Safari on your phone.
2. Chrome → "Add to Home screen"; Safari → Share → "Add to Home Screen".

---

## Architecture

```
Golden-Price/
├── server.js          # Express server — proxies Brave API (solves CORS)
├── package.json
└── public/
    ├── index.html     # App shell
    ├── styles.css     # Responsive premium light theme (mobile + desktop)
    ├── app.js         # Data fetching, parsing, charts, history
    ├── manifest.json  # PWA manifest
    ├── sw.js          # Service worker (offline caching)
    └── icons/
        └── icon.svg   # App icon
```

The browser talks only to the server's `/api/search`.  
In local development this is `http://localhost:3000/api/search`; when deployed via Docker it becomes `http://localhost:7000/api/search`.  
The Express server reads your Brave API key from the `X-Api-Key` request header and forwards it to `api.search.brave.com` as the `X-Subscription-Token` header.  
**Your API key is never placed in URLs or server logs.**

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | HTTP port for local development; the Dockerfile overrides this to `7000` |

---

## Data Parsing

Financial prices are extracted from Brave Search result snippets using item-specific regex patterns with a valid-range guard.  
Historical data points (up to 48 per metric) are stored in `localStorage` for sparkline and trend charts.

---

## UI Notes (Latest)

- Cards are displayed in a **fixed two-row layout** and scroll horizontally when needed.
- The trend chart modal uses a **responsive container** (`clamp`-based height) for balanced chart proportions.
- The page is tuned for **mobile and desktop** with breakpoint-based spacing, typography, and card widths.
- Visual polish includes a soft gradient background, glass-like sticky header, and refined hover/focus states.

