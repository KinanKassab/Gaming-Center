/** Six requested viewports in Arabic RTL and English LTR, on the disposable fixture. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.BROWSER_BASE_URL ?? "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Loopback browser origin required");
const fixture = JSON.parse(await readFile(".tmp-browser-fixture.json", "utf8"));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
const failures = [];
const matrix = [];
const artifacts = path.resolve(".tmp-browser-artifacts");
await mkdir(artifacts, { recursive: true });
page.on("pageerror", (error) => failures.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
});

async function go(url) {
  await page.goto(base + url, { waitUntil: "load", timeout: 45000 });
  await page.locator("body").waitFor();
  await page.waitForTimeout(500);
}
async function setLocale(locale) {
  const result = await page.evaluate(async (value) => {
    const response = await fetch("/api/ui/locale", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: value, source: "user" }),
    });
    return response.status;
  }, locale);
  assert.equal(result, 200);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction((expected) => document.documentElement.dir === expected, locale === "ar" ? "rtl" : "ltr");
}
async function inspect(viewport, locale, surface, url, dialog = false) {
  await go(url);
  if (dialog) {
    await page.getByRole("button", { name: locale === "ar" ? /أرشفة/ : /Archive customer/ }).click();
    await page.getByRole("alertdialog").waitFor();
  }
  const check = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const bodyWidth = document.body.scrollWidth;
    const htmlWidth = document.documentElement.scrollWidth;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const clipped = [...document.querySelectorAll("main h1, main h2, main label, main button, [role=alertdialog] button")]
      .filter(visible)
      .filter((element) => {
        const style = getComputedStyle(element);
        return ["hidden", "clip"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 2;
      })
      .map((element) => element.textContent?.trim().slice(0, 50));
    const smallTargets = [...document.querySelectorAll("main button, [role=alertdialog] button, .app-bottom-nav a, .menu-toggle")]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 32 || rect.height < 32;
      })
      .map((element) => ({ text: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 30), width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) }));
    const modal = document.querySelector('[role="alertdialog"]');
    const modalBox = modal?.getBoundingClientRect();
    return {
      width, bodyWidth, htmlWidth, clipped, smallTargets,
      dialogWithinViewport: !modalBox || (modalBox.left >= -1 && modalBox.right <= innerWidth + 1 && modalBox.top >= -1 && modalBox.bottom <= innerHeight + 1),
      dir: document.documentElement.dir,
    };
  });
  const row = { viewport: `${viewport.width}x${viewport.height}`, locale, surface, ...check };
  if (surface === "customers") {
    row.formReachable = await page.locator('input[name="displayName"]').isVisible();
  }
  if (surface === "checkout") {
    row.paymentReachable = await page.getByRole("button", { name: locale === "ar" ? "دفع المحدد" : "Pay selected" }).isVisible();
  }
  if (dialog) {
    row.dialogActions = await page.getByRole("alertdialog").getByRole("button").count();
    await page.keyboard.press("Escape");
    await page.getByRole("alertdialog").waitFor({ state: "hidden" });
  }
  row.pass = check.bodyWidth <= check.width + 1 && check.htmlWidth <= check.width + 1 &&
    check.clipped.length === 0 && check.dialogWithinViewport && check.smallTargets.length === 0 &&
    (row.formReachable ?? true) && (row.paymentReachable ?? true) && (row.dialogActions === undefined || row.dialogActions >= 2);
  matrix.push(row);
  if (!row.pass) await page.screenshot({ path: path.join(artifacts, `responsive-${viewport.width}-${locale}-${surface}.png`), fullPage: true });
  console.log(`${row.pass ? "PASS" : "FAIL"} ${row.viewport} ${locale} ${surface} overflow=${Math.max(check.bodyWidth, check.htmlWidth) - check.width} clipped=${check.clipped.length} small=${check.smallTargets.length}`);
}

try {
  await go("/login");
  await page.locator('input[name="email"]').fill(fixture.ownerEmail);
  await page.locator('input[name="password"]').fill(fixture.password);
  await page.locator('button[type="submit"]').click();
  await page.getByText("Synthetic Gaming Center").waitFor({ timeout: 30000 });
  const selected = page.waitForResponse((response) => response.url().endsWith("/api/organizations/select") && response.request().method() === "POST");
  await page.getByRole("button", { name: /Enter|دخول/ }).click();
  assert.equal((await selected).status(), 200);
  await go("/admin");

  // Keep an unpaid checkout visible through the viewport run.
  const started = await page.evaluate(async ({ deviceId, customerId }) => {
    const response = await fetch("/api/gaming/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId, customerId }) });
    return { status: response.status, body: await response.json() };
  }, { deviceId: fixture.deviceId, customerId: fixture.customerId });
  assert.equal(started.status, 201);
  const sessionId = started.body.data?.id ?? started.body.data?.session?.id;
  assert.ok(sessionId);
  const drink = await page.evaluate(async ({ sessionId, productId }) => {
    const response = await fetch(`/api/gaming/sessions/${sessionId}/pos/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, quantity: "1" }),
    });
    return response.status;
  }, { sessionId, productId: fixture.productId });
  assert.equal(drink, 201);
  const ended = await page.evaluate(async (id) => {
    const response = await fetch(`/api/gaming/sessions/${id}/end`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    return response.status;
  }, sessionId);
  assert.equal(ended, 200);

  const viewports = [
    { width: 1440, height: 900 }, { width: 1280, height: 720 },
    { width: 1024, height: 768 }, { width: 768, height: 1024 },
    { width: 390, height: 844 }, { width: 375, height: 812 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const locale of ["en", "ar"]) {
      await setLocale(locale);
      await inspect(viewport, locale, "dashboard", "/admin");
      await inspect(viewport, locale, "floor", "/admin/gaming/floor");
      await inspect(viewport, locale, "customers", "/admin/customers");
      await inspect(viewport, locale, "checkout", `/admin/gaming/sessions/${sessionId}/checkout`);
      await inspect(viewport, locale, "confirmation", `/admin/customers/${fixture.customerId}`, true);
      await go("/admin");
      const compact = viewport.width <= 1100;
      if (compact) {
        const open = page.locator('button[aria-controls="app-sidebar"][aria-expanded="false"]').filter({ visible: true }).first();
        await open.click();
        await page.locator('aside[role="dialog"]').waitFor();
        await page.keyboard.press("Escape");
        await page.locator('aside[role="dialog"]').waitFor({ state: "hidden" });
      } else {
        assert.equal(await page.locator("aside.app-sidebar").isVisible(), true);
      }
    }
  }
  assert.equal(failures.length, 0, failures.join("; "));
  assert.ok(matrix.every((row) => row.pass), "Responsive matrix contains failures");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(artifacts, "responsive-results.json"), JSON.stringify({ matrix, failures }, null, 2));
  await browser.close();
}
