// runner.js
// Fill, check, confirm, submit, mark and close one job's application form.
// Every step reads the application from disk, checks the state table, and
// works under the job's lock. The browser, sheet, model and job lookup are
// passed in, so tests run the whole flow with fakes.

import crypto from "crypto";
import fs from "fs";
import { siteFor, isAtsHost } from "./sites.js";
import { buildFacts } from "./facts.js";
import { rolesOf } from "./roles.js";
import { planAnswers, planHash, sameFieldSet } from "./plan.js";
import { can, transition, OPEN, CLICKED } from "./state.js";
import { ApplyError, readApp, writeApp, listApps, takeLock, lockIsLive, compareAndSwap } from "./store.js";
import { openTab, attachTab, closeTab, assertAllowed } from "./cdp.js";
import { pageApi, fillItems, readBackOf, waitForResult } from "./page.js";
import { ask } from "./model.js";
import { jobId as jobIdOf } from "../jobId.js";
import { logEvent } from "../timeline.js";

export const CODE_MS = 2 * 60_000;
const FOLLOW_UP_ROUNDS = 3;

export function isDry(formUrl, env = process.env) {
  let host = "";
  try {
    host = new URL(formUrl).hostname;
  } catch {}
  return env.APPLY_DRY_RUN === "true" || env.NODE_ENV === "test" || host === "127.0.0.1" || host === "localhost";
}

const hostOf = (url) => new URL(url).host;
const pageOf = (url) => {
  const u = new URL(url);
  return u.origin + u.pathname;
};
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const fail = (code, message) => new ApplyError(code, message);
const NOT_ATS = { kind: "not-ats", detail: "The form isn't on Greenhouse, Lever or Ashby. Use Open application." };
const onAts = (read) => isAtsHost(new URL(read.url).hostname);
const isClean = (app) => !app.blockers?.length && (app.readBack || []).every((r) => r.ok);

async function defaultContext(jobId) {
  const { loadContext } = await import("../jobContext.js");
  const ctx = await loadContext(jobId);
  if (!ctx) return null;
  return { row: ctx.row, posting: ctx.posting.description, resumeText: ctx.ai.resumeText, resume: ctx.resume, kit: ctx.kit };
}

async function defaultSheet() {
  const { getAllJobs, updateStatus, setFollowUpDate, STATUS } = await import("../sheets.js");
  return { getAllJobs, updateStatus, setFollowUpDate, applied: STATUS.APPLIED };
}

const DEFAULTS = {
  context: defaultContext,
  sheet: null,
  browser: {
    open: (url, opts) => openTab(url, opts),
    attach: async (target, host) => pageApi(await attachTab(target, host)),
    close: closeTab,
  },
  ask: (q) => ask(q),
  siteFor,
  logEvent,
  waitOptions: {},
  settleMs: 600,
  now: () => new Date(),
};

// Answers from the last fill moved onto the fields now on the page, matched
// by label and kind (ids shift when a follow-up question appears).
function carryOver(oldFields = [], answers = [], newFields = []) {
  const key = (f) => `${f.kind}|${f.label}`;
  const byKey = new Map(oldFields.map((f) => [f.id, key(f)]));
  const target = new Map(newFields.map((f) => [key(f), f.id]));
  return answers
    .map((a) => ({ ...a, fieldId: target.get(byKey.get(a.fieldId)) }))
    .filter((a) => a.fieldId);
}

const withResumeFile = (a, fields) =>
  fields.find((f) => f.id === a.fieldId)?.kind === "file" && a.value && !fs.existsSync(a.value)
    ? { ...a, value: "", source: "you", note: "Left for you. The resume file isn't in resumes/" }
    : a;

// Without the one-time code's hash.
export function publicView(app) {
  if (!app) return null;
  const { confirm, ...rest } = app;
  return { ...rest, confirmOpen: !!confirm };
}

export function createRunner(overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const sheet = async () => d.sheet || (d.sheet = await defaultSheet());
  const save = (app, to, detail) => writeApp(transition(app, to, detail, d.now()));

  async function attach(app) {
    try {
      return await d.browser.attach(app.target, hostOf(app.formUrl));
    } catch (err) {
      if (err.code === "LOST" || err.code === "NOT_ALLOWED") save(app, "lost", err.message);
      throw err;
    }
  }

  async function recordApplied(app) {
    try {
      const s = await sheet();
      const row = (await s.getAllJobs()).find((r) => jobIdOf(r.Link) === app.jobId);
      if (!row) throw new Error("The job's row isn't in the sheet.");
      await s.updateStatus(row._row, s.applied || "Applied");
      await s.setFollowUpDate(row._row, 7);
      d.logEvent(app.jobId, "status", s.applied || "Applied");
      d.logEvent(app.jobId, "note", `Application sent on ${hostOf(app.formUrl)}`);
      return writeApp({ ...app, sheetPending: false, sheetError: null });
    } catch (err) {
      return writeApp({ ...app, sheetPending: true, sheetError: err.message });
    }
  }

  // The fill's own writes after it starts: only while the file is still this
  // fill's `filling`. A mark, a close or a timeout written meanwhile wins, and
  // the fill's result is dropped.
  function finishFill(started, update) {
    try {
      return compareAndSwap(started.jobId, { state: "filling", fillId: started.fillId }, update);
    } catch (err) {
      if (err.code !== "CHANGED") throw err;
      return readApp(started.jobId);
    }
  }

  // A fill whose lock nobody has touched for 3 minutes crashed or hung.
  function expireDeadFill(app) {
    if (app?.state !== "filling" || lockIsLive(app.jobId)) return app;
    return finishFill(app, (disk) => transition(disk, "failed", "Filling stopped without finishing. Press Fill again.", d.now()));
  }

  // The sheet is the record of what you've sent, so a job marked Applied there
  // is never sent again, even when this application says otherwise.
  async function assertNotApplied(jobId) {
    let row;
    try {
      row = (await (await sheet()).getAllJobs()).find((r) => jobIdOf(r.Link) === jobId);
    } catch {
      throw fail("SHEET", "The app couldn't read your sheet to check this job isn't already Applied. Nothing was sent. Try again.");
    }
    if (/^Applied/i.test(row?.Status || "")) throw fail("APPLIED", "This job is already marked Applied in your sheet. Nothing was sent.");
  }

  async function get(jobId) {
    let app = expireDeadFill(readApp(jobId));
    if (!app) return null;
    if (app.state === "sent" && app.sheetPending) app = await recordApplied(app);
    return publicView(app);
  }

  async function fillWork(started, ctx, edits, lock) {
    // A lock taken over by someone else means this fill must stop touching the page.
    const beat = () => {
      if (!lock.touch()) throw fail("BUSY", "Filling stopped: something else took over this application.");
    };
    const ask = async (q) => {
      beat();
      try {
        return await d.ask(q);
      } finally {
        beat();
      }
    };
    let app = started;
    let target = app.target;
    let page;
    try {
      page = await d.browser.attach(target, hostOf(app.formUrl));
    } catch {
      target = await d.browser.open(app.startUrl, { previous: app.target });
      app = { ...app, formUrl: app.startUrl, target };
      page = await d.browser.attach(target, hostOf(app.formUrl));
    }
    try {
      const embedded = await page.embeddedFormUrl();
      if (embedded && embedded !== app.formUrl) {
        assertAllowed(embedded);
        await page.navigate(embedded);
        app = { ...app, formUrl: embedded };
      }
      let read = await page.read();
      if (!onAts(read)) {
        const next = { ...app, fields: [], answers: [], readBack: [], blockers: [NOT_ATS], model: null, planHash: null, confirm: null };
        return finishFill(started, () => transition(next, "blocked", "Not a Greenhouse, Lever or Ashby form", d.now()));
      }
      // Where the tab really is (after any redirect), so check and submit compare against it.
      app = { ...app, formUrl: read.url };
      const facts = buildFacts(ctx.kit, { trackKey: ctx.row["CV Version Used"] });
      const job = { title: ctx.row["Role Title"], company: ctx.row.Company, location: ctx.row["Country/Remote"] };
      const sources = { posting: ctx.posting, resumeText: ctx.resumeText, summary: ctx.kit?.summaries?.[ctx.row["CV Version Used"]] || "", roles: ctx.resume ? rolesOf(ctx.resume, d.now()) : [], today: d.now().toISOString() };
      let previous = carryOver(app.fields, app.answers, read.fields);
      let yours = carryOver(app.fields, edits, read.fields);
      let answers = [];
      let model = null;
      let errors = [];
      for (let round = 0; round < FOLLOW_UP_ROUNDS; round++) {
        beat();
        const plan = await planAnswers({ fields: read.fields, facts, job, sources, model: ask, edits: yours, previous });
        model = plan.model || model;
        answers = plan.answers.map((a) => withResumeFile(a, read.fields));
        errors = await page.fill(fillItems(read.fields, answers, { strict: !!started.strictMatch }));
        for (const a of answers.filter((x) => x.value)) {
          const f = read.fields.find((x) => x.id === a.fieldId);
          if (f.kind === "file") await page.upload(f.selector, a.value);
        }
        await new Promise((r) => setTimeout(r, d.settleMs));
        const again = await page.read();
        const same = sameFieldSet(read.fields, again.fields);
        previous = carryOver(read.fields, answers, again.fields);
        yours = carryOver(read.fields, yours, again.fields);
        read = again;
        // A follow-up question appeared; plan again for the new set.
        if (same) break;
        answers = read.fields.map((f) => previous.find((a) => a.fieldId === f.id) || { fieldId: f.id, value: "", source: "none", note: "Needs you" });
      }
      const readBack = readBackOf(read.fields, answers, { strict: !!started.strictMatch });
      const byId = Object.fromEntries(read.fields.map((f) => [f.id, f]));
      const blockers = [
        ...read.blockers,
        ...errors.map((e) => ({ kind: "unsupported-field", detail: `The app couldn't fill "${byId[e.fieldId]?.label || e.fieldId}". Fill it in the Chrome window.` })),
      ];
      const next = { ...app, fields: read.fields, answers, readBack, blockers, model, confirm: null };
      next.planHash = planHash(next);
      const clean = isClean(next);
      return finishFill(started, () => transition(next, clean ? "review" : "blocked", clean ? "Filled and read back" : "Filled. Some questions need you", d.now()));
    } finally {
      page.close();
    }
  }

  // Starts filling and returns at once with the application in `filling`.
  // `done` settles when the background work ends (the route doesn't wait).
  async function fill(jobId, edits = [], { strict = false } = {}) {
    const ctx = await d.context(jobId);
    if (!ctx) throw fail("NOT_FOUND", "This job isn't in your sheet.");
    if (/^Applied/i.test(ctx.row.Status || "")) throw fail("APPLIED", "This job is already marked Applied.");
    const site = d.siteFor(ctx.row.Link);
    if (!site.site) throw fail("UNSUPPORTED", site.reason);
    const fresh = () => expireDeadFill(readApp(jobId)) || { jobId, state: "idle", history: [] };
    const cantFill = () => fail("STATE", "The app can't fill this application right now.");
    if (!can(fresh().state, "fill")) throw cantFill();
    const other = listApps().find((a) => a.jobId !== jobId && OPEN.has(a.state) && a.startUrl === site.formUrl);
    if (other) throw fail("OPEN_ELSEWHERE", "Another job has this same form open. Close that one first.");
    const lock = takeLock(jobId);
    let started;
    try {
      const app = fresh();
      if (!can(app.state, "fill")) throw cantFill();
      const formUrl = app.startUrl === site.formUrl ? app.formUrl : site.formUrl;
      started = save({ ...app, site: site.site, startUrl: site.formUrl, formUrl, company: ctx.row.Company, confirm: null, fillId: lock.token, strictMatch: !!strict }, "filling", "Filling the form");
    } catch (err) {
      lock.release();
      throw err;
    }
    const done = fillWork(started, ctx, edits, lock)
      .catch((err) => finishFill(started, (disk) => transition(disk, err.code === "LOST" ? "lost" : "failed", err.message, d.now())))
      .catch((err) => console.warn(`[apply] couldn't save the fill result for ${started.jobId}: ${err.message}`))
      .finally(() => lock.release());
    return { application: publicView(started), done };
  }

  async function withJobLock(jobId, action, fn) {
    const app = readApp(jobId);
    if (!app || !can(app.state, action)) throw fail("STATE", `You can't do that now. The application is ${app ? app.state : "not started"}.`);
    const lock = takeLock(jobId);
    try {
      const fresh = readApp(jobId);
      if (!can(fresh.state, action)) throw fail("STATE", `You can't do that now. The application is ${fresh.state}.`);
      return await fn(fresh);
    } finally {
      lock.release();
    }
  }

  async function check(jobId) {
    return publicView(
      await withJobLock(jobId, "check", async (app) => {
        const page = await attach(app);
        try {
          // After the click, check only looks for a confirmation; only Fill goes back to review.
          if (CLICKED.has(app.state)) {
            if ((await page.result()) === "sent") return recordApplied(save(app, "sent", "The page now shows a confirmation"));
            return save(app, app.state, app.state === "refused" ? "Still no confirmation. Press Fill to read the form again." : "Still no confirmation on the page");
          }
          const read = await page.read();
          if (!onAts(read)) return save({ ...app, blockers: [NOT_ATS], readBack: [], planHash: null, confirm: null }, "blocked", "Not a Greenhouse, Lever or Ashby form");
          if (!sameFieldSet(app.fields, read.fields)) {
            const blockers = [...read.blockers, { kind: "page-error", detail: "The form's questions changed. Press Fill again." }];
            // The saved answers follow their questions to the new field ids; they are never replaced.
            const answers = carryOver(app.fields, app.answers, read.fields);
            return save({ ...app, fields: read.fields, answers, blockers, readBack: [], planHash: null, confirm: null }, "blocked", "The form changed");
          }
          // Check only re-reads the page: the planned answers in `app.answers` stay exactly as they were.
          const next = { ...app, fields: read.fields, readBack: readBackOf(read.fields, app.answers, { strict: !!app.strictMatch }), blockers: read.blockers, confirm: null };
          next.planHash = planHash(next);
          return save(next, isClean(next) ? "review" : "blocked", "Checked the page again");
        } finally {
          page.close();
        }
      }),
    );
  }

  async function confirm(jobId) {
    return withJobLock(jobId, "confirm", async (app) => {
      if (!isClean(app)) throw fail("NOT_READY", "Some questions still need you, so this can't be sent yet.");
      const code = crypto.randomBytes(16).toString("hex");
      const expiresAt = new Date(d.now().getTime() + CODE_MS).toISOString();
      writeApp({ ...app, confirm: { hash: sha(code), planHash: app.planHash, expiresAt } });
      return { code, expiresAt };
    });
  }

  // Every check between a clean review and the click. It runs under the
  // job's lock with the application as it is on disk.
  async function sendReviewed(jobId, app, click) {
    await assertNotApplied(app.jobId);
    const page = await attach(app);
    try {
      const read = await page.read();
      const readBack = readBackOf(read.fields, app.answers, { strict: !!app.strictMatch });
      const fresh = planHash({ ...app, fields: read.fields, readBack });
      const why = pageOf(read.url) !== pageOf(app.formUrl)
        ? "The Chrome tab is on a different page than the form you reviewed. Nothing was sent. Press Fill again."
        : !sameFieldSet(app.fields, read.fields)
          ? "A question was added, removed or changed since you reviewed it. Nothing was sent. Press Fill again."
          : read.blockers.length
            ? `Nothing was sent. ${read.blockers[0].detail}`
            : readBack.some((r) => !r.ok) || fresh !== app.planHash
              ? "The page no longer shows what you reviewed. Nothing was sent. Press Check again."
              : null;
      if (why) {
        save({ ...app, fields: read.fields, readBack, blockers: [...read.blockers, { kind: "page-error", detail: why }] }, "blocked", why);
        throw fail("CHANGED", why);
      }
      if (isDry(app.formUrl)) return save(app, "sent-dry", "Dry run. Everything checked, nothing was clicked.");
      const errorsBefore = await page.errorCount();
      const sending = compareAndSwap(jobId, { state: "review", planHash: app.planHash }, (disk) => transition(disk, "sending", "Clicking Submit", d.now()));
      const clicked = await click(page);
      if (!clicked) return save(sending, "failed", "The submit button was gone, so nothing was sent.");
      const outcome = await waitForResult(page, { ...d.waitOptions, errorsBefore });
      if (outcome === "sent") return recordApplied(save(sending, "sent", "The page confirmed the application"));
      if (outcome === "refused") return save(sending, "refused", "The form showed errors after Submit. Press Fill to read the form again, or fix and send it in the Chrome window, then press Check.");
      return save(sending, "unclear", "No confirmation seen after Submit. Check the Chrome window, then mark the result.");
    } finally {
      page.close();
    }
  }

  async function submit(jobId, code, { click = (page) => page.clickSubmit() } = {}) {
    const result = await withJobLock(jobId, "submit", async (app) => {
      const c = app.confirm;
      app = writeApp({ ...app, confirm: null });
      if (!c || !code || sha(code) !== c.hash) throw fail("BAD_CODE", "That confirmation isn't valid. Press Submit application again.");
      if (d.now().getTime() > Date.parse(c.expiresAt)) throw fail("EXPIRED", "The confirmation expired. Press Submit application again.");
      if (c.planHash !== app.planHash || !isClean(app)) throw fail("CHANGED", "The application changed since you confirmed. Check it and press Submit application again.");
      return sendReviewed(jobId, app, click);
    });
    return publicView(result);
  }


  async function mark(jobId, result) {
    if (!["applied", "not-sent"].includes(result)) throw fail("BAD_RESULT", 'result must be "applied" or "not-sent".');
    return publicView(
      await withJobLock(jobId, "mark", async (app) =>
        result === "applied" ? recordApplied(save(app, "sent", "You marked it applied")) : save({ ...app, confirm: null }, "idle", "You marked it not sent"),
      ),
    );
  }

  async function close(jobId) {
    return publicView(
      await withJobLock(jobId, "close", async (app) => {
        await d.browser.close(app.target);
        const { jobId: id, site, startUrl, company, history } = app;
        return save({ jobId: id, site, startUrl, formUrl: startUrl, company, history }, "idle", "Closed");
      }),
    );
  }

  return {
    get, fill, check, confirm, submit,
    mark, close, recordApplied,
  };
}

const runner = createRunner();
export const getApplication = runner.get;
export const fill = runner.fill;
export const check = runner.check;
export const confirm = runner.confirm;
export const submit = runner.submit;
export const mark = runner.mark;
export const close = runner.close;
