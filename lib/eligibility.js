// eligibility.js
// Can you actually take this job? Checks a posting against your own facts
// (work authorization, graduation, degree, languages, certifications) from
// the "eligibility" section of config/applyKit.json.
//
// checkEligibility(job, facts) -> { verdict, reasons, notes }
//   verdict: "ok" | "check" (worth a look, something to confirm) | "no"
//   reasons: plain-English strings, the strongest first
//   notes: facts worth knowing that aren't a problem (e.g. a US job needs a visa)
// Pure: no file or network access, so it runs anywhere and is easy to test.

import { termsOf } from "./jobType.js";
import { degreeOf, meetsRequirement, requiredDegrees, titleDegrees, withArticle } from "./degrees.js";

export const VERDICT_LABEL = { ok: "", check: "Check", no: "Not eligible" };

const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_PLACE = new RegExp(
  String.raw`\b(united states|usa|u\.s\.a?\.?|us only|us-based|new york|san francisco|seattle|boston|chicago|austin|los angeles|denver|atlanta|miami|washington,? d\.?c)\b|,\s*(${US_STATES})\b|\((us|usa)\)|remote\s*[-–(]?\s*(us|usa|united states)\b`,
  "i",
);
const CANADA_PLACE =
  /\b(canada|toronto|vancouver|montreal|ottawa|calgary|waterloo|edmonton|winnipeg|ontario|quebec|british columbia|alberta)\b|,\s*(ON|BC|QC|AB|MB|NS|SK|NB|NL|PE)\b/i;

const CITIZENSHIP =
  /\b(u\.?s\.? citizen(ship)?( is)? required|must be a u\.?s\.? citizen|united states citizen(ship)? (is )?required|u\.?s\.? citizens? only|security clearance|(secret|top secret|ts\/sci) clearance|active clearance|clearance (is )?required|u\.?s\.? persons?\b|itar\b)/i;
const NO_SPONSORSHIP =
  /\b((not|unable to|cannot|can't|won't|will not|do not|does not|are not able to)\s+(provide\s+|offer\s+)?(visa\s+|immigration\s+)?sponsor(ship)?|without (the need for )?(current or future |any )?(visa |employment visa )?sponsorship|no (visa )?sponsorship|sponsorship (is )?not (available|provided|offered))\b/i;

const LANGUAGES = [
  "german", "french", "spanish", "mandarin", "chinese", "japanese", "korean", "portuguese",
  "italian", "dutch", "arabic", "hindi", "cantonese", "polish", "russian", "turkish",
  "hebrew", "vietnamese", "swedish", "danish", "norwegian", "finnish", "greek", "thai",
];
// Other ways a posting names a language, and which spoken languages count.
const LANGUAGE_WORDS = { french: "french|fran[cç]ais|francophone", chinese: "chinese", mandarin: "mandarin", cantonese: "cantonese" };
const LANGUAGE_ROLE = /writer|translator|speaker|speaking|bilingual|bilingue|native|fluent|annotat|tutor|linguist/i;
const BILINGUAL = /\b(bilingual|bilingue|billingual)\b/i;
const FAMILY = { mandarin: ["chinese"], cantonese: ["chinese"] };

// The languages a person speaks, lowercased, with close names counted
// (Mandarin speakers can take Chinese roles). English by default.
export function spokenLanguages(list) {
  const set = new Set((list?.length ? list : ["English"]).map((l) => String(l).trim().toLowerCase()).filter(Boolean));
  for (const l of [...set]) for (const alias of FAMILY[l] || []) set.add(alias);
  return set;
}

// Every language a person can pick, for the settings control.
export const LANGUAGE_CHOICES = ["English", ...LANGUAGES.map((l) => l[0].toUpperCase() + l.slice(1))];

const CERTS = ["cpa", "cfa", "cma", "frm", "acca", "pmp", "series 7", "series 63", "series 65", "series 66", "series 79"];

const SEASON_MONTH = { winter: 1, spring: 4, summer: 5, fall: 9, autumn: 9 };

function monthIndex(yyyyMm) {
  const m = String(yyyyMm || "").match(/^(\d{4})-(\d{1,2})/);
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

function termIndex(term) {
  const m = String(term).toLowerCase().match(/(winter|spring|summer|fall|autumn)\s*(\d{4})/);
  return m ? Number(m[2]) * 12 + SEASON_MONTH[m[1]] - 1 : null;
}

// The most years of experience the posting asks for, or 0.
export function yearsAsked(text) {
  let most = 0;
  const re = /(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*\+?\s*years?(?:'|’)?\s+(?:of\s+)?(?:\w+\s+){0,4}?experience/gi;
  for (const m of String(text || "").matchAll(re)) most = Math.max(most, Number(m[1]));
  return most;
}

// Graduation years a posting asks for ("Class of 2026", "graduating in 2026",
// "2026 graduates"), empty when it names none.
export function graduationYears(text) {
  const years = new Set();
  const t = String(text || "");
  const near = /(class of|graduat\w*|grads?\b|degree (completion|conferred)|expected to graduate|completing (your|a) degree)[^.]{0,40}?\b(20\d\d)\b/gi;
  const before = /\b(20\d\d)\s+(new\s+)?(grads?|graduates?|graduation)\b/gi;
  for (const m of t.matchAll(near)) years.add(Number(m[4]));
  for (const m of t.matchAll(before)) years.add(Number(m[1]));
  return [...years];
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const MONTH_NUM = Object.fromEntries(MONTHS.split("|").map((m, i) => [m, i]));
const WHEN = String.raw`(?:(${MONTHS})[a-z]*\.?,?\s+)?(20\d\d)`;
const month = (m, y) => Number(y) * 12 + (m ? MONTH_NUM[m.slice(0, 3).toLowerCase()] : 0);

// The graduation dates a posting accepts: { from, to } as month indexes, null
// when open. Reads "graduating Dec 2027 or later", "no earlier than ...",
// "graduating between May 2026 and Dec 2026". A bare year starts in January
// (or, as an end, ends in December).
export function graduationWindow(text) {
  const t = String(text || "");
  const GRAD = String.raw`(?:graduat\w*|degree completion|degree conferral|expected completion)[^.\n]{0,40}?`;
  let from = null;
  let to = null;
  const later = new RegExp(`${GRAD}${WHEN}\\s*(?:or later|and later|or after|and after|and beyond|or beyond|onwards?|\\+)`, "gi");
  const notBefore = new RegExp(`${GRAD}(?:no earlier than|not before|after|from)\\s+${WHEN}`, "gi");
  const between = new RegExp(`${GRAD}(?:between|from)\\s+${WHEN}\\s*(?:and|to|-|–)\\s*${WHEN}`, "gi");
  for (const m of t.matchAll(later)) from = Math.max(from ?? -Infinity, month(m[1], m[2]));
  for (const m of t.matchAll(notBefore)) from = Math.max(from ?? -Infinity, month(m[1], m[2]));
  for (const m of t.matchAll(between)) {
    from = Math.max(from ?? -Infinity, month(m[1], m[2]));
    to = Math.min(to ?? Infinity, month(m[3], m[4]) + (m[3] ? 0 : 11));
  }
  return { from, to };
}

// Fields of study. A posting's "degree in X" is met when your field is X or
// shares a family with it (finance counts as business).
const FIELDS = {
  cs: ["computer science", "computer engineering", "software engineering", "information technology", "information systems", "cs", "cse"],
  data: ["data science", "statistics", "applied mathematics", "mathematics", "math"],
  engineering: ["engineering", "electrical engineering", "mechanical engineering", "civil engineering", "chemical engineering"],
  finance: ["finance", "financial engineering", "accounting", "economics", "business", "business administration", "commerce", "management", "marketing"],
  science: ["biology", "chemistry", "physics", "neuroscience", "biochemistry"],
  law: ["law", "legal studies"],
  humanities: ["english", "history", "philosophy", "journalism", "communications", "psychology", "sociology", "political science"],
};
const FIELD_WORDS = Object.entries(FIELDS).flatMap(([family, words]) => words.map((w) => ({ w, family })))
  .sort((a, b) => b.w.length - a.w.length);

function fieldsIn(text) {
  let rest = ` ${String(text || "").toLowerCase().replace(/[^a-z]+/g, " ")} `;
  const out = new Set();
  for (const { w, family } of FIELD_WORDS) {
    if (rest.includes(` ${w} `)) {
      out.add(family);
      rest = rest.split(` ${w} `).join("  ");
    }
  }
  return out;
}

// Fields of study the posting requires in a degree, or [] when none. Only
// "required"-style sentences count, and "any field" or "preferred" ones don't.
export function requiredFields(text) {
  const out = new Set();
  const asks = /(degree|bachelor|\bb\.?s\.?\b|\bb\.?a\.?\b|major|enrolled|pursuing)[^.\n]{0,60}\b(?:in|of)\b([^.\n]{0,80})/gi;
  for (const sentence of String(text || "").split(/(?<=[.!?])\s+|\n/)) {
    if (/prefer|plus\b|nice to have|bonus|ideal|any (field|major|discipline)|all majors/i.test(sentence)) continue;
    if (!/required|requires?\b|must|pursuing|enrolled|currently|minimum|qualif/i.test(sentence)) continue;
    for (const m of sentence.matchAll(asks)) for (const f of fieldsIn(m[2])) out.add(f);
  }
  return [...out];
}

const FIELD_LABEL = { cs: "computer science", data: "data or math", engineering: "engineering", finance: "finance or business", science: "science", law: "law", humanities: "humanities" };
const monthName = (i) => `${MONTHS.split("|")[i % 12][0].toUpperCase()}${MONTHS.split("|")[i % 12].slice(1)} ${Math.floor(i / 12)}`;

function locationOf(job) {
  return String(job.location || job["Country/Remote"] || "");
}

export function checkEligibility(job, facts = {}) {
  const title = String(job.title || job["Role Title"] || "");
  const description = String(job.description || "");
  const text = `${title}\n${description}`;
  const lower = text.toLowerCase();
  const location = locationOf(job);
  const no = [];
  const check = [];
  const notes = [];

  // --- work authorization ---
  const workIn = (facts.workIn || []).map((c) => c.toLowerCase());
  const canWorkInUS = workIn.some((c) => /united states|^us$|^usa$/.test(c));
  const knowsAuth = workIn.length > 0;
  const inUS = US_PLACE.test(location);
  const inCanada = CANADA_PLACE.test(location);
  const usOnly = inUS && !inCanada;
  if (knowsAuth && !canWorkInUS && usOnly) {
    const sponsorship = String(job.sponsorship || "");
    if (/citizenship is required/i.test(sponsorship) || CITIZENSHIP.test(text)) {
      no.push("Requires US citizenship or a security clearance");
    } else if (/remote/i.test(location)) {
      no.push("Remote, but for people based in the US");
    } else if (/does not offer sponsorship/i.test(sponsorship) || NO_SPONSORSHIP.test(text)) {
      (facts.tnEligible ? check : no).push(
        facts.tnEligible
          ? "US job with no visa sponsorship. A TN visa may still work for business roles, so ask the recruiter"
          : "US job with no visa sponsorship",
      );
    } else {
      notes.push(facts.tnEligible ? "US job, needs a TN visa" : "US job, needs visa sponsorship");
    }
  }

  // --- graduation and student status ---
  const grad = monthIndex(facts.graduation);
  const win = graduationWindow(text);
  if (grad !== null) {
    const isIntern = /intern|co-?op/i.test(job.jobType || job["Job Type"] || "") || /\b(intern(ship)?|co-?op)\b/i.test(title);
    const terms = termsOf({ ...job, title }).map(termIndex).filter((n) => n !== null);
    if (isIntern && terms.length) {
      const after = terms.filter((t) => t > grad);
      if (after.length === terms.length) {
        no.push(`Internship after you graduate (${facts.graduation}). Internships expect you to still be a student`);
      } else if (terms.some((t) => t >= grad - 1)) {
        check.push(`Internship around your graduation (${facts.graduation}). Many expect you to go back to school after`);
      }
    }
    const years = graduationYears(text);
    const gradYear = Math.floor(grad / 12);
    if (!isIntern && years.length && Math.max(...years) < gradYear) {
      no.push(`Wants ${Math.max(...years)} graduates, and you graduate in ${gradYear}`);
    } else if (!isIntern && years.length && Math.min(...years) > gradYear && win.from === null) {
      no.push(`Wants ${Math.min(...years)} graduates, and you graduate in ${gradYear}`);
    }
  }

  // --- degree field and graduation window ---
  if (grad !== null) {
    if (win.from !== null && grad < win.from) no.push(`Wants graduates from ${monthName(win.from)} on, and you graduate in ${monthName(grad)}`);
    else if (win.to !== null && grad > win.to) no.push(`Wants graduates by ${monthName(win.to)}, and you graduate in ${monthName(grad)}`);
  }
  const myFields = fieldsIn(facts.degree);
  const askedFields = requiredFields(text);
  if (myFields.size && askedFields.length && !askedFields.some((f) => myFields.has(f))) {
    no.push(`Requires a degree in ${askedFields.map((f) => FIELD_LABEL[f]).join(" or ")}`);
  }

  // --- degree ---
  const myDegree = degreeOf(facts.degree);
  if (myDegree) {
    const unmet = (asked) => asked.length > 0 && !asked.some((a) => meetsRequirement(myDegree, a));
    const names = (asked) => asked.map((a) => a.label).join(" or ");
    const inTitle = titleDegrees(title);
    const inText = requiredDegrees(text);
    if (unmet(inTitle)) {
      no.push(`For ${names(inTitle)} students`);
    } else if (unmet((job.degrees || []).map(degreeOf))) {
      no.push(`Requires ${withArticle(job.degrees.join(" or "))}`);
    } else if (unmet(inText)) {
      no.push(`Requires ${withArticle(names(inText))}`);
    }
  }

  // --- experience ---
  const asked = yearsAsked(text);
  const maxYears = Number(facts.maxYearsExperience ?? 2);
  if (asked >= maxYears + 3) no.push(`Asks for ${asked}+ years of experience`);
  else if (asked > maxYears) check.push(`Asks for ${asked}+ years of experience`);

  // --- languages ---
  const mine = spokenLanguages(facts.languages);
  const speaksOther = [...mine].some((l) => l !== "english");
  const hasLanguage = (lang) => mine.has(lang);
  const mentioned = (lang, where) => new RegExp(`\\b(?:${LANGUAGE_WORDS[lang] || lang})\\b`, "i").test(where);
  let anyNamed = false;
  for (const lang of LANGUAGES) {
    if (mentioned(lang, text)) anyNamed = true;
    if (hasLanguage(lang)) continue;
    const words = LANGUAGE_WORDS[lang] || lang;
    const label = lang[0].toUpperCase() + lang.slice(1);
    const inTitle = mentioned(lang, title) && LANGUAGE_ROLE.test(title);
    const near = new RegExp(`(fluen\\w*|native|proficien\\w*|bilingual|bilingue|speak\\w*|written and spoken)[^.\\n]{0,40}\\b(?:${words})\\b|\\b(?:${words})\\b[^.\\n]{0,25}(fluen\\w*|native|proficien\\w*|required|speaker|speaking)`, "i");
    if (inTitle) no.push(`Needs ${label}`);
    else if (near.test(text)) {
      const required = new RegExp(`(required|must)[^.\\n]{0,40}\\b(?:${words})\\b|\\b(?:${words})\\b[^.\\n]{0,40}(required|is a must)`, "i").test(text);
      (required ? no : check).push(`${required ? "Needs" : "Mentions"} ${label}`);
    }
  }

  // "Bilingual" with no language named. In Canada that means English and
  // French. In the US we can't tell which language, so someone who speaks a
  // second language is asked to check and everyone else is told it's needed.
  if (!anyNamed && BILINGUAL.test(title)) {
    const abroad = location.trim() && !CANADA_PLACE.test(location) && !/\bremote\b/i.test(location);
    if (!abroad) {
      if (!hasLanguage("french")) no.push("Bilingual role: needs French as well as English");
    } else if (!speaksOther) {
      no.push("Bilingual role: needs a second language");
    } else {
      check.push("Bilingual role: check which second language");
    }
  } else if (!anyNamed && !speaksOther && BILINGUAL.test(description)) {
    check.push("Mentions a second language (bilingual)");
  }

  // --- certifications ---
  const certs = (facts.certifications || []).map((c) => c.toLowerCase());
  for (const cert of CERTS) {
    if (certs.includes(cert)) continue;
    const c = cert.replace(" ", "\\s*");
    const required = new RegExp(`\\b${c}\\b[^.\\n]{0,30}(required|is a must|designation required)|must (hold|have|possess)[^.\\n]{0,25}\\b${c}\\b|requires?[^.\\n]{0,20}\\b${c}\\b`, "i");
    if (required.test(lower)) {
      const within = new RegExp(`\\b${c}\\b[^.\\n]{0,60}(within|after hire|upon hire|sponsor)`, "i").test(lower);
      (within ? check : no).push(`${within ? "Must get" : "Requires"} ${cert.toUpperCase().replace("SERIES", "Series")}${within ? " after joining" : ""}`);
    }
  }

  const verdict = no.length ? "no" : check.length ? "check" : "ok";
  return { verdict, reasons: [...no, ...check], notes };
}

// The sheet's Eligibility cell: "Check: …" / "Not eligible: …", "Note: …" for
// a fine job with something worth knowing, "" otherwise.
export function eligibilityCell({ verdict, reasons, notes = [] }) {
  if (verdict !== "ok") return `${VERDICT_LABEL[verdict]}: ${[...reasons, ...notes].join(" · ")}`;
  return notes.length ? `Note: ${notes.join(" · ")}` : "";
}
