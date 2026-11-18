// eligibilityRun.js
// Re-checks jobs already in the sheet against your eligibility facts, so a
// change to your facts (or a better rule) hides or brings back jobs.
// Pure: the caller passes rows, saved postings and facts, and writes the
// changes it gets back.

import { checkEligibility, eligibilityCell } from "./eligibility.js";
import { namedCountries } from "./filters.js";

export function checkListingEligibility(job, facts) {
  if (facts?.requireUsSponsorship !== true) return checkEligibility(job, facts);
  const location = String(job.location || job["Country/Remote"] || "");
  const countries = new Set();
  for (const option of location.split(/\s*[/;|&]\s*|\s+(?:or|and)\s+/i)) {
    const named = namedCountries(option);
    // "Ontario, CA" and other colliding city names cannot establish that a
    // role is available in Canada. Distinct location options can.
    if (named.length > 1 && !/\bcanada\b/i.test(option)) {
      countries.add("united states");
    } else {
      for (const country of named) countries.add(country);
    }
  }
  return checkEligibility(job, facts, { countries: [...countries] });
}

// Statuses a re-check may move between. Anything you've acted on (Applied,
// Interview, Offer, Rejected, Closed) is left alone.
const OPEN = new Set(["New", "Awaiting Your Approval", "Approved", "Needs Manual Apply"]);
const HIDDEN = "Not Eligible";
const BACK = "Awaiting Your Approval";

// The job as eligibility rules read it: sheet row + saved posting text.
export function jobForCheck(row, posting) {
  return {
    title: row["Role Title"],
    location: row["Country/Remote"] || posting?.location || "",
    description: posting?.description || "",
    jobType: row["Job Type"] || posting?.jobType || "",
    terms: posting?.terms || [],
    sponsorship: posting?.sponsorship || "",
    degrees: posting?.degrees || [],
  };
}

// -> { cells: [{ row, value }], statuses: [{ row, link, status, kind, reason }] }
export function eligibilityChanges(rows, { postingFor, facts }) {
  const cells = [];
  const statuses = [];
  for (const row of rows) {
    if (!row.Link || !(OPEN.has(row.Status) || row.Status === HIDDEN)) continue;
    const result = checkListingEligibility(jobForCheck(row, postingFor(row.Link)), facts);
    const cell = eligibilityCell(result);
    if (cell !== (row.Eligibility || "")) cells.push({ row: row._row, value: cell });
    if (result.verdict === "no" && OPEN.has(row.Status)) {
      statuses.push({ row: row._row, link: row.Link, status: HIDDEN, kind: "status", reason: result.reasons[0] });
    } else if (result.verdict !== "no" && row.Status === HIDDEN) {
      statuses.push({ row: row._row, link: row.Link, status: BACK, kind: "status", reason: "Eligible again" });
    }
  }
  return { cells, statuses };
}
