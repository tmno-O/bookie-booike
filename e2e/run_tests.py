#!/usr/bin/env python3
"""Automated UI test for Bookie Bookie (customer flow + admin pages).

Drives a real Chromium browser with Playwright, clicks through the app like a macro and
saves a screenshot of every step into a new timestamped folder next to this script:

    e2e/2026-11-11_14-30-05/01-customer-login.png ... report.md  results.json

Usage:
    .venv/bin/python run_tests.py                 # headless, app at http://localhost:3100
    .venv/bin/python run_tests.py --headed        # watch the browser
    .venv/bin/python run_tests.py --slow 400      # slow every action by 400 ms
    .venv/bin/python run_tests.py --start-server               # start a mock dev server
    .venv/bin/python run_tests.py --start-server --production  # run a mock production build

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
from tempfile import TemporaryDirectory
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from html import unescape
from pathlib import Path
from urllib.parse import urlsplit

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


def ensure_server(base: str, args, mock_db: Path) -> subprocess.Popen | None:
    if server_up(base):
        return None
    if not args.start_server:
        sys.exit(f"No mock server at {base}. Use --start-server or start the app in mock mode.")
    address = urlsplit(base)
    if address.hostname not in ("localhost", "127.0.0.1") or address.port is None:
        sys.exit("--start-server requires a local base URL with an explicit port.")
    command = "start" if args.production else "dev"
    env = {**os.environ, "MOCK_API": "1", "NEXT_PUBLIC_API_MODE": "mock", "MOCK_DB_PATH": str(mock_db)}
    print(f"Starting Next.js ({command}) in {args.repo} on port {address.port}")
    process = subprocess.Popen(
        ["node", "node_modules/next/dist/bin/next", command, "--port", str(address.port)],
        cwd=args.repo, env=env,
    )
    for _ in range(90):
        if process.poll() is not None:
            sys.exit(f"Next.js exited with code {process.returncode}.")
        if server_up(base):
            return process
        time.sleep(1)
    stop_server(process)
    sys.exit("The mock server did not start within 90 seconds.")


def stop_server(server: subprocess.Popen) -> None:
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()


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
             "/book/bookie-demo/confirmed", "/book/bookie-demo/bookings", "/admin", "/admin/login", "/admin/queue", "/admin/zones",
             "/admin/hours", "/admin/settings", "/admin/bookings", "/admin/bookings/new"]
    for path in paths:
        try:
            urllib.request.urlopen(base + path, timeout=60).read()
        except Exception:  # noqa: BLE001 - redirects/401s are fine, we only want compilation
            pass


def customer_flow(run: Run, browser: Browser, base: str) -> dict:
    context: BrowserContext = browser.new_context(**view(390, 844, 2))
    context.set_default_timeout(TIMEOUT_MS)
    context.add_init_script(HIDE_DEV_BADGE)
    page = context.new_page()
    flow = Flow(run, "customer", page)
    shared: dict = {}
    book = f"{base}/book/{SLUG}"

    def root_redirect():
        response = context.request.get(f"{base}/", max_redirects=0)
        assert response.status == 307, response.status
        assert response.headers["location"] == f"/book/{SLUG}/login", response.headers["location"]
        page.goto(base)
        expect(page).to_have_url(f"{book}/login")
        expect(page.get_by_role("heading", name="เข้าสู่ระบบด้วย LINE")).to_be_visible()
        expect(page).to_have_title("เข้าสู่ระบบ · Bookie lyon.")

    flow.step("root-redirect", root_redirect)
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
        expect(page).to_have_title("จองสำเร็จ · Bookie lyon.")
        expect(page.get_by_text("คืนที่จอง", exact=True)).to_be_visible()
        expect(page.get_by_text("18:00 น.", exact=True)).to_be_visible()
        expect(page.get_by_text("สถานที่จอง", exact=True)).to_be_visible()
        expect(page.get_by_text("เชียงใหม่ ประเทศไทย")).to_be_visible()
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

    def cancel_staff_booking():
        page.get_by_role("row", name=re.compile("คุณทดสอบ")).get_by_role("link", name=re.compile("ดูรายละเอียด")).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("button", name="ยกเลิกการจอง", exact=True).click()
        dialog.get_by_role("button", name="ยืนยันยกเลิก", exact=True).click()
        expect(dialog.get_by_text("ยกเลิกแล้ว", exact=True)).to_be_visible()
        dialog.get_by_role("button", name="กลับ", exact=True).click()
        nav("รายการจอง").click()
        page.get_by_role("combobox", name="กรองตามสถานะ").select_option("cancelled")
        expect(page.get_by_role("row", name=re.compile("คุณทดสอบ")).get_by_text("ยกเลิกแล้ว")).to_be_visible()

    flow.step("staff-cancel-booking", cancel_staff_booking)

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
        dialog.get_by_role("spinbutton").fill("3")
        dialog.get_by_label("เวลาเปิดรับจอง").fill("00:00")
        dialog.get_by_role("button", name="บันทึก", exact=True).click()
        expect(page.get_by_text("เปิดจองล่วงหน้า 3 วัน · เวลา 00:00 น.", exact=True)).to_be_visible()
        assert api(base, "/venue")["maxAdvanceDays"] == 3

    flow.step("save-standard-hours", edit_standard)

    def add_special():
        service_date = date.fromisoformat(api(base, "/venue")["today"]) + timedelta(days=2)
        page.get_by_role("button", name="+ เพิ่มวันพิเศษ").click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("ชื่อวันพิเศษ").fill("ทดสอบคืนพิเศษ")
        dialog.get_by_label("คืนที่ต้องการ").fill(service_date.isoformat())
        dialog.get_by_label("เวลาเปิดรับจอง").fill("12:30")
        dialog.get_by_role("checkbox", name=re.compile("ประกาศให้ลูกค้า")).check()
        dialog.get_by_role("button", name="บันทึก", exact=True).click()
        expect(page.get_by_role("button", name=re.compile("ลบวันพิเศษ"))).to_be_visible()
        expect(page.get_by_text("ทดสอบคืนพิเศษ")).to_be_visible()

    flow.step("add-special-opening", add_special)

    def settings():
        nav("ตั้งค่าร้าน").click()
        expect(page.get_by_role("heading", name="ตั้งค่าร้าน")).to_be_visible()
        page.get_by_role("button", name=re.compile("จัดการทีมและสิทธิ์")).click()
        expect(page.get_by_role("dialog").get_by_role("heading", name="ทีมและสิทธิ์")).to_be_visible()

    flow.step("settings-team", settings)
    def save_slug():
        page.get_by_role("dialog").get_by_role("button", name="กลับ").click()
        new_url = f"{base}/book/bookie-test-cafe"
        context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
        page.locator("#venue-slug").fill("bookie-test-cafe")
        page.get_by_role("button", name="บันทึกรหัสร้าน").click()
        expect(page.get_by_text("บันทึกรหัสร้านแล้ว")).to_be_visible()
        expect(page.locator("#venue-booking-url")).to_have_value(new_url)
        expect(page.get_by_role("img", name="QR สำหรับเปิดหน้าจอง")).to_be_visible()
        page.get_by_role("button", name="คัดลอกลิงก์").click()
        expect(page.get_by_text("คัดลอกลิงก์แล้ว")).to_be_visible()
        assert page.evaluate("navigator.clipboard.readText()") == new_url

    flow.step("save-slug-and-copy-booking-link", save_slug)
    flow.step("logout", lambda: (
        page.get_by_role("button", name="ออกจากระบบ").click(),
        page.wait_for_url(re.compile(r"/admin/login$")),
    ))
    context.close()


def landing_and_titles(run: Run, browser: Browser, base: str) -> None:
    context = browser.new_context(**view(390, 844, 2))
    page = context.new_page()
    flow = Flow(run, "routing", page)
    book = f"/book/{SLUG}"

    def check_titles():
        titles = {
            f"{book}/login": "เข้าสู่ระบบ",
            f"{book}/details": "ข้อมูลผู้จอง",
            f"{book}/select": "เลือกคืนและโซน",
            f"{book}/confirmed": "จองสำเร็จ",
            f"{book}/bookings": "การจองของฉัน",
            "/admin/login": "เข้าสู่ระบบร้าน",
            "/admin": "แอดมิน: แดชบอร์ด",
            "/admin/bookings": "แอดมิน: การจอง",
            "/admin/bookings/new": "แอดมิน: เพิ่มการจอง",
            "/admin/bookings/seed-1": "แอดมิน: รายละเอียดการจอง",
            "/admin/queue": "แอดมิน: คิวจัดโต๊ะ",
            "/admin/queue/seed-2": "แอดมิน: จัดสรรโต๊ะ",
            "/admin/hours": "แอดมิน: เวลาเปิดจอง",
            "/admin/zones": "แอดมิน: โซน",
            "/admin/zones/plan": "แอดมิน: ผังร้าน",
            "/admin/audit": "แอดมิน: Audit",
            "/admin/settings": "แอดมิน: ตั้งค่า",
            "/admin/settings/hours": "แอดมิน: เวลาเปิดร้าน",
            "/admin/settings/cancellation": "แอดมิน: เงื่อนไขการยกเลิก",
            "/admin/settings/notifications": "แอดมิน: แจ้งเตือน LINE",
            "/admin/example-section": "แอดมิน: กำลังพัฒนา",
        }
        page.goto(base)
        for path, title in titles.items():
            response = context.request.get(base + path, timeout=60_000)
            assert response.ok, f"{path}: {response.status}"
            match = re.search(r"<title>(.*?)</title>", response.text())
            actual = unescape(match.group(1)) if match else None
            assert actual == f"{title} · Bookie lyon.", f"{path}: {actual!r}"

    flow.step("customer-and-admin-page-titles", check_titles)
    context.close()


def countdown_and_rebook(run: Run, browser: Browser, base: str) -> None:
    context = browser.new_context(**view(390, 844, 2))
    context.set_default_timeout(TIMEOUT_MS)
    context.add_init_script(HIDE_DEV_BADGE)
    page = context.new_page()
    flow = Flow(run, "rebook", page)
    book = f"{base}/book/{SLUG}"
    picker = page.locator("#date")
    selection = {}

    def begin():
        api(base, "/reset", {"opensInSeconds": 25})
        staff = browser.new_context()
        try:
            assert staff.request.post(f"{base}/api/mock/admin/login", data={"email": "owner@bookie.test"}).ok
            assert staff.request.put(f"{base}/api/mock/admin/hours/standard", data={"daysBefore": 3, "time": "00:00"}).ok
        finally:
            staff.close()
        page.goto(f"{book}/login")
        page.get_by_role("button", name=re.compile("พี่แมว")).click()
        expect(page).to_have_url(f"{book}/details")
        page.get_by_role("button", name="ดำเนินการต่อ").click()
        expect(page).to_have_url(f"{book}/select")
        expect(page.get_by_role("timer")).to_be_visible()
        expect(picker).to_be_disabled()

    flow.step("countdown-blocks-selection", begin)

    def opens():
        expect(picker).to_be_enabled(timeout=35_000)
        selection["date"] = picker.locator("option").last.get_attribute("value")
        assert selection["date"] > api(base, "/venue")["today"], selection["date"]

    flow.step("countdown-opens-automatically", opens)

    def confirm_date():
        picker.select_option(selection["date"])
        page.get_by_role("button", name="Indoor", exact=True).click()
        page.get_by_role("button", name="ยืนยันการจอง").click()
        expect(page.get_by_role("heading", name="ยืนยันการจองแล้ว")).to_be_visible()

    def first_booking():
        confirm_date()
        selection["first_booking"] = page.url

    flow.step("confirm-future-booking", first_booking)

    def cancel_booking():
        page.goto(f"{book}/details")
        expect(page.get_by_role("button", name="ดำเนินการต่อ")).to_be_disabled()
        page.get_by_role("link", name="ไปที่การยกเลิก").click()
        page.get_by_role("button", name="ยกเลิกการจอง", exact=True).click()
        page.get_by_role("button", name="ยืนยันยกเลิก", exact=True).click()
        expect(page.get_by_role("heading", name="ยกเลิกการจองแล้ว")).to_be_visible()

    flow.step("cancel-from-active-booking-banner", cancel_booking)

    def rebook():
        page.goto(f"{book}/details")
        page.get_by_role("button", name="ดำเนินการต่อ").click()
        expect(page).to_have_url(f"{book}/select")
        expect(picker).to_be_enabled()
        confirm_date()
        assert page.url != selection["first_booking"], "Rebooking must produce a new booking"

    flow.step("rebook-after-cancellation", rebook)

    def remove_from_history():
        page.get_by_role("link", name="ดูการจองของฉัน").click()
        booking_cards = page.get_by_role("region", name=re.compile(r"^BL-"))
        expect(booking_cards).to_have_count(1)
        booking_cards.get_by_role("button", name="ยกเลิกการจอง", exact=True).click()
        page.get_by_role("dialog").get_by_role("button", name="ยืนยันยกเลิก", exact=True).click()
        expect(page.get_by_role("status")).to_contain_text("ยกเลิกการจองแล้ว")
        expect(booking_cards).to_have_count(0)
        page.reload()
        expect(page.get_by_text("ยังไม่มีการจอง", exact=True)).to_be_visible()
        expect(booking_cards).to_have_count(0)

    flow.step("cancelled-bookings-hidden-from-history", remove_from_history)
    context.close()


# ----------------------------------------------------------------------------- report
def write_report(run: Run, base: str, started: datetime, seconds: float) -> None:
    passed = sum(r.status == "PASS" for r in run.results)
    failed = len(run.results) - passed
    lines = [
        f"# Bookie Bookie UI test — {started:%Y-%m-%d %H:%M:%S}", "",
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
    parser = argparse.ArgumentParser(description="Bookie Bookie automated UI test")
    parser.add_argument("--base-url", default="http://localhost:3100")
    parser.add_argument("--headed", action="store_true", help="show the browser window")
    parser.add_argument("--chrome", action="store_true", help="use the installed Google Chrome (implies --headed)")
    parser.add_argument("--slow", type=int, default=0, metavar="MS", help="slow down every action (ms); headed runs default to 270")
    parser.add_argument("--start-server", action="store_true", help="start a local mock Next.js server if needed")
    parser.add_argument("--production", action="store_true", help="start from an existing mock production build")
    parser.add_argument("--repo", type=Path, default=DEFAULT_REPO, help="app folder used by --start-server")
    args = parser.parse_args()
    if args.production and not args.start_server:
        parser.error("--production requires --start-server")
    with TemporaryDirectory(prefix="bookie-e2e-") as temp:
        return run_tests(args, Path(temp) / "db.json")


def run_tests(args, mock_db: Path) -> int:
    base = args.base_url.rstrip("/")
    server = ensure_server(base, args, mock_db)
    started = datetime.now()
    out_dir = HERE / started.strftime("%Y-%m-%d_%H-%M-%S")
    out_dir.mkdir(parents=True)
    run = Run(out_dir)
    print(f"Saving screenshots to {out_dir}")

    global HEADED
    HEADED = args.headed or args.chrome
    if HEADED and args.slow == 0:
        args.slow = 270  # visible runs default to a calm pace (0.9 s cut by 70%); --slow overrides
    began = time.time()
    try:
        api(base, "/reset", {})  # fresh seed data
        with sync_playwright() as p:
            customer_browser = open_browser(p, args, 390, 844)
            print("Customer flow")
            warm_up(base)
            landing_and_titles(run, customer_browser, base)
            shared = customer_flow(run, customer_browser, base)
            customer_browser.close()
            admin_browser = open_browser(p, args, 1440, 900)
            print("Admin flow")
            admin_flow(run, admin_browser, base, shared.get("reference", ""))
            admin_browser.close()
            print("Countdown and rebooking")
            customer_browser = open_browser(p, args, 390, 844)
            countdown_and_rebook(run, customer_browser, base)
            customer_browser.close()
    finally:
        try:
            api(base, "/reset", {})  # leave the app on clean seed data
        except OSError:
            pass
        write_report(run, base, started, time.time() - began)
        if server:
            stop_server(server)

    failed = [r for r in run.results if r.status == "FAIL"]
    print(f"\n{len(run.results) - len(failed)} passed, {len(failed)} failed — report: {out_dir / 'report.md'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
