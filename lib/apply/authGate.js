// authGate.js
// Work authorization and sponsorship answers are computed from the apply kit,
// never guessed. The gate runs last over every answer, whatever its source,
// and overrules or clears any answer to these questions that doesn't match.

import { loadJson } from "../loadJson.js";
import { norm, matchOption } from "./rules.js";

const REGIONS = loadJson(import.meta.url, "../../config/countries.json").regions;

const ALIASES = {
  "United States": ["united states", "united states of america"],
  Canada: ["canada", "canadian"],
  "United Kingdom": ["united kingdom", "uk", "u k", "great britain", "britain", "england", "scotland", "wales", "london"],
  Ireland: ["ireland", "dublin"],
  Germany: ["germany", "berlin", "munich"],
  France: ["france", "paris"],
  Netherlands: ["netherlands", "amsterdam"],
  Spain: ["spain", "madrid", "barcelona"],
  India: ["india", "bangalore", "bengaluru", "mumbai", "hyderabad"],
  Australia: ["australia", "sydney", "melbourne"],
  Singapore: ["singapore"],
  Mexico: ["mexico"],
  Brazil: ["brazil"],
  Japan: ["japan", "tokyo"],
  Israel: ["israel", "tel aviv"],
  Poland: ["poland", "warsaw"],
};

const hasWord = (text, word) => ` ${text} `.includes(` ${word} `);

// Canonical country names a piece of text names.
export function countriesIn(text) {
  const t = norm(text);
  const raw = String(text || "");
  const found = new Set();
  // "us" is also a pronoun, so only the capitalised abbreviations count.
  if (/(^|[^A-Za-z])(U\.?S\.?A?\.?|USA)(?![A-Za-z])/.test(raw)) found.add("United States");
  // "London, ON" and "London, Ontario" are in Canada, not the United Kingdom.
  const londonCanada = /\blondon\s*,?\s*(on|ontario|canada)\b/i.test(raw) && !/\blondon\b(?!\s*,?\s*(on|ontario|canada)\b)/i.test(raw);
  for (const [country, words] of Object.entries(ALIASES)) {
    if (words.some((w) => !(londonCanada && w === "london") && hasWord(t, w))) found.add(country);
  }
  for (const [country, region] of Object.entries(REGIONS)) {
    const codes = [...raw.matchAll(/,\s*([A-Z]{2})(?![A-Za-z])/g)].map((m) => m[1]);
    if (region.names.some((n) => hasWord(t, norm(n))) || region.cities.some((c) => hasWord(t, norm(c))) || codes.some((c) => region.codes.includes(c))) {
      found.add(country);
    }
  }
  return [...found];
}

const canonical = (name) => countriesIn(name)[0] || name;

const AUTH = /\b(authori[sz]ed|legally (able|eligible|permitted|entitled|allowed)|eligib\w*|permitted|entitled|allowed|right) to work\b|\bwork authori[sz]ation\b|\bcan you work (in|within)\b|\bproof of eligib\w* to work\b/;
const SPONSOR = /\bsponsor/;
const NEEDS_PERMIT = /\b(require|need)s?\b.*\bwork (authori[sz]ation|permit|visa)\b/;
const NOT_OURS = /\bcitizen|\bclearance\b|green card|permanent resident|immigration status|\bvisa (type|status you hold)|\b(which|what|current) (type of )?visa\b|\bhold an? .*visa\b|\bwork permit\b/;
const NEGATED = /\b(not|never|unable|dont|cannot|cant|wont)\b/;
const WITHOUT_SPONSOR = /\bwithout (the need for |needing |requiring |requiring the |any )?(visa |employer |employment )?sponsorship\b|\bwithout (a )?visa\b/;
const TOPIC = /authori[sz]|sponsor|\bvisa\b|citizen|clearance|green card|permanent resident|immigration|right to work|eligible to work|work permit|legally (able|entitled|permitted|allowed|authori[sz]ed)|\bwork (in|within) (the )?(canada|united states|u s|us|usa|uk|united kingdom)\b|eligib\w* to work|proof of eligib/;

// Nationality words a citizenship question may use instead of a country name.
const DEMONYMS = { american: "United States", british: "United Kingdom", irish: "Ireland", german: "Germany", french: "France", dutch: "Netherlands", spanish: "Spain", indian: "India", australian: "Australia", mexican: "Mexico", brazilian: "Brazil", japanese: "Japan", israeli: "Israel", polish: "Poland" };
const NOT_PLAIN_CITIZEN = /clearance|permanent resident|green card|\bvisa\b|sponsor|authori[sz]|immigration|\bstatus\b|\bor\b|\band\b|dual|which|what|list|other than|outside|\bnon\b|\bnot\b|except|excluding|besides|apart from/;

// The one country a plain "Are you a Canadian citizen?" question names, or null.
export function citizenCountry(label) {
  const l = norm(label);
  if (!/\bcitizen(ship)?\b/.test(l) || NOT_PLAIN_CITIZEN.test(l)) return null;
  const found = new Set(countriesIn(label));
  for (const [word, country] of Object.entries(DEMONYMS)) if (hasWord(l, word)) found.add(country);
  return found.size === 1 ? [...found][0] : null;
}

// "auth" | "sponsor" | "citizen" | "you" | null (not about work authorization).
export function questionKind(label) {
  const l = norm(label);
  if (!TOPIC.test(l)) return null;
  if (citizenCountry(label)) return "citizen";
  if (NOT_OURS.test(l)) return "you";
  const rest = l.replace(WITHOUT_SPONSOR, " ");
  if (NEGATED.test(rest)) return "you";
  const auth = AUTH.test(rest);
  const sponsor = SPONSOR.test(rest) || NEEDS_PERMIT.test(rest);
  if (auth && sponsor) return "you";
  if (/\band\b.*\b(now or in the future|in the future)\b|\b(now or in the future|in the future)\b.*\band\b/.test(rest) && !sponsor) return "you";
  if (auth) return /\bvisa\b/.test(rest) ? "you" : "auth";
  if (sponsor) return "sponsor";
  return "you";
}

// The one country a question is about: named in the label, else the job's
// single country. null when there is no single country.
export function countryFor(label, jobLocation) {
  const named = countriesIn(label);
  if (named.length) return named.length === 1 ? named[0] : null;
  const where = countriesIn(jobLocation);
  return where.length === 1 ? where[0] : null;
}

// { kind, verdict: "Yes" | "No" | null, country, note }
export function gateVerdict(label, workAuth, jobLocation) {
  const kind = questionKind(label);
  if (!kind) return null;
  if (kind === "you") return { kind, verdict: null, note: "Left for you. Visa, citizenship or wording the app won't guess" };
  if (kind === "citizen") {
    const country = citizenCountry(label);
    const citizenOf = (workAuth.citizenOf || []).map(canonical);
    if (!citizenOf.length) return { kind, verdict: null, country, note: "Left for you. Your apply kit doesn't say which country you are a citizen of" };
    const yes = citizenOf.includes(country);
    return { kind, country, verdict: yes ? "Yes" : "No", note: `${yes ? `Citizen of ${country}` : `Not a citizen of ${country}`}, ${workAuth.citizenAssumed ? "assumed from work authorization (set applicant.citizenship to change)" : "from your apply kit"}` };
  }
  const country = countryFor(label, jobLocation);
  if (!country) return { kind, verdict: null, note: "Left for you. No single country for this job" };
  const later = workAuth.sponsorshipLaterIn.map(canonical).includes(country);
  const now = workAuth.authorizedIn.map(canonical).includes(country);
  if (kind === "sponsor" && country === "United States" && workAuth.tnEligible) {
    return { kind, verdict: null, country, note: "Left for you. US sponsorship with a TN visa" };
  }
  if (kind === "auth") {
    return { kind, country, verdict: now || later ? "Yes" : "No", note: now || later ? `Authorized in ${country}` : `Not authorized in ${country}` };
  }
  const needs = later || !now;
  return { kind, country, verdict: needs ? "Yes" : "No", note: needs ? `Needs sponsorship in ${country}` : `No sponsorship needed in ${country}` };
}

const asValue = (field, verdict) => {
  if (field.kind === "select" || field.kind === "radio") return matchOption(field.options, verdict);
  if (field.kind === "checkbox") return field.options?.length ? null : verdict === "Yes" ? "true" : "false";
  if (field.kind === "file") return null;
  return verdict;
};

// The answer after the gate. Unchanged when the field isn't about work authorization.
export function gate(field, answer, { workAuth, jobLocation }) {
  const v = gateVerdict(field.label, workAuth, jobLocation);
  if (!v) return answer;
  const userTyped = answer?.source === "you" && answer.value;
  if (!v.verdict) {
    return userTyped ? answer : { fieldId: field.id, value: "", source: "you", note: v.note };
  }
  const value = asValue(field, v.verdict);
  if (!value) return userTyped ? answer : { fieldId: field.id, value: "", source: "you", note: `Left for you. No option means ${v.verdict}` };
  const changed = answer?.value && answer.value !== value;
  return { fieldId: field.id, value, source: "rule", note: changed ? `${v.note}. Changed from "${answer.value}"` : v.note };
}

export const isAuthTopic = (label) => questionKind(label) !== null;
