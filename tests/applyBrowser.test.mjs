// Fills three local copies of Greenhouse-, Lever- and Ashby-style forms in a
// headless Chrome, served by this test on 127.0.0.1, and runs the whole flow
// through submit in dry mode. Nothing leaves this computer, and the server
// must receive no submission.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "apply");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apply-browser-"));
process.chdir(tmp);
process.env.NODE_ENV = "test";
fs.mkdirSync(path.join(tmp, "resumes"));
fs.writeFileSync(path.join(tmp, "resumes", "resume.pdf"), "%PDF-1.4\n%test resume\n");

const { createRunner } = await import(new URL("../lib/apply/runner.js", import.meta.url));
const { openTab, attachTab, closeTab, chromePath, shutdown } = await import(new URL("../lib/apply/cdp.js", import.meta.url));
const { pageApi } = await import(new URL("../lib/apply/page.js", import.meta.url));
const { jobId } = await import(new URL("../lib/jobId.js", import.meta.url));

const PROFILE = path.join(tmp, "chrome-profile");
const KIT = {
  applicant: {
    name: { first: "Ada", last: "Lovelace" },
    email: "ada@example.com",
    phone: "+1 416 555 0100",
    links: { linkedin: "https://www.linkedin.com/in/example" },
    workAuth: { authorizedIn: ["Canada"] },
  },
};

let server;
let base;
const posts = [];

before(async () => {
  server = http.createServer((req, res) => {
    if (req.method !== "GET") {
      posts.push(req.url);
      res.end("Thank you for applying");
      return;
    }
    const file = path.join(FIXTURES, path.basename(req.url.split("?")[0]));
    if (!file.endsWith(".html") || !fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await shutdown(PROFILE);
  server?.closeAllConnections();
  server?.close();
});

function runnerFor(link) {
  const row = { Link: link, Company: "Example Co", Status: "Awaiting Your Approval", "Role Title": "Analyst", "Country/Remote": "Toronto, ON", "CV Version Used": "startup", _row: 2 };
  const writes = [];
  const runner = createRunner({
    context: async () => ({ row, posting: "Example Co builds tools.", resumeText: "Ran a student club.", kit: KIT }),
    siteFor: (url) => ({ site: "test", formUrl: url }),
    sheet: { getAllJobs: async () => [row], updateStatus: async (...a) => writes.push(a), setFollowUpDate: async (...a) => writes.push(a) },
    ask: async (q) => {
      const ids = q.schema.properties.answers.items.properties.fieldId.enum;
      const writing = !!q.schema.properties.answers.items.properties.text;
      return { data: { answers: ids.map((fieldId) => (writing ? { fieldId, text: "I like building tools." } : { fieldId, key: "unknown" })) }, provider: "fake", skipped: [] };
    },
    browser: {
      open: (url, opts) => openTab(url, { ...opts, profileDir: PROFILE, headless: true }),
      attach: async (target, host) => pageApi(await attachTab(target, host)),
      close: closeTab,
    },
    logEvent: () => {},
    settleMs: 400,
  });
  return { runner, writes };
}

const answerFor = (app, pattern) => {
  const f = app.fields.find((x) => pattern.test(x.label));
  assert.ok(f, `no field matching ${pattern} in ${app.fields.map((x) => x.label).join(" | ")}`);
  return { field: f, answer: app.answers.find((a) => a.fieldId === f.id), readBack: app.readBack.find((r) => r.fieldId === f.id) };
};

for (const site of ["greenhouse", "lever", "ashby"]) {
  test(`${site}: fill, read back, confirm and dry-run submit with zero posts`, { timeout: 90_000 }, async (t) => {
    if (!chromePath()) return t.skip("Google Chrome isn't installed, so the browser test can't run");
    const link = `${base}/${site}.html`;
    const id = jobId(link);
    const { runner, writes } = runnerFor(link);
    const { done } = await runner.fill(id);
    await done;
    const app = await runner.get(id);
    assert.equal(app.state, "review", `${app.history.at(-1).detail}\n${JSON.stringify({ blockers: app.blockers, readBack: app.readBack.filter((r) => !r.ok), fields: app.fields.map((f) => f.label) }, null, 1)}`);
    assert.ok(app.readBack.every((r) => r.ok));
    assert.ok(!app.fields.some((f) => /autofill|job alerts/i.test(f.label)), "helpers and controls outside the form are skipped");

    assert.equal(answerFor(app, /^(first name|full name|name)$/i).readBack.shows.startsWith("Ada"), true);
    assert.equal(answerFor(app, /^email$/i).readBack.shows, "ada@example.com");
    assert.equal(answerFor(app, /^resume/i).readBack.shows, "resume.pdf");
    assert.equal(answerFor(app, /authorized to work in Canada/i).readBack.shows, "Yes");
    assert.equal(answerFor(app, /sponsorship/i).readBack.shows, "No");
    assert.match(answerFor(app, /gender/i).readBack.shows, /decline|prefer not/i);
    assert.equal(answerFor(app, /privacy/i).readBack.shows, "true");
    const open = app.fields.find((f) => f.kind === "textarea");
    assert.equal(app.readBack.find((r) => r.fieldId === open.id).shows, "I like building tools.");

    const { code } = await runner.confirm(id);
    let clicked = false;
    const sent = await runner.submit(id, code, { click: async () => (clicked = true) });
    assert.equal(sent.state, "sent-dry");
    assert.equal(clicked, false);
    assert.deepEqual(writes, []);
    assert.deepEqual(posts, [], "the test server received no submission");

    if (site === "ashby") {
      const page = pageApi(await attachTab(app.target, new URL(link).host));
      try {
        const kept = await page.read();
        assert.equal(kept.fields.find((f) => /^name$/i.test(f.label)).value, "Ada Lovelace", "the controlled input kept the native-setter value");
        await page.fill([]);
        const s = await attachTab(app.target, new URL(link).host);
        await s.evaluate(`(() => { const el = document.getElementById("_systemfield_name"); el.value = "Direct"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await new Promise((r) => setTimeout(r, 200));
        assert.equal(await s.evaluate(`document.getElementById("_systemfield_name").value`), "Ada Lovelace", "a plain .value write is undone, so the fixture is really controlled");
        s.close();
      } finally {
        page.close();
      }
    }
    await runner.close(id);
  });
}
