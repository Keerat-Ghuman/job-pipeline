"use client";

import { useEffect, useState } from "react";
import { LANGUAGE_CHOICES } from "../lib/eligibility.js";

// "Languages I speak": roles that need a language you don't pick are marked
// Not eligible (with the reason on the card); pick it and they come back.
export default function LanguagesSetting({ kit, onSaved }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(["English"]);
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const saved = kit?.eligibility?.languages;
    if (saved?.length) setPicked(saved);
  }, [kit]);

  async function toggle(lang) {
    const next = picked.includes(lang) ? picked.filter((l) => l !== lang) : [...picked, lang];
    if (!next.length || saving) return;
    const before = picked;
    setPicked(next);
    setSaving(true);
    setState("Saving…");
    try {
      const res = await fetch("/api/kit/languages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ languages: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save.");
      setState(data.rechecked ? "Saved. Your list is updated." : "Saved. Your list updates on the next search.");
      onSaved?.();
    } catch (err) {
      setPicked(before);
      setState(err.message);
    }
    setSaving(false);
  }

  return (
    <div className="langSetting">
      <button type="button" className="ghostBtn" aria-expanded={open} onClick={() => setOpen(!open)}>
        Languages I speak: {picked.join(", ")}
      </button>
      {open && (
        <fieldset className="langPanel">
          <legend>Roles that need a language you don't pick are marked Not eligible.</legend>
          <div className="langList">
            {LANGUAGE_CHOICES.map((l) => (
              <label key={l} className="langOption">
                <input type="checkbox" checked={picked.includes(l)} disabled={saving} onChange={() => toggle(l)} />
                <span>{l}</span>
              </label>
            ))}
          </div>
          <p className="langState" role="status">{state}</p>
        </fieldset>
      )}
    </div>
  );
}
