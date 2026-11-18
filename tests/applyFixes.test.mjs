// Fixes after a live trial on Ashby forms: contact rules, the writer's tense
// and claims, standing-answer shapes, number boxes and Check keeping answers.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apply-fixes-unit-"));
process.chdir(tmp);
delete process.env.NODE_ENV;
delete process.env.APPLY_DRY_RUN;
const { createRunner } = await import(new URL("../lib/apply/runner.js", import.meta.url));
const { jobId } = await import(new URL("../lib/jobId.js", import.meta.url));
const { ruleAnswer, isQuestionLabel } = await import(new URL("../lib/apply/rules.js", import.meta.url));
const { buildFacts, standingRows, schoolAliases } = await import(new URL("../lib/apply/facts.js", import.meta.url));
const { planAnswers, isOpenQuestion, unsupportedClaim } = await import(new URL("../lib/apply/plan.js", import.meta.url));
const { rolesOf } = await import(new URL("../lib/apply/roles.js", import.meta.url));
const { fillItems, readBackOf } = await import(new URL("../lib/apply/page.js", import.meta.url));

const field = (label, kind = "text", extra = {}) => ({ id: "f0", label, kind, required: false, options: null, ...extra });
const facts = buildFacts({ applicant: { name: { first: "Ada", last: "Lovelace" }, email: "ada@example.com", phone: "+1 555 0100", salaryIfRequired: "Negotiable" } });

const QUESTION =
  "Most customer interaction happens over email, so clear writing matters a lot here. Are you comfortable with writing short, careful emails every day?";

test("contact rules fit short field names, not long questions that mention the word", () => {
  assert.equal(ruleAnswer(field("Email"), facts).value, "ada@example.com");
  assert.equal(ruleAnswer(field("Email address *"), facts).value, "ada@example.com");
  assert.equal(ruleAnswer(field("Work email"), facts).value, "ada@example.com");
  assert.equal(ruleAnswer(field("Phone number"), facts).value, "+1 555 0100");
  assert.equal(ruleAnswer(field(QUESTION), facts), null);
  assert.equal(ruleAnswer(field("Do you prefer to be contacted by phone or email?"), facts), null);
  assert.equal(ruleAnswer(field("Your name", "text"), facts).value, "Ada Lovelace");
  assert.ok(isQuestionLabel(QUESTION));
  assert.ok(!isQuestionLabel("Email address"));
});

test("a long sentence ending in a question is an open question, written by the model", async () => {
  assert.ok(isOpenQuestion(field(QUESTION)));
  assert.ok(!isOpenQuestion(field("Email")));
  const asked = [];
  const model = async (q) => (asked.push(q), { data: { answers: q.schema.properties.answers.items.properties.text ? [{ fieldId: "f0", text: "Yes, I write clearly." }] : [] }, provider: "fake", skipped: [] });
  const { answers } = await planAnswers({ fields: [field(QUESTION)], facts, sources: {}, model });
  assert.equal(answers[0].value, "Yes, I write clearly.");
  assert.notEqual(answers[0].value, "ada@example.com");
});

const RESUME = {
  sections: [
    {
      id: "experience",
      entries: [
        { role: "Analyst", org: "Example Bank", dates: "May 2023 – January 2025" },
        { role: "Coordinator", org: "Example Club", dates: "September 2025 – Present" },
        { role: "Student", org: "Example University", dates: "Expected May 2027" },
      ],
    },
  ],
};

test("roles say which jobs ended and which are current", () => {
  const roles = rolesOf(RESUME, new Date("2026-11-14"));
  assert.deepEqual(roles.map((r) => r.current), [false, true, true]);
});

test("the writer is told the dates, which roles ended, and to use the past tense for them", async () => {
  const calls = [];
  const model = async (q) => (calls.push(q), { data: { answers: [{ fieldId: "f0", text: "At Example Bank I built reports." }] }, provider: "fake", skipped: [] });
  const sources = { posting: "p", resumeText: "Analyst Example Bank built reports", roles: rolesOf(RESUME, new Date("2026-11-14")), today: "2026-11-14" };
  await planAnswers({ fields: [field("Tell us about yourself", "textarea")], facts, sources, model });
  const q = calls[0];
  assert.match(q.prompt, /Analyst, Example Bank: May 2023 – January 2025 \(ENDED: use past tense\)/);
  assert.match(q.prompt, /Coordinator, Example Club: September 2025 – Present \(CURRENT/);
  assert.match(q.prompt, /today is 2026-11-14/);
  assert.match(q.system, /past tense for every role marked ENDED/);
  assert.match(q.system, /Never imply an ended job is current/);
  assert.match(q.system, /Never state an outcome, result, number, skill, tool or employer detail that is not there/);
});

test("an answer claiming an outcome that isn't in the sources is dropped for you to write", async () => {
  const sources = ["Analyst at Example Bank. Built shift schedules for the kitchen team."];
  assert.equal(unsupportedClaim("I built shift schedules for the kitchen team.", sources), null);
  assert.ok(unsupportedClaim("I built the rota. The outcome was better run scheduling and less waste.", sources));
  assert.ok(unsupportedClaim("This reduced costs and saved the team hours.", sources));
  assert.equal(unsupportedClaim("This improved the kitchen schedules.", sources), null);
  const model = async () => ({ data: { answers: [{ fieldId: "f0", text: "I built shift schedules. The outcome was better run scheduling and less waste." }] }, provider: "fake", skipped: [] });
  const { answers } = await planAnswers({ fields: [field("Describe a project", "textarea")], facts, sources: { resumeText: sources[0] }, model });
  assert.equal(answers[0].value, "");
  assert.equal(answers[0].source, "none");
  assert.match(answers[0].note, /result/);
});

test("standing answers work as label/value or question/answer rows, at the top level or under applicant", () => {
  const kit = {
    applicant: { answers: [{ question: "Q one", answer: "A one" }, { label: "Q two", value: "A two" }] },
    answers: [{ label: "Q three", value: "A three" }, { question: "q one", answer: "dup" }, { label: "Q four", value: "EDIT ME" }],
  };
  assert.deepEqual(standingRows(kit), [
    { question: "Q one", answer: "A one" },
    { question: "Q two", answer: "A two" },
    { question: "Q three", answer: "A three" },
  ]);
  assert.equal(buildFacts(kit).answers.length, 3);
  const f = buildFacts({ answers: [{ label: "Why us?", value: "Because." }] });
  assert.equal(f.answers[0].answer, "Because.");
});

test("school aliases come from the table and the kit", () => {
  const f = buildFacts({ applicant: { school: { name: "University of Western Ontario", aliases: ["Western"] } } });
  assert.ok(schoolAliases(f).includes("Western University"));
  assert.ok(schoolAliases(f).includes("Western"));
  assert.ok(!schoolAliases(f).includes("University of Western Ontario"));
  const rule = ruleAnswer(field("School"), f);
  assert.equal(rule.value, "University of Western Ontario");
  assert.ok(rule.aliases.includes("Western University"));
  const items = fillItems([field("School", "text", { id: "f0", selector: "#s", combobox: true })], [{ fieldId: "f0", ...rule }]);
  assert.deepEqual([items[0].combobox, items[0].aliases.includes("Western University")], [true, true]);
  const sel = field("School", "select", { options: [{ value: "1", label: "Western University" }] });
  assert.equal(ruleAnswer(sel, f).value, "Western University", "a dropdown finds the school by an alias");
});

test("a number-only box never gets text; a numeric kit salary is used", () => {
  const box = field("Salary expectation", "number", { required: true, numeric: true });
  const r = ruleAnswer(box, facts);
  assert.equal(r.value, "");
  assert.equal(r.source, "you");
  const withNumber = buildFacts({ applicant: { salaryIfRequired: "Negotiable", salaryNumber: "$55,000" } });
  assert.equal(ruleAnswer(box, withNumber).value, "55000");
  assert.equal(ruleAnswer(field("Salary expectation", "text", { required: true }), withNumber).value, "Negotiable");
  assert.equal(ruleAnswer(field("Salary expectation", "text", { required: true, numeric: true }), facts).source, "you");
});

test("a combobox read-back accepts the option the list showed", () => {
  const f = field("School", "text", { id: "f0", combobox: true, value: "Western University" });
  const rb = readBackOf([f], [{ fieldId: "f0", value: "University of Western Ontario", aliases: ["Western University"] }]);
  assert.equal(rb[0].ok, true);
});

// Check never replaces the planned answers.
const LINK = "https://boards.greenhouse.io/acme/jobs/9";
const ID = jobId(LINK);
beforeEach(() => fs.rmSync(path.join(tmp, "data"), { recursive: true, force: true }));

function harness() {
  const base = [
    { id: "f0", selector: "#first", kind: "text", label: "First name", required: true, options: null },
    { id: "f1", selector: "#why", kind: "textarea", label: "Why Acme?", required: false, options: null },
  ];
  const shows = {};
  const page = {
    url: LINK,
    fields: base,
    read: async () => ({ url: page.url, fields: page.fields.map((f) => ({ ...f, value: shows[f.label] ?? "" })), blockers: [] }),
    fill: async (items) => (items.forEach((i) => (shows[page.fields.find((f) => f.id === i.fieldId).label] = i.value)), []),
    upload: async () => {},
    clickSubmit: async () => true,
    errorCount: async () => 0,
    result: async () => "pending",
    embeddedFormUrl: async () => "",
    navigate: async () => {},
    close: () => {},
  };
  const row = { Link: LINK, Company: "Acme", Status: "Awaiting Your Approval", "Role Title": "Analyst", "Country/Remote": "Toronto, ON", "CV Version Used": "startup", _row: 2 };
  const runner = createRunner({
    context: async () => ({ row, posting: "Acme makes tools.", resumeText: "Ran a club.", kit: { applicant: { name: { first: "Ada", last: "L" } } } }),
    sheet: { getAllJobs: async () => [row], updateStatus: async () => {}, setFollowUpDate: async () => {} },
    browser: { open: async () => ({ port: 1, targetId: "t" }), attach: async () => page, close: async () => {} },
    ask: async (q) => ({ data: { answers: q.schema.properties.answers.items.properties.text ? [{ fieldId: "f1", text: "A long written answer about tools." }] : [] }, provider: "fake", skipped: [] }),
    logEvent: () => {},
    settleMs: 0,
  });
  return { runner, page, shows };
}

test("Check re-reads the page and leaves the planned answers alone, even when the page shows something else", async () => {
  const { runner, shows } = harness();
  await (await runner.fill(ID)).done;
  const before = (await runner.get(ID)).answers;
  assert.equal(before.find((a) => a.fieldId === "f1").value, "A long written answer about tools.");
  shows["Why Acme?"] = "";
  shows["First name"] = "Changed in the browser";
  const app = await runner.check(ID);
  assert.deepEqual(app.answers, before);
  assert.equal(app.state, "blocked");
  assert.equal(app.readBack.find((r) => r.fieldId === "f1").ok, false, "the read-back reports the difference");
});

test("when the form's questions change, Check keeps the answers with their questions", async () => {
  const { runner, page } = harness();
  await (await runner.fill(ID)).done;
  const written = (await runner.get(ID)).answers.find((a) => a.fieldId === "f1");
  page.fields = [{ id: "f0", selector: "#extra", kind: "text", label: "New first", required: false, options: null }, { ...page.fields[0], id: "f1" }, { ...page.fields[1], id: "f2" }];
  const app = await runner.check(ID);
  assert.equal(app.answers.find((a) => a.fieldId === "f2").value, written.value, "the long answer moved to its new id");
  assert.equal(app.answers.find((a) => a.fieldId === "f1").value, "Ada");
});

test("short contact questions get the contact answer, never the writer", async () => {
  const f2 = buildFacts({ applicant: { name: { first: "Ada", last: "Lovelace" }, email: "ada@example.com", phone: "+1 555 0100", links: { linkedin: "https://linkedin.com/in/ada", github: "ada-l" } } });
  for (const [label, want] of [
    ["What is your email address?", "ada@example.com"],
    ["What is your phone number?", "+1 555 0100"],
    ["What is your full legal name?", "Ada Lovelace"],
    ["What is your LinkedIn profile URL?", "https://linkedin.com/in/ada"],
    ["What is your GitHub username?", "ada-l"],
  ]) {
    assert.equal(ruleAnswer(field(label), f2)?.value, want, label);
    const asked = [];
    const model = async (q) => (asked.push(q), { data: { answers: [] }, provider: "fake", skipped: [] });
    const { answers } = await planAnswers({ fields: [field(label)], facts: f2, sources: {}, model });
    assert.equal(answers[0].value, want, label);
    assert.equal(asked.length, 0, `the writer wasn't asked: ${label}`);
  }
  assert.equal(ruleAnswer(field("Are you comfortable with email?"), facts), null);
  assert.equal(ruleAnswer(field(QUESTION), facts), null);
});

test("a strict combobox takes only an exact option, in the fill and in the read-back", () => {
  const fields = [{ id: "f0", label: "City", kind: "text", combobox: true, selector: "#c", value: "London, UK" }];
  const answers = [{ fieldId: "f0", value: "London", aliases: ["London, ON"] }];
  assert.equal(fillItems(fields, answers)[0].strict, undefined);
  assert.equal(fillItems(fields, answers, { strict: true })[0].strict, true);
  assert.equal(readBackOf(fields, answers)[0].ok, true, "the loose read-back still passes");
  const strict = readBackOf(fields, answers, { strict: true })[0];
  assert.equal(strict.ok, false);
  assert.equal(strict.problem, "wrong value");
  assert.equal(readBackOf([{ ...fields[0], value: "London, ON" }], answers, { strict: true })[0].ok, true, "a known alias, exactly");
  assert.equal(readBackOf([{ ...fields[0], value: "london" }], answers, { strict: true })[0].ok, true, "exact after normalising");
});

test("required agreements are ticked, optional ones and legal items are not", async () => {
  const box = (label, required) => field(label, "checkbox", { required });
  const tick = (label, required) => ruleAnswer(box(label, required), facts)?.value;
  assert.equal(tick("I agree to the Terms and Conditions", true), "true");
  assert.equal(tick("I acknowledge that I have read the Privacy Notice", true), "true");
  assert.equal(tick("I consent to data processing as described in the privacy notice", true), "true");
  assert.equal(tick("I agree to the Terms and Conditions", false), "false");
  for (const l of ["I agree to receive SMS updates", "Send me WhatsApp messages about jobs", "I agree to receive marketing emails"]) assert.notEqual(tick(l, true), "true", l);
  for (const l of [
    "I consent to a background check", "I consent to a credit check", "I agree to take a drug test", "I consent to biometric data collection",
    "I agree to the recording of my interview", "I consent to the use of AI in the hiring process", "I agree to be contacted by phone or email",
    "I agree to receive emails about my application", "I understand this role requires travel and weekend shifts",
  ]) assert.notEqual(tick(l, true), "true", l);
  for (const l of ["I agree to binding arbitration", "I agree to sign a non-disclosure agreement", "I agree to a non-compete", "I certify that this is true"]) assert.equal(tick(l, true), "", l);

});
