import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, CLICKED, can, transition } from "../lib/apply/state.js";

test("the state table allows exactly the doc's actions", () => {
  const table = {
    idle: "fill",
    filling: "",
    review: "fill check confirm submit close mark",
    blocked: "fill check close mark",
    failed: "fill close mark",
    lost: "fill close mark",
    sending: "mark",
    sent: "close",
    "sent-dry": "fill close",
    unclear: "check mark",
    refused: "fill check close mark",
  };
  assert.deepEqual(Object.keys(STATES).sort(), Object.keys(table).sort());
  const all = ["fill", "check", "confirm", "submit", "close", "mark"];
  for (const [state, allowed] of Object.entries(table)) {
    for (const action of all) assert.equal(can(state, action), allowed.split(" ").includes(action), `${state} ${action}`);
  }
});

test("only review can submit; sending and unclear refuse another submit", () => {
  assert.ok(can("review", "submit"));
  for (const s of ["sending", "unclear", "sent", "blocked", "sent-dry"]) assert.ok(!can(s, "submit"), s);
  assert.ok(!can("nope", "fill"));
});

test("transition appends to the history", () => {
  const at = new Date("2026-01-02T03:04:05Z");
  const a = transition({ jobId: "x", history: [] }, "filling", "start", at);
  const b = transition(a, "review", "done", at);
  assert.equal(b.state, "review");
  assert.deepEqual(b.history.map((h) => h.state), ["filling", "review"]);
  assert.equal(b.history[0].at, at.toISOString());
  assert.throws(() => transition(a, "nowhere"));
});

test("after the click, unclear and refused can be checked but not sent again", () => {
  assert.deepEqual([...CLICKED].sort(), ["refused", "unclear"]);
  for (const s of CLICKED) {
    assert.ok(can(s, "check"), s);
    assert.ok(!can(s, "submit") && !can(s, "confirm"), s);
  }
});
