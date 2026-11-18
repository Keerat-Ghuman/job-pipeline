// Pure view rules for the Fill application panel. Which actions each state
// allows comes from the engine's own table in lib/apply/state.js.

import { can } from "../../../lib/apply/state.js";

export const SOURCE_LABELS = {
  kit: "From your apply kit",
  rule: "Worked out from your apply kit",
  standing: "Your standing answer",
  model: "Picked by AI",
  written: "Written for this job",
  takeover: "Answered by Claude",
  you: "You typed this",
  none: "Needs you",
};

export const BLOCKER_TEXT = {
  "human-check": "Finish the human check in the Chrome window, then press Check again.",
  "sign-in": "Sign in in the Chrome window, then press Check again.",
  signature: "Sign the form in the Chrome window, then press Check again.",
  "emailed-code": "Enter the code from your email in the Chrome window, then press Check again.",
  "unsupported-field": "A question here can't be filled by the app. Answer it in the Chrome window, then press Check again.",
  "page-error": "The page showed an error. Look at the Chrome window, then press Check again.",
  "multi-page": "This form has more than one page. Finish it in the Chrome window.",
  "not-ats": "The form isn't on Greenhouse, Lever or Ashby. Use Open application.",
};

export const AI_ROUTE_LABELS = {
  claude: "Answers written with your Claude subscription",
  gemini: "Answers written with your free Gemini key",
  none: "No AI used. Answers come from your apply kit only.",
};

export const TEXT_KINDS = ["text", "email", "tel", "url", "number", "date"];

export function allowed(state, action) {
  return can(state, action);
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || SOURCE_LABELS.none;
}

export function blockerText(b) {
  return BLOCKER_TEXT[b?.kind] || "Look at the Chrome window, then press Check again.";
}

export function aiRouteLabel(model) {
  if (!model) return "";
  const key = String(typeof model === "string" ? model : model.provider || "").split(",")[0].trim();
  return AI_ROUTE_LABELS[key] || "";
}

const PROBLEM_TEXT = {
  "wrong value": "The page shows something different from this answer. Fill again.",
  "empty required": "This is required and empty.",
  "no file": "No file is attached.",
};

// One line for a row, or "" when the row is fine. `edited` is a pending local edit.
export function rowProblem(field, readBack, edited) {
  if (edited !== undefined) return "";
  if (readBack && readBack.ok === false) return PROBLEM_TEXT[readBack.problem] || "The page does not show this answer. Fill again.";
  const shown = readBack ? readBack.shows : field.value;
  if (field.required && (shown === undefined || shown === null || String(shown).trim() === "")) return PROBLEM_TEXT["empty required"];
  return "";
}

// What the row shows: the pending edit, else the page's read-back, else the field value.
export function rowValue(field, readBack, edited) {
  if (edited !== undefined) return edited;
  const v = readBack ? readBack.shows : field.value;
  return v === undefined || v === null ? "" : String(v);
}

export function rowSource(application, fieldId, edited) {
  if (edited !== undefined) return "you";
  const a = (application.answers || []).find((x) => x.fieldId === fieldId);
  return a ? a.source : "none";
}

export function noteFor(application, fieldId) {
  const a = (application.answers || []).find((x) => x.fieldId === fieldId);
  return a?.note || "";
}

export function problemCount(application, edits = {}) {
  const rb = new Map((application.readBack || []).map((r) => [r.fieldId, r]));
  return (application.fields || []).filter((f) => rowProblem(f, rb.get(f.id), edits[f.id])).length;
}

export function canSubmit(application, edits = {}) {
  if (!application || !allowed(application.state, "submit")) return false;
  if ((application.blockers || []).length) return false;
  if (Object.keys(edits).length) return false;
  return problemCount(application) === 0;
}

export const RESULT_TEXT = {
  sent: "Sent. Marked applied; follow-up in 7 days.",
  "sent-dry": "Dry run. Stopped before Submit. Nothing was sent.",
  unclear: "The page didn't confirm it. Check the Chrome window, then mark it.",
  refused: "The page refused it. Fix what it lists, then fill again.",
  failed: "Filling failed. Fill again, or close the form.",
  lost: "The Chrome window is gone. Fill again to reopen the form.",
  sending: "Sending. Wait for the result, or mark it yourself if this stays.",
};
