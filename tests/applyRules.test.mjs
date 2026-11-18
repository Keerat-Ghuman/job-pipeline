import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ruleAnswer, standingAnswer, matchOption } from "../lib/apply/rules.js";
import { buildFacts } from "../lib/apply/facts.js";

const facts = buildFacts(
  {
    applicant: {
      name: { first: "Ada", last: "Lovelace" },
      email: "ada@example.com",
      phone: "+1 555 0100",
      location: { city: "Toronto", region: "Ontario", country: "Canada" },
      links: { linkedin: "https://linkedin.com/in/ada" },
      school: { name: "Example University", degree: "Bachelor of Commerce", graduation: "2026-05" },
      answers: [{ question: "How did you hear about us?", answer: "LinkedIn" }],
    },
  },
  { root: "/r" },
);
const field = (label, kind = "text", extra = {}) => ({ id: "f0", label, kind, required: false, options: null, ...extra });
const opts = (...labels) => labels.map((l) => ({ value: l.toLowerCase(), label: l }));

test("names, contact, links and school come from the facts", () => {
  assert.equal(ruleAnswer(field("First Name"), facts).value, "Ada");
  assert.equal(ruleAnswer(field("Last name"), facts).value, "Lovelace");
  assert.equal(ruleAnswer(field("Full name"), facts).value, "Ada Lovelace");
  assert.equal(ruleAnswer(field("Email"), facts).value, "ada@example.com");
  assert.equal(ruleAnswer(field("Anything", "tel"), facts).value, "+1 555 0100");
  assert.equal(ruleAnswer(field("LinkedIn Profile"), facts).value, "https://linkedin.com/in/ada");
  assert.equal(ruleAnswer(field("School"), facts).value, "Example University");
  assert.equal(ruleAnswer(field("Expected graduation year"), facts).value, "2026");
  assert.equal(ruleAnswer(field("Location (City)"), facts).value, "Toronto");
});

test("the resume upload uses the track's resume file", () => {
  const a = ruleAnswer(field("Resume/CV", "file"), facts);
  assert.equal(a.source, "kit");
  assert.ok(a.value.startsWith(path.join("/r", "resumes") + path.sep), a.value);
});

test("demographic questions pick the decline option unless you set a value", () => {
  const gender = field("Gender", "select", { options: opts("Male", "Female", "Decline to self-identify") });
  assert.equal(ruleAnswer(gender, facts).value, "Decline to self-identify");
  const veteran = field("Veteran Status", "radio", { options: opts("I am a veteran", "I am not a veteran", "I don't wish to answer") });
  assert.equal(ruleAnswer(veteran, facts).value, "I don't wish to answer");
  const set = buildFacts({ applicant: { demographics: { gender: "Female" } } });
  assert.equal(ruleAnswer(gender, set).value, "Female");
});

test("privacy consent is ticked only when required; agreements and signatures are left for you", () => {
  assert.equal(ruleAnswer(field("I consent to the privacy notice", "checkbox", { required: true }), facts).value, "true");
  assert.equal(ruleAnswer(field("I consent to the privacy notice", "checkbox"), facts).value, "false");
  assert.equal(ruleAnswer(field("Send me marketing emails", "checkbox"), facts).value, "false");
  assert.equal(ruleAnswer(field("I agree to binding arbitration", "checkbox", { required: true }), facts).source, "you");
  assert.equal(ruleAnswer(field("Signature"), facts).source, "you");
  assert.equal(ruleAnswer(field("I certify that the information is true", "checkbox", { required: true }), facts).source, "you");
});

test("salary only when required, how-did-you-hear left for you", () => {
  assert.equal(ruleAnswer(field("Salary expectations"), facts).value, "");
  assert.equal(ruleAnswer(field("Salary expectations", "text", { required: true }), facts).value, "Negotiable");
  assert.equal(ruleAnswer(field("How did you hear about this job?"), facts).source, "you");
});

test("standing answers match after normalising and beat rules", () => {
  const f = field("How did you hear about us?", "select", { options: opts("Job board", "LinkedIn", "Friend") });
  assert.deepEqual(standingAnswer(f, facts), { value: "LinkedIn", source: "standing", note: "Your standing answer" });
  assert.equal(standingAnswer(field("how did you hear about us"), facts).value, "LinkedIn");
  assert.equal(standingAnswer(field("Something else"), facts), null);
});

test("option matching handles yes/no synonyms, decline phrasings and no match", () => {
  const yn = opts("Yes", "No");
  assert.equal(matchOption(yn, "yes"), "Yes");
  assert.equal(matchOption(opts("Yes, I am", "No, I am not"), "No"), "No, I am not");
  assert.equal(matchOption(opts("Yes", "No", "Prefer not to say"), "decline"), "Prefer not to say");
  assert.equal(matchOption(yn, "Maybe"), null);
  assert.equal(matchOption(opts("Canada", "United States"), "canada"), "Canada");
  assert.equal(matchOption([], "Yes"), null);
});

test("a select with no matching option is left for you", () => {
  const f = field("Degree", "select", { options: opts("High school", "PhD") });
  assert.equal(ruleAnswer(f, facts).source, "you");
});
