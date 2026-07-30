# Plan 5 Scraper Safety Hardening Design

**Date:** 2026-07-30  
**Status:** Approved  
**Extends:** `2026-07-28-csuf-scraper-design.md`

## Goal

Make every scraper write fail closed. A partial PeopleSoft response, parser defect, expired
session, or invalid operator input must never prune valid catalog data or report success.
Preserve Plan 5's transactional replacement, stable section ids, live HTML transport, and
hourly status refresh.

## Full-Scrape Completion Policy

The scraper continues every subject and career search for diagnostics. Each term tracks four
failure sources:

- failed searches;
- HTML result rows skipped by `parseResultRows`;
- failed detail/unit fetches;
- rows skipped by `parseClassRows`.

Any failure marks that term incomplete. An incomplete term is never passed to `persistTerm`,
regardless of existing section count. Its summary has `abortedByErrors: true`,
`persisted: null`, and makes the overall summary return `ok: false`.
`abortedBySanityGate` remains separate so operators can distinguish incomplete input from a
complete but unexpectedly small catalog.

A complete term still uses the existing ratio gate and transactional upsert-and-prune.
First-run terms may bypass only the ratio comparison; they never bypass completeness checks.

## Status-Refresh Completion Policy

Status refresh collects valid updates in a map keyed by class number. Duplicate observations
with the same status collapse into one update and count once toward the sanity ratio.
Conflicting statuses for one class number are reported as row errors.

Any failed search, skipped HTML row, invalid status, or conflicting duplicate makes the pass
incomplete. Incomplete passes call no update function and return `ok: false`. Complete passes
gate on the number of unique valid class numbers, then apply one update per class number.

## Catalog and Runtime Validation

Runtime parsing moves into a pure, tested module:

- `RATE_LIMIT_MS` must be finite and at least zero;
- `SANITY_MIN_RATIO` must be finite, greater than zero, and at most one;
- comma-separated term codes are trimmed, empty values removed, and duplicates collapsed.

Full runs reject catalogs with no terms, subjects, or careers. Every requested term code must
exist in the live catalog; an unmatched filter is an error, not a zero-work success.

Status mode requires its term code to exist in both the live catalog and the database. It no
longer upserts an arbitrary term before reading statuses. Missing or mistyped terms fail before
any write.

## Session-Expiry Recovery

PeopleSoft actions after the initial search depend on page state. Reopening a session and
blindly replaying `#ICSave`, detail, back, or new-search actions is invalid.

The session exposes a monotonically increasing generation. When a POST response says the
session expired, the session reopens to a fresh entry page, increments its generation, and
throws a typed reset error instead of replaying the action.

The searcher owns recovery:

1. Capture current generation.
2. If previous results require `NEW_SEARCH`, send it only when generation is unchanged.
3. Run the whole search flow.
4. If a typed reset error occurs, retry the whole search once from the fresh entry page.
5. Propagate a second reset error.

Detail fetches do not retry themselves. A reset during detail or back marks the term
incomplete. On the next search, generation mismatch proves the session is already on a fresh
entry page, so `NEW_SEARCH` is skipped.

## Multiple Meeting Patterns

PeopleSoft may render multiple day/time and room values in one result row separated by
`<br>`. The HTML parser splits those cells into patterns and emits one `RawClassRow` per
meeting pattern, preserving shared class metadata and PeopleSoft row index.

A single room value may apply to every time pattern. Otherwise room and time pattern counts
must match. A mismatch is a row parse error, which makes the term incomplete. Downstream
`parseClassRows` already merges repeated class numbers into one section and appends each
meeting.

A representative recorded fixture must cover one section with multiple meeting patterns.

## Error Reporting

Existing detailed error arrays remain operator-facing evidence. New abort flags make write
decisions explicit:

- full term: `abortedByErrors` versus `abortedBySanityGate`;
- status pass: incomplete input returns `ok: false` without calling `applyUpdates`.

CLI exits nonzero whenever orchestration reports incomplete input, invalid configuration, or
invalid term selection.

## Testing

Regression tests must prove behavior, not only summary text:

- each full-scrape failure source causes zero persistence;
- first-run empty databases do not bypass completeness checks;
- status duplicates count once and generate one update;
- conflicting or invalid status rows cause zero updates;
- empty catalog dimensions and unknown term filters fail;
- runtime numeric and term-list parsing rejects malformed input;
- status mode does not create a missing term;
- expiry during search, warning continuation, detail, back, and reset preserves a valid
  navigation state or fails closed;
- multiple meeting patterns become one section with multiple meetings;
- database integration still proves rollback, pruning, and stable section ids.

Final verification:

1. Workspace typecheck and default tests.
2. Full suite with `TEST_DATABASE_URL`.
3. Live CSUF smoke test.
4. Full Fall 2026 scrape into a scratch database, repeated once.
5. Compare section count and `(id, class_nbr)` pairs across runs.
6. Verify a share link created before the second run still resolves through local API/web app.

## Non-Goals

- Partition-scoped pruning.
- Best-effort writes from incomplete terms.
- Automatic detail-navigation reconstruction after expiry.
- Schema changes.
