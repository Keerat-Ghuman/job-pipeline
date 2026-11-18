import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEligibility, graduationWindow, requiredFields } from "../lib/eligibility.js";
import { scoreAndTag, capIneligible } from "../lib/scorer.js";

const facts = { workIn: ["Canada"], degree: "BCom, Finance", graduation: "2027-05" };
const desc = (extra) =>
  "Build financial models in Excel and support valuation and cash flow forecasting for a small team. " + extra;
const job = (extra) => ({ title: "Financial Analyst, New Grad", location: "Toronto, ON", description: desc(extra) });

test("a CS degree requirement is not eligible for a finance degree", () => {
  const r = checkEligibility(job("Requires a Bachelor's degree in Computer Science or Software Engineering."), facts);
  assert.equal(r.verdict, "no");
  assert.match(r.reasons[0], /computer science/);
});

test("finance, business and 'any field' degree asks stay eligible; preferred fields are ignored", () => {
  for (const extra of [
    "Bachelor's degree in Finance, Economics or Business required.",
    "A degree in any field is required.",
    "A degree in Computer Science is preferred.",
  ]) assert.equal(checkEligibility(job(extra), facts).verdict, "ok", extra);
});

test("graduating Dec 2027 or later does not fit a May 2027 graduate", () => {
  const r = checkEligibility(job("Candidates must be graduating December 2027 or later."), facts);
  assert.equal(r.verdict, "no");
  assert.match(r.reasons[0], /Dec 2027/);
  assert.equal(checkEligibility(job("Candidates must be graduating May 2027 or later."), facts).verdict, "ok");
});

test("graduation windows and later class years", () => {
  assert.deepEqual(graduationWindow("graduating between Jan 2026 and Dec 2026"), { from: 2026 * 12, to: 2026 * 12 + 11 });
  assert.equal(checkEligibility(job("Open to those graduating between Jan 2026 and Dec 2026."), facts).verdict, "no");
  assert.equal(checkEligibility(job("Open to the class of 2028."), facts).verdict, "no");
});

test("requiredFields reads degree fields", () => {
  assert.deepEqual(requiredFields("A bachelor's degree in Computer Science is required."), ["cs"]);
  assert.deepEqual(requiredFields("We love Computer Science. Nothing else."), []);
});

test("an ineligible job is capped below 100 with the reason in the score why", () => {
  const j = { ...job("Requires a degree in Computer Science. Graduating December 2027 or later."), employmentType: "Full-time" };
  const scored = scoreAndTag(j);
  const capped = capIneligible(scored, checkEligibility(j, facts));
  assert.ok(capped.matchScore <= 40);
  assert.match(capped.scoreWhy, /^not eligible: /);
  assert.equal(capIneligible(scored, { verdict: "ok", reasons: [] }).matchScore, scored.matchScore);
});

test("requiredFields does not read 'labs in' as a B.S.", () => {
  assert.deepEqual(requiredFields("Our labs in Toronto are required to be staffed by finance staff."), []);
  assert.deepEqual(requiredFields("A BS in Computer Science is required."), ["cs"]);
});
