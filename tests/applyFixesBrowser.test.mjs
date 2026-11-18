// Browser behaviour fixed after a live trial on Ashby forms: Yes/No buttons,
// autocomplete picks, month and year dropdowns, number boxes and working only
// on the job's own tab. Served locally; skips when Chrome isn't installed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "apply");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apply-fixes-"));
process.chdir(tmp);
process.env.NODE_ENV = "test";

const { openTab, attachTab, closeTab, chromePath, shutdown } = await import(new URL("../lib/apply/cdp.js", import.meta.url));
const { pageApi, fillItems, readBackOf } = await import(new URL("../lib/apply/page.js", import.meta.url));

const PROFILE = path.join(tmp, "chrome-profile");
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
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

const open = (url) => openTab(url, { profileDir: PROFILE, headless: true });

test("Yes/No buttons, autocomplete, month and year dropdowns and number boxes fill and read back", { timeout: 60_000 }, async (t) => {
  if (!chromePath()) return t.skip("Google Chrome isn't installed, so the browser test can't run");
  const target = await open(`${base}/ashby-fixes.html`);
  const page = pageApi(await attachTab(target, new URL(base).host));
  try {
    const read = await page.read();
    const by = (re) => read.fields.find((f) => re.test(f.label));
    const yn = by(/open to working in person/i);
    assert.equal(yn.kind, "radio");
    assert.deepEqual(yn.options.map((o) => o.label), ["Yes", "No"]);
    assert.equal(yn.required, true);
    assert.equal(yn.value, "");
    assert.equal(read.fields.filter((f) => /open to working/i.test(f.label)).length, 1, "the hidden checkbox is not a second field");
    assert.ok(by(/^school/i).combobox, "the autocomplete is marked");
    assert.equal(by(/salary/i).numeric, true);

    const answers = [
      { fieldId: yn.id, value: "Yes" },
      { fieldId: by(/^school/i).id, value: "University of Western Ontario", aliases: ["Western University"] },
      { fieldId: by(/start month/i).id, value: "September" },
      { fieldId: by(/start year/i).id, value: "2022" },
    ];
    const errors = await page.fill(fillItems(read.fields, answers));
    assert.deepEqual(errors, []);
    const after = await page.read();
    const val = (re) => after.fields.find((f) => re.test(f.label)).value;
    assert.equal(val(/open to working/i), "Yes", "read back from the pressed button");
    assert.equal(val(/^school/i), "Western University", "the alias was picked from the list");
    assert.equal(val(/start month/i), "Sep");
    assert.equal(val(/start year/i), "2022");
    const rb = readBackOf(after.fields, answers);
    assert.ok(rb.filter((r) => answers.some((x) => x.fieldId === r.fieldId)).every((r) => r.ok), JSON.stringify(rb));

    const second = await page.fill(fillItems(after.fields, [{ fieldId: yn.id, value: "No" }, { fieldId: by(/^school/i).id, value: "Western" }]));
    assert.equal(second.length, 1, "an ambiguous list is an error, not a guess");
    assert.equal((await page.read()).fields.find((f) => /open to working/i.test(f.label)).value, "No");
  } finally {
    page.close();
    await closeTab(target);
  }
});

test("the filler stays on the job's own tab when another tab is in front", { timeout: 60_000 }, async (t) => {
  if (!chromePath()) return t.skip("Google Chrome isn't installed, so the browser test can't run");
  const mine = await open(`${base}/ashby.html`);
  const other = await open(`${base}/greenhouse.html`);
  try {
    const s = await attachTab(other, new URL(base).host, { activate: true });
    s.close();
    const page = pageApi(await attachTab(mine, new URL(base).host));
    try {
      assert.match((await page.read()).url, /ashby\.html$/, "reads the job's tab, not the frontmost one");
    } finally {
      page.close();
    }
    await closeTab(mine);
    await assert.rejects(attachTab(mine, new URL(base).host), { code: "LOST" }, "a closed tab is lost, never replaced by another");
  } finally {
    await closeTab(other);
  }
});
