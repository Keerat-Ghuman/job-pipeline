import { test } from "node:test";
import assert from "node:assert/strict";
import { allowed, canSubmit, rowProblem, rowValue, rowSource, sourceLabel, blockerText, aiRouteLabel, problemCount } from "../app/jobs/[id]/applyView.js";

const field = (o = {}) => ({ id: "f0", kind: "text", label: "Name", required: true, value: "Alex Example", ...o });
const clean = () => ({
  state: "review",
  blockers: [],
  fields: [field()],
  answers: [{ fieldId: "f0", value: "Alex Example", source: "kit" }],
  readBack: [{ fieldId: "f0", shows: "Alex Example", ok: true }],
});

test("panel buttons follow the engine's state table", () => {
  assert.ok(allowed("idle", "fill"));
  assert.ok(!allowed("filling", "fill"));
  assert.ok(!allowed("sending", "submit") && allowed("sending", "mark"));
  assert.ok(!allowed("sent", "submit") && allowed("sent", "close"));
  assert.ok(!allowed("unclear", "submit") && allowed("unclear", "check"));
  assert.ok(allowed("review", "submit"));
  assert.ok(!allowed("blocked", "submit"));
  assert.ok(!allowed("nonsense", "fill"));
});

test("submit needs review, no blockers, no problems, no pending edits", () => {
  assert.equal(canSubmit(clean()), true);
  assert.equal(canSubmit({ ...clean(), state: "blocked" }), false);
  assert.equal(canSubmit({ ...clean(), blockers: [{ kind: "human-check" }] }), false);
  assert.equal(canSubmit(clean(), { f0: "Other" }), false);
  const bad = clean();
  bad.readBack[0] = { fieldId: "f0", shows: "", ok: false, problem: "wrong value" };
  assert.equal(canSubmit(bad), false);
});

test("row problems", () => {
  assert.match(rowProblem(field(), { ok: false, problem: "wrong value", shows: "x" }), /different/);
  assert.match(rowProblem(field({ value: "" }), { ok: true, shows: "" }), /required/);
  assert.equal(rowProblem(field({ required: false, value: "" }), { ok: true, shows: "" }), "");
  assert.equal(rowProblem(field(), { ok: false, problem: "wrong value" }, "typed"), "");
  assert.match(rowProblem(field(), { ok: false, problem: "no file" }), /file/);
});

test("row value and source prefer the pending edit", () => {
  assert.equal(rowValue(field(), { shows: "Page" }), "Page");
  assert.equal(rowValue(field(), undefined), "Alex Example");
  assert.equal(rowValue(field(), { shows: "Page" }, "Mine"), "Mine");
  assert.equal(rowSource(clean(), "f0"), "kit");
  assert.equal(rowSource(clean(), "f0", "x"), "you");
  assert.equal(rowSource(clean(), "nope"), "none");
});

test("labels are plain words", () => {
  assert.equal(sourceLabel("model"), "Picked by AI");
  assert.equal(sourceLabel("written"), "Written for this job");
  assert.equal(sourceLabel("none"), "Needs you");
  assert.match(blockerText({ kind: "human-check" }), /Check again/);
  assert.match(blockerText({ kind: "weird" }), /Chrome window/);
  assert.equal(aiRouteLabel("claude"), "Answers written with your Claude subscription");
  assert.equal(aiRouteLabel({ provider: "none" }), "No AI used. Answers come from your apply kit only.");
  assert.equal(aiRouteLabel(undefined), "");
  assert.equal(problemCount(clean()), 0);
});
