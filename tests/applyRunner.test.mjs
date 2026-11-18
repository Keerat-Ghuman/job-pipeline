import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// The store reads data/ under the working directory, so work in a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apply-runner-"));
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, "resumes"));
fs.writeFileSync(path.join(tmp, "resumes", "resume.pdf"), "%PDF");
delete process.env.NODE_ENV;
delete process.env.APPLY_DRY_RUN;
const { createRunner } = await import(new URL("../lib/apply/runner.js", import.meta.url));
const { jobId } = await import(new URL("../lib/jobId.js", import.meta.url));
const { readApp, writeApp, takeLock } = await import(new URL("../lib/apply/store.js", import.meta.url));

const LINK = "https://boards.greenhouse.io/acme/jobs/1";
const ID = jobId(LINK);
const yn = [{ value: "1", label: "Yes" }, { value: "0", label: "No" }];
const FORM = [
  { id: "f0", selector: "#first", kind: "text", label: "First name", required: true },
  { id: "f1", selector: "#email", kind: "email", label: "Email", required: true },
  { id: "f2", selector: "#resume", kind: "file", label: "Resume/CV", required: true },
  { id: "f3", selector: "#privacy", kind: "checkbox", label: "I consent to the privacy notice", required: true },
  { id: "f4", selector: "#sponsor", kind: "select", label: "Will you now or in the future require sponsorship?", required: true, options: yn },
  { id: "f5", selector: "#why", kind: "textarea", label: "Why Acme?", required: false },
];
const KIT = { applicant: { name: { first: "Ada", last: "Lovelace" }, email: "ada@example.com", workAuth: { authorizedIn: ["Canada"] } } };

function fakePage(url = LINK) {
  const values = {};
  const page = {
    url,
    extra: false,
    clicks: 0,
    fills: 0,
    errors: 0,
    // "sent", "pending", or "errors": refused only when there are more field errors than before the click.
    outcome: "sent",
    fields: () =>
      [...FORM, ...(page.extra ? [{ id: "f6", selector: "#new", kind: "text", label: "New question", required: false }] : [])].map((f) => ({
        ...f,
        options: f.options || null,
        value: values[f.id] ?? (f.kind === "checkbox" ? "false" : ""),
      })),
    read: async () => ({ url: page.url, fields: page.fields(), blockers: [] }),
    fill: async (items) => (page.fills++, items.forEach((i) => (values[i.fieldId] = i.value)), []),
    upload: async (selector, file) => (values[FORM.find((f) => f.selector === selector).id] = path.basename(file)),
    clickSubmit: async () => (page.clicks++, true),
    errorCount: async () => page.errors,
    result: async (before = 0) => (page.outcome === "errors" ? (page.errors > before ? "refused" : "pending") : page.outcome),
    embeddedFormUrl: async () => "",
    navigate: async () => {},
    close: () => {},
  };
  return page;
}

function setup({ status = "Awaiting Your Approval", sheetFails = false, link = LINK, ask } = {}) {
  const page = fakePage(link);
  const row = { Link: link, Company: "Acme", Status: status, "Role Title": "Analyst", "Country/Remote": "Toronto, ON", "CV Version Used": "startup", _row: 7 };
  const sheet = {
    writes: [],
    getAllJobs: async () => [row],
    updateStatus: async (r, s) => {
      if (sheetFails) throw new Error("Sheet down");
      sheet.writes.push(["status", r, s]);
    },
    setFollowUpDate: async (r, days) => sheet.writes.push(["followup", r, days]),
  };
  const events = [];
  const runner = createRunner({
    context: async () => ({ row, posting: "Acme makes tools.", resumeText: "Ran a club.", kit: KIT }),
    sheet,
    browser: { open: async () => ({ port: 1, targetId: "t1" }), attach: async () => page, close: async () => {} },
    ask: ask || (async (q) => ({ data: q.schema.properties.answers.items.properties.text ? { answers: [{ fieldId: "f5", text: "I like tools." }] } : { answers: [] }, provider: "fake", skipped: [] })),
    logEvent: (...e) => events.push(e),
    waitOptions: { timeoutMs: 50, everyMs: 5 },
    settleMs: 0,
  });
  return { runner, page, sheet, events, row };
}

async function filled(opts) {
  const s = setup(opts);
  const { application, done } = await s.runner.fill(ID);
  assert.equal(application.state, "filling");
  await done;
  return s;
}

beforeEach(() => fs.rmSync(path.join(tmp, "data"), { recursive: true, force: true }));

test("fill reads, plans, fills and reads back every field into review", async () => {
  const { runner } = await filled();
  const app = await runner.get(ID);
  assert.equal(app.state, "review", JSON.stringify(app.readBack));
  assert.ok(app.readBack.every((r) => r.ok));
  const by = Object.fromEntries(app.answers.map((a) => [a.fieldId, a]));
  assert.equal(by.f0.value, "Ada");
  assert.equal(by.f3.value, "true");
  assert.equal(by.f4.value, "No");
  assert.equal(by.f5.source, "written");
  assert.equal(app.readBack.find((r) => r.fieldId === "f2").shows, "resume.pdf");
  assert.ok(app.planHash);
});

test("dry mode checks everything and never clicks or touches the sheet", async () => {
  const { runner, page, sheet } = await filled();
  process.env.APPLY_DRY_RUN = "true";
  try {
    const { code } = await runner.confirm(ID);
    const app = await runner.submit(ID, code, { click: async () => assert.fail("clicked in dry mode") });
    assert.equal(app.state, "sent-dry");
    assert.equal(page.clicks, 0);
    assert.deepEqual(sheet.writes, []);
  } finally {
    delete process.env.APPLY_DRY_RUN;
  }
});

test("a confirmed submit clicks once, reads the confirmation and marks the job Applied", async () => {
  const { runner, page, sheet, events } = await filled();
  const { code } = await runner.confirm(ID);
  const app = await runner.submit(ID, code);
  assert.equal(app.state, "sent");
  assert.equal(page.clicks, 1);
  assert.deepEqual(sheet.writes, [["status", 7, "Applied"], ["followup", 7, 7]]);
  assert.ok(events.some(([id, kind, detail]) => id === ID && kind === "status" && detail === "Applied"));
  assert.equal(app.history.map((h) => h.state).join(" "), "filling review sending sent");
});

test("submit without a valid code is refused, and a code works once", async () => {
  const { runner, page } = await filled();
  await assert.rejects(runner.submit(ID, "nope"), { code: "BAD_CODE" });
  const { code } = await runner.confirm(ID);
  await assert.rejects(runner.submit(ID, "wrong"), { code: "BAD_CODE" });
  await assert.rejects(runner.submit(ID, code), { code: "BAD_CODE" }, "a wrong try uses up the code");
  const second = await runner.confirm(ID);
  page.outcome = "unclear";
  assert.equal((await runner.submit(ID, second.code)).state, "unclear");
  await assert.rejects(runner.submit(ID, second.code), { code: "STATE" });
  assert.equal(page.clicks, 1);
});

test("an expired code is refused", async () => {
  const { runner } = await filled();
  const { code } = await runner.confirm(ID);
  const app = readApp(ID);
  writeApp({ ...app, confirm: { ...app.confirm, expiresAt: new Date(Date.now() - 1000).toISOString() } });
  await assert.rejects(runner.submit(ID, code), { code: "EXPIRED" });
});

test("a question added after review stops the send", async () => {
  const { runner, page } = await filled();
  const { code } = await runner.confirm(ID);
  page.extra = true;
  await assert.rejects(runner.submit(ID, code), { code: "CHANGED" });
  assert.equal(page.clicks, 0);
  assert.equal((await runner.get(ID)).state, "blocked");
});

test("two submits at once: one sends, the other is refused, one click", async () => {
  const { runner, page, sheet } = await filled();
  const { code } = await runner.confirm(ID);
  const results = await Promise.allSettled([runner.submit(ID, code), runner.submit(ID, code)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "BUSY");
  assert.equal(page.clicks, 1);
  assert.equal(sheet.writes.filter((w) => w[0] === "status").length, 1);
});

test("sending refuses another submit and another confirm until you mark it", async () => {
  const { runner, page } = await filled();
  const { code } = await runner.confirm(ID);
  writeApp({ ...readApp(ID), state: "sending" });
  await assert.rejects(runner.submit(ID, code), { code: "STATE" });
  await assert.rejects(runner.confirm(ID), { code: "STATE" });
  assert.equal(page.clicks, 0);
  assert.equal((await runner.mark(ID, "not-sent")).state, "idle");
});

test("a sheet failure keeps the application sent and retries on the next read", async () => {
  const s = await filled({ sheetFails: true });
  const { code } = await s.runner.confirm(ID);
  const app = await s.runner.submit(ID, code);
  assert.equal(app.state, "sent");
  assert.equal(app.sheetPending, true);
  const again = setup();
  const later = await again.runner.get(ID);
  assert.equal(later.sheetPending, false);
  assert.deepEqual(again.sheet.writes[0], ["status", 7, "Applied"]);
});

test("fill is refused for a job already Applied, and while another job has the same form open", async () => {
  await assert.rejects(setup({ status: "Applied" }).runner.fill(ID), { code: "APPLIED" });
  writeApp({ jobId: "other1", state: "review", startUrl: LINK, formUrl: LINK, history: [] });
  await assert.rejects(setup().runner.fill(ID), { code: "OPEN_ELSEWHERE" });
});

test("a lost tab moves the application to lost", async () => {
  const s = await filled();
  const lost = createRunner({
    browser: { attach: async () => { throw Object.assign(new Error("The Chrome tab for this application is closed."), { code: "LOST" }); } },
  });
  await assert.rejects(lost.check(ID), { code: "LOST" });
  assert.equal((await s.runner.get(ID)).state, "lost");
});

test("a slow fill can't overwrite an application you marked while it ran", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  let slow = false;
  const s = setup({ ask: async () => (slow && (await gate), { data: { answers: [] }, provider: "fake", skipped: [] }) });
  await (await s.runner.fill(ID)).done;
  await s.runner.mark(ID, "not-sent");
  slow = true;
  const { done } = await s.runner.fill(ID);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await s.runner.get(ID)).state, "filling", "a fill whose lock is fresh isn't called stale");

  const lockFile = path.join(tmp, "data", "applications", `${ID}.lock`);
  const held = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
  fs.writeFileSync(lockFile, JSON.stringify({ ...held, at: 0 }));
  assert.equal((await s.runner.get(ID)).state, "failed", "a fill whose lock went stale is called failed");
  assert.equal((await s.runner.mark(ID, "applied")).state, "sent");

  release();
  await done;
  assert.equal(readApp(ID).state, "sent", "the late fill's result was dropped");
  assert.equal(readApp(ID).history.at(-1).state, "sent");
  assert.ok(!fs.existsSync(lockFile), "nothing left locked");
});

test("a lock taken over after going stale can't be touched or released by its old holder", () => {
  fs.mkdirSync(path.join(tmp, "data", "applications"), { recursive: true });
  const old = takeLock(ID, 0);
  const now = takeLock(ID);
  assert.equal(old.touch(), false);
  assert.equal(old.release(), false);
  assert.throws(() => takeLock(ID), { code: "BUSY" }, "the new holder's lock is still there");
  assert.equal(now.release(), true);
});

test("submit refuses a job your sheet already shows as Applied", async () => {
  const { runner, page, row } = await filled();
  const { code } = await runner.confirm(ID);
  row.Status = "Applied (Auto)";
  await assert.rejects(runner.submit(ID, code), { code: "APPLIED" });
  assert.equal(page.clicks, 0);
});

test("submit refuses when the Chrome tab is on a different page than the reviewed form", async () => {
  const { runner, page } = await filled();
  const { code } = await runner.confirm(ID);
  page.url = "https://boards.greenhouse.io/acme/jobs/2";
  await assert.rejects(runner.submit(ID, code), { code: "CHANGED" });
  assert.equal(page.clicks, 0);
  assert.equal((await runner.get(ID)).state, "blocked");
});

test("a company page that isn't a Greenhouse, Lever or Ashby form is blocked and nothing is filled", async () => {
  const link = "https://acme.example/careers?gh_jid=1";
  const s = setup({ link });
  await (await s.runner.fill(jobId(link))).done;
  const app = await s.runner.get(jobId(link));
  assert.equal(app.state, "blocked");
  assert.deepEqual(app.blockers, [{ kind: "not-ats", detail: "The form isn't on Greenhouse, Lever or Ashby. Use Open application." }]);
  assert.equal(s.page.fills, 0);
  assert.deepEqual(app.answers, []);
  assert.equal((await s.runner.check(jobId(link))).state, "blocked", "check keeps it blocked");
});

test("errors already on the page before the click aren't a refusal", async () => {
  const { runner, page } = await filled();
  const { code } = await runner.confirm(ID);
  page.errors = 1;
  page.outcome = "errors";
  assert.equal((await runner.submit(ID, code)).state, "unclear");
});

test("after a refusal, check only looks for a confirmation; it never goes back to review", async () => {
  const { runner, page } = await filled();
  const { code } = await runner.confirm(ID);
  page.outcome = "errors";
  page.clickSubmit = async () => (page.clicks++, page.errors++, true);
  assert.equal((await runner.submit(ID, code, { click: (p) => p.clickSubmit() })).state, "refused");
  page.outcome = "pending";
  assert.equal((await runner.check(ID)).state, "refused");
  page.outcome = "sent";
  assert.equal((await runner.check(ID)).state, "sent");
});
