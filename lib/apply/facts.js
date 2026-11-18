// facts.js
// The applicant facts a form asks for, built from config/applyKit.json: the
// optional `applicant` section first, then the older profile rows and
// eligibility. Any value containing EDIT ME counts as missing.
// FACT_KEYS is the closed list a model may pick from; it never types a value.

import path from "path";
import { resumeFileFor } from "../profile.js";

const clean = (v) => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return /EDIT ME/i.test(s) ? "" : s;
};
const list = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);

function profileRow(kit, label) {
  return clean(kit.profile?.find((p) => String(p.label).toLowerCase() === label)?.value);
}

// Standing answers in either shape: { question, answer } or the kit's own
// { label, value } rows, from applicant.answers and the top-level answers list.
// The applicant section wins when both give the same question.
export function standingRows(kit = {}) {
  const rows = [kit.applicant?.answers, kit.answers].flatMap((l) => (Array.isArray(l) ? l : []));
  const seen = new Set();
  const out = [];
  for (const x of rows) {
    const question = clean(x?.question ?? x?.label ?? x?.q);
    const answer = clean(x?.answer ?? x?.value ?? x?.a);
    const key = question.toLowerCase().replace(/\s+/g, " ");
    if (!question || !answer || seen.has(key)) continue;
    seen.add(key);
    out.push({ question, answer });
  }
  return out;
}

// Names a school goes by on forms, so an autocomplete that lists one spelling
// still finds it. Each row is one school; the first entry is how forms
// usually list it.
const SCHOOL_NAMES = [
  ["Western University", "University of Western Ontario", "The University of Western Ontario", "UWO", "Western Ontario"],
  ["University of Toronto", "U of T", "UofT", "The University of Toronto"],
  ["Toronto Metropolitan University", "Ryerson University", "TMU", "Ryerson"],
  ["University of Waterloo", "Waterloo", "UWaterloo"],
  ["Queen's University", "Queens University", "Queen's University at Kingston"],
  ["McMaster University", "McMaster"],
  ["University of British Columbia", "UBC", "The University of British Columbia"],
  ["McGill University", "McGill"],
  ["York University", "York U"],
  ["Wilfrid Laurier University", "Laurier"],
];
const nk = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Other names for the school, from the kit's own `aliases` list and the table above.
export function schoolAliases(facts) {
  const name = facts.school.name;
  if (!name) return [];
  const row = SCHOOL_NAMES.find((r) => r.some((n) => nk(n) === nk(name)));
  const all = [...(facts.school.aliases || []), ...(row || [])];
  const seen = new Set([nk(name)]);
  return all.filter((a) => a && !seen.has(nk(a)) && seen.add(nk(a)));
}

const DEMOGRAPHICS = ["gender", "race", "hispanic", "veteran", "disability"];

function citizenOf(a, elig) {
  const own = list(a.citizenship).length ? list(a.citizenship) : list(elig.citizenship);
  if (own.length) return { list: own, assumed: false };
  const says = [...list(a.workAuth?.authorizedIn), ...list(elig.workIn)].some((c) => /^canada$/i.test(c));
  return says ? { list: ["Canada"], assumed: true } : { list: [], assumed: false };
}

export function buildFacts(kit = {}, { trackKey, root = process.cwd() } = {}) {
  const a = kit.applicant || {};
  const full = clean(a.name?.full) || profileRow(kit, "full name");
  const [first = "", ...rest] = full.split(/\s+/).filter(Boolean);
  const name = {
    first: clean(a.name?.first) || first,
    last: clean(a.name?.last) || rest.join(" "),
    preferred: clean(a.name?.preferred),
  };
  const elig = kit.eligibility || {};
  const resume = resumeFileFor(trackKey);
  return {
    name,
    email: clean(a.email) || profileRow(kit, "email"),
    phone: clean(a.phone) || profileRow(kit, "phone"),
    location: {
      city: clean(a.location?.city),
      region: clean(a.location?.region),
      country: clean(a.location?.country),
    },
    links: {
      linkedin: clean(a.links?.linkedin) || profileRow(kit, "linkedin"),
      github: clean(a.links?.github) || profileRow(kit, "github"),
      website: clean(a.links?.website) || profileRow(kit, "website"),
    },
    school: {
      name: clean(a.school?.name),
      degree: clean(a.school?.degree) || clean(elig.degree),
      field: clean(a.school?.field),
      graduation: clean(a.school?.graduation) || clean(elig.graduation),
      aliases: list(a.school?.aliases),
    },
    workAuth: {
      authorizedIn: list(a.workAuth?.authorizedIn).length ? list(a.workAuth.authorizedIn) : list(elig.workIn),
      sponsorshipLaterIn: list(a.workAuth?.sponsorshipLaterIn),
      tnEligible: !!elig.tnEligible,
      // Citizenship is never guessed: the kit's own list, else Canada when the
      // kit's work-authorization facts already say Canada.
      citizenOf: citizenOf(a, elig).list,
      citizenAssumed: citizenOf(a, elig).assumed,
    },
    demographics: Object.fromEntries(DEMOGRAPHICS.map((k) => [k, clean(a.demographics?.[k]) || "decline"])),
    salaryIfRequired: clean(a.salaryIfRequired) || "Negotiable",
    salaryNumber: clean(a.salaryNumber).replace(/[^\d.]/g, ""),
    earliestStart: clean(a.earliestStart),
    willingToRelocate: clean(a.willingToRelocate).toLowerCase(),
    answers: standingRows(kit),
    resumeFile: resume ? path.join(root, "resumes", resume) : "",
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function graduationText(g) {
  const m = /^(\d{4})-(\d{2})/.exec(g || "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : g || "";
}

// key -> [definition shown to the model, value from Facts]
const KEYS = {
  first_name: ["Given (first) name", (f) => f.name.first],
  last_name: ["Family (last) name", (f) => f.name.last],
  full_name: ["Full name, first and last", (f) => [f.name.first, f.name.last].filter(Boolean).join(" ")],
  preferred_name: ["Preferred first name or nickname", (f) => f.name.preferred || f.name.first],
  email: ["Email address", (f) => f.email],
  phone: ["Phone number", (f) => f.phone],
  city: ["City the applicant lives in", (f) => f.location.city],
  region: ["State or province the applicant lives in", (f) => f.location.region],
  country: ["Country the applicant lives in", (f) => f.location.country],
  location: ["Where the applicant lives, as city, region, country", (f) => [f.location.city, f.location.region, f.location.country].filter(Boolean).join(", ")],
  linkedin: ["LinkedIn profile URL", (f) => f.links.linkedin],
  github: ["GitHub profile URL", (f) => f.links.github],
  website: ["Personal website or portfolio URL", (f) => f.links.website],
  school: ["Name of the school or university", (f) => f.school.name],
  degree: ["Degree earned or in progress", (f) => f.school.degree],
  field_of_study: ["Major or field of study", (f) => f.school.field],
  graduation_date: ["Graduation month and year", (f) => graduationText(f.school.graduation)],
  graduation_year: ["Graduation year", (f) => (f.school.graduation.match(/^\d{4}/) || [""])[0]],
  earliest_start: ["Earliest date the applicant can start work", (f) => f.earliestStart],
  willing_to_relocate: ["Whether the applicant is willing to relocate (yes or no)", (f) => ({ yes: "Yes", no: "No" })[f.willingToRelocate] || ""],
  salary: ["Salary expectation, only when the form requires one", (f) => f.salaryIfRequired],
};

export const FACT_KEYS = Object.entries(KEYS).map(([key, [definition]]) => ({ key, definition }));

export function valueFor(facts, key) {
  return KEYS[key] ? KEYS[key][1](facts) || "" : "";
}
