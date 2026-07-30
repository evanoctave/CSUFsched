# CSUFsched
csuf schedule builder

## Scraper operations

Environment: `DATABASE_URL` (required), `CSUF_BASE_URL` (defaults to the public Class Search
URL), `RATE_LIMIT_MS` (default 1000), `SANITY_MIN_RATIO` (default 0.9), `TERM_CODES`
(optional comma-separated filter for the full run), `TERM_CODE` (required for the status
refresh).

Both jobs exit nonzero when their sanity gate trips, so cron mails the operator.

```cron
# nightly full catalog scrape (~1.5h at 1 req/s)
15 3 * * * cd /srv/csufsched && DATABASE_URL=... npx pnpm --filter @csufsched/scraper-csuf scrape:full

# hourly open/closed refresh for the current term (~9 min)
20 * * * * cd /srv/csufsched && DATABASE_URL=... TERM_CODE=2267 npx pnpm --filter @csufsched/scraper-csuf scrape:status
```

Re-record test fixtures after a CSUF markup change:
`npx pnpm --filter @csufsched/scraper-csuf record-fixtures`
