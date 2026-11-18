import { test } from "node:test";
import assert from "node:assert/strict";
import { planAnswers, planHash, numbersSupported } from "../lib/apply/plan.js";
import { buildFacts } from "../lib/apply/facts.js";

const facts = buildFacts({
  applicant: {
    name: { first: "Ada", last: "Lovelace" },
    email: "ada@example.com",
    school: { name: "Example University", field: "Mathematics" },
    workAuth: { authorizedIn: ["Canada"] },
    answers: [{ question: "Are you authorized to work in the United States?", answer: "Yes" }],
  },
});
const yn = [{ value: "y", label: "Yes" }, { value: "n", label: "No" }];
const FIELDS = [
  { id: "f0", label: "First name", kind: "text", required: true },
  { id: "f1", label: "Area of concentration", kind: "text", required: false },
  { id: "f2", label: "Why do you want to work here?", kind: "textarea", required: true, maxLength: 400 },
  { id: "f3", label: "Are you authorized to work in the United States?", kind: "select", options: yn, required: true },
  { id: "f4", label: "Favourite colour", kind: "text", required: false },
];
const job = { title: "Analyst", company: "Acme", location: "New York, NY" };
const sources = { posting: "Acme builds tools for 30 teams.", resumeText: "Led a club of 40 members." };

function fakeModel(replies) {
  const calls = [];
  const model = async (q) => {
    calls.push(q);
    const data = q.schema.properties.answers.items.properties.key ? replies.map : replies.write;
    return { data, provider: "fake", skipped: [] };
  };
  return { model, calls };
}

test("rules first, one mapping call for short fields, one writing call for open questions, gate last", async () => {
  const { model, calls } = fakeModel({
    map: { answers: [{ fieldId: "f1", key: "field_of_study" }, { fieldId: "f4", key: "unknown" }] },
    write: { answers: [{ fieldId: "f2", text: "I led a club of 40 members and like Acme's tools." }] },
  });
  const { answers, model: info } = await planAnswers({ fields: FIELDS, facts, job, sources, model });
  const by = Object.fromEntries(answers.map((a) => [a.fieldId, a]));
  assert.equal(by.f0.value, "Ada");
  assert.equal(by.f0.source, "rule");
  assert.deepEqual([by.f1.value, by.f1.source], ["Mathematics", "model"]);
  assert.deepEqual([by.f2.source, by.f2.value.startsWith("I led")], ["written", true]);
  assert.equal(by.f3.value, "No", "the gate overrules the standing answer for the US");
  assert.deepEqual([by.f4.value, by.f4.source], ["", "none"]);
  assert.equal(calls.length, 2);
  assert.equal(info.provider, "fake");
});

test("labels about authorization never reach the model", async () => {
  const { model, calls } = fakeModel({ map: { answers: [] }, write: { answers: [] } });
  await planAnswers({ fields: FIELDS, facts, job, sources, model });
  const sent = calls.map((c) => c.prompt).join("\n");
  assert.ok(!/authorized to work/i.test(sent));
  assert.ok(calls.every((c) => !/sponsor/i.test(c.prompt)));
});

test("a written answer with a number not in the sources is dropped", async () => {
  const { model } = fakeModel({ map: { answers: [] }, write: { answers: [{ fieldId: "f2", text: "I grew revenue 300% at 40 clubs." }] } });
  const { answers } = await planAnswers({ fields: FIELDS, facts, job, sources, model });
  const a = answers.find((x) => x.fieldId === "f2");
  assert.deepEqual([a.value, a.source], ["", "none"]);
  assert.ok(numbersSupported("40 members", ["club of 40"]));
  assert.ok(!numbersSupported("41 members", ["club of 40"]));
});

test("the model can't type values: unknown keys and invented ids are ignored", async () => {
  const { model } = fakeModel({ map: { answers: [{ fieldId: "f4", key: "secret_key" }, { fieldId: "f9", key: "email" }] }, write: { answers: [] } });
  const { answers } = await planAnswers({ fields: FIELDS, facts, job, sources, model });
  assert.equal(answers.find((a) => a.fieldId === "f4").value, "");
  assert.equal(answers.length, FIELDS.length);
});

test("without a model, everything not covered is marked needs you", async () => {
  const { answers } = await planAnswers({ fields: FIELDS, facts, job, sources });
  assert.equal(answers.find((a) => a.fieldId === "f2").source, "none");
  assert.equal(answers.find((a) => a.fieldId === "f2").note, "Needs you");
});

test("your edits win, and earlier written answers are kept without asking again", async () => {
  const { model, calls } = fakeModel({ map: { answers: [] }, write: { answers: [] } });
  const previous = [{ fieldId: "f2", value: "Kept answer.", source: "written", note: "" }];
  const { answers } = await planAnswers({ fields: FIELDS, facts, job, sources, model, previous, edits: [{ fieldId: "f0", value: "Augusta" }] });
  assert.deepEqual(answers.find((a) => a.fieldId === "f0"), { fieldId: "f0", value: "Augusta", source: "you", note: "Your answer" });
  assert.equal(answers.find((a) => a.fieldId === "f2").value, "Kept answer.");
  assert.ok(!calls.some((c) => c.schema.properties.answers.items.properties.text), "no writing call");
});

test("planHash changes with the form, the answers and the read-back", () => {
  const app = { formUrl: "http://127.0.0.1/f", fields: FIELDS, answers: [{ fieldId: "f0", value: "Ada" }], readBack: [{ fieldId: "f0", shows: "Ada", ok: true }] };
  const h = planHash(app);
  assert.equal(h, planHash({ ...app }));
  assert.notEqual(h, planHash({ ...app, fields: [...FIELDS, { id: "f5", label: "New", kind: "text" }] }));
  assert.notEqual(h, planHash({ ...app, answers: [{ fieldId: "f0", value: "Bob" }] }));
  assert.notEqual(h, planHash({ ...app, readBack: [{ fieldId: "f0", shows: "", ok: false }] }));
});

test("an edit can't point a file upload at another file on this computer", async () => {
  const withResume = { ...facts, resumeFile: "/resumes/ada.pdf" };
  const fields = [{ id: "f0", label: "Resume/CV", kind: "file", required: true }];
  const { answers } = await planAnswers({ fields, facts: withResume, edits: [{ fieldId: "f0", value: "/Users/ada/.ssh/id_rsa" }] });
  assert.notEqual(answers[0].value, "/Users/ada/.ssh/id_rsa");
  assert.notEqual(answers[0].source, "you");
});

test("an answer Claude took over is kept by a later fill, but your own edit beats it", async () => {
  const { planAnswers } = await import("../lib/apply/plan.js");
  const { buildFacts } = await import("../lib/apply/facts.js");
  const facts = buildFacts({ applicant: { name: { first: "Ada", last: "Lovelace" } } });
  const fields = [{ id: "f0", kind: "text", label: "Favourite programming language", required: true }];
  const model = async () => ({ data: { answers: [] }, provider: "fake", skipped: [] });
  const taken = await planAnswers({ fields, facts, model, edits: [{ fieldId: "f0", value: "Python", source: "takeover", note: "Answered by Claude (sonnet)" }] });
  assert.equal(taken.answers[0].value, "Python");
  assert.equal(taken.answers[0].source, "takeover");
  const kept = await planAnswers({ fields, facts, model, previous: taken.answers });
  assert.equal(kept.answers[0].value, "Python");
  assert.equal(kept.answers[0].source, "takeover");
  const typed = await planAnswers({ fields, facts, model, previous: taken.answers, edits: [{ fieldId: "f0", value: "Rust" }] });
  assert.deepEqual([typed.answers[0].value, typed.answers[0].source], ["Rust", "you"]);
});
