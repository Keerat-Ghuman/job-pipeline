// rules.js
// Label patterns that answer a form field from the applicant facts, and the
// code that matches a wanted answer to a select or radio option. The first
// row whose pattern matches the label wins.

import path from "path";
import { valueFor, schoolAliases } from "./facts.js";

export const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const YES = new Set(["yes", "y", "true"]);
const NO = new Set(["no", "n", "false"]);
const DECLINE = /\b(decline|prefer not|do not wish|dont wish|not wish|choose not|rather not|not to (say|answer|disclose|self identify)|not disclose|no answer)\b/;

// The label of the option that means `wanted`, or null when none or several do.
export function matchOption(options = [], wanted) {
  const w = norm(wanted);
  if (!w || !options.length) return null;
  const labelOf = (o) => o.label ?? o.value;
  const exact = options.find((o) => norm(o.label) === w || norm(o.value) === w);
  if (exact) return labelOf(exact);
  const one = (pick) => {
    const hits = options.filter(pick);
    return hits.length === 1 ? labelOf(hits[0]) : null;
  };
  if (YES.has(w)) return one((o) => /^yes\b/.test(norm(o.label)));
  if (NO.has(w)) return one((o) => /^no\b/.test(norm(o.label)) && !DECLINE.test(norm(o.label)));
  if (w === "decline") return one((o) => DECLINE.test(norm(o.label)));
  return one((o) => {
    const l = norm(o.label);
    return l && (l.includes(w) || w.includes(l));
  });
}

// A sentence asking something, not a short field name: it ends in a question
// mark with several words, or it is long, or it opens like a question.
const QUESTION_START = /^(are|is|do|does|did|can|could|would|will|have|how|why|what|which|when|please (describe|explain|tell))\b/;
export function isQuestionLabel(label) {
  const raw = String(label ?? "").trim();
  const n = norm(raw);
  const words = n ? n.split(" ").length : 0;
  return (/\?\s*$/.test(raw) && words >= 5) || words > 8 || (words >= 5 && QUESTION_START.test(n));
}

const CHOICE = new Set(["select", "radio"]);
const TEXTY = new Set(["text", "email", "tel", "url", "number", "date", "textarea"]);

const you = (note) => ({ value: "", source: "you", note });
const none = (note) => ({ value: "", source: "none", note });

// A value from the facts, fitted to the field: an option label for choices.
export function fitted(field, value, source, note, aliases = []) {
  if (!value) return none(`${note}: not in your apply kit`);
  if ((field.kind === "number" || field.numeric) && !/^\d[\d,.\s]*$/.test(String(value).trim())) return you("This box takes a number, and your kit has no number for it");
  if (CHOICE.has(field.kind)) {
    const option = [value, ...aliases].map((v) => matchOption(field.options, v)).find(Boolean);
    return option ? { value: option, source, note } : you(`No option matches "${value}"`);
  }
  if (field.kind === "checkbox") return you("Left for you");
  if (field.kind === "file") return you("Left for you");
  const max = Number(field.maxLength) > 0 ? Number(field.maxLength) : Infinity;
  return { value: String(value).slice(0, max), source, note, ...(aliases.length && { aliases }) };
}

const fact = (key, note) => (field, facts) => fitted(field, valueFor(facts, key), "rule", note);

function demographic(key, note) {
  return (field, facts) => {
    const wanted = facts.demographics[key] || "decline";
    if (!CHOICE.has(field.kind)) return you(`${note}`);
    const option = matchOption(field.options, wanted);
    if (!option) return you(`Left for you. No option matches "${wanted}"`);
    return { value: option, source: "rule", note: wanted === "decline" ? `${note}, declined` : note };
  };
}

// Routine agreements a form marks required: only terms and conditions, the
// privacy policy or notice, "I have read", and data processing, protection or
// retention consent. Anything else (background or credit checks, drug tests,
// biometrics, recording, AI in hiring, being contacted, receiving emails,
// "I understand this role requires ...") stays for you, even when required.
// Arbitration, NDA, non-compete, signatures and certifications are matched by
// earlier rules.
const ROUTINE_ALLOW = /\bterms (and|&) conditions\b|\bterms of (use|service)\b|\bprivacy (policy|notice|statement)\b|\bi have read\b|\bdata (processing|protection|retention)\b|\bgdpr\b|\b(agree|accept|acknowledge)\w*\b.*\bterms\b/;
const ROUTINE_DENY = /background|credit|drug|biometric|record|\bai\b|artificial|automated|machine|contact|\bcall|e ?mail|phone|receive|requires?\b|screen|check|fingerprint|video|photo|relocat|travel|shift|overtime|signature|\bsign\b|arbitration|non ?disclosure|\bnda\b|non ?compete|non ?solicit|\bcertif|\battest\b|marketing|newsletter|job alerts?|text messages?|\bsms\b|whatsapp|future (job )?opportunit|talent (pool|community)/;
export const isRoutineLabel = (label) => {
  const n = norm(label);
  return ROUTINE_ALLOW.test(n) && !ROUTINE_DENY.test(n);
};
export const ROUTINE_AGREEMENT = ROUTINE_ALLOW;
export const isRoutineAgreement = (field) => field.kind === "checkbox" && !field.options?.length && !!field.required && isRoutineLabel(field.label);

function consent(field) {
  if (field.kind !== "checkbox" || field.options?.length) return you("Left for you. Agreement");
  return field.required
    ? isRoutineLabel(field.label) ? { value: "true", source: "rule", note: "Required privacy consent" } : you("Left for you. Consent that isn't a routine privacy or terms box")
    : { value: "false", source: "rule", note: "Optional consent left unticked" };
}

function resume(field, facts) {
  if (field.kind !== "file") return null;
  return facts.resumeFile
    ? { value: facts.resumeFile, source: "kit", note: `Resume ${path.basename(facts.resumeFile)}` }
    : you("Left for you. No resume file for this job's track");
}

function salary(field, facts) {
  if (!field.required) return none("Salary is only given when required");
  const numeric = field.kind === "number" || field.numeric;
  const want = numeric && facts.salaryNumber ? facts.salaryNumber : facts.salaryIfRequired;
  return fitted(field, want, "rule", "Salary, because the form requires it");
}

function school(field, facts) {
  return fitted(field, valueFor(facts, "school"), "rule", "School", schoolAliases(facts));
}

// [pattern on the normalised label, answer(field, facts)]. Order matters.
export const RULES = [
  [/\bsignature\b|\bsign (here|below)\b|\be ?sign|type your (full )?(legal )?name/, () => you("Left for you. Signature")],
  [/arbitration|non ?disclosure|\bnda\b|non ?compete|non ?solicit|\bi certify\b|\bcertif(y|ication) that\b|\battest\b/, () => you("Left for you. Agreement")],
  [/\b(marketing|newsletter|job alerts?|text messages?|sms|whatsapp|future (job )?opportunit|talent (pool|community))\b/, (f) =>
    f.kind === "checkbox" && !f.options?.length && !f.required ? { value: "false", source: "rule", note: "Opt-in left unticked" } : you("Left for you")],
  [/\b(privacy|data (processing|protection)|gdpr|personal (data|information))\b/, consent],
  [ROUTINE_ALLOW, (f) => (f.kind === "checkbox" && !f.options?.length ? (f.required ? (isRoutineLabel(f.label) ? { value: "true", source: "rule", note: "Required agreement ticked" } : you("Left for you. Agreement")) : { value: "false", source: "rule", note: "Optional agreement left unticked" }) : null)],
  [/how did you (hear|find|learn)|where did you (hear|find)|\breferr(al|ed)\b|^source$/, () => you("Left for you. How you heard about the job")],
  [/\bgender\b|\bsex\b/, demographic("gender", "Gender")],
  [/hispanic|latin[oax]/, demographic("hispanic", "Hispanic or Latino")],
  [/\brace\b|ethnicit/, demographic("race", "Race")],
  [/veteran/, demographic("veteran", "Veteran status")],
  [/disabilit/, demographic("disability", "Disability")],
  [/sexual orientation|transgender|pronoun/, () => you("Left for you")],
  [/\b(resume|cv)\b/, resume],
  [/cover letter|transcript/, () => none("Not uploaded")],
  [/\b(first|given) name\b/, fact("first_name", "First name"), true],
  [/\b(last|family) name\b|\bsurname\b/, fact("last_name", "Last name"), true],
  [/\bpreferred (first )?name\b|\bnickname\b/, fact("preferred_name", "Preferred name"), true],
  [/^(full |legal )?name$|^your name$|\bfull name\b|\blegal name\b/, fact("full_name", "Full name"), true],
  [/\be ?mail\b/, fact("email", "Email"), true],
  [/\b(phone|mobile|cell)\b/, fact("phone", "Phone"), true],
  [/linkedin/, fact("linkedin", "LinkedIn"), true],
  [/github/, fact("github", "GitHub"), true],
  [/\b(website|portfolio|personal (site|url))\b/, fact("website", "Website"), true],
  [/\bsalary\b|\bcompensation\b|\bpay (expectation|range)\b/, salary],
  [/\bgpa\b|grade point/, () => none("GPA is not given")],
  [/\bgraduat/, (f, facts) => (/\byear\b/.test(norm(f.label)) ? fact("graduation_year", "Graduation year")(f, facts) : fact("graduation_date", "Graduation date")(f, facts))],
  [/\b(school|university|college|institution)\b/, school],
  [/\bmajor\b|field of study|\bdiscipline\b|area of study/, fact("field_of_study", "Field of study")],
  [/\bdegree\b/, fact("degree", "Degree")],
  [/start date|earliest start|when (can|could) you start|\bavailable to start\b/, fact("earliest_start", "Start date")],
  [/relocat/, fact("willing_to_relocate", "Relocation")],
  [/^city$|\bcity\b(?!.*\bstate\b)/, fact("city", "City")],
  [/^(state|province|region)$|state or province/, fact("region", "State or province")],
  [/^country$|country of residence|which country do you (live|reside)/, fact("country", "Country")],
  [/\b(location|where are you (based|located)|current address|where do you live)\b/, fact("location", "Location")],
];

// The rule answer for a field, or null when no rule speaks to it.
// A contact rule fits a short ask for the detail itself ("What is your email
// address?"). It doesn't fit a long question that only mentions the word, or a
// yes/no question about it ("Are you comfortable with email?").
const YES_NO_START = /^(are|is|do|does|did|can|could|would|will|have|has|how|why|describe|explain|tell|please (describe|explain|tell))\b/;
const mixedQuestion = (label) => {
  const n = norm(label);
  return n.split(" ").length > 8 || YES_NO_START.test(n);
};

export function ruleAnswer(field, facts) {
  const label = norm(field.label);
  const asking = isQuestionLabel(field.label) && mixedQuestion(field.label);
  for (const [pattern, answer, contact] of RULES) {
    // Contact rules fit a short field name, not a long question that mentions the word.
    if (contact && asking) continue;
    if (pattern.test(label)) {
      const a = answer(field, facts);
      if (a) return a;
    }
  }
  if (field.kind === "email") return fact("email", "Email")(field, facts);
  if (field.kind === "tel") return fact("phone", "Phone")(field, facts);
  return null;
}

export function standingAnswer(field, facts) {
  const label = norm(field.label);
  const hit = facts.answers.find((a) => norm(a.question) === label);
  if (!hit) return null;
  if (field.kind === "checkbox" && !field.options?.length) {
    const v = norm(hit.answer);
    const value = YES.has(v) || /^(i agree|agree|tick|check)/.test(v) ? "true" : NO.has(v) ? "false" : "";
    return value ? { value, source: "standing", note: "Your standing answer" } : null;
  }
  const a = fitted(field, hit.answer, "standing", "Your standing answer");
  return a.source === "standing" ? a : null;
}

export const isTexty = (field) => TEXTY.has(field.kind);
export const isChoice = (field) => CHOICE.has(field.kind);
