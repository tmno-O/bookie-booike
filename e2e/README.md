# Bookie Bookie Playwright tests

Run customer and admin flows in Chromium against a disposable mock database. Each step records a screenshot. Use the [test evidence guide](../docs/evidence/README.md) for the latest verified CI baseline and presentation examples.

## Setup

From the repository root:

```bash
npm ci
python -m pip install -r e2e/requirements.txt
python -m playwright install chromium
```

## Run

```bash
python e2e/run_tests.py --start-server
python e2e/run_tests.py --start-server --headed
python e2e/run_tests.py --start-server --headed --slow 400
```

`--start-server` launches a mock dev server on port 3100 with an isolated database. Use `--base-url http://localhost:3115` to select a different port. When pointed to a running server, the suite resets that server's mock DB at the start and end. Use an instance dedicated to testing.

To use the same production build as CI, set `MOCK_API=1` and `NEXT_PUBLIC_API_MODE=mock` in the shell, then run:

```bash
npm run build
python e2e/run_tests.py --start-server --production
```

## Coverage

- Root redirect, legacy booking redirects, and customer and admin page titles.
- Mock LINE login, FCFS booking, booking reference, and active-booking banner.
- Opening countdown, automatic availability, cancellation, and a fresh booking for the same night.
- Admin list and search, check-in, staff booking and cancellation, queue allocation, zone management, standard hours, special opening, and updating the slug, QR, and clipboard link.

## Results

Each run saves screenshots, `report.md`, and `results.json` under `e2e/YYYY-MM-DD_HH-MM-SS/`. GitHub Actions uploads the folder as `playwright-report`. A failing step has a `-FAILED.png` screenshot. The script exits with code 1 when a step fails.
