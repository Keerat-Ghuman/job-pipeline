// degrees.js
// Every kind of degree the app knows, in one table. A person's degree (the
// free-text facts.degree) and a posting's degree requirements (Simplify's
// degrees list, words in the title or text) both go through degreeOf, so one
// rule decides who can take what.
//
// Each entry: { key, label, level, field?, group, aliases, satisfies,
//               titleCues?, textCues?, noun? }
//   level      one of LEVELS. Requirements at bachelor level or below never
//              hide anyone: postings list them loosely ("or equivalent").
//   field      set on degrees for one program (law, medicine, MBA...). As a
//              requirement, only that degree or one whose satisfies lists it
//              meets it. A generic Master's or PhD requirement is met by level.
//   satisfies  other requirement keys this degree meets beyond its own.
//   titleCues  words that, in a job title, mean the job is for this degree.
//   textCues   words that, in "requires a X" or "X is required", name it.
//   noun       the degree in a sentence ("OD student") when the label won't do.
// Pure: no file or network access.

export const LEVELS = ["high_school", "certificate", "diploma", "bachelor", "graduate", "doctorate"];

export const GROUPS = [
  { key: "common", label: "Most common" },
  { key: "college", label: "College and certificates" },
  { key: "bachelor", label: "Bachelor's degrees" },
  { key: "law", label: "Law" },
  { key: "health", label: "Health" },
  { key: "graduate", label: "Other graduate degrees" },
  { key: "doctorate", label: "Doctorates" },
];

const d = (key, label, level, group, aliases, extra = {}) => ({ key, label, level, group, aliases, satisfies: [], ...extra });

export const DEGREE_TYPES = [
  d("high_school", "High school", "high_school", "common", ["high school", "high school diploma", "secondary school", "ged", "ossd", "diplome d etudes secondaires"]),
  d("diploma", "College diploma", "diploma", "common", ["college diploma", "diploma", "ontario college diploma", "college"]),
  d("bachelor", "Bachelor's", "bachelor", "common", ["bachelors", "bachelor", "bachelors degree", "bachelor degree", "undergraduate degree", "undergraduate", "undergrad", "honours degree", "honors degree"]),
  d("master", "Master's", "graduate", "common", ["masters", "master", "masters degree", "master degree", "ma", "ms", "msc", "masc", "mfin", "mmgt", "mtech", "m tech", "master of arts", "master of science", "master of management", "graduate degree", "advanced degree", "maitrise"], {
    // The old check let any graduate degree through MBA roles; a Master's in
    // management or finance often competes for them.
    satisfies: ["mba"],
    titleCues: ["masters"],
    // Not "graduate degree": postings say "recent graduate, degree required".
    textCues: ["masters"],
  }),
  d("mba", "MBA", "graduate", "common", ["mba", "emba", "executive mba", "master of business administration", "pgdm"], { field: "business", titleCues: ["mba"], textCues: ["mba"] }),
  d("phd", "PhD", "doctorate", "common", ["phd", "dphil", "doctorate", "doctoral", "doctoral degree", "doctor of philosophy", "postdoc"], {
    satisfies: ["mba"],
    titleCues: ["phd", "doctoral", "postdoc", "postdoctoral"],
    textCues: ["phd", "doctoral", "doctorate"],
  }),
  d("jd", "JD", "graduate", "common", ["jd", "juris doctor", "juris doctorate", "law degree", "law school"], { field: "law", satisfies: ["llb"], textCues: ["jd", "juris doctor", "law degree"] }),

  d("certificate", "Certificate", "certificate", "college", ["certificate", "college certificate"]),
  d("bootcamp", "Bootcamp", "certificate", "college", ["bootcamp", "boot camp", "coding bootcamp"]),
  d("associate", "Associate's", "diploma", "college", ["associates", "associate", "associates degree", "associate degree", "aa", "aas"]),
  d("cegep", "CEGEP (DEC)", "diploma", "college", ["cegep", "dec", "diplome d etudes collegiales"], { noun: "CEGEP" }),
  d("advanced_diploma", "Advanced diploma", "diploma", "college", ["advanced diploma", "ontario college advanced diploma"]),
  d("grad_certificate", "Graduate certificate or diploma", "bachelor", "college", ["graduate certificate", "graduate diploma", "postgraduate certificate", "post graduate certificate", "postgraduate diploma", "post graduate diploma", "pg diploma", "pgd"], { noun: "Graduate certificate" }),
  d("incomplete", "Some college, no degree", "high_school", "college", ["incomplete", "some college", "some university", "no degree"], { noun: "" }),

  d("ba", "BA", "bachelor", "bachelor", ["ba", "b a", "bachelor of arts", "honours ba", "hons ba"]),
  d("bsc", "BSc", "bachelor", "bachelor", ["bsc", "bs", "b sc", "bachelor of science", "honours bsc", "hons bsc"]),
  d("bcom", "BCom", "bachelor", "bachelor", ["bcom", "bcomm", "b com", "b comm", "bachelor of commerce"]),
  d("bba", "BBA", "bachelor", "bachelor", ["bba", "bachelor of business administration"]),
  d("hba", "HBA", "bachelor", "bachelor", ["hba", "honours business administration", "honors business administration"]),
  d("bmos", "BMOS", "bachelor", "bachelor", ["bmos", "bachelor of management and organizational studies"]),
  d("beng", "BEng", "bachelor", "bachelor", ["beng", "b eng", "bachelor of engineering"]),
  d("basc", "BASc", "bachelor", "bachelor", ["basc", "bachelor of applied science"]),
  d("btech", "BTech", "bachelor", "bachelor", ["btech", "b tech", "bachelor of technology"]),
  d("bfa", "BFA", "bachelor", "bachelor", ["bfa", "bachelor of fine arts"]),
  d("bed", "BEd", "bachelor", "bachelor", ["bed", "bachelor of education"]),
  d("bsn", "BSN", "bachelor", "bachelor", ["bsn", "bscn", "bachelor of science in nursing", "bachelor of nursing"]),
  d("licence", "Licence (France)", "bachelor", "bachelor", ["licence"], { noun: "Licence" }),

  d("llb", "LLB", "graduate", "law", ["llb", "ll b", "bachelor of laws", "bcl"], { field: "law", satisfies: ["jd"] }),
  d("llm", "LLM", "graduate", "law", ["llm", "ll m", "master of laws"], { field: "law", satisfies: ["jd", "llb"] }),
  d("jd_mba", "JD/MBA", "graduate", "law", ["jd mba", "jd and mba", "mba jd"], { field: "law", satisfies: ["jd", "llb", "mba"] }),

  d("md", "MD", "graduate", "health", ["md", "doctor of medicine", "medical degree"], { field: "medicine", satisfies: ["do", "mbbs"], textCues: ["doctor of medicine", "medical degree"] }),
  d("do", "DO", "graduate", "health", ["do", "doctor of osteopathic medicine"], { field: "medicine", satisfies: ["md"] }),
  d("mbbs", "MBBS", "graduate", "health", ["mbbs", "bachelor of medicine"], { field: "medicine", satisfies: ["md"] }),
  d("dds", "DDS or DMD", "graduate", "health", ["dds", "dmd", "doctor of dental surgery", "doctor of dental medicine"], { field: "dentistry", noun: "DDS" }),
  d("pharmd", "PharmD", "graduate", "health", ["pharmd", "pharm d", "doctor of pharmacy"], { field: "pharmacy" }),
  d("dvm", "DVM", "graduate", "health", ["dvm", "vmd", "doctor of veterinary medicine"], { field: "veterinary" }),
  d("dpt", "DPT", "graduate", "health", ["dpt", "doctor of physical therapy"], { field: "physical therapy" }),
  d("od", "OD (optometry)", "graduate", "health", ["od", "od optometry", "doctor of optometry"], { field: "optometry", noun: "OD" }),

  d("msw", "MSW", "graduate", "graduate", ["msw", "master of social work"], { field: "social work" }),
  d("mph", "MPH", "graduate", "graduate", ["mph", "master of public health"], { field: "public health" }),
  d("mpp", "MPP or MPA", "graduate", "graduate", ["mpp", "mpa", "master of public policy", "master of public administration"], { field: "public policy", noun: "MPP" }),
  d("mfa", "MFA", "graduate", "graduate", ["mfa", "master of fine arts"], { field: "fine arts" }),
  d("meng", "MEng", "graduate", "graduate", ["meng", "m eng", "master of engineering"], { field: "engineering" }),
  d("march", "MArch", "graduate", "graduate", ["march", "m arch", "master of architecture"], { field: "architecture" }),

  d("psyd", "PsyD", "doctorate", "doctorate", ["psyd", "psy d", "doctor of psychology"], { field: "psychology" }),
  d("edd", "EdD", "doctorate", "doctorate", ["edd", "ed d", "doctor of education"], { field: "education" }),
];

const rank = (level) => LEVELS.indexOf(level);

// Lowercase, accents and apostrophes gone, "Ph.D." -> "phd". A sentence end
// becomes "|" so a cue never reads across two sentences ("MBA. Required...").
function normalize(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(?<!\.[a-z])\.(?=\s|$)|[!?;:\n]/g, " | ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Short or common words count only as the whole answer ("DO") or how it
// starts ("BA, Economics"), so "graduating in May, MS Excel" isn't a Master's
// and "BA, applying to law school" isn't a JD.
const WHOLE_ONLY = new Set(["do", "od"]);
const AT_START = new Set(["dec", "bed", "march", "licence", "law school"]);
const ANYWHERE = new Set(["jd"]);
const atStart = (alias) => (alias.length <= 2 && !ANYWHERE.has(alias)) || AT_START.has(alias);

const ALIASES = DEGREE_TYPES.flatMap((t) => t.aliases.map((a) => ({ words: normalize(a), type: t })));

// Microsoft products, not a Master of Science.
const MS_PRODUCT = /\bms (?:excel|office|word|powerpoint|outlook|access|project|teams|sql)\b/g;

// A part of the answer about a degree not held yet: "planning a Master's",
// "Master of Arts planned", "applying to law school". A year alone ("MBA
// 2027") is a degree in progress, which counts.
const PLAN = /\b(?:plans?|planning|planned|apply|applying|will|intend|intends|intending|future|hope|hopes|hoping|aspiring|considering)\b/i;
const heldPart = (raw) => raw.split(/[,;()\n]/).filter((part) => !PLAN.test(part)).join(", ");

const MONTH_YEAR = /\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|december) \d{4}\b/g;

// Where each alias appears in the answer, as [start, end) in ` ${words} `.
function aliasMatches(words) {
  const padded = ` ${words} `;
  const out = [];
  for (const a of ALIASES) {
    if (WHOLE_ONLY.has(a.words)) continue;
    const start = atStart(a.words) ? (padded.startsWith(` ${a.words} `) ? 0 : -1) : padded.indexOf(` ${a.words} `);
    if (start >= 0) out.push({ ...a, start, end: start + a.words.length + 2 });
  }
  return out;
}

// The degree a piece of text names, or null for empty text. Parts about a
// degree still to come are left out. An answer that
// names several ("MBA candidate, BCom 2022") reads as the highest, the
// earliest of those on a tie. A name inside a longer one doesn't count, so
// "Some college, no degree" isn't a college diploma and "University College
// London BSc" is a BSc. Unknown text gives an "other" entry that keeps what
// was typed and never hides a job.
export function degreeOf(text) {
  const raw = String(text ?? "").trim();
  const words = normalize(raw).replace(/\s*\|\s*/g, " ").trim();
  if (!words) return null;
  const exact = ALIASES.find((a) => a.words === words);
  if (exact) return exact.type;
  const held = normalize(heldPart(raw)).replace(/\s*\|\s*/g, " ").replace(MONTH_YEAR, " ").replace(MS_PRODUCT, " ");
  const found = aliasMatches(held.replace(/\s+/g, " ").trim());
  const inside = (m, o) => o !== m && o.start <= m.start && o.end >= m.end && o.words.length > m.words.length;
  const best = found
    .filter((m) => !found.some((o) => inside(m, o)))
    .sort((a, b) => rank(b.type.level) - rank(a.type.level) || a.start - b.start || b.words.length - a.words.length)[0];
  return best ? best.type : { key: "other", label: raw, level: null, group: null, aliases: [], satisfies: [] };
}

// The degree as a word in a sentence: "OD student", "DDS graduate". Empty for
// answers that aren't a degree ("Some college, no degree").
export const nounOf = (type) => (type ? (type.noun ?? type.label) : "");


// Whether a person with degree `mine` meets one requirement. Either side
// missing or unknown means yes: the app never hides a job on a guess.
export function meetsRequirement(mine, required) {
  if (!mine || !required || mine.key === "other" || required.key === "other") return true;
  if (required.key === mine.key || mine.satisfies.includes(required.key)) return true;
  if (rank(required.level) <= rank("bachelor")) return true;
  if (required.field) return false;
  return rank(mine.level) >= rank(required.level);
}

const has = (text, words) => ` ${text} `.includes(` ${words} `);

function cued(text, cue) {
  const out = [];
  for (const t of DEGREE_TYPES) for (const w of t[cue] || []) if (has(text, w) && !out.includes(t)) out.push(t);
  return out;
}

// Degrees a job title says the job is for ("MBA Intern", "PhD Researcher").
export const titleDegrees = (title) => cued(normalize(title), "titleCues");

// Degrees a posting's text says are required ("An MBA is required",
// "must hold a J.D."), but not "No PhD required" or "JD Edwards experience".
// Each "required" or "requires" reads up to eight words next to it, stopping
// at the sentence, an "and" or the last requirement. Degrees listed there are alternatives, so naming
// a bachelor's or less ("Bachelor's or Master's required") asks for nothing
// above a bachelor's. A requirement just for some roles ("for managers")
// doesn't count.
const TEXT_CUES = new Map(DEGREE_TYPES.flatMap((t) => (t.textCues || []).map((w) => [w, t])));
const NEGATION = "(?:no|not|doesnt|dont|without|never) ";
const NOT = `(?<!\\b${NEGATION})`;
const NEGATED = new RegExp(`\\b${NEGATION}$`);
const CUE = new RegExp(`${NOT}\\b(${[...TEXT_CUES.keys()].join("|")})\\b(?! edwards)`, "g");
const ANCHOR = new RegExp(`\\b(?:(requires?|must (?:have|hold))|(?:is |are )?(?:required|needed))\\b`, "g");
const WINDOW = 8;
const SOME_ROLES = /^ for (?:managers?|management|senior|leads?|leadership|supervisors?|some|certain)\b/;
// Words that name something else in a posting: "an accredited college", "Summer
// Associate", "a driver's licence".
const NOT_AN_ALTERNATIVE = new Set(["college", "associate", "associates", "licence", "incomplete", "some college", "some university", "no degree", "bed", "dec"]);
const LOWER = DEGREE_TYPES.filter((t) => rank(t.level) <= rank("bachelor"))
  .flatMap((t) => t.aliases.map(normalize))
  .filter((a) => !NOT_AN_ALTERNATIVE.has(a));

export function requiredDegrees(text) {
  const out = [];
  for (const sentence of normalize(text).split("|")) {
    const parts = ` ${sentence} `.split(/ and /);
    for (const part of parts) {
      const anchors = [...part.matchAll(ANCHOR)];
      anchors.forEach((m, i) => {
        const end = m.index + m[0].length;
        const words = (m[1]
          ? part.slice(end, anchors[i + 1]?.index ?? part.length)
          : part.slice(i ? anchors[i - 1].index + anchors[i - 1][0].length : 0, m.index)
        ).trim().split(" ");
        const window = (m[1] ? words.slice(0, WINDOW) : words.slice(-WINDOW)).join(" ");
        if (NEGATED.test(part.slice(0, m.index)) || (!m[1] && SOME_ROLES.test(part.slice(end)))) return;
        if (LOWER.some((a) => has(window, a))) return;
        for (const c of window.matchAll(CUE)) {
          const t = TEXT_CUES.get(c[1]);
          if (!out.includes(t)) out.push(t);
        }
      });
    }
  }
  return out;
}

// "in_progress" while the graduation month is still ahead (or this month),
// "completed" after it, null with no graduation date.
export function degreeStatus(facts = {}, today = new Date()) {
  const m = String(facts.graduation || "").match(/^(\d{4})-(\d{1,2})/);
  if (!m) return null;
  const grad = Number(m[1]) * 12 + Number(m[2]) - 1;
  const now = today.getFullYear() * 12 + today.getMonth();
  return grad >= now ? "in_progress" : "completed";
}

// "a JD", "an MBA", "an EdD", "a Master's": initials are read letter by letter.
export function withArticle(label) {
  const s = String(label);
  const an = /^[A-Z]{2}/.test(s) ? /^[AEFHILMNORSX]/.test(s) : /^[AEIOU]/i.test(s);
  return `${an ? "an" : "a"} ${s}`;
}
