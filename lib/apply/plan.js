// plan.js
// Chooses an answer for every field on a form, in this order: your edits,
// standing answers, rules, then one model call that maps leftover short
// fields to a fact key, then one call that writes open questions. The work
// authorization gate runs last over all of them.

import crypto from "crypto";
import { FACT_KEYS, valueFor, schoolAliases } from "./facts.js";
import { ruleAnswer, standingAnswer, fitted, norm, isQuestionLabel } from "./rules.js";
import { gate, isAuthTopic } from "./authGate.js";
import { SYSTEM as WRITING_SYSTEM } from "../writing.js";

const SHORT = new Set(["text", "email", "tel", "url", "number", "date", "select", "radio"]);
const OPEN_WORDS = /\b(why|describe|tell us|explain|what (excites|interests|motivates|draws)|anything else)\b/;
const REUSED = new Set(["you", "model", "written", "takeover"]);
// Answers a later fill keeps even over a rule: yours, and the ones Claude took over for.
const PINNED = new Set(["you", "takeover"]);

export const isOpenQuestion = (f) =>
  f.kind === "textarea" || (f.kind === "text" && (Number(f.maxLength) > 200 || OPEN_WORDS.test(norm(f.label)) || isQuestionLabel(f.label)));

const numbers = (text) => new Set(String(text || "").match(/\d+(?:[.,]\d+)*/g) || []);

// True when every number in the text appears in the sources.
export function numbersSupported(text, sources) {
  const allowed = numbers(sources.join("\n"));
  return [...numbers(text)].every((n) => allowed.has(n));
}

// Phrases that claim an outcome. A sentence using one must rest on the sources.
const CLAIM = /\b(resulted in|result(ed)? in|led to|the outcome was|the result was|as a result|improv(ed|ing)|reduc(ed|ing)|saved|saving|increas(ed|ing)|decreas(ed|ing)|boost(ed|ing)|grew|cut|generated|achiev(ed|ing)|streamlin(ed|ing)|eliminat(ed|ing))\b/i;
const FILLER = new Set(("about above after again also because been before being between both could does doing down during each from further have having here into just like more most much only other over same should some such than that their them then there these they this those through under until very were what when where which while with would your you our out for and the was are not but can his her its has had how").split(" "));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, "").slice(0, 5);

// The first sentence that claims an outcome whose content words are not in the
// sources, or null. Conservative on purpose: a miss only leaves the field for you.
export function unsupportedClaim(text, sources) {
  const have = new Set(norm(sources.join("\n")).split(" ").filter((w) => w.length > 3).map(stem));
  for (const sentence of String(text || "").split(/(?<=[.!?])\s+/)) {
    if (!CLAIM.test(sentence)) continue;
    const words = norm(sentence.replace(new RegExp(CLAIM.source, "gi"), " ")).split(" ").filter((w) => w.length > 3 && !FILLER.has(w));
    if (words.some((w) => !have.has(stem(w)))) return sentence;
  }
  return null;
}

// Each role's dates and whether it is still going, for the writer.
export function rolesText(roles = []) {
  return roles.map((r) => `- ${r.role}${r.org ? `, ${r.org}` : ""}: ${r.dates} (${r.current ? "CURRENT: present tense is right" : "ENDED: use past tense"})`).join("\n");
}

export const WRITER_RULES = [
  "Tense: use the past tense for every role marked ENDED. Use the present tense only for a role marked CURRENT. Never imply an ended job is current.",
  "Facts: state only facts that appear in the resume, the posting or the standing answers. Never state an outcome, result, number, skill, tool or employer detail that is not there. When the resume gives an action without a result, describe the action and stop. Do not add what it led to, improved, reduced or saved.",
].join(" ");

const describe = (f) => ({
  fieldId: f.id,
  label: f.label,
  ...(f.hint && { hint: f.hint }),
  kind: f.kind,
  ...(f.options?.length && { options: f.options.map((o) => o.label) }),
});

async function mapShortFields(fields, facts, model) {
  if (!fields.length) return { answers: {}, info: null };
  const keys = FACT_KEYS.map((k) => k.key);
  const schema = {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: { fieldId: { type: "string", enum: fields.map((f) => f.id) }, key: { type: "string", enum: [...keys, "unknown"] } },
          required: ["fieldId", "key"],
        },
      },
    },
    required: ["answers"],
  };
  const prompt = [
    "For each form field, pick the one fact key whose value belongs in it, or unknown when none fits.",
    "Fact keys:",
    ...FACT_KEYS.map((k) => `- ${k.key}: ${k.definition}`),
    "",
    "Fields:",
    JSON.stringify(fields.map(describe), null, 1),
  ].join("\n");
  const res = await model({ system: "You map job application form fields to a fixed list of keys. Pick only from the list. Never invent a key.", prompt, schema });
  const answers = {};
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const defs = Object.fromEntries(FACT_KEYS.map((k) => [k.key, k.definition]));
  for (const pick of res.data?.answers || []) {
    const f = byId[pick?.fieldId];
    if (!f || !defs[pick.key] || (pick.key === "salary" && !f.required)) continue;
    const a = fitted(f, valueFor(facts, pick.key), "model", `Matched to: ${defs[pick.key]}`, pick.key === "school" ? schoolAliases(facts) : []);
    if (a.value) answers[f.id] = a;
  }
  return { answers, info: res };
}

async function writeOpenQuestions(fields, { facts, job, sources, model }) {
  if (!fields.length) return { answers: {}, info: null };
  const schema = {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: { type: "object", properties: { fieldId: { type: "string", enum: fields.map((f) => f.id) }, text: { type: "string" } }, required: ["fieldId", "text"] },
      },
    },
    required: ["answers"],
  };
  const standing = facts.answers.filter((a) => !isAuthTopic(a.question)).map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n");
  const prompt = [
    `ROLE: ${job.title || ""} at ${job.company || ""}`,
    `POSTING:\n${String(sources.posting || "").slice(0, 6000) || "(none)"}`,
    `RESUME:\n${String(sources.resumeText || "").slice(0, 5000)}`,
    sources.roles?.length && `ROLES AND DATES (today is ${(sources.today || new Date().toISOString()).slice(0, 10)}):\n${rolesText(sources.roles)}\nOnly roles marked CURRENT are happening now. Write about every ENDED role in the past tense.`,
    sources.summary && `SUMMARY:\n${sources.summary}`,
    standing && `STANDING ANSWERS:\n${standing}`,
    "",
    "Answer each open question on the application form. Match the length to the question: 60 to 140 words unless a limit is given. Never state a number, outcome or result that is not in the resume, posting or standing answers.",
    JSON.stringify(fields.map((f) => ({ ...describe(f), ...(f.maxLength && { maxLength: f.maxLength }) })), null, 1),
  ].filter(Boolean).join("\n\n");
  const res = await model({ system: `${WRITING_SYSTEM} ${WRITER_RULES}`, prompt, schema });
  const allowed = [sources.posting, sources.resumeText, sources.summary, standing, job.title, job.company];
  const answers = {};
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  for (const w of res.data?.answers || []) {
    const f = byId[w?.fieldId];
    const text = String(w?.text || "").replace(/[–—]/g, ", ").trim();
    if (!f || !text) continue;
    if (!numbersSupported(text, allowed.map((s) => String(s || "")))) {
      answers[f.id] = { value: "", source: "none", note: "The written answer had a number that isn't in your resume, so it was dropped" };
      continue;
    }
    const unsupported = unsupportedClaim(text, [...allowed, f.label].map((x) => String(x || "")));
    if (unsupported) {
      answers[f.id] = { value: "", source: "none", note: "The written answer claimed a result that isn't in your resume, so it was dropped. Write this one yourself" };
      continue;
    }
    const max = Number(f.maxLength) > 0 ? Number(f.maxLength) : Infinity;
    answers[f.id] = { value: text.slice(0, max), source: "written", note: "Written for this job. Check it." };
  }
  return { answers, info: res };
}

// previous: answers from the last fill, kept when the same field (id and
// label) is still there, so Fill again doesn't re-ask the model.
export async function planAnswers({ fields, facts, job = {}, sources = {}, model, edits = [], previous = [] }) {
  const edited = new Map(edits.map((e) => [e.fieldId, e]));
  const kept = new Map(previous.filter((a) => REUSED.has(a.source) && a.value).map((a) => [a.fieldId, a]));
  const chosen = {};
  for (const f of fields) {
    // A typed path could attach any file on this computer; uploads only ever use your resume.
    const e = f.kind === "file" ? null : edited.get(f.id);
    chosen[f.id] =
      (e && (e.source === "takeover" ? { value: String(e.value ?? ""), source: "takeover", note: e.note || "Answered by Claude" } : { value: String(e.value ?? ""), source: "you", note: "Your answer" })) ||
      (PINNED.has(kept.get(f.id)?.source) && kept.get(f.id)) ||
      standingAnswer(f, facts) ||
      ruleAnswer(f, facts) ||
      kept.get(f.id) ||
      null;
  }
  const open = fields.filter((f) => !chosen[f.id] && !isAuthTopic(f.label));
  const toMap = open.filter((f) => SHORT.has(f.kind) && !isOpenQuestion(f));
  const toWrite = open.filter(isOpenQuestion);
  const ask = model || (async () => ({ data: null, provider: "none", skipped: [] }));
  const mapped = await mapShortFields(toMap, facts, ask);
  const written = await writeOpenQuestions(toWrite, { facts, job, sources, model: ask });
  const answers = fields.map((f) => {
    const a = chosen[f.id] || mapped.answers[f.id] || written.answers[f.id] || { value: "", source: "none", note: "Needs you" };
    return gate(f, { fieldId: f.id, ...a }, { workAuth: facts.workAuth, jobLocation: job.location });
  });
  const used = [mapped.info, written.info].filter(Boolean);
  return {
    answers,
    model: used.length ? { provider: [...new Set(used.map((u) => u.provider))].join(", "), skipped: used.flatMap((u) => u.skipped) } : null,
  };
}

const fieldShape = (f) => ({ id: f.id, label: f.label, kind: f.kind, options: (f.options || []).map((o) => [o.value, o.label]) });

export function planHash({ formUrl, fields = [], answers = [], readBack = [] }) {
  const body = JSON.stringify({
    formUrl,
    fields: fields.map(fieldShape),
    answers: answers.map((a) => [a.fieldId, a.value]),
    readBack: readBack.map((r) => [r.fieldId, r.shows, r.ok]),
  });
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function sameFieldSet(a = [], b = []) {
  return JSON.stringify(a.map(fieldShape)) === JSON.stringify(b.map(fieldShape));
}
