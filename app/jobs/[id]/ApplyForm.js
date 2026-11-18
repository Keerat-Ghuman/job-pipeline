"use client";

import { useEffect, useRef, useState } from "react";
import s from "../jobs.module.css";
import { api } from "./ui.js";
import { demoApplication } from "./applyDemo.js";
import { allowed, canSubmit, noteFor, problemCount, rowProblem, rowSource, rowValue, sourceLabel, blockerText, aiRouteLabel, RESULT_TEXT, TEXT_KINDS } from "./applyView.js";

const POLL_MS = 2000;
const IDLE_TEXT = "Opens the form in a separate Chrome window and fills it from your apply kit. Nothing is sent until you say yes.";

function Answer({ field, value, onChange }) {
  const label = field.label;
  if (field.kind === "file") return <span className={s.applyValue}>{value || "No file"}</span>;
  if (field.kind === "textarea") return <textarea className={s.textarea} style={{ minHeight: 110 }} aria-label={label} value={value} maxLength={field.maxLength || undefined} onChange={(e) => onChange(e.target.value)} />;
  if (field.kind === "select" || field.kind === "radio" || field.kind === "checkbox") {
    const opts = field.kind === "checkbox" && !(field.options || []).length ? [{ label: "true" }, { label: "false" }] : field.options || [];
    const shown = (o) => (o.label === "true" ? "Ticked" : o.label === "false" ? "Not ticked" : o.label);
    return (
      <select className={s.select} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {value === "" && <option value="">Choose one</option>}
        {opts.map((o) => (
          <option key={o.label} value={o.label}>
            {shown(o)}
          </option>
        ))}
      </select>
    );
  }
  const type = TEXT_KINDS.includes(field.kind) && field.kind !== "number" && field.kind !== "date" ? field.kind : "text";
  return <input className={s.input} type={type} aria-label={label} value={value} maxLength={field.maxLength || undefined} onChange={(e) => onChange(e.target.value)} />;
}

function Rows({ application, edits, setEdit, locked }) {
  const rb = new Map((application.readBack || []).map((r) => [r.fieldId, r]));
  return (
    <div className={s.applyRows}>
      {(application.fields || []).map((f) => {
        const edited = edits[f.id];
        const value = rowValue(f, rb.get(f.id), edited);
        const problem = rowProblem(f, rb.get(f.id), edited);
        return (
          <div key={f.id} className={s.applyRow}>
            <div className={s.applyLabel}>
              {f.label}
              {f.required && <span className={s.note}> Required</span>}
            </div>
            {locked ? <span className={s.applyValue}>{value || "Empty"}</span> : <Answer field={f} value={value} onChange={(v) => setEdit(f.id, v)} />}
            <div className={s.applySource}>
              {sourceLabel(rowSource(application, f.id, edited))}
              {edited === undefined && noteFor(application, f.id) && <span className={s.applyNote}>{noteFor(application, f.id)}</span>}
            </div>
            {problem && <div className={`${s.error} ${s.applyProblem}`}>{problem}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function ApplyForm({ id, company }) {
  const [info, setInfo] = useState(null);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [code, setCode] = useState("");
  const [demo, setDemo] = useState("");
  const alive = useRef(true);

  const application = info?.application || null;
  const state = application?.state || "idle";

  useEffect(() => {
    alive.current = true;
    const d = process.env.NEXT_PUBLIC_APPLY_DEMO === "1" && new URLSearchParams(window.location.search).get("applyDemo");
    if (d) {
      setDemo(d);
      setInfo({ available: true, site: "greenhouse", application: d === "idle" ? null : demoApplication(d) });
    } else {
      load();
    }
    return () => {
      alive.current = false;
    };
  }, [id]);

  async function load() {
    const r = await api(`/api/jobs/${id}/apply`);
    if (!alive.current) return;
    if (r.success === false) setErr(r.error || "Could not check this form.");
    else setInfo(r);
  }

  useEffect(() => {
    if (demo || (state !== "filling" && state !== "sending")) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [state, demo, id]);

  function setEdit(fieldId, value) {
    setEdits((e) => ({ ...e, [fieldId]: value }));
  }

  async function act(action, body = {}) {
    setBusy(action);
    setErr("");
    let r;
    if (demo) {
      r = action === "confirm" ? { success: true, code: "demo" } : { success: true, application: demoApplication(action === "submit" ? "sent-dry" : action === "fill" ? "review" : demo) };
      if (action === "close") r = { success: true, application: null };
    } else r = await api(`/api/jobs/${id}/apply`, "POST", { action, ...body });
    if (!alive.current) return r;
    setBusy("");
    if (r.success === false) {
      setErr(r.error || "That did not work. Try again.");
      return r;
    }
    if ("application" in r) setInfo((i) => ({ ...i, application: r.application }));
    else if (action !== "confirm") load();
    if (action === "fill" || action === "close") setEdits({});
    return r;
  }

  const fill = () => act("fill", Object.keys(edits).length ? { answers: Object.entries(edits).map(([fieldId, value]) => ({ fieldId, value })) } : {});
  async function askConfirm() {
    const r = await act("confirm");
    if (r?.code) setCode(r.code);
  }
  async function submit() {
    const c = code;
    setCode("");
    await act("submit", { code: c });
  }

  if (!info) return err ? <p className={s.error}>{err}</p> : null;
  if (!info.available) return info.site && info.reason ? <p className={s.note}>{info.reason}</p> : null;

  const can = (a) => allowed(state, a);
  const dirty = Object.keys(edits).length > 0;
  const problems = application ? problemCount(application, edits) : 0;
  const blockers = application?.blockers || [];
  const submitOk = application && canSubmit(application, edits);
  const filling = state === "filling";
  const ai = aiRouteLabel(application?.model);
  const result = RESULT_TEXT[state];

  return (
    <section className={s.card} aria-live="polite">
      <h2>Fill application</h2>

      {state === "idle" && (
        <>
          <p className={s.note}>{IDLE_TEXT}</p>
          <div className={s.row}>
            <button className={s.btn} disabled={!!busy} onClick={fill}>
              {busy === "fill" ? "Starting…" : "Fill application"}
            </button>
          </div>
        </>
      )}

      {filling && <p className={s.note}>Filling the form…</p>}

      {application && !filling && (
        <>
          {result && <p className={state === "sent" || state === "sent-dry" ? s.note : s.warn}>{result}</p>}
          {blockers.map((b, i) => (
            <p key={i} className={s.warn}>
              {blockerText(b)}
              {b.detail && b.kind === "page-error" ? ` ${b.detail}` : ""}
            </p>
          ))}
          {ai && <p className={s.note}>{ai}</p>}
          <Rows application={application} edits={edits} setEdit={setEdit} locked={state === "sent" || state === "sending"} />
          {problems > 0 && state === "review" && <p className={s.error}>Fix the rows marked above before you submit.</p>}
          {dirty && <p className={s.note}>You changed answers. Press Fill again to put them in the form.</p>}

          {!code && (
            <div className={`${s.row} ${s.applyActions}`}>
              {can("submit") && (
                <button className={s.btn} disabled={!submitOk || !!busy} onClick={askConfirm}>
                  {busy === "confirm" || busy === "submit" ? "Working…" : "Submit application"}
                </button>
              )}
              {can("fill") && (
                <button className={s.ghost} disabled={!!busy} onClick={fill}>
                  {busy === "fill" ? "Starting…" : "Fill again"}
                </button>
              )}
              {can("check") && (
                <button className={s.ghost} disabled={!!busy} onClick={() => act("check")}>
                  {busy === "check" ? "Checking…" : "Check again"}
                </button>
              )}
              {can("mark") && (
                <>
                  <button className={s.ghost} disabled={!!busy} onClick={() => act("mark", { result: "applied" })}>
                    Mark applied
                  </button>
                  <button className={s.ghost} disabled={!!busy} onClick={() => act("mark", { result: "not-sent" })}>
                    Mark not sent
                  </button>
                </>
              )}
              {can("close") && (
                <button className={`${s.ghost} ${s.danger}`} disabled={!!busy} onClick={() => act("close")}>
                  Close form
                </button>
              )}
            </div>
          )}
        </>
      )}

      {code && (
        <div className={s.prompt} role="alertdialog" aria-label="Send this application">
          <span>Send this application to {company}? Nothing is sent until you say yes.</span>
          <button className={s.btn} disabled={!!busy} onClick={submit}>
            Yes, send it
          </button>
          <button className={s.ghost} disabled={!!busy} onClick={() => setCode("")}>
            Not yet
          </button>
        </div>
      )}

      {err && <p className={s.error}>{err}</p>}
    </section>
  );
}
