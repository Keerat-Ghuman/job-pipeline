import test from "node:test";
import assert from "node:assert/strict";
import { checkEligibility } from "../lib/eligibility.js";
import { cleanLanguages, withLanguages } from "../lib/languages.js";

const base = { workIn: ["Canada"], tnEligible: false, graduation: "2028-04", degree: "Bachelor's", maxYearsExperience: 2 };
const english = { ...base, languages: ["English"] };
const withFrench = { ...base, languages: ["English", "French"] };

// The Float posting: "Bilingual" in the title, French never named in the description.
const float = {
  title: "Bilingual Operations Associate, Risk",
  location: "Toronto, ON",
  description: "Join our risk team. You will review accounts and help keep customers safe.",
};

test("a Bilingual title with no language named needs French in Canada", () => {
  const r = checkEligibility(float, english);
  assert.equal(r.verdict, "no");
  assert.deepEqual(r.reasons, ["Bilingual role: needs French as well as English"]);
});

test("adding French brings the Bilingual role back", () => {
  assert.equal(checkEligibility(float, withFrench).verdict, "ok");
  assert.equal(checkEligibility({ ...float, description: "Fluency in French is required." }, withFrench).verdict, "ok");
  assert.equal(checkEligibility({ ...float, description: "Fluency in French is required." }, english).verdict, "no");
});

test("a person with no languages saved is treated as English only", () => {
  assert.equal(checkEligibility(float, base).verdict, "no");
});

test("French-named titles and Spanish roles follow the chosen languages", () => {
  assert.equal(checkEligibility({ title: "Bilingual (English/French) Associate", location: "Montreal, QC" }, english).verdict, "no");
  assert.equal(checkEligibility({ title: "Associé bilingue", location: "Montreal, QC" }, english).verdict, "no");
  assert.equal(checkEligibility({ title: "Spanish Customer Support", description: "Native Spanish speaker." , location: "Toronto, ON" }, english).verdict, "check");
  assert.equal(checkEligibility({ title: "Spanish Customer Support", description: "Native Spanish speaker.", location: "Toronto, ON" }, { ...base, languages: ["English", "Spanish"] }).verdict, "ok");
});

test("Bilingual outside Canada: second-language speakers are asked to check, others are told", () => {
  const us = { ...float, location: "New York, NY" };
  assert.equal(checkEligibility(us, english).verdict, "no");
  const r = checkEligibility(us, { ...base, languages: ["English", "Spanish"] });
  assert.equal(r.verdict, "check");
});

test("a bilingual description alone is only a check, never a hide", () => {
  const job = (description) => ({ title: "Analyst", location: "Toronto, ON", description });
  assert.equal(checkEligibility(job("Bilingual candidates are an asset."), english).verdict, "check");
  assert.equal(checkEligibility(job("Our customers are bilingual families."), english).verdict, "check");
  assert.equal(checkEligibility(job("Bilingual candidates are an asset."), withFrench).verdict, "ok");
});

test("Bilingual with no place or Remote counts as Canada; other countries ask for a second language", () => {
  assert.equal(checkEligibility({ title: "Bilingual Associate", location: "Remote" }, english).verdict, "no");
  assert.equal(checkEligibility({ title: "Bilingual Associate" }, withFrench).verdict, "ok");
  assert.deepEqual(checkEligibility({ title: "Bilingual Associate", location: "London, UK" }, english).reasons, ["Bilingual role: needs a second language"]);
});

test("Mandarin speakers can take Chinese roles", () => {
  const job = { title: "Chinese Language Annotator", location: "Toronto, ON" };
  assert.equal(checkEligibility(job, english).verdict, "no");
  assert.equal(checkEligibility(job, { ...base, languages: ["English", "Mandarin"] }).verdict, "ok");
});

test("saved languages keep only known ones, once, and never end up empty", () => {
  assert.deepEqual(cleanLanguages(["french", "French", "Klingon", " english "]), ["English", "French"]);
  assert.deepEqual(cleanLanguages([]), ["English"]);
  assert.deepEqual(cleanLanguages("French"), ["English"]);
  const kit = withLanguages({ name: "x", eligibility: { degree: "Bachelor's", languages: ["English"] } }, ["English", "French"]);
  assert.deepEqual(kit.eligibility, { degree: "Bachelor's", languages: ["English", "French"] });
});
