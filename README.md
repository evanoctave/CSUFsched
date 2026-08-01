# CSUFsched
csuf schedule builder

## Running it

```sh
docker compose up --build          # postgres + migrations + api on :3001 + web on :8080
docker compose run --rm scrape-full   # ~1.5h, populates the catalog
RMP_SCHOOL_ID=... docker compose run --rm scrape-rmp
```

The database starts empty and the migrations only create the schema, so the app has nothing
to show until the full scrape finishes. Run `scrape-rmp` after it, not before — it reads the
professor names the catalog scrape wrote.

`VITE_API_URL` is inlined into the frontend bundle at image build time, so pointing the web
container at a different backend means rebuilding it, not restarting it. It must agree with
the API's `CORS_ORIGIN` or the browser drops every response.

## Tests

```sh
pnpm -r typecheck
TEST_DATABASE_URL=postgres://localhost/csufsched_test pnpm -r test
pnpm --filter @csufsched/web test:e2e
```

Integration tests skip themselves when `TEST_DATABASE_URL` is unset, so a run without it
passes while never exercising the pruning and deletion paths. Each of those files migrates
into a scratch schema of its own, so they are safe to point at a scratch database and safe
to run concurrently. CI always sets the variable.

## Scraper operations

Environment: `DATABASE_URL` (required), `CSUF_BASE_URL` (defaults to the public Class Search
URL), `RATE_LIMIT_MS` (default 1000), `SANITY_MIN_RATIO` (default 0.9), `TERM_CODES`
(optional comma-separated filter for the full run), `TERM_CODE` (required for the status
refresh). Both term variables are checked against the live catalog and reject an unknown or
empty code rather than silently scraping nothing.

Both jobs exit nonzero when anything went wrong, so cron mails the operator. Read the JSON
summary on stdout to tell the failure modes apart:

- **`abortedBySanityGate`** — the term saw far fewer sections than the database already holds,
  so nothing was written at all. Usually CSUF changed its markup; re-record the fixtures.
- **`pruned: false`** — the full scrape lost rows to an error, so it refreshed everything it
  saw but deleted nothing. Pruning is the only step that removes a section, and a section
  deleted today comes back tomorrow with a new id, breaking every share link that named it.
  A scrape with gaps cannot tell "cancelled" from "never seen", so it declines to guess.
- **`coursesMissingUnits`** — the detail page failed twice for these courses and their
  sections were dropped from this run.

The status refresh writes nothing but `enrollment_status`, so a partial pass still applies
what it observed. It refuses to run against a term the full scrape has not built yet.

```cron
# nightly full catalog scrape (~1.5h at 1 req/s)
15 3 * * * cd /srv/csufsched && DATABASE_URL=... npx pnpm --filter @csufsched/scraper-csuf scrape:full

# hourly open/closed refresh for the current term (~9 min), skipping the nightly window so
# the two jobs never contend for row locks on the same term
20 0-2,6-23 * * * cd /srv/csufsched && DATABASE_URL=... TERM_CODE=2267 npx pnpm --filter @csufsched/scraper-csuf scrape:status
```

Re-record test fixtures after a CSUF markup change:
`npx pnpm --filter @csufsched/scraper-csuf record-fixtures`
