// Sample data for ?applyDemo=<state>. Obviously fake; no network calls are made in demo mode.
const fields = [
  { id: "f0", kind: "text", label: "First name", required: true, value: "Alex" },
  { id: "f1", kind: "text", label: "Last name", required: true, value: "Example" },
  { id: "f2", kind: "email", label: "Email", required: true, value: "alex@example.com" },
  { id: "f3", kind: "select", label: "Are you legally authorized to work in Canada?", required: true, value: "Yes", options: [{ value: "y", label: "Yes" }, { value: "n", label: "No" }] },
  { id: "f4", kind: "textarea", label: "Why Example Co?", required: true, value: "I like that Example Co ships small tools for small teams, and my ops internship taught me to do the same." },
  { id: "f5", kind: "text", label: "How did you hear about us?", required: true, value: "" },
  { id: "f6", kind: "file", label: "Resume", required: true, value: "resume-ops.pdf" },
];
const answers = [
  { fieldId: "f0", value: "Alex", source: "kit" },
  { fieldId: "f1", value: "Example", source: "kit" },
  { fieldId: "f2", value: "alex@example.com", source: "kit" },
  { fieldId: "f3", value: "Yes", source: "rule" },
  { fieldId: "f4", value: "I like that Example Co ships small tools for small teams, and my ops internship taught me to do the same.", source: "written" },
  { fieldId: "f5", value: "", source: "none" },
  { fieldId: "f6", value: "resumes/resume-ops.pdf", source: "kit" },
];
const readBack = (okAll) =>
  fields.map((f) => ({ fieldId: f.id, shows: f.value, ok: okAll || f.id !== "f5", problem: okAll || f.id !== "f5" ? undefined : "empty required" }));

export function demoApplication(state) {
  const clean = state === "review" || state === "sent" || state === "sent-dry" || state === "unclear";
  const fs = clean ? fields.map((f) => (f.id === "f5" ? { ...f, value: "A friend" } : f)) : fields;
  const ans = clean ? answers.map((a) => (a.fieldId === "f5" ? { ...a, value: "A friend", source: "standing" } : a)) : answers;
  return {
    jobId: "demo",
    site: "greenhouse",
    state,
    company: "Example Co",
    model: "claude",
    fields: fs,
    answers: ans,
    readBack: clean ? fs.map((f) => ({ fieldId: f.id, shows: f.value, ok: true })) : readBack(false),
    blockers: state === "blocked" ? [{ kind: "human-check", detail: "reCAPTCHA" }] : [],
    history: [],
  };
}
