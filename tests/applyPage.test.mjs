import { test } from "node:test";
import assert from "node:assert/strict";
import { script, waitForResult } from "../lib/apply/page.js";

// Runs one in-page script against a fake document.
function inPage(name, arg, { errors = 0, text = "", pathname = "/apply", iframe = null } = {}) {
  const el = (t) => ({ innerText: t, getBoundingClientRect: () => ({ width: 10, height: 10 }), getAttribute: () => null });
  const document = {
    body: el(text),
    querySelectorAll: () => Array.from({ length: errors }, () => el("This field is required")),
    querySelector: () => iframe,
  };
  const getComputedStyle = () => ({ visibility: "visible", display: "block" });
  return new Function("document", "location", "getComputedStyle", `return ${script(name, arg)}`)(document, { pathname }, getComputedStyle);
}

test("field errors already on the page before the click aren't a refusal; new ones are", () => {
  assert.equal(inPage("fieldErrors", undefined, { errors: 1 }), 1);
  assert.equal(inPage("pageResult", 1, { errors: 1 }), "pending");
  assert.equal(inPage("pageResult", 1, { errors: 2 }), "refused");
  assert.equal(inPage("pageResult", 0, { errors: 1 }), "refused");
  assert.equal(inPage("pageResult", 3, { errors: 3, text: "Thank you for applying!" }), "sent");
});

test("waitForResult passes the error count from before the click", async () => {
  const seen = [];
  const page = { result: async (before) => (seen.push(before), "pending") };
  assert.equal(await waitForResult(page, { timeoutMs: 20, everyMs: 5, errorsBefore: 2 }), "unclear");
  assert.ok(seen.length && seen.every((b) => b === 2));
});

test("an embedded form is followed only when its frame is on greenhouse.io", () => {
  const frame = (src) => inPage("embeddedForm", undefined, { iframe: { src } });
  assert.equal(frame("https://boards.greenhouse.io/embed/job_app?for=acme&token=1"), "https://boards.greenhouse.io/embed/job_app?for=acme&token=1");
  assert.equal(frame("https://job-boards.greenhouse.io/embed/job_app?for=acme"), "https://job-boards.greenhouse.io/embed/job_app?for=acme");
  assert.equal(frame("https://evil.example/greenhouse.io/embed/job_app"), "");
  assert.equal(frame("https://greenhouse.io.evil.example/embed/job_app"), "");
  assert.equal(frame("not a url"), "");
  assert.equal(inPage("embeddedForm", undefined, { iframe: null }), "");
});
