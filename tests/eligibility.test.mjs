import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEligibility, eligibilityCell, yearsAsked, graduationYears } from "../lib/eligibility.js";
import { eligibilityChanges } from "../lib/eligibilityRun.js";

const canadian = {
  workIn: ["Canada"],
  tnEligible: true,
  graduation: "2027-05",
  degree: "Bachelor's",
  languages: ["English"],
  certifications: [],
  maxYearsExperience: 2,
};
const job = (title, extra = {}) => ({ title, description: "", location: "Toronto, ON", ...extra });

test("a Canadian job with nothing special is eligible", () => {
  assert.deepEqual(checkEligibility(job("Financial Analyst"), canadian), { verdict: "ok", reasons: [], notes: [] });
});

test("US citizenship or clearance rules a Canadian out", () => {
  const r = checkEligibility(job("Analyst", { location: "New York, NY", description: "Must be a U.S. citizen." }), canadian);
  assert.equal(r.verdict, "no");
  assert.match(r.reasons[0], /US citizenship/);
  assert.equal(
    checkEligibility(job("Analyst", { location: "Arlington, VA", sponsorship: "U.S. Citizenship is Required" }), canadian).verdict,
    "no",
  );
  assert.equal(checkEligibility(job("Analyst", { location: "Austin, TX", description: "Active Secret clearance required." }), canadian).verdict, "no");
});

test("a US job without sponsorship is flagged for a TN check, not hidden", () => {
  const r = checkEligibility(
    job("Strategy Associate", { location: "San Francisco, CA", description: "We are unable to sponsor visas for this role." }),
    canadian,
  );
  assert.equal(r.verdict, "check");
  assert.match(r.reasons[0], /TN visa/);
  assert.equal(checkEligibility(job("Ops Analyst", { location: "Remote (US)" }), canadian).verdict, "no");
});

test("a US job that says nothing about visas is fine, with a quiet note", () => {
  const r = checkEligibility(job("Strategy Associate", { location: "New York, NY" }), canadian);
  assert.equal(r.verdict, "ok");
  assert.equal(eligibilityCell(r), "Note: US job, needs a TN visa");
});

test("jobs open to Canada are not affected by US rules", () => {
  assert.equal(checkEligibility(job("Analyst", { location: "Toronto, ON or New York, NY" }), canadian).verdict, "ok");
  assert.equal(checkEligibility(job("Analyst", { location: "Remote" }), canadian).verdict, "ok");
});

test("internships after graduation are out; ones around it are a check", () => {
  assert.equal(checkEligibility(job("Finance Intern - Fall 2027", { jobType: "Internship" }), canadian).verdict, "no");
  assert.equal(checkEligibility(job("Finance Intern", { jobType: "Internship", terms: ["Summer 2027"] }), canadian).verdict, "check");
  assert.equal(checkEligibility(job("Finance Intern", { jobType: "Internship", terms: ["Winter 2027"] }), canadian).verdict, "ok");
});

test("new grad roles for an earlier class are out", () => {
  const r = checkEligibility(job("Analyst, New Grad", { description: "Open to the Class of 2026." }), canadian);
  assert.equal(r.verdict, "no");
  assert.equal(checkEligibility(job("Analyst, New Grad", { description: "For 2027 graduates." }), canadian).verdict, "ok");
});

test("graduate degrees, years, languages and certifications", () => {
  assert.equal(checkEligibility(job("Analyst", { degrees: ["Master's", "PhD"] }), canadian).verdict, "no");
  assert.equal(checkEligibility(job("MBA Intern - Finance & Strategy", { jobType: "Internship" }), canadian).verdict, "no");
  assert.equal(checkEligibility(job("Analyst", { degrees: ["Bachelor's", "Master's"] }), canadian).verdict, "ok");
  assert.equal(checkEligibility(job("Analyst", { description: "An MBA is required." }), canadian).verdict, "no");
  assert.equal(checkEligibility(job("Analyst", { description: "3+ years of experience in finance." }), canadian).verdict, "check");
  assert.equal(checkEligibility(job("Analyst", { description: "7+ years of relevant experience." }), canadian).verdict, "no");
  assert.equal(checkEligibility(job("Data Annotation Specialist - German Writer"), canadian).verdict, "no");
  assert.equal(checkEligibility(job("Analyst", { description: "Fluency in French is required." }), canadian).verdict, "no");
  assert.equal(checkEligibility(job("Analyst", { description: "Bilingual in French is an asset." }), canadian).verdict, "check");
  assert.equal(checkEligibility(job("Accountant", { description: "CPA designation required." }), canadian).verdict, "no");
  assert.equal(checkEligibility(job("Associate", { description: "Series 7 required within 90 days of hire." }), canadian).verdict, "check");
});

const withDegree = (degree) => ({ ...canadian, degree });
const verdict = (j, degree) => checkEligibility(j, withDegree(degree)).verdict;

test("a JD student can take law student roles and isn't hidden by a JD requirement", () => {
  for (const degree of ["JD", "LLB", "JD/MBA"]) {
    for (const title of ["Articling Student 2027-2028", "Summer Law Student", "Student-at-Law", "Law Clerk"]) {
      assert.deepEqual(checkEligibility(job(title, { degrees: ["JD"] }), withDegree(degree)), { verdict: "ok", reasons: [], notes: [] }, `${degree}: ${title}`);
    }
    assert.equal(verdict(job("Legal Analyst", { description: "Must hold a J.D. from an accredited school." }), degree), "ok", degree);
  }
});

test("a JD requirement hides people without a law degree", () => {
  const r = verdict(job("Summer Associate", { degrees: ["JD"] }), "Bachelor's");
  assert.equal(r, "no");
  assert.deepEqual(checkEligibility(job("Summer Associate", { degrees: ["JD"] }), canadian).reasons, ["Requires a JD"]);
  assert.equal(verdict(job("Legal Analyst", { description: "A law degree is required." }), "Master's"), "no");
});

test("a JD student is still hidden from MBA and PhD roles", () => {
  const r = checkEligibility(job("MBA Intern - Finance & Strategy", { jobType: "Internship" }), withDegree("JD"));
  assert.equal(r.verdict, "no");
  assert.deepEqual(r.reasons, ["For MBA students"]);
  assert.equal(verdict(job("Analyst", { description: "An MBA is required." }), "JD"), "no");
  assert.equal(verdict(job("Research Scientist", { degrees: ["PhD"] }), "LLB"), "no");
  assert.equal(verdict(job("Policy Analyst", { description: "A graduate degree is required." }), "JD"), "ok");
});

test("medical degrees meet medical requirements only", () => {
  assert.equal(verdict(job("Resident Physician", { degrees: ["MD", "DO"] }), "MD"), "ok");
  assert.equal(verdict(job("Resident Physician", { degrees: ["MD"] }), "MBBS"), "ok");
  assert.equal(verdict(job("Clinical Pharmacist", { degrees: ["PharmD"] }), "MD"), "no");
  assert.deepEqual(checkEligibility(job("Clinical Pharmacist", { degrees: ["PharmD"] }), withDegree("MD")).reasons, ["Requires a PharmD"]);
});

test("a college diploma passes undergraduate postings and not graduate ones", () => {
  assert.equal(verdict(job("Analyst", { degrees: ["Bachelor's"] }), "College diploma"), "ok");
  assert.equal(verdict(job("Analyst", { degrees: ["Associate's", "Bachelor's"] }), "College diploma"), "ok");
  assert.equal(verdict(job("Analyst", { degrees: ["Master's"] }), "College diploma"), "no");
  assert.equal(verdict(job("PhD Research Intern"), "College diploma"), "no");
});

test("a degree the app doesn't know never hides a job", () => {
  const degree = "Sommelier, level 2";
  assert.equal(verdict(job("MBA Intern"), degree), "ok");
  assert.equal(verdict(job("Analyst", { degrees: ["JD"] }), degree), "ok");
  assert.equal(verdict(job("Analyst", { description: "A PhD is required." }), degree), "ok");
});

test("old answers keep their old results", () => {
  for (const degree of ["MBA", "Master's", "PhD"]) {
    assert.equal(verdict(job("MBA Associate"), degree), "ok", degree);
    assert.equal(verdict(job("Analyst", { degrees: ["Master's", "PhD"] }), degree), "ok", degree);
    assert.equal(verdict(job("Analyst", { description: "An MBA is required." }), degree), "ok", degree);
  }
  assert.deepEqual(checkEligibility(job("Analyst", { degrees: ["Master's", "PhD"] }), canadian).reasons, ["Requires a Master's or PhD"]);
  assert.equal(verdict(job("MBA Intern"), null), "ok");
  assert.equal(verdict(job("Analyst", { degrees: ["Bachelor's", "Master's"] }), "High school"), "ok");
});

test("a sentence ending in a degree isn't read as requiring it", () => {
  assert.equal(verdict(job("Analyst", { description: "Nice to have: an MBA. Required: Excel." }), "Bachelor's"), "ok");
});

test("entry-level postings that ask for a degree in general aren't hidden", () => {
  for (const description of [
    "Recent graduate, degree required.",
    "University graduate (degree required).",
    "Bachelor's or graduate degree required.",
    "Post-graduate degree is required.",
    "Requires an advanced degree or equivalent experience.",
    "No PhD required.",
    "no JD required",
    "Requires JD Edwards experience.",
    "Must have JD Edwards knowledge.",
  ]) assert.equal(verdict(job("Analyst", { description }), "Bachelor's"), "ok", description);
  assert.deepEqual(checkEligibility(job("Legal Analyst", { description: "J.D. required." }), withDegree("Bachelor's")).reasons, ["Requires a JD"]);
});

test("a person with several degrees is judged on the highest", () => {
  assert.equal(verdict(job("Associate", { degrees: ["MBA"] }), "MBA candidate, BCom 2022"), "ok");
  assert.equal(verdict(job("Summer Associate", { degrees: ["JD"] }), "Bachelor of Arts in Law and Society; JD 2027"), "ok");
  assert.equal(verdict(job("Summer Associate", { degrees: ["JD"] }), "Honours BA, applying to law school"), "no");
});

test("without any facts set, nothing is ruled out on authorization", () => {
  assert.equal(checkEligibility(job("Analyst", { location: "New York, NY", description: "Must be a U.S. citizen." }), {}).verdict, "ok");
});

test("helpers read years and graduation classes", () => {
  assert.equal(yearsAsked("Requires 2-4 years of professional experience and 5+ years experience with Excel"), 5);
  assert.equal(yearsAsked("We were founded 10 years ago."), 0);
  assert.deepEqual(graduationYears("Class of 2026 and 2027 graduates welcome"), [2026, 2027]);
  assert.equal(eligibilityCell({ verdict: "check", reasons: ["a", "b"] }), "Check: a · b");
  assert.equal(eligibilityCell({ verdict: "ok", reasons: [] }), "");
});

test("re-checking the sheet hides open jobs you can't take and brings back ones you now can", async () => {
  const { eligibilityChanges } = await import("../lib/eligibilityRun.js");
  const rows = [
    { _row: 2, Link: "a", Status: "Needs Manual Apply", "Role Title": "Analyst", "Country/Remote": "New York, NY" },
    { _row: 3, Link: "b", Status: "Applied", "Role Title": "Analyst", "Country/Remote": "New York, NY" },
    { _row: 4, Link: "c", Status: "Not Eligible", "Role Title": "Analyst", "Country/Remote": "Toronto, ON", Eligibility: "Not eligible: old" },
  ];
  const postings = { a: { description: "Must be a U.S. citizen." }, b: { description: "Must be a U.S. citizen." }, c: { description: "" } };
  const { cells, statuses } = eligibilityChanges(rows, { postingFor: (l) => postings[l], facts: canadian });
  assert.deepEqual(statuses.map((s) => [s.row, s.status]), [[2, "Not Eligible"], [4, "Awaiting Your Approval"]]);
  assert.deepEqual(cells.map((c) => c.row), [2, 4]);
  assert.equal(cells[1].value, "");
});

test("a bachelor's degree isn't hidden by a posting that also takes a Master's", () => {
  for (const description of [
    "Bachelor's or Master's degree is required.",
    "Bachelor's, Master's, or PhD required.",
    "Bachelor's degree is required and a Master's degree is required for managers.",
  ]) assert.equal(verdict(job("Analyst", { description }), "Bachelor's"), "ok", description);
  assert.equal(verdict(job("Analyst", { description: "Master's degree required." }), "Bachelor's"), "no");
});

test("a planned degree doesn't open roles that need it", () => {
  assert.equal(verdict(job("Analyst", { description: "Master's degree required." }), "Bachelor's, planning a Master's"), "no");
  assert.equal(verdict(job("Analyst", { description: "Master's degree required." }), "Bachelor, Masters 2027"), "ok");
});

test("a re-check never touches a job you dismissed", () => {
  const rows = [{ _row: 2, Link: "https://x.test/1", Status: "Dismissed", "Role Title": "MBA Intern" }];
  const out = eligibilityChanges(rows, { postingFor: () => null, facts: { workIn: ["Canada"], graduation: "2027-05" } });
  assert.deepEqual(out, { cells: [], statuses: [] });
});
