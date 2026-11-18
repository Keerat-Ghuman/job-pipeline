// cdp.js
// The application Chrome, driven over the DevTools protocol with Node's
// built-in WebSocket (no packages). Chrome runs on its own profile in
// data/apply-browser and is started detached, so a dashboard restart leaves
// it open; every request reconnects through the profile's DevToolsActivePort
// file. Nothing about the browser is kept in server memory.

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../store.js";
import { ApplyError } from "./store.js";

export const PROFILE_DIR = path.join(DATA_DIR, "apply-browser");

const CHROME_PATHS = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  win32: [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

export function chromePath(env = process.env, platform = process.platform) {
  if (env.CHROME_PATH) return fs.existsSync(env.CHROME_PATH) ? env.CHROME_PATH : null;
  return (CHROME_PATHS[platform] || []).find((p) => fs.existsSync(p)) || null;
}

const lost = () => new ApplyError("LOST", "The Chrome tab for this application is closed. Press Fill application to open it again.");

// Tests may only open forms the test itself serves.
export function assertAllowed(url) {
  if (process.env.NODE_ENV === "test" && new URL(url).hostname !== "127.0.0.1") {
    throw new ApplyError("NOT_ALLOWED", `Tests may only open 127.0.0.1, not ${url}`);
  }
}

function readPort(profileDir) {
  try {
    return Number(fs.readFileSync(path.join(profileDir, "DevToolsActivePort"), "utf-8").split("\n")[0]) || null;
  } catch {
    return null;
  }
}

async function getJson(port, route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(3000) });
  return res.json();
}

async function livePort(profileDir) {
  const port = readPort(profileDir);
  if (!port) return null;
  try {
    await getJson(port, "/json/version");
    return port;
  } catch {
    return null;
  }
}

export async function ensureChrome({ profileDir = PROFILE_DIR, headless = false } = {}) {
  const running = await livePort(profileDir);
  if (running) return running;
  const bin = chromePath();
  if (!bin) throw new ApplyError("NO_CHROME", "Google Chrome isn't installed. Install it, or set CHROME_PATH in .env.local.");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.rmSync(path.join(profileDir, "DevToolsActivePort"), { force: true });
  const args = [`--user-data-dir=${profileDir}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", ...(headless ? ["--headless=new"] : []), "about:blank"];
  spawn(bin, args, { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const port = await livePort(profileDir);
    if (port) return port;
  }
  throw new ApplyError("NO_CHROME", "Chrome didn't start. Close any Chrome window using the application profile and try again.");
}

// A DevTools connection to the whole browser.
async function connect(port) {
  const { webSocketDebuggerUrl } = await getJson(port, "/json/version");
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => fail(lost()), { once: true });
  });
  let nextId = 0;
  const waiting = new Map();
  const listeners = new Set();
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    } else listeners.forEach((f) => f(m));
  });
  ws.addEventListener("close", () => waiting.forEach((f) => f({ error: { message: "connection closed" } })));
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const id = ++nextId;
      waiting.set(id, (m) => (m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
      ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  return { send, listeners, close: () => ws.close() };
}

async function tabInfo(port, targetId) {
  try {
    return (await getJson(port, "/json/list")).find((t) => t.id === targetId) || null;
  } catch {
    return null;
  }
}

// A session on one tab: evaluate scripts, upload files, navigate.
async function session(port, targetId) {
  const cdp = await connect(port);
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  return {
    targetId,
    async evaluate(expression) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(`Page script failed: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
      return result.value;
    },
    async setFiles(selector, files) {
      const { root } = await send("DOM.getDocument", { depth: 0 });
      const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`No file box at ${selector}`);
      await send("DOM.setFileInputFiles", { nodeId, files });
    },
    activate: () => cdp.send("Target.activateTarget", { targetId }),
    async navigate(url) {
      assertAllowed(url);
      let timer;
      const loaded = new Promise((r) => {
        const f = (m) => m.sessionId === sessionId && m.method === "Page.loadEventFired" && (cdp.listeners.delete(f), r());
        cdp.listeners.add(f);
        timer = setTimeout(r, 30000);
      }).finally(() => clearTimeout(timer));
      await send("Page.navigate", { url });
      await loaded;
    },
    close: () => cdp.close(),
  };
}

// Opens the form in a new tab (or reuses this job's tab when still open).
export async function openTab(formUrl, { previous, profileDir = PROFILE_DIR, headless = false } = {}) {
  assertAllowed(formUrl);
  const port = await ensureChrome({ profileDir, headless });
  if (previous?.port === port && (await tabInfo(port, previous.targetId))) {
    const s = await session(port, previous.targetId);
    try {
      await s.navigate(formUrl);
    } finally {
      s.close();
    }
    return { port, targetId: previous.targetId };
  }
  const cdp = await connect(port);
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const s = await session(port, targetId);
    try {
      await s.navigate(formUrl);
    } finally {
      s.close();
    }
    return { port, targetId };
  } finally {
    cdp.close();
  }
}

// A session on the job's tab, after checking the browser answers, the tab
// exists and it is still on the form's host. Otherwise LOST.
export async function attachTab(target, formHost, { activate = true } = {}) {
  if (!target?.port || !target?.targetId) throw lost();
  const tab = await tabInfo(target.port, target.targetId);
  if (!tab) throw lost();
  let host = "";
  try {
    host = new URL(tab.url).host;
  } catch {}
  if (host !== formHost) throw lost();
  // Chrome can still list a tab for a moment after it closes; attaching then
  // says the target is gone, which is the same as a closed tab.
  const s = await session(target.port, target.targetId).catch((e) => {
    throw /No target with given id/i.test(e.message) ? lost() : e;
  });
  // Only ever this job's own tab (by its targetId, never the frontmost one).
  // Bring it forward so you can watch; if that fails the work still goes on in it.
  if (activate) await s.activate().catch(() => {});
  return s;
}

export async function closeTab(target) {
  if (!target?.port) return;
  try {
    const cdp = await connect(target.port);
    try {
      await cdp.send("Target.closeTarget", { targetId: target.targetId });
    } finally {
      cdp.close();
    }
  } catch {}
}

// Closes the whole application Chrome (tests use it to clean up).
export async function shutdown(profileDir = PROFILE_DIR) {
  const port = await livePort(profileDir);
  if (!port) return;
  try {
    const cdp = await connect(port);
    await cdp.send("Browser.close").catch(() => {});
    cdp.close();
  } catch {}
}
