import { test } from "node:test";
import assert from "node:assert/strict";
import { DEGREE_TYPES, degreeOf, degreeStatus, meetsRequirement, nounOf, requiredDegrees } from "../lib/degrees.js";

const key = (text) => degreeOf(text)?.key;

test("old saved answers read as before", () => {
  assert.equal(key("Bachelor's"), "bachelor");
  assert.equal(key("MBA"), "mba");
  assert.equal(key("Master's"), "master");
  assert.equal(key("PhD"), "phd");
  assert.equal(key("High school"), "high_school");
  assert.equal(key("College diploma"), "diploma");
  assert.equal(degreeOf(null), null);
  assert.equal(degreeOf("  "), null);
});

test("typed degrees are read however they're written", () => {
  assert.equal(key("JD student"), "jd");
  assert.equal(key("Juris Doctor (2L)"), "jd");
  assert.equal(key("J.D./M.B.A."), "jd_mba");
  assert.equal(key("LL.B."), "llb");
  assert.equal(key("Bachelor of Laws"), "llb");
  assert.equal(key("M.D."), "md");
  assert.equal(key("DMD"), "dds");
  assert.equal(key("Ph.D. candidate"), "phd");
  assert.equal(key("Honours BA in Economics"), "ba");
  assert.equal(key("Bachelor of Science in Nursing"), "bsn");
  assert.equal(key("B.Tech"), "btech");
  assert.equal(key("MBBS"), "mbbs");
  assert.equal(key("Maîtrise"), "master");
  assert.equal(key("DEC en sciences humaines"), "cegep");
  assert.equal(key("Master of Science in Finance"), "master");
});

test("short words don't read as degrees in the middle of an answer", () => {
  assert.equal(key("BSc, graduating March 2027"), "bsc");
  assert.equal(key("Do not have one"), "other");
});

test("an unknown degree keeps what was typed and meets every requirement", () => {
  const mine = degreeOf("Sommelier, level 2");
  assert.equal(mine.key, "other");
  assert.equal(mine.label, "Sommelier, level 2");
  for (const t of DEGREE_TYPES) assert.equal(meetsRequirement(mine, t), true, t.key);
});

test("every Simplify degree value maps to a known type", () => {
  for (const v of ["Bachelor's", "Master's", "PhD", "Associate's", "MBA", "Certificate", "JD", "MD", "Bootcamp", "Incomplete", "PharmD", "DVM", "DO", "DDS"]) {
    assert.notEqual(key(v), "other", v);
  }
});

test("law degrees meet a JD requirement and a bachelor's doesn't", () => {
  const jd = degreeOf("JD");
  for (const d of ["JD", "LLB", "JD/MBA", "LLM"]) assert.equal(meetsRequirement(degreeOf(d), jd), true, d);
  for (const d of ["Bachelor's", "Master's", "MBA", "MD"]) assert.equal(meetsRequirement(degreeOf(d), jd), false, d);
});

test("a JD counts as a graduate degree but not as an MBA or PhD", () => {
  const jd = degreeOf("JD");
  assert.equal(meetsRequirement(jd, degreeOf("graduate degree")), true);
  assert.equal(meetsRequirement(jd, degreeOf("Master's")), true);
  assert.equal(meetsRequirement(jd, degreeOf("MBA")), false);
  assert.equal(meetsRequirement(jd, degreeOf("PhD")), false);
  assert.equal(meetsRequirement(degreeOf("JD/MBA"), degreeOf("MBA")), true);
});

test("an undergraduate requirement never rules anyone out", () => {
  for (const d of ["High school", "College diploma", "Certificate"]) {
    assert.equal(meetsRequirement(degreeOf(d), degreeOf("Bachelor's")), true, d);
  }
});

test("a degree is in progress until its graduation month passes", () => {
  const today = new Date(2026, 10, 4);
  assert.equal(degreeStatus({ graduation: "2027-05" }, today), "in_progress");
  assert.equal(degreeStatus({ graduation: "2026-11" }, today), "in_progress");
  assert.equal(degreeStatus({ graduation: "2026-10" }, today), "completed");
  assert.equal(degreeStatus({}, today), null);
});

test("an answer naming several degrees reads as the highest", () => {
  assert.equal(key("MBA candidate, BCom 2022"), "mba");
  assert.equal(key("MSc Finance (BCom 2022)"), "master");
  assert.equal(key("PhD candidate (BSc, MSc)"), "phd");
  assert.equal(key("Bachelor of Arts in Law and Society; JD 2027"), "jd");
  assert.equal(key("2L JD student"), "jd");
});

test("plans, dates and school names aren't read as degrees", () => {
  assert.equal(key("Honours BA, applying to law school"), "ba");
  assert.equal(key("March 2027, BCom"), "bcom");
  assert.equal(key("College of Engineering BASc"), "basc");
  assert.equal(key("University College London BSc"), "bsc");
  assert.equal(key("Some college, no degree"), "incomplete");
  assert.equal(key("Law school, 2L"), "jd");
});

test("every degree in the list reads back as itself", () => {
  for (const t of DEGREE_TYPES) assert.equal(key(t.label), t.key, t.label);
});

test("each degree has a word that fits in a sentence", () => {
  assert.equal(nounOf(degreeOf("OD (optometry)")), "OD");
  assert.equal(nounOf(degreeOf("DDS or DMD")), "DDS");
  assert.equal(nounOf(degreeOf("Some college, no degree")), "");
  assert.equal(nounOf(degreeOf("JD")), "JD");
  assert.equal(nounOf(degreeOf("Sommelier, level 2")), "Sommelier, level 2");
  for (const t of DEGREE_TYPES) assert.doesNotMatch(nounOf(t), /[(),]| or /, t.key);
});

const asked = (text) => requiredDegrees(text).map((t) => t.key);

test("a posting asking for a degree in general isn't read as a Master's", () => {
  for (const text of [
    "Recent graduate, degree required.",
    "University graduate (degree required).",
    "Bachelor's or graduate degree required.",
    "Post-graduate degree is required.",
    "This role requires an advanced degree or equivalent experience.",
  ]) assert.deepEqual(asked(text), [], text);
  assert.deepEqual(asked("A Master's degree is required."), ["master"]);
});

test("a degree the posting says it doesn't need isn't required", () => {
  for (const text of ["No PhD required.", "no JD required", "This role does not require an MBA.", "Doesn't require a PhD."]) {
    assert.deepEqual(asked(text), [], text);
  }
});

test("JD Edwards isn't a law degree", () => {
  assert.deepEqual(asked("Requires JD Edwards experience."), []);
  assert.deepEqual(asked("Must have JD Edwards knowledge."), []);
  assert.deepEqual(asked("J.D. required."), ["jd"]);
  assert.deepEqual(asked("You must hold a JD from an accredited school."), ["jd"]);
});

test("a requirement that also lists a bachelor's asks for nothing above it", () => {
  for (const text of [
    "Bachelor's or Master's degree is required.",
    "Bachelor's degree or Master's degree required.",
    "Bachelor's degree (or Master's degree) required.",
    "Bachelor's, Master's, or PhD required.",
    "Bachelor's/Master's degree required.",
    "Requires a Bachelor's or Master's degree.",
    "Bachelor's degree is required and a Master's degree is required for managers.",
    "BA or MBA required.",
  ]) assert.deepEqual(asked(text), [], text);
});

test("a graduate degree asked for on its own is still required", () => {
  assert.deepEqual(asked("Master's degree required."), ["master"]);
  assert.deepEqual(asked("Requires an MBA."), ["mba"]);
  assert.deepEqual(asked("A JD is required."), ["jd"]);
  assert.deepEqual(asked("Doctorate required."), ["phd"]);
  assert.deepEqual(asked("Master's or PhD required."), ["master", "phd"]);
  assert.deepEqual(asked("A PhD is not required, a Master's degree is required."), ["master"]);
  assert.deepEqual(asked("Summer Associate. JD required."), ["jd"]);
  assert.deepEqual(asked("MBA from an accredited college required."), ["mba"]);
});

test("a degree far from the word required isn't read as required", () => {
  assert.deepEqual(asked("This role requires travel to client sites across the region, with PhD students welcome to apply."), []);
});

test("a degree someone plans to get isn't read as one they hold", () => {
  assert.equal(key("Bachelor's, planning a Master's"), "bachelor");
  assert.equal(key("Bachelor degree, Master of Arts planned"), "bachelor");
  assert.equal(key("BA, applying to law school"), "ba");
  assert.equal(key("BCom; will start an MBA next fall"), "bcom");
  assert.equal(key("Planning a Master's"), "other");
  assert.equal(key("Bachelor of Applied Science"), "basc");
});

test("a degree with a graduation year is one in progress, and counts", () => {
  assert.equal(key("Bachelor, Masters 2027"), "master");
  assert.equal(key("Bachelors in CS, MBA 2027"), "mba");
});

test("dotted and spaced abbreviations read as their degree", () => {
  assert.equal(key("B. Comm."), "bcom");
  assert.equal(key("b comm"), "bcom");
  assert.equal(key("B. Sc."), "bsc");
  assert.equal(key("b sc"), "bsc");
  assert.equal(key("B. A."), "ba");
});

test("MS Excel isn't a Master's", () => {
  assert.equal(key("MS Excel"), "other");
  assert.equal(key("BCom, MS Office"), "bcom");
  assert.equal(key("MS in Finance"), "master");
});
