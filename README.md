# VendorWatch

VendorWatch is a vendor risk monitoring platform that tracks changes to vendor websites, extracts structured data from terms of service and privacy policies, and surfaces liabilities and risk findings in a structured dashboard.

## Features

- Add vendors by website URL and monitor them on a schedule
- Scrape vendor sites using Firecrawl and extract content
- Extract structured data (pricing, liability, compliance, SLA, etc.) from terms and policy documents using Reducto
- Two research modes: Basic (rule-based) and Deep (AI-powered insights)
- Risk alerts grouped by Legal, Data and Security, Financial, and Operational categories
- Email alerts for configurable severities (low, medium, high)
- Export vendor snapshot data as JSON, CSV, or Markdown
- Light and dark mode UI

## Prerequisites

- Node.js 18+
- MongoDB (MongoDB Atlas recommended)
- API keys for Firecrawl, Resend, Reducto, and optionally Anthropic (for Deep research mode)

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and configure:

```bash
cp .env.local.example .env.local
```

Required variables:

| Variable | Description |
|----------|-------------|
| MONGODB_URI | MongoDB connection string |
| FIRECRAWL_API_KEY | Firecrawl API key from firecrawl.dev |
| RESEND_API_KEY | Resend API key for email alerts |
| ALERT_EMAIL | Email address for risk alerts |
| REDUCTO_API_KEY | Reducto API key for document extraction |

Optional variables:

| Variable | Description |
|----------|-------------|
| ANTHROPIC_API_KEY | Anthropic API key for Deep research mode (falls back to rule-based when not set) |
| ALERT_SEVERITIES | Comma-separated severities that trigger email (default: medium,high) |
| CRON_SECRET | Secret for cron endpoint authentication |
| VENDORWATCH_PLAN | Plan tier: basic (5 sites), premium (15), enterprise (500) |

## Development

```bash
npm run dev
```

Open http://localhost:3000

## Production

```bash
npm run build
npm start
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/vendors | List vendors |
| POST | /api/vendors | Create vendor |
| DELETE | /api/vendors/[id] | Delete vendor |
| GET | /api/snapshots | List snapshots (optionally by vendorId) |
| GET | /api/snapshots/[vendorId]/latest | Latest snapshot for download |
| GET | /api/risk-events | List risk events |
| POST | /api/run-monitor | Trigger monitoring cycle |
| POST | /api/run-monitor-stream | Streaming monitor with progress |
| POST | /api/cron/run-monitor | Cron endpoint (requires CRON_SECRET when set) |
| GET/POST | /api/alert-preferences | Get or set alert severity preferences |
| POST | /api/alert-test | Send test email |

## Scheduled Monitoring

The cron endpoint runs hourly by default (Vercel Cron). Configure CRON_SECRET in production and pass it via Authorization header, x-cron-secret header, or ?secret= query param.

## License

Proprietary.
