/** Authenticated UI smoke against the separately seeded disposable fixture. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.BROWSER_BASE_URL ?? "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  throw new Error("Browser smoke only accepts a loopback application origin");
}
const fixture = JSON.parse(await readFile(".tmp-browser-fixture.json", "utf8"));
const chrome = process.env.BROWSER_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const artifacts = path.resolve(".tmp-browser-artifacts");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const events = { consoleErrors: [], failedRequests: [], httpFailures: [] };
const results = [];

function watch(page) {
  page.on("console", (message) => {
    if (message.type() === "error") events.consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => events.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on("response", (response) => {
    if (response.status() >= 400) events.httpFailures.push({ status: response.status(), url: response.url() });
  });
}
async function step(name, fn, page) {
  try {
    const detail = await fn();
    results.push({ name, result: "PASS", detail: detail ?? "" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, result: "FAIL", detail: String(error) });
    if (page) await page.screenshot({ path: path.join(artifacts, `${name.replace(/[^a-z0-9]+/gi, "-")}.png`), fullPage: true }).catch(() => {});
    throw error;
  }
}
async function go(page, url) {
  await page.goto(base + url, { waitUntil: "load", timeout: 45000 });
  await page.locator("body").waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);
}
async function login(page, email) {
  await go(page, "/login");
  const language = page.locator('select[aria-label]').first();
  if (await language.inputValue() !== "en") {
    const localeResponse = page.waitForResponse((response) => response.url().endsWith("/api/ui/locale") && response.request().method() === "POST");
    await language.selectOption("en");
    assert.equal((await localeResponse).status(), 200);
    await page.getByRole("heading", { name: "Sign in" }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
  }
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(fixture.password);
  await page.locator('button[type="submit"]').click();
  await page.getByText("Synthetic Gaming Center").waitFor({ timeout: 30000 });
  const enter = page.getByRole("button", { name: /Enter|دخول/ });
  const selection = page.waitForResponse((response) => response.url().endsWith("/api/organizations/select") && response.request().method() === "POST");
  await enter.click();
  assert.equal((await selection).status(), 200);
  await page.getByText("Synthetic Gaming Center").first().waitFor();
  await page.getByText("Choose your center").waitFor({ state: "hidden", timeout: 30000 });
}

const owner = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const staff = await browser.newPage({ viewport: { width: 1280, height: 720 } });
watch(owner);
watch(staff);
let sessionId;
let paymentRequest;
try {
  await step("invalid login alert Arabic and English", async () => {
    await go(owner, "/login");
    await owner.locator('select[aria-label]').first().selectOption("ar");
    await owner.locator('input[name="email"]').fill(fixture.ownerEmail);
    await owner.locator('input[name="password"]').fill("wrong-synthetic-password");
    await owner.locator('button[type="submit"]').click();
    await owner.locator('p.error[role="alert"]').waitFor({ timeout: 30000 });
    const arabic = await owner.locator('p.error[role="alert"]').innerText();
    assert.match(arabic, /[\u0600-\u06ff]/);
    assert.equal(await owner.locator('input[name="password"]').inputValue(), "wrong-synthetic-password");
    await owner.locator('select[aria-label]').first().selectOption("en");
    await owner.locator('input[name="password"]').fill("wrong-synthetic-password");
    await owner.locator('button[type="submit"]').click();
    await owner.locator('p.error[role="alert"]').waitFor({ timeout: 30000 });
    assert.match(await owner.locator('p.error[role="alert"]').innerText(), /Invalid|incorrect|password/i);
    return { arabic, english: await owner.locator('p.error[role="alert"]').innerText() };
  }, owner);

  await step("owner login and organization selection", async () => {
    await login(owner, fixture.ownerEmail);
    await owner.getByText("What’s happening now").waitFor({ timeout: 30000 });
    assert.match(owner.url(), /\/admin$/);
  }, owner);

  await step("customer create edit search archive", async () => {
    await go(owner, "/admin/customers");
    const name = `Smoke Customer ${Date.now()}`;
    await owner.locator('input[name="displayName"]').fill(name);
    await owner.getByRole("button", { name: "Create customer" }).click();
    await owner.getByRole("row", { name: new RegExp(name) }).waitFor({ timeout: 30000 });
    await owner.locator('input[name="q"]').fill(name);
    await owner.getByRole("button", { name: "Search" }).click();
    const row = owner.getByRole("row", { name: new RegExp(name) });
    await row.waitFor({ timeout: 30000 });
    await row.getByRole("link", { name: "View" }).click();
    await owner.getByRole("heading", { name }).waitFor();
    await owner.waitForTimeout(900);
    const edited = `${name} Edited`;
    await owner.locator('form[action^="/api/customers/"]').locator('input[name="displayName"]').fill(edited);
    await owner.getByRole("button", { name: "Save" }).click();
    await owner.getByRole("heading", { name: edited }).waitFor({ timeout: 30000 });
    await owner.getByRole("button", { name: "Archive customer" }).click();
    await owner.getByRole("alertdialog").getByRole("button", { name: /Archive|Confirm/ }).click();
    await owner.getByText("Archived", { exact: true }).waitFor({ timeout: 30000 });
    return { name: edited };
  }, owner);

  await step("device selection and session start", async () => {
    await go(owner, "/admin/gaming/floor");
    await owner.locator('select[name="branchId"]').selectOption(fixture.mainBranchId);
    await owner.getByRole("button", { name: "Filter" }).click();
    await owner.waitForURL(/\/admin\/gaming\/floor\?branchId=/, { timeout: 30000 });
    await owner.waitForTimeout(900);
    await owner.getByText("Test PC 1").waitFor({ timeout: 30000 });
    assert.equal(await owner.getByText("Restricted PC").count(), 0);
    await owner.locator('select[name="customerId"]').selectOption(fixture.customerId);
    assert.equal(await owner.locator('select[name="customerId"]').inputValue(), fixture.customerId);
    const responsePromise = owner.waitForResponse((response) => response.url().endsWith("/api/gaming/sessions") && response.request().method() === "POST");
    await owner.getByRole("button", { name: "Start", exact: true }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 201);
    const body = await response.json();
    sessionId = body.data?.id ?? body.data?.session?.id;
    assert.match(sessionId, /^[0-9a-f-]{36}$/i);
    await owner.getByRole("button", { name: "Pause" }).waitFor({ timeout: 30000 });
    return { sessionId };
  }, owner);

  await step("POS drink and session pause resume end", async () => {
    await go(owner, `/admin/gaming/sessions/${sessionId}`);
    const drinkResponse = owner.waitForResponse((response) => response.url().endsWith(`/api/gaming/sessions/${sessionId}/pos/orders`) && response.request().method() === "POST");
    await owner.getByRole("button", { name: "Add drink" }).click();
    assert.equal((await drinkResponse).status(), 201);
    await go(owner, "/admin/gaming/floor");
    await owner.locator('select[name="branchId"]').selectOption(fixture.mainBranchId);
    await owner.getByRole("button", { name: "Filter" }).click();
    await owner.waitForURL(/\/admin\/gaming\/floor\?branchId=/, { timeout: 30000 });
    await owner.waitForTimeout(900);
    await owner.getByRole("button", { name: "Pause" }).click();
    await owner.getByRole("button", { name: "Resume" }).waitFor({ timeout: 30000 });
    await owner.getByRole("button", { name: "Resume" }).click();
    await owner.getByRole("button", { name: "Pause" }).waitFor({ timeout: 30000 });
    await owner.getByRole("button", { name: "End", exact: true }).click();
    await owner.getByRole("alertdialog").getByRole("button", { name: /End|Confirm/ }).click();
    await owner.waitForURL(new RegExp(`/admin/gaming/sessions/${sessionId}/checkout`), { timeout: 30000 });
  }, owner);

  await step("checkout payment duplicate submit and retry", async () => {
    await owner.getByRole("button", { name: "Pay all" }).first().click();
    const pay = owner.getByRole("button", { name: "Pay selected" });
    owner.on("request", (request) => {
      if (request.url().endsWith(`/api/gaming/sessions/${sessionId}/payments`) && request.method() === "POST") {
        paymentRequest = { body: request.postData(), key: request.headers()["idempotency-key"] };
      }
    });
    const paymentResponse = owner.waitForResponse((response) => response.url().endsWith(`/api/gaming/sessions/${sessionId}/payments`) && response.request().method() === "POST");
    await Promise.allSettled([pay.click(), pay.click({ force: true })]);
    assert.equal((await paymentResponse).status(), 201);
    await owner.getByText("Paid", { exact: true }).first().waitFor({ timeout: 30000 });
    assert.ok(paymentRequest?.key);
    const retry = await owner.evaluate(async ({ url, body, key }) => {
      const response = await fetch(url, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body,
      });
      return { status: response.status, body: await response.json() };
    }, { url: `/api/gaming/sessions/${sessionId}/payments`, ...paymentRequest });
    assert.ok([200, 201].includes(retry.status));
    const paymentRows = await owner.locator("table tbody tr").count();
    assert.equal(paymentRows, 1);
    return { paymentRows, retryStatus: retry.status };
  }, owner);

  await step("low privilege login and denied mutations", async () => {
    await login(staff, fixture.staffEmail);
    await go(staff, "/admin/customers");
    assert.equal(await staff.getByRole("button", { name: "Create customer" }).count(), 0);
    const customerDenied = await staff.evaluate(async () => {
      const response = await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Should not exist" }) });
      return response.status;
    });
    assert.equal(customerDenied, 403);
    await go(staff, "/admin/gaming/floor");
    assert.equal(await staff.locator(`select[name="branchId"] option[value="${fixture.restrictedBranchId}"]`).count(), 0);
    const branchDenied = await staff.evaluate(async (deviceId) => {
      const response = await fetch("/api/gaming/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }) });
      return response.status;
    }, fixture.restrictedDeviceId);
    assert.equal(branchDenied, 403);
    const foreignDenied = await staff.evaluate(async (customerId) => {
      const response = await fetch(`/api/customers/${customerId}`);
      return response.status;
    }, fixture.foreignCustomerId);
    assert.equal(foreignDenied, 404);
    return { customerDenied, branchDenied, foreignDenied };
  }, staff);

  await step("logout", async () => {
    await staff.getByRole("button", { name: "Sign out" }).click();
    await staff.waitForURL(/\/login$/, { timeout: 30000 });
    await staff.locator('input[name="email"]').waitFor();
  }, staff);

  const unexpectedConsole = events.consoleErrors.filter((message) => !/\b(401|403|404)\b/.test(message));
  assert.equal(unexpectedConsole.length, 0, `Console errors: ${unexpectedConsole.join("; ")}`);
  const unexpectedRequests = events.failedRequests.filter((entry) => !(entry.url.includes("_rsc=") && entry.error === "net::ERR_ABORTED"));
  assert.equal(unexpectedRequests.length, 0, `Failed requests: ${JSON.stringify(unexpectedRequests)}`);
  const unexpectedHttp = events.httpFailures.filter((entry) => ![401, 403, 404].includes(entry.status));
  assert.equal(unexpectedHttp.length, 0, `Unexpected HTTP failures: ${JSON.stringify(unexpectedHttp)}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(artifacts, "smoke-results.json"), JSON.stringify({ results, events, sessionId }, null, 2));
  await browser.close();
}
