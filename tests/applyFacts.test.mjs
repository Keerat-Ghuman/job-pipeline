import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildFacts, FACT_KEYS, valueFor } from "../lib/apply/facts.js";

const oldKit = {
  profile: [
    { label: "Full name", value: "Ada Byron Lovelace" },
    { label: "Email", value: "ada@example.com" },
    { label: "Phone", value: "EDIT ME" },
    { label: "LinkedIn", value: "https://linkedin.com/in/ada" },
  ],
  eligibility: { workIn: ["Canada"], tnEligible: true, graduation: "2026-05", degree: "Bachelor's" },
};

test("without an applicant section, facts fall back to the profile rows and eligibility", () => {
  const f = buildFacts(oldKit, { root: "/x" });
  assert.deepEqual(f.name, { first: "Ada", last: "Byron Lovelace", preferred: "" });
  assert.equal(f.email, "ada@example.com");
  assert.equal(f.links.linkedin, "https://linkedin.com/in/ada");
  assert.deepEqual(f.workAuth, { authorizedIn: ["Canada"], sponsorshipLaterIn: [], tnEligible: true, citizenOf: ["Canada"], citizenAssumed: true });
  assert.deepEqual(buildFacts({ applicant: { workAuth: { authorizedIn: ["United States"] } } }).workAuth.citizenOf, [], "citizenship is never invented");
  assert.deepEqual(buildFacts({ applicant: { citizenship: ["Ireland"] } }).workAuth.citizenOf, ["Ireland"]);
  assert.equal(f.school.graduation, "2026-05");
  assert.equal(f.salaryIfRequired, "Negotiable");
  assert.equal(f.demographics.gender, "decline");
  assert.ok(f.resumeFile.startsWith(path.join("/x", "resumes") + path.sep), f.resumeFile);
});

test("EDIT ME counts as missing", () => {
  assert.equal(buildFacts(oldKit).phone, "");
  assert.equal(buildFacts({ applicant: { email: "EDIT ME", answers: [{ question: "Q", answer: "EDIT ME" }] } }).answers.length, 0);
});

test("the applicant section wins over the old rows", () => {
  const f = buildFacts({
    ...oldKit,
    applicant: {
      name: { first: "Augusta", last: "King", preferred: "Ada" },
      workAuth: { authorizedIn: ["Canada", "United States"], sponsorshipLaterIn: [] },
      demographics: { gender: "Female" },
      answers: [{ question: "Are you over 18?", answer: "Yes" }],
    },
  });
  assert.equal(valueFor(f, "full_name"), "Augusta King");
  assert.equal(valueFor(f, "preferred_name"), "Ada");
  assert.deepEqual(f.workAuth.authorizedIn, ["Canada", "United States"]);
  assert.equal(f.demographics.gender, "Female");
  assert.equal(f.demographics.race, "decline");
  assert.deepEqual(f.answers, [{ question: "Are you over 18?", answer: "Yes" }]);
});

test("an empty applicant authorizedIn list falls back to eligibility.workIn", () => {
  assert.deepEqual(buildFacts({ ...oldKit, applicant: { workAuth: { authorizedIn: [], sponsorshipLaterIn: [] } } }).workAuth.authorizedIn, ["Canada"]);
});

test("every fact key has a definition and valueFor knows it", () => {
  const f = buildFacts(oldKit);
  for (const { key, definition } of FACT_KEYS) {
    assert.ok(definition, key);
    assert.equal(typeof valueFor(f, key), "string");
  }
  assert.equal(valueFor(f, "graduation_date"), "May 2026");
  assert.equal(valueFor(f, "graduation_year"), "2026");
  assert.equal(valueFor(f, "no_such_key"), "");
  assert.ok(!FACT_KEYS.some((k) => /author|sponsor|visa/.test(k.key)), "work authorization is never a model key");
});
