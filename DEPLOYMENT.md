# VendorWatch Deployment

## Environment Variables

Set these in your hosting platform:

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `FIRECRAWL_API_KEY` | Yes | From firecrawl.dev |
| `REDUCTO_API_KEY` | Yes | From reducto.ai — document extraction |
| `ANTHROPIC_API_KEY` | Yes | Claude for risk analysis |
| `RESEND_API_KEY` | Yes | From resend.com |
| `ALERT_EMAIL` | Yes | Email to receive risk alerts |
| `CRON_SECRET` | Recommended | Secret for cron endpoint (set in prod) |

## Hosting Options

### Vercel

1. Deploy: `vercel` or connect GitHub
2. Add env vars in Project Settings
3. Cron: `vercel.json` is configured for hourly runs. Set `CRON_SECRET` and add it to the cron URL in Vercel dashboard: `/api/cron/run-monitor?secret=YOUR_CRON_SECRET`

### Railway / Render / Fly.io

1. Deploy the Next.js app
2. Add env vars
3. Use platform cron or external scheduler (e.g. cron-job.org) to call:

```
POST https://yourdomain.com/api/cron/run-monitor
Authorization: Bearer YOUR_CRON_SECRET
```

**Schedule:** Every hour (`0 * * * *`)

### External Cron (cron-job.org, etc.)

```
URL: https://yourdomain.com/api/cron/run-monitor
Method: POST
Header: Authorization: Bearer YOUR_CRON_SECRET
Schedule: Every hour
```

## Pipeline

```
Firecrawl → Scrape vendor sites
    ↓
Hash compare → Detect changes
    ↓
Reducto → Extract Terms/Policy PDFs (when linked)
    ↓
Claude → Risk analysis
    ↓
Resend → Email alerts (medium/high)
```
