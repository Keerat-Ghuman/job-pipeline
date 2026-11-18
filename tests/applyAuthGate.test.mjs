import { test } from "node:test";
import assert from "node:assert/strict";
import { gate, questionKind, countryFor } from "../lib/apply/authGate.js";

const canadian = { authorizedIn: ["Canada"], sponsorshipLaterIn: [], tnEligible: false };
const yn = [{ value: "1", label: "Yes" }, { value: "0", label: "No" }];
const field = (label, kind = "select", extra = {}) => ({ id: "f1", label, kind, options: kind === "select" || kind === "radio" ? yn : null, ...extra });
const run = (label, answer, ctx) => gate(field(label), { fieldId: "f1", ...answer }, ctx);

test("authorization and sponsorship are computed from the kit for the job's single country", () => {
  const ctx = { workAuth: canadian, jobLocation: "Toronto, ON" };
  assert.equal(run("Are you legally authorized to work in this country?", { value: "" }, ctx).value, "Yes");
  assert.equal(run("Will you now or in the future require sponsorship for employment visa status (e.g., H-1B)?", { value: "" }, ctx).value, "No");
  const us = { workAuth: canadian, jobLocation: "New York, NY" };
  assert.equal(run("Are you authorized to work in the country where this job is located?", { value: "" }, us).value, "No");
  assert.equal(run("Will you require sponsorship?", { value: "" }, us).value, "Yes");
});

test("sponsorship later: authorized yes, sponsorship yes", () => {
  const ctx = { workAuth: { authorizedIn: [], sponsorshipLaterIn: ["United States"], tnEligible: false }, jobLocation: "Remote (US)" };
  assert.equal(run("Are you authorized to work in the US?", { value: "" }, ctx).value, "Yes");
  assert.equal(run("Will you now or in the future require sponsorship?", { value: "" }, ctx).value, "Yes");
});

test("a standing answer for the wrong country is overruled", () => {
  const ctx = { workAuth: canadian, jobLocation: "San Francisco, CA" };
  const a = run("Are you authorized to work in the United States?", { value: "Yes", source: "standing" }, ctx);
  assert.equal(a.value, "No");
  assert.equal(a.source, "rule");
  assert.match(a.note, /Changed from "Yes"/);
});

test("the country named in the question beats the job's country", () => {
  assert.equal(countryFor("Are you authorized to work in Canada?", "New York, NY"), "Canada");
  assert.equal(run("Are you authorized to work in Canada?", { value: "" }, { workAuth: canadian, jobLocation: "New York, NY" }).value, "Yes");
});

test("remote or several countries leaves it for you, and clears any answer", () => {
  for (const jobLocation of ["Remote", "Toronto, ON or New York, NY", ""]) {
    const a = run("Are you authorized to work in the country where this job is?", { value: "Yes", source: "model" }, { workAuth: canadian, jobLocation });
    assert.equal(a.value, "", jobLocation);
    assert.equal(a.source, "you");
  }
});

test("negated and compound wording is left for you", () => {
  const ctx = { workAuth: canadian, jobLocation: "Toronto, ON" };
  assert.equal(run("Do you not require sponsorship?", { value: "No", source: "standing" }, ctx).source, "you");
  assert.equal(run("Are you authorized to work in Canada and will you now or in the future require sponsorship?", { value: "Yes", source: "rule" }, ctx).value, "");
  assert.equal(questionKind("Are you legally authorized to work in Canada without sponsorship?"), "auth");
});

test("TN-eligible: US sponsorship is left for you", () => {
  const ctx = { workAuth: { ...canadian, tnEligible: true }, jobLocation: "Austin, TX" };
  const a = run("Will you now or in the future require sponsorship?", { value: "No", source: "standing" }, ctx);
  assert.equal(a.source, "you");
  assert.equal(a.value, "");
  assert.equal(run("Will you require sponsorship?", { value: "" }, { ...ctx, jobLocation: "Toronto, ON" }).value, "No");
});

test("visa, citizenship and clearance questions are never written, even as free text", () => {
  const ctx = { workAuth: canadian, jobLocation: "Toronto, ON" };
  for (const label of ["What visa do you currently hold?", "Are you a US citizen?", "Do you have an active security clearance?"]) {
    const a = gate(field(label, "text"), { fieldId: "f1", value: "Some text", source: "written" }, ctx);
    assert.equal(a.value, "", label);
    assert.equal(a.source, "you");
  }
});

test("your own typed answer stands where the gate won't decide", () => {
  const ctx = { workAuth: canadian, jobLocation: "Remote" };
  assert.equal(run("Will you require sponsorship?", { value: "No", source: "you" }, ctx).value, "No");
});

test("questions not about authorization pass through, and 'us' the pronoun is not a country", () => {
  const a = { fieldId: "f1", value: "Ada", source: "rule" };
  assert.equal(gate(field("First name", "text"), a, { workAuth: canadian, jobLocation: "" }), a);
  assert.equal(countryFor("Why do you want to work with us?", "Remote"), null);
});

test("London, Ontario is Canada, not the United Kingdom, so a sponsorship question there has one country", async () => {
  const { countriesIn, countryFor } = await import("../lib/apply/authGate.js");
  assert.deepEqual(countriesIn("London, ON"), ["Canada"]);
  assert.deepEqual(countriesIn("London, Ontario"), ["Canada"]);
  assert.deepEqual(countriesIn("London, UK"), ["United Kingdom"]);
  assert.equal(countryFor("Will you require sponsorship?", "London, ON"), "Canada");
});

test("wordings of the work-authorization question all go through the gate", () => {
  const ctx = { workAuth: canadian, jobLocation: "London, ON" };
  for (const label of [
    "Are you legally able to work in Canada?",
    "Are you legally entitled to work in the United States?",
    "Can you work in Canada without restrictions?",
    "Are you able to provide proof of eligibility to work in Canada?",
  ]) {
    assert.notEqual(questionKind(label), null, label);
    assert.equal(questionKind(label), "auth", label);
    const a = run(label, { value: "Yes", source: "model" }, ctx);
    assert.equal(a.source, "rule", label);
  }
  assert.equal(run("Are you legally entitled to work in the United States?", { value: "Yes", source: "model" }, ctx).value, "No");
  assert.equal(run("Are you legally able to work in Canada?", { value: "No", source: "model" }, ctx).value, "Yes");
});

test("citizenship is answered from the kit: Yes for Canada, No for any other country", () => {
  const ctx = { workAuth: { ...canadian, citizenOf: ["Canada"] }, jobLocation: "New York, NY" };
  for (const l of ["Are you a Canadian citizen?", "Are you a citizen of Canada?", "Citizen of Canada"]) {
    assert.equal(questionKind(l), "citizen", l);
    assert.equal(run(l, { value: "No", source: "model" }, ctx).value, "Yes", l);
  }
  for (const l of ["Are you a US citizen?", "Are you a citizen of the United States?", "Are you a British citizen?"]) {
    assert.equal(run(l, { value: "Yes", source: "model" }, ctx).value, "No", l);
  }
  // Clearance, permanent residence and mixed questions are not answered here.
  for (const l of ["Do you hold a security clearance?", "Are you a citizen or permanent resident of the US?", "Are you a U.S. citizen or a green card holder?"]) {
    assert.equal(run(l, { value: "Yes", source: "model" }, ctx).value, "", l);
  }
  // Not in the kit: left for the owner, never guessed.
  assert.equal(run("Are you a citizen of Canada?", { value: "Yes", source: "model" }, { workAuth: canadian, jobLocation: "" }).value, "");
});

test("citizenship questions that exclude or negate a country are left for the owner", () => {
  const ctx = { workAuth: { ...canadian, citizenOf: ["Canada"] }, jobLocation: "Toronto, ON" };
  for (const l of [
    "Are you a citizen of a country other than Canada?", "Citizenship outside of Canada", "Are you a non-US citizen?", "Are you not a U.S. citizen?",
    "Citizen of any country except Canada?", "Citizen of a country excluding the United States?", "Citizen of a country besides Canada?", "Citizen of a country apart from Canada?",
  ]) {
    assert.equal(questionKind(l), "you", l);
    assert.equal(run(l, { value: "Yes", source: "model" }, ctx).value, "", l);
  }
});

test("an inferred citizenship says it was assumed", () => {
  const a = run("Are you a citizen of Canada?", { value: "" }, { workAuth: { ...canadian, citizenOf: ["Canada"], citizenAssumed: true }, jobLocation: "" });
  assert.match(a.note, /assumed from work authorization \(set applicant\.citizenship to change\)/);
  const b = run("Are you a citizen of Canada?", { value: "" }, { workAuth: { ...canadian, citizenOf: ["Canada"] }, jobLocation: "" });
  assert.match(b.note, /from your apply kit/);
});
