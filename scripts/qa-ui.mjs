// Browser QA for the dashboard: every main page at desktop and phone width,
// with no crash, no console or page errors, no failed requests and no sideways
// scroll. Drives the Mac's Google Chrome directly; no packages needed.
// It only loads pages: it never clicks, so it never approves, sends or fetches.
// Usage: node scripts/qa-ui.mjs <base url>     (prints "no issues" or each one)
// With DASHBOARD_USER and DASHBOARD_PASSWORD set, it logs in with them.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3001";
const PAGES = [
  "/",
  "/board",
  "/outreach",
  "/studio",
];
const WIDTHS = [1440, 375];
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const profile = mkdtempSync(join(tmpdir(), "qa-ui-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

let port;
for (let i = 0; i < 50 && !port; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch {}
}
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let nextId = 0;
const waiting = new Map();
const listeners = new Set();
ws.addEventListener("message", ({ data }) => {
  const m = JSON.parse(data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  else listeners.forEach((f) => f(m));
});
const send = (method, params = {}, sessionId) =>
  new Promise((ok, fail) => {
    const id = ++nextId;
    waiting.set(id, (m) => (m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

const issues = [];
const host = new URL(base).host;
for (const path of PAGES) {
  for (const width of WIDTHS) {
    const where = `${path} @${width}`;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const seen = (m) => {
      if (m.sessionId !== sessionId) return;
      const p = m.params || {};
      if (m.method === "Runtime.exceptionThrown") issues.push(`${where}: page error: ${p.exceptionDetails?.exception?.description?.split("\n")[0] ?? p.exceptionDetails?.text}`);
      if (m.method === "Runtime.consoleAPICalled" && p.type === "error") issues.push(`${where}: console error: ${p.args?.map((a) => a.value ?? a.description).join(" ").slice(0, 160)}`);
      if (m.method === "Network.responseReceived" && p.response.status >= 400 && new URL(p.response.url).host === host) issues.push(`${where}: ${p.response.status} ${p.response.url}`);
      if (m.method === "Network.loadingFailed" && !p.canceled) issues.push(`${where}: request failed: ${p.errorText}`);
    };
    listeners.add(seen);
    await send("Runtime.enable", {}, sessionId);
    await send("Network.enable", {}, sessionId);
    if (process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD) {
      const login = Buffer.from(`${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString("base64");
      await send("Network.setExtraHTTPHeaders", { headers: { Authorization: `Basic ${login}` } }, sessionId);
    }
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }, sessionId);
    const loaded = new Promise((r) => {
      const f = (m) => m.sessionId === sessionId && m.method === "Page.loadEventFired" && (listeners.delete(f), r());
      listeners.add(f);
      setTimeout(r, 30000);
    });
    await send("Page.navigate", { url: base + path }, sessionId);
    await loaded;
    await new Promise((r) => setTimeout(r, 2500)); // let client data load
    const { result } = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `({ wide: document.documentElement.scrollWidth - innerWidth, crash: /Application error|Unhandled Runtime Error|Internal Server Error/.test(document.body.innerText), empty: document.body.innerText.trim().length < 20 })`,
    }, sessionId);
    const v = result.value;
    if (v.wide > 1) issues.push(`${where}: sideways scroll, ${v.wide}px too wide`);
    if (v.crash) issues.push(`${where}: shows an error page`);
    if (v.empty) issues.push(`${where}: page is blank`);
    listeners.delete(seen);
    await send("Target.closeTarget", { targetId });
    console.log(`checked ${where}`);
  }
}

ws.close();
const exited = new Promise((r) => chrome.once("exit", r));
chrome.kill();
await exited;
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
if (issues.length) {
  console.log("\n" + [...new Set(issues)].map((i) => `FAIL ${i}`).join("\n"));
  process.exit(1);
}
console.log("no issues");
