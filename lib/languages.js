// languages.js
// The languages a person speaks, saved in config/applyKit.json under
// eligibility.languages. Pure helpers: the route does the file reading and writing.

import { LANGUAGE_CHOICES } from "./eligibility.js";

// Keep only languages we know how to look for, once each, English first.
export function cleanLanguages(input) {
  const wanted = new Set((Array.isArray(input) ? input : []).map((l) => String(l).trim().toLowerCase()));
  const picked = LANGUAGE_CHOICES.filter((l) => wanted.has(l.toLowerCase()));
  return picked.length ? picked : ["English"];
}

// A copy of the kit with the languages replaced.
export function withLanguages(kit, input) {
  return { ...kit, eligibility: { ...(kit.eligibility || {}), languages: cleanLanguages(input) } };
}
