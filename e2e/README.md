# e2e — Bookie Lyon automated UI test

Drives a real Chromium browser with Playwright (Python), clicks through the customer booking flow
and the admin pages like a macro, and saves a screenshot of every step.

## Setup (once)
```bash
cd e2e
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium
```

## Before you run
1. Start the app (mock backend) from the repo root:
   ```bash
   npm run dev -- --port 3100
   ```
   Or let the script start it for you with `--start-server`.

## Run
```bash
cd e2e
.venv/bin/python run_tests.py              # headless (no window)
.venv/bin/python run_tests.py --headed     # watch the browser
.venv/bin/python run_tests.py --headed --slow 400   # slower, easier to follow
.venv/bin/python run_tests.py --start-server        # start `npm run dev` if nothing is running
.venv/bin/python run_tests.py --base-url http://localhost:3000
```

## Output
Every run creates a new folder named with the start time, next to the script:

```
e2e/2026-11-11_03-24-07/
  01-customer-open-login.png
  02-customer-login-line-account.png
  ...
  29-admin-logout.png
  report.md       # table of steps: PASS/FAIL, seconds, notes, screenshot name
  results.json    # same data for tools
```
A failing step is saved as `NN-<flow>-<step>-FAILED.png` and the rest of that flow is skipped.
The exit code is 0 when everything passes and 1 otherwise.

## What it covers (29 steps)
- **Customer (390×844 phone):** mock LINE login → booker details → pick night, party and zone →
  confirmation (reads the booking reference) → my bookings.
- **Admin (1440×900):** redirect to login → owner login → dashboard shows the customer's booking → pending filter →
  booking list and search → details and check-in → add booking → queue and zone allocation → zones (add) →
  open times (edit dialog) → settings and team → logout.

## Notes
- The run resets the mock database first and again at the end, so it always starts from the same seed data.
- Needs Python 3 and the packages in `requirements.txt` (already installed in `.venv`). To set up elsewhere:
  `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium`
- Text locators use the Thai labels in the app, so a renamed button needs a one-line change in `run_tests.py`.
