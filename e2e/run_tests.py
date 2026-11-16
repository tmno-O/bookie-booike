#!/usr/bin/env python3
"""Automated UI test for Bookie Lyon (customer flow + admin pages).

Drives a real Chromium browser with Playwright, clicks through the app like a macro and
saves a screenshot of every step into a new timestamped folder next to this script:

    e2e/2026-11-11_14-30-05/01-customer-login.png ... report.md  results.json

Usage:
    .venv/bin/python run_tests.py                 # headless, app at http://localhost:3100
    .venv/bin/python run_tests.py --headed        # watch the browser
    .venv/bin/python run_tests.py --slow 400      # slow every action by 400 ms
    .venv/bin/python run_tests.py --start-server  # start `npm run dev` if nothing is listening

The app must be running with the mock backend (see docs/MOCK_TESTING.md in the repo).
The run resets the mock database first, so it always starts from the same seed data.
"""
from __future__ import annotations

import base64
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeout, expect, sync_playwright

HERE = Path(__file__).resolve().parent
DEFAULT_REPO = Path(os.environ.get("BOOKIE_REPO", HERE.parent))
SLUG = "bookie-demo"
TIMEOUT_MS = 20_000  # first visit to a page compiles it in `next dev`, so be generous


HIDE_DEV_BADGE = """
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = 'nextjs-portal { display: none !important; }';  /* Next.js dev-mode badge */
  document.head.appendChild(style);
});
"""


@dataclass
class Result:
    flow: str
    step: str
    status: str  # PASS | FAIL
    screenshot: str
    detail: str = ""
    seconds: float = 0.0


@dataclass
class Run:
    out_dir: Path
    results: list[Result] = field(default_factory=list)
    counter: int = 0

    def shot(self, page: Page, label: str) -> str:
        self.counter += 1
        name = f"{self.counter:02d}-{label}.png"
        path = self.out_dir / name
        try:
            page.bring_to_front()  # headed Chrome stalls screenshots of a background window
            page.screenshot(path=str(path), full_page=False, timeout=10000)
        except Exception:  # noqa: BLE001 - headed Chrome sometimes refuses; retry through CDP
            try:
                page.bring_to_front()
                cdp = page.context.new_cdp_session(page)
                data = cdp.send("Page.captureScreenshot", {"format": "png", "fromSurface": False})["data"]
                path.write_bytes(base64.b64decode(data))
            except Exception as error:  # noqa: BLE001 - never let a screenshot hide the real result
                print(f"    (screenshot failed: {str(error).splitlines()[0]})")
        return name


class Flow:
    """One browser flow. `step()` runs an action, takes a screenshot and records PASS/FAIL."""

    def __init__(self, run: Run, name: str, page: Page):
        self.run, self.name, self.page = run, name, page
        page.bring_to_front()
        time.sleep(1)
        self.failed = False

    def step(self, label: str, action, detail: str = "") -> bool:
        if self.failed:  # a broken step makes the rest of the flow meaningless
            return False
        started = time.time()
        status, message = "PASS", detail
        try:
            action()
        except (AssertionError, PlaywrightTimeout, Exception) as error:  # noqa: BLE001 - report everything
            lines = [ln.strip() for ln in str(error).splitlines() if ln.strip()]
            extra = next((ln for ln in lines if ln.startswith("Error:")), "")
            status, message = "FAIL", (" ".join([lines[0], extra]) if lines else type(error).__name__)[:300]
            self.failed = True
        shot = self.run.shot(self.page, f"{self.name}-{label}" if status == "PASS" else f"{self.name}-{label}-FAILED")
        self.run.results.append(Result(self.name, label, status, shot, message, round(time.time() - started, 2)))
        mark = "✓" if status == "PASS" else "✗"
        print(f"  {mark} [{self.name}] {label}" + (f"  — {message}" if message and status == "FAIL" else ""))
        return status == "PASS"


def api(base: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{base}/api/mock{path}", method="POST" if body is not None else "GET",
        data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read() or b"{}")


def server_up(base: str) -> bool:
    try:
        api(base, "/venue")
        return True
    except (urllib.error.URLError, OSError):
        return False


def ensure_server(base: str, start: bool, repo: Path) -> subprocess.Popen | None:
    if server_up(base):
        return None
    if not start:
        sys.exit(f"The app is not running at {base}.\nStart it with `npm run dev -- --port 3100` in {repo}, or re-run with --start-server.")
    port = base.rsplit(":", 1)[-1]
    print(f"Starting the app in {repo} on port {port} ...")
    process = subprocess.Popen(["npm", "run", "dev", "--", "--port", port], cwd=repo, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(90):
        if server_up(base):
            return process
        time.sleep(1)
    process.terminate()
    sys.exit("The app did not start within 90 seconds.")


# ----------------------------------------------------------------------------- customer flow
HEADED = False  # set in main(); a visible window is sized by the OS, not by emulation


def view(width: int, height: int, scale: int, real_window: bool = False) -> dict:
    """Context options. Headed: use the real window size (no emulation), which stops the screen resizing/flickering."""
    if HEADED and real_window:  # Chrome cannot make a window narrower than ~500px, so phone size stays emulated
        return {"no_viewport": True, "locale": "th-TH"}
    return {"viewport": {"width": width, "height": height}, "device_scale_factor": scale, "locale": "th-TH"}


def open_browser(p, args, width: int, height: int):
    return p.chromium.launch(
        channel="chrome" if args.chrome else None,
        headless=not HEADED,
        slow_mo=args.slow,
        args=[f"--window-size={width},{height + 90}", "--window-position=40,40"] if HEADED and width > 500 else [],
    )


def warm_up(base: str) -> None:
    """Compile every page once so Next dev does not hot-reload the page under the browser mid-test."""
    paths = ["/book/bookie-demo/login", "/book/bookie-demo/details", "/book/bookie-demo/select",
             "/book/demo/confirmed", "/book/demo/bookings", "/admin", "/admin/login", "/admin/queue", "/admin/zones",
             "/admin/hours", "/admin/settings", "/admin/bookings", "/admin/bookings/new"]
    for path in paths:
        try:
            urllib.request.urlopen(base + path, timeout=60).read()
        except Exception:  # noqa: BLE001 - redirects/401s are fine, we only want compilation
            pass


def customer_flow(run: Run, browser: Browser, base: str, slow: int) -> dict:
    context: BrowserContext = browser.new_context(**view(390, 844, 2))
    context.set_default_timeout(TIMEOUT_MS)
    context.add_init_script(HIDE_DEV_BADGE)
    page = context.new_page()
    flow = Flow(run, "customer", page)
    shared: dict = {}
    book = f"{base}/book/{SLUG}"

    flow.step("open-login", lambda: (page.goto(f"{book}/login"), expect(page.get_by_role("heading", name="เข้าสู่ระบบด้วย LINE")).to_be_visible()))
    flow.step("login-line-account", lambda: (
        page.get_by_role("button", name=re.compile("พี่แมว")).click(),
        page.wait_for_url(re.compile(r"/details$")),
        expect(page.locator("#name")).to_have_value("พี่แมว"),
    ), "mock LINE account 'พี่แมว'")

    def fill_details():
        page.locator("#phone").fill("0855555555")
        page.get_by_role("button", name="ดำเนินการต่อ").click()
        page.wait_for_url(re.compile(r"/select$"))

    flow.step("details", fill_details)

    def compatible_links():
        for old in ("waiting", "queue"):
            page.goto(f"{book}/{old}")
            expect(page).to_have_url(f"{book}/select")
        expect(page.get_by_role("button", name="Indoor", exact=True)).to_be_enabled()

    flow.step("select-open", compatible_links)

    def choose():
        page.get_by_role("button", name="5–8", exact=True).click()
        page.get_by_role("button", name="Indoor", exact=True).click()
        expect(page.get_by_role("button", name="ยืนยันการจอง")).to_be_enabled()

    flow.step("select-party-and-zone", choose, "party 5–8, zone Indoor")

    def confirm():
        page.get_by_role("button", name="ยืนยันการจอง").click()
        page.wait_for_url(re.compile(r"/confirmed\?b="))
        expect(page.get_by_role("heading", name="ยืนยันการจองแล้ว")).to_be_visible()
        reference = page.get_by_text(re.compile(r"BL-\d{4}-\d{4}")).first
        expect(reference).to_be_visible()
        shared["reference"] = reference.inner_text().strip()

    flow.step("confirmed", confirm)
    flow.run.results[-1].detail = flow.run.results[-1].detail or f"reference {shared.get('reference', '?')}"

    def my_bookings():
        page.get_by_role("link", name="ดูการจองของฉัน").click()
        page.wait_for_url(re.compile(r"/bookings$"))
        expect(page.get_by_text("Indoor")).to_be_visible()

    flow.step("my-bookings", my_bookings)

    # An existing booking blocks a fresh request before the customer selects a zone.
    def other_night():
        page.goto(f"{book}/details")
        expect(page.get_by_role("complementary", name="การจองเดิม")).to_be_visible()
        expect(page.get_by_role("button", name="ดำเนินการต่อ")).to_be_disabled()

    flow.step("duplicate-booking-blocked", other_night)
    context.close()
    return shared


# ----------------------------------------------------------------------------- admin flow
def admin_flow(run: Run, browser: Browser, base: str, reference: str) -> None:
    context = browser.new_context(**view(1440, 900, 1, real_window=True))
    context.set_default_timeout(TIMEOUT_MS)
    context.add_init_script(HIDE_DEV_BADGE)
    page = context.new_page()
    flow = Flow(run, "admin", page)
    nav = lambda name: page.get_by_role("navigation").get_by_role("link", name=name, exact=True)  # noqa: E731

    flow.step("redirect-to-login", lambda: (page.goto(f"{base}/admin"), page.wait_for_url(re.compile(r"/admin/login$"))), "not logged in → login page")
    flow.step("login-owner", lambda: (
        page.get_by_role("button", name=re.compile("owner@bookie.test")).click(),
        page.wait_for_url(re.compile(r"/admin$")),
        expect(page.get_by_role("heading", name="ภาพรวม")).to_be_visible(),
    ), "owner@bookie.test")

    flow.step("dashboard-shows-customer-booking", lambda: (
        expect(page.get_by_role("row", name=re.compile("พี่แมว"))).to_be_visible(),
        expect(page.get_by_text("การจองคืนนี้", exact=True)).to_be_visible(),
    ), "the booking made in the customer flow appears")
    flow.step("dashboard-filter-pending", lambda: (
        page.get_by_role("button", name="รอจัดสรร", exact=True).click(),
        expect(page.get_by_role("row", name=re.compile("คุณเมย์"))).to_be_visible(),
    ))

    def booking_list():
        nav("รายการจอง").click()
        page.wait_for_url(re.compile(r"/admin/bookings"))
        expect(page.get_by_role("heading", name=re.compile("การจอง \\d+ รายการ"))).to_be_visible()

    flow.step("booking-list", booking_list)
    flow.step("booking-list-search", lambda: (
        page.get_by_label("ค้นหาชื่อ เบอร์ หรือเลขจอง").fill(reference),
        expect(page.get_by_role("row", name=re.compile("พี่แมว"))).to_be_visible(),
        expect(page.get_by_role("heading", name="การจอง 1 รายการ")).to_be_visible(),
    ), f"search by reference {reference}")

    def open_details():
        page.get_by_role("row", name=re.compile("พี่แมว")).get_by_role("link", name=re.compile("ดูรายละเอียด")).click()
        expect(page.get_by_role("dialog")).to_be_visible()
        expect(page.get_by_role("dialog").get_by_text("ยืนยันแล้ว")).to_be_visible()

    flow.step("booking-details", open_details)

    def check_in():
        page.get_by_role("dialog").get_by_role("button", name="เช็กอิน", exact=True).click()
        expect(page.get_by_role("heading", name="เช็กอินเรียบร้อย")).to_be_visible()

    flow.step("check-in", check_in)
    flow.step("back-to-list", lambda: (
        page.get_by_role("button", name="กลับไปยังรายการ").click(),
        expect(page.get_by_role("row", name=re.compile("พี่แมว")).get_by_text("เช็กอินแล้ว")).to_be_visible(),
    ), "status is now เช็กอินแล้ว")

    def add_booking():
        page.get_by_role("link", name="+ เพิ่มการจอง").click()
        dialog = page.get_by_role("dialog")
        expect(dialog.get_by_role("heading", name="เพิ่มการจอง")).to_be_visible()
        dialog.get_by_label("ชื่อลูกค้า").fill("คุณทดสอบ")
        dialog.get_by_label("เบอร์โทร").fill("0861112222")
        dialog.get_by_role("button", name="ตรวจสอบข้อมูล").click()
        expect(dialog.get_by_role("heading", name="ตรวจสอบการจอง")).to_be_visible()

    flow.step("add-booking-review", add_booking)
    flow.step("add-booking-created", lambda: (
        page.get_by_role("dialog").get_by_role("button", name="ยืนยันการจอง").click(),
        expect(page.get_by_role("heading", name="สร้างการจองแล้ว")).to_be_visible(),
    ))
    flow.step("add-booking-close", lambda: (
        page.get_by_role("button", name="กลับไปยังรายการ").click(),
        expect(page.get_by_role("row", name=re.compile("คุณทดสอบ"))).to_be_visible(),
    ), "staff booking appears with channel จองโดยร้าน")

    def queue_page():
        nav("คิวการจอง").click()
        page.wait_for_url(re.compile(r"/admin/queue"))
        expect(page.get_by_role("row", name=re.compile("คุณเมย์"))).to_be_visible()

    flow.step("queue", queue_page)

    def allocate():
        page.get_by_role("row", name=re.compile("คุณเมย์")).get_by_role("link", name=re.compile("ดูรายละเอียด")).click()
        dialog = page.get_by_role("dialog")
        expect(dialog.get_by_role("heading", name=re.compile("รายละเอียดคำขอ"))).to_be_visible()
        dialog.get_by_role("button", name="จัดสรรโซน").click()
        expect(page.get_by_role("heading", name="จัดสรรโซนแล้ว")).to_be_visible()

    flow.step("queue-allocate-zone", allocate)
    flow.step("queue-after-allocate", lambda: (
        page.get_by_role("button", name="กลับไปยังรายการ").click(),
        expect(page.get_by_role("row", name=re.compile("คุณเมย์")).get_by_text("จัดสรรแล้ว")).to_be_visible(),
    ))

    flow.step("zones", lambda: (nav("โซนและความจุ").click(), expect(page.get_by_role("heading", name="โซนของร้าน")).to_be_visible()))

    def add_zone():
        page.get_by_role("button", name="+ เพิ่มโซน").click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("ชื่อโซน").fill("Rooftop")
        dialog.get_by_role("button", name="บันทึก").click()
        expect(page.get_by_role("status")).to_contain_text("เพิ่มโซน Rooftop แล้ว")

    flow.step("zones-add-rooftop", add_zone)

    flow.step("open-times", lambda: (nav("เวลาเปิดจอง").click(), expect(page.get_by_role("heading", name="เวลาเปิดรับจองมาตรฐาน")).to_be_visible()))

    def edit_standard():
        page.get_by_role("button", name="แก้ไขค่าเริ่มต้น").click()
        dialog = page.get_by_role("dialog")
        expect(dialog.get_by_role("heading", name="แก้ไขเวลามาตรฐาน")).to_be_visible()
        dialog.get_by_role("button", name="ยกเลิก").click()

    flow.step("open-times-edit-dialog", edit_standard, "dialog opened and cancelled (no change saved)")

    def settings():
        nav("ตั้งค่าร้าน").click()
        expect(page.get_by_role("heading", name="ตั้งค่าร้าน")).to_be_visible()
        page.get_by_role("button", name=re.compile("จัดการทีมและสิทธิ์")).click()
        expect(page.get_by_role("dialog").get_by_role("heading", name="ทีมและสิทธิ์")).to_be_visible()

    flow.step("settings-team", settings)
    flow.step("logout", lambda: (
        page.get_by_role("dialog").get_by_role("button", name="กลับ").click(),
        page.get_by_role("button", name="ออกจากระบบ").click(),
        page.wait_for_url(re.compile(r"/admin/login$")),
    ))
    context.close()


# ----------------------------------------------------------------------------- report
def write_report(run: Run, base: str, started: datetime, seconds: float) -> None:
    passed = sum(r.status == "PASS" for r in run.results)
    failed = len(run.results) - passed
    lines = [
        f"# Bookie Lyon UI test — {started:%Y-%m-%d %H:%M:%S}", "",
        f"- App: {base}", f"- Result: **{'PASS' if not failed else 'FAIL'}** ({passed} passed, {failed} failed)",
        f"- Duration: {seconds:.1f}s", "", "| # | Flow | Step | Result | Seconds | Notes | Screenshot |", "|---|---|---|---|---|---|---|",
    ]
    for i, r in enumerate(run.results, 1):
        lines.append(f"| {i} | {r.flow} | {r.step} | {r.status} | {r.seconds} | {r.detail.replace('|', '/')} | {r.screenshot} |")
    (run.out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (run.out_dir / "results.json").write_text(
        json.dumps({"app": base, "started": started.isoformat(), "passed": passed, "failed": failed,
                    "results": [asdict(r) for r in run.results]}, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Bookie Lyon automated UI test")
    parser.add_argument("--base-url", default="http://localhost:3100")
    parser.add_argument("--headed", action="store_true", help="show the browser window")
    parser.add_argument("--chrome", action="store_true", help="use the installed Google Chrome (implies --headed)")
    parser.add_argument("--slow", type=int, default=0, metavar="MS", help="slow down every action (ms)")
    parser.add_argument("--start-server", action="store_true", help="run `npm run dev` if the app is not running")
    parser.add_argument("--repo", type=Path, default=DEFAULT_REPO, help="app folder used by --start-server")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    server = ensure_server(base, args.start_server, args.repo)
    started = datetime.now()
    out_dir = HERE / started.strftime("%Y-%m-%d_%H-%M-%S")
    out_dir.mkdir(parents=True)
    run = Run(out_dir)
    print(f"Saving screenshots to {out_dir}")

    global HEADED
    HEADED = args.headed or args.chrome
    if args.chrome and args.slow == 0:
        args.slow = 900  # visible runs default to a calm pace
    api(base, "/reset", {})  # fresh seed data
    began = time.time()
    try:
        with sync_playwright() as p:
            customer_browser = open_browser(p, args, 390, 844)
            print("Customer flow")
            warm_up(base)
            shared = customer_flow(run, customer_browser, base, args.slow)
            customer_browser.close()
            admin_browser = open_browser(p, args, 1440, 900)
            print("Admin flow")
            admin_flow(run, admin_browser, base, shared.get("reference", ""))
            admin_browser.close()
    finally:
        try:
            api(base, "/reset", {})  # leave the app on clean seed data
        except OSError:
            pass
        write_report(run, base, started, time.time() - began)
        if server:
            server.terminate()

    failed = [r for r in run.results if r.status == "FAIL"]
    print(f"\n{len(run.results) - len(failed)} passed, {len(failed)} failed — report: {out_dir / 'report.md'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
