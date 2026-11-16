# Audit trail burst verification — 15 November 2026

Executed the existing `tests/load/booking-burst.js` against Next.js dev and local Supabase, `QUEUE_DRIVER=db`, using 5,000 requests and 250 in flight. k6 ran in Docker via `host.docker.internal`; API used mock LINE verification. This is test traffic only; no LINE messages were sent.

All 5,000 POSTs returned 202; final DB state was one confirmed booking, 4,999 `TABLE_UNAVAILABLE` rejections, and one active allocation. Each request produced a received event and a terminal decision event. Full venue hash verification passed. See `db-result.txt`, `k6-summary.json`, `k6-console.txt`, and `run-info.txt`.

Final run `audit20261115b`: POST median 2.764 s; p95 3.070 s. Historical `../db/k6-summary.json` has median 3.448 s and p95 4.405 s (30.3% lower p95 in this final run). Request count and concurrency match. Dates, application builds, Docker networking, warm-up, and machine activity differ; this is historical comparison, not an isolated measurement of hash-chain overhead. No p95 regression threshold was specified by the plan or load script. Re-measure on the target deployment before capacity decisions.

The earlier run `audit20261115a`, concurrent with browser verification and before final receipt-reference binding, is retained in `run-a/` (p95 5.379 s). It also accepted all 5,000 requests and produced one active allocation with a valid chain. The second run used a freshly reset database and the final SQL definitions, with no browser activity. Screenshots document the earlier browser workflow and its receipt codes.

The hash chain detects modified rows and internal gaps relative to retained data; it does not independently prove an administrator has not rewritten or truncated the entire history. Archive verification checkpoints or exports externally for that threat model.
