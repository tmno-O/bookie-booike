# Bookie Bookie backend development 3

> Historical implementation and verification record before PR #22. Current booking flow and test results are in the [project summary](PROJECT_SUMMARY.md) and [CI evidence](evidence/README.md).

## Starting point

Implementation started from `origin/main` commit `928a998`, which includes the new owner floor-plan editor and published customer zone picker. Next.js routes validate Zod contracts and session/tenant permissions, TypeScript services perform configuration/read operations, and Postgres functions own allocation, cancellation, ticket admission, and locking. Both database and optional SQS drivers call the same booking decision function. Existing uncommitted project exploration/summary documents were left out of feature commits.

## Delivered sequence

1. `feat/venue-closures`: versioned weekly opening rules, dated closures, impact previews, public date restrictions, queue-opening filtering, real/mock parity. PR #4.
2. `feat/customer-cancellation`: owner policy settings in hours/days, authoritative deadlines, customer confirmation dialogs, staff override, pending-allocation support, atomic table release, cancellation audit details. PR #5, based on #4.
3. `feat/release-announcements`: named releases, transactional past-booker audiences, opt-out, separate push outbox, bounded Cron drain, reusable LINE sender, customer banners and delivery counts. PR #6, based on #5.
4. `feat/booking-audit-trail`: received timestamps, per-venue hash chains, append-only guards, complete decision/ticket evidence, receipts, staff timelines and owner CSV export, backlog age, mock audit labeling.

## Verification

- Typecheck, ESLint, 94 unit tests, 37 integration tests, and production build passed at the final verification. Checks also ran before each feature commit.
- Docker Desktop and local Supabase were started. All migrations applied locally; integrations use local-only guards and disposable fixtures. No production database was migrated.
- 50 concurrent contenders: one confirmed, 49 rejected, one active allocation, complete decision evidence; 50 concurrent ticket inserts have distinct sequence numbers.
- Normal audit UPDATE/DELETE fail. Privileged simulated tampering identifies the first altered seq. Verification also passes after changing the session timezone.
- Staff audit APIs enforce venue access, mask phone numbers, match customer receipt codes, and deny staff CSV export. LINE delivery tested with mock HTTP, including retries and duplicate acceptance; no live LINE messages sent.
- Browser mock mode: audit is explicitly labeled simulated; audit verification, hours, cancellation settings, customer login and booking history render successfully.
- Browser real mode: owner closure disables that customer date; one-hour policy appears on receipt; customer cancellation succeeds with the receipt code unchanged; a named announcement targets two past bookers and appears in the customer banner; staff chain verification passes over 10,000 rows. Screenshots are retained under `evidence/audit/`.
- Two 5,000-request load runs passed. Final POST p95: 3.070 s; one active allocation and 10,000 hash-verified audit events. Historical comparison: [evidence/audit/README.md](evidence/audit/README.md).

## Deployment and evidence boundaries

This round introduced policy migrations with versions earlier than the floor-plan migration. For the current rollout and Cron checks, follow the [deployment guide](DEPLOY.md). The verification in this record used local services.

Hash verification proves consistency against retained chain data. A DB administrator can disable triggers and rewrite the entire chain or remove its tail; external checkpoints/exports are needed to detect that. Legacy timestamps and details cannot be reconstructed. Receipt short hashes support comparison with staff evidence, not identity verification. The build retains the pre-existing mock filesystem tracing warning.
