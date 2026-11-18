// page.js
// Scripts that run inside the form's page (kept as one string, so a build
// step can't rewrite them), the calls that run them over a tab session, and
// the read-back check in Node.

import path from "path";
import { norm } from "./rules.js";

const LIB = String.raw`
var SKIP = { hidden: 1, submit: 1, button: 1, image: 1, reset: 1, password: 1 };
var HELPER = /autofill|auto-fill|apply with (linkedin|indeed|google|seek)|import (from|your) (linkedin|resume)|easy apply/i;
var KINDS = { text: "text", search: "text", email: "email", tel: "tel", url: "url", number: "number", date: "date", radio: "radio", checkbox: "checkbox", file: "file" };

function txt(el) { return el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : ""; }
function shown(el) {
  var r = el.getBoundingClientRect(), s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
}
function optionLabelEl(el) {
  if (el.id) { var l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l; }
  return el.closest("label");
}
function usable(el) {
  var t = (el.type || "").toLowerCase();
  if (SKIP[t] || el.disabled) return false;
  if (t === "file") return true;
  if (t === "radio" || t === "checkbox") return shown(el) || !!(optionLabelEl(el) && shown(optionLabelEl(el)));
  return shown(el);
}
function controls(root) { return Array.prototype.filter.call(root.querySelectorAll("input, select, textarea"), usable); }
function formRoot() {
  var best = null, n = 0;
  document.querySelectorAll("form").forEach(function (f) { var c = controls(f).length; if (c > n) { n = c; best = f; } });
  return best || document.body;
}
function cleanLabel(s) { return String(s || "").replace(/\s*[*✱]\s*$/, "").replace(/\s+/g, " ").trim(); }
function byIds(ids) { return ids.split(/\s+/).map(function (id) { return txt(document.getElementById(id)); }).join(" ").trim(); }
function questionAbove(el, root) {
  var c = el.parentElement;
  for (var i = 0; i < 5 && c && c !== root; i++) {
    var lab = c.querySelector("legend, label, .label, .application-label, [class*='question']");
    if (lab && !lab.contains(el) && !lab.querySelector("input, select, textarea")) return txt(lab);
    c = c.parentElement;
  }
  return "";
}
function labelOf(el, root) {
  if (el.type !== "radio") { var l = optionLabelEl(el); if (l) return txt(l); }
  if (el.getAttribute("aria-labelledby")) return byIds(el.getAttribute("aria-labelledby"));
  if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
  return questionAbove(el, root) || el.placeholder || el.name || "";
}
function groupLabel(el, root) {
  var fs = el.closest("fieldset"); if (fs && fs.querySelector("legend")) return txt(fs.querySelector("legend"));
  var rg = el.closest("[role=radiogroup], [role=group]");
  if (rg && rg.getAttribute("aria-labelledby")) return byIds(rg.getAttribute("aria-labelledby"));
  if (rg && rg.getAttribute("aria-label")) return rg.getAttribute("aria-label");
  return questionAbove(rg || el.parentElement, root);
}
function stableId(id) { return id && !/^:|radix|react-|^ember\d|\d{4,}/i.test(id) && !(id.length >= 16 && /\d/.test(id) && !/[-_]/.test(id)); }
function unique(sel) { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } }
function selectorOf(el) {
  var tag = el.tagName.toLowerCase();
  if (stableId(el.id) && unique("#" + CSS.escape(el.id))) return "#" + CSS.escape(el.id);
  if (el.name && unique(tag + '[name="' + el.name + '"]')) return tag + '[name="' + el.name + '"]';
  var tid = el.getAttribute("data-testid") || el.getAttribute("data-qa");
  if (tid && unique('[data-testid="' + tid + '"]')) return '[data-testid="' + tid + '"]';
  var parts = [], c = el;
  while (c && c !== document.body) {
    var i = 1, s = c; while ((s = s.previousElementSibling)) if (s.tagName === c.tagName) i++;
    parts.unshift(c.tagName.toLowerCase() + ":nth-of-type(" + i + ")"); c = c.parentElement;
  }
  return "body > " + parts.join(" > ");
}
function requiredOf(el, label) { return !!(el.required || el.getAttribute("aria-required") === "true" || /[*✱]\s*$/.test(label)); }
function sectionOf(el, root) {
  var heads = root.querySelectorAll("h1, h2, h3, h4"), last = "";
  heads.forEach(function (h) { if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) last = txt(h); });
  return last;
}
function optText(o) { return txt(o) || o.label || o.value; }
function valueOf(f) {
  var els = f.els, el = els[0];
  if (f.buttons) { var on = f.buttons.filter(pressed)[0]; return on ? txt(on) : ""; }
  if (f.kind === "select") { var o = el.options[el.selectedIndex]; return o && o.value !== "" ? optText(o) : ""; }
  if (f.kind === "radio") { var c = els.filter(function (e) { return e.checked; })[0]; return c ? txt(optionLabelEl(c)) || c.value : ""; }
  if (f.kind === "checkbox" && !f.options) return el.checked ? "true" : "false";
  if (f.kind === "checkbox") return els.filter(function (e) { return e.checked; }).map(function (e) { return txt(optionLabelEl(e)) || e.value; }).join("; ");
  if (f.kind === "file") return Array.prototype.map.call(el.files || [], function (x) { return x.name; }).join(", ");
  return el.value || "";
}
function pressed(b) {
  var cls = String(b.getAttribute("class") || "");
  return b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-checked") === "true" ||
    /^(on|checked|active|selected)$/i.test(b.getAttribute("data-state") || "") ||
    /(^|[\s_-])(active|selected|checked|pressed)(?![a-z])/i.test(cls);
}
// Two buttons reading Yes and No side by side (Ashby's Yes/No question; its
// checkbox is hidden): one radio-like field.
function yesNoGroups(root) {
  var seen = [], out = [];
  Array.prototype.forEach.call(root.querySelectorAll("button, [role=button]"), function (b) {
    var p = b.parentElement;
    if (!p || seen.indexOf(p) >= 0) return;
    seen.push(p);
    var bs = Array.prototype.filter.call(p.children, function (x) { return /^(button)$/i.test(x.tagName) || x.getAttribute("role") === "button"; });
    if (bs.length !== 2 || !bs.every(function (x) { return shown(x) && !x.disabled && /^(yes|no)$/i.test(txt(x)); })) return;
    if (txt(bs[0]).toLowerCase() === txt(bs[1]).toLowerCase()) return;
    out.push({ box: p, buttons: bs });
  });
  return out;
}
function collect() {
  var root = formRoot(), groups = {}, list = [], yn = yesNoGroups(root);
  controls(root).forEach(function (el) {
    if (yn.some(function (g) { return g.box.contains(el) || (el.type === "checkbox" && !shown(el) && g.box.parentElement && g.box.parentElement.contains(el)); })) return;
    var t = el.tagName === "SELECT" ? (el.multiple ? "" : "select") : el.tagName === "TEXTAREA" ? "textarea" : KINDS[(el.type || "text").toLowerCase()];
    if (!t) return;
    if ((t === "radio" || t === "checkbox") && el.name) {
      var key = t + ":" + el.name;
      if (groups[key]) { groups[key].els.push(el); return; }
      groups[key] = { kind: t, els: [el] }; list.push(groups[key]); return;
    }
    list.push({ kind: t, els: [el] });
  });
  yn.forEach(function (g) { list.push({ kind: "radio", els: [g.box], box: g.box, buttons: g.buttons }); });
  list.sort(function (a, b) {
    var x = a.els[0], y = b.els[0];
    return x === y ? 0 : x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  return { root: root, list: list };
}
function fieldsOf() {
  var c = collect(), root = c.root, out = [];
  c.list.forEach(function (f) {
    var el = f.els[0], group = f.els.length > 1 || f.kind === "radio";
    var raw = group ? groupLabel(el, root) : labelOf(el, root);
    if (f.buttons) {
      var cb = el.parentElement && el.parentElement.querySelector("input[type=checkbox]");
      var cl = cb && optionLabelEl(cb);
      raw = (cl && txt(cl)) || raw;
    }
    if (HELPER.test(raw) || HELPER.test(el.name || "") || HELPER.test(el.id || "")) return;
    var field = {
      id: "f" + out.length,
      selector: f.buttons ? selectorOf(el) : group ? el.tagName.toLowerCase() + '[type="' + el.type + '"][name="' + el.name + '"]' : selectorOf(el),
      kind: f.kind,
      label: cleanLabel(raw),
      hint: el.getAttribute("aria-describedby") ? byIds(el.getAttribute("aria-describedby")) : "",
      section: sectionOf(el, root),
      required: f.els.some(function (e) { return requiredOf(e, raw); }),
      maxLength: el.maxLength > 0 ? el.maxLength : null,
      options: null,
      value: ""
    };
    if (f.kind === "number" || /^(numeric|decimal)$/i.test(el.getAttribute("inputmode") || "") || /^\^?\[?0-9\]|^\^?\\d/.test(el.getAttribute("pattern") || "")) field.numeric = true;
    if (el.getAttribute("role") === "combobox" || /list|both/.test(el.getAttribute("aria-autocomplete") || "") || el.getAttribute("aria-haspopup") === "listbox") field.combobox = true;
    if (f.kind === "select") field.options = Array.prototype.filter.call(el.options, function (o) { return o.value !== ""; }).map(function (o) { return { value: o.value, label: optText(o) }; });
    if (f.buttons) field.options = f.buttons.map(function (b) { var t = txt(b); return { value: t, label: t }; });
    else if (group) field.options = f.els.map(function (e) { return { value: e.value, label: txt(optionLabelEl(e)) || e.value }; });
    f.options = field.options;
    field.value = valueOf(f);
    out.push(field);
  });
  return out;
}
function submitButtons() {
  var root = formRoot();
  var all = Array.prototype.filter.call(root.querySelectorAll("button, input[type=submit], [role=button]"), function (b) { return shown(b) && !b.disabled; });
  var label = function (b) { return (txt(b) || b.value || b.getAttribute("aria-label") || "").trim(); };
  return {
    submit: all.filter(function (b) { var t = label(b); return /submit|apply/i.test(t) && !HELPER.test(t); }),
    next: all.filter(function (b) { return /^(next|continue)\b/i.test(label(b)); })
  };
}
function blockersOf() {
  var out = [];
  var frames = Array.prototype.filter.call(document.querySelectorAll("iframe"), function (f) {
    return /recaptcha|hcaptcha|challenges\.cloudflare|turnstile/.test(f.src || "") && !/size=invisible/.test(f.src || "") && shown(f);
  });
  if (frames.length) out.push({ kind: "human-check", detail: "The page shows a human check. Solve it in the Chrome window, then press Check again." });
  if (Array.prototype.some.call(document.querySelectorAll("input[type=password]"), shown)) out.push({ kind: "sign-in", detail: "The page asks you to sign in. Do that in the Chrome window, then press Check again." });
  if (/(enter|type) the (\w+ )?code|we (sent|emailed) (you )?an? (\w+ )?code/i.test(txt(document.body))) out.push({ kind: "emailed-code", detail: "The page asks for a code sent to your email. Enter it in the Chrome window." });
  var b = submitButtons();
  if (!b.submit.length && b.next.length) out.push({ kind: "multi-page", detail: "This form has more than one page. Use Open application." });
  else if (!b.submit.length) out.push({ kind: "page-error", detail: "The app can't find the form's submit button." });
  else if (b.submit.length > 1) out.push({ kind: "page-error", detail: "The form has more than one submit button, so the app won't pick one." });
  return out;
}
function readPage() { return { url: location.href, fields: fieldsOf(), blockers: blockersOf() }; }
function setNative(el, v) {
  var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function normText(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
var MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function monthIdx(s) {
  var t = normText(s);
  if (/^\d{1,2}$/.test(t) && +t >= 1 && +t <= 12) return +t - 1;
  return /^[a-z]{3,9}$/.test(t) ? MON.indexOf(t.slice(0, 3)) : -1;
}
function findSelectOption(el, value) {
  var opts = Array.prototype.filter.call(el.options, function (o) { return o.value !== ""; });
  var by = function (v) {
    var w = normText(v);
    var hit = opts.filter(function (o) { return normText(optText(o)) === w || o.value === v; })[0];
    if (hit) return hit;
    var m = monthIdx(v);
    return m >= 0 ? opts.filter(function (o) { return monthIdx(optText(o)) === m; })[0] : null;
  };
  var hit = by(value);
  if (hit) return hit;
  var monthish = opts.length && opts.every(function (o) { return monthIdx(optText(o)) >= 0 || /^\d{4}$/.test(normText(optText(o))); });
  if (monthish) {
    var parts = String(value).split(/[\s\/,-]+/).filter(Boolean);
    for (var i = 0; i < parts.length && !hit; i++) hit = by(parts[i]);
  }
  return hit || null;
}
function listOptions(el) {
  var id = el.getAttribute("aria-controls") || el.getAttribute("aria-owns"), box = id && document.getElementById(id);
  var all = Array.prototype.slice.call((box || document).querySelectorAll("[role=option]"));
  return all.filter(shown);
}
function fire(el, types) { types.forEach(function (t) { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); }); }
async function fillCombobox(el, it) {
  var tries = [it.value].concat(it.aliases || []), sawList = false;
  for (var i = 0; i < tries.length; i++) {
    el.focus(); setNative(el, tries[i]);
    var opts = [];
    for (var k = 0; k < 14; k++) { await sleep(150); opts = listOptions(el); if (opts.length) break; }
    if (!opts.length) continue;
    sawList = true;
    await sleep(250); opts = listOptions(el);
    var wants = tries.map(normText);
    var loose = opts.filter(function (o) { var t = normText(txt(o)); return t && wants.some(function (w) { return t.indexOf(w) >= 0 || w.indexOf(t) >= 0; }); });
    var hit = opts.filter(function (o) { return wants.indexOf(normText(txt(o))) >= 0; })[0] || (!it.strict && loose.length === 1 ? loose[0] : null);
    if (!hit) continue;
    fire(hit, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
    await sleep(250);
    var shownNow = normText(el.value), want = normText(txt(hit));
    if (shownNow && (shownNow.indexOf(want) >= 0 || want.indexOf(shownNow) >= 0 || !listOptions(el).length)) { el.blur(); return; }
    throw new Error("the list option did not stick");
  }
  if (sawList) throw new Error("no matching option in the list");
  el.blur();
}
async function fillFields(items) {
  var errors = [];
  for (var n = 0; n < items.length; n++) {
    var it = items[n];
    try {
      var els = Array.prototype.slice.call(document.querySelectorAll(it.selector));
      var el = els[0];
      if (!el) throw new Error("not on the page");
      if (it.kind === "select") {
        var o = findSelectOption(el, it.value);
        if (!o) throw new Error("no such option");
        el.focus(); o.selected = true; setNative(el, o.value); el.blur();
        await sleep(60);
        if (el.options[el.selectedIndex] !== o) throw new Error("the option did not stick");
      } else if (it.kind === "radio" && el.tagName !== "INPUT") {
        var btn = Array.prototype.filter.call(el.children, function (b) { return txt(b).toLowerCase() === String(it.value).toLowerCase(); })[0];
        if (!btn) throw new Error("no such option");
        if (!pressed(btn)) {
          btn.click();
          await sleep(120);
          if (!pressed(btn)) throw new Error("the button did not stay pressed");
        }
      } else if (it.kind === "radio" || (it.kind === "checkbox" && els.length > 1)) {
        var pick = els.filter(function (e) { return (txt(optionLabelEl(e)) || e.value) === it.value; })[0];
        if (!pick) throw new Error("no such option");
        if (!pick.checked) pick.click();
      } else if (it.kind === "checkbox") {
        if (el.checked !== (it.value === "true")) el.click();
      } else if (it.combobox) {
        await fillCombobox(el, it);
      } else {
        el.focus(); setNative(el, it.value); el.blur();
      }
    } catch (e) { errors.push({ fieldId: it.fieldId, error: String(e.message || e) }); }
  }
  return errors;
}
function clickSubmit() {
  var b = submitButtons().submit;
  if (b.length !== 1) return false;
  b[0].click();
  return true;
}
function fieldErrors() {
  return Array.prototype.filter.call(document.querySelectorAll("[aria-invalid=true], .error, .field-error, .invalid-feedback, [role=alert]"), function (e) {
    return shown(e) && (e.getAttribute("aria-invalid") === "true" || txt(e).length > 0);
  }).length;
}
function pageResult(errorsBefore) {
  var t = txt(document.body);
  if (/thank you for (applying|your application|submitting)|application (has been |was )?(received|submitted)|we(ve| have) received your application|successfully submitted|submission (received|successful)/i.test(t.replace(/'/g, "")) || /confirmation|thank-?you/i.test(location.pathname)) return "sent";
  return fieldErrors() > (errorsBefore || 0) ? "refused" : "pending";
}
function embeddedForm() {
  var f = document.querySelector("iframe#grnhse_iframe, iframe[src*='greenhouse.io/embed/job_app']");
  try { return f && /(^|\.)greenhouse\.io$/.test(new URL(f.src).hostname) ? f.src : ""; } catch (e) { return ""; }
}
`;

export const script = (name, arg) => `(function () {${LIB}\nreturn ${name}(${arg === undefined ? "" : JSON.stringify(arg)});\n})()`;

// The page calls the runner needs, over one tab session.
export function pageApi(session) {
  return {
    read: () => session.evaluate(script("readPage")),
    fill: (items) => session.evaluate(script("fillFields", items)),
    upload: (selector, file) => session.setFiles(selector, [file]),
    clickSubmit: () => session.evaluate(script("clickSubmit")),
    errorCount: () => session.evaluate(script("fieldErrors")),
    result: (errorsBefore) => session.evaluate(script("pageResult", errorsBefore)),
    embeddedFormUrl: () => session.evaluate(script("embeddedForm")),
    navigate: (url) => session.navigate(url),
    close: () => session.close(),
  };
}

// "sent" | "refused" | "unclear", polling the page after the click. Only
// field errors beyond the errorsBefore already showing count as refused.
export async function waitForResult(page, { timeoutMs = 20_000, everyMs = 1000, errorsBefore = 0 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, everyMs));
    let r = "pending";
    try {
      r = await page.result(errorsBefore);
    } catch {}
    if (r === "sent" || r === "refused") return r;
  }
  return "unclear";
}

// What to type, tick and pick: every answer with a value, minus uploads.
// strict: a combobox takes only an option whose text is the planned answer or
// one of its known aliases, exactly.
export function fillItems(fields, answers, { strict = false } = {}) {
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  return answers
    .filter((a) => a.value && byId[a.fieldId] && byId[a.fieldId].kind !== "file")
    .map((a) => ({
      fieldId: a.fieldId,
      selector: byId[a.fieldId].selector,
      kind: byId[a.fieldId].kind,
      value: a.value,
      ...(byId[a.fieldId].combobox && { combobox: true, aliases: a.aliases || [], ...(strict && { strict: true }) }),
    }));
}

const digits = (s) => String(s || "").replace(/\D/g, "");
const spaced = (s) => String(s || "").replace(/\s+/g, " ").trim();

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (s) => {
  const t = norm(s);
  return /^\d{1,2}$/.test(t) && +t >= 1 && +t <= 12 ? +t - 1 : /^[a-z]{3,9}$/.test(t) ? MON.indexOf(t.slice(0, 3)) : -1;
};

function shows(field, planned, aliases = [], strict = false) {
  const now = field.value || "";
  if (field.combobox) {
    const n = norm(now);
    if (strict) return !!n && [planned, ...aliases].map(norm).some((w) => w && n === w);
    return !!n && [planned, ...aliases].map(norm).some((w) => w && (n.includes(w) || w.includes(n)));
  }
  if (field.kind === "checkbox" && !field.options?.length) return now === planned;
  if (field.kind === "select" && monthOf(planned) >= 0 && monthOf(now) === monthOf(planned)) return true;
  if (field.kind === "select" || field.kind === "radio" || field.kind === "checkbox") return norm(now) === norm(planned);
  if (field.kind === "file") return now.split(", ").includes(path.basename(planned));
  if (field.kind === "tel") return digits(now) === digits(planned) && digits(now) !== "";
  return spaced(now) === spaced(planned);
}

const isEmpty = (f) => !f.value || (f.kind === "checkbox" && !f.options?.length && f.value !== "true");

// One row per field on the page now: what it shows and whether that matches
// the plan. Fields with no planned value only need a value when required.
export function readBackOf(fieldsNow, answers, { strict = false } = {}) {
  const planned = new Map(answers.map((a) => [a.fieldId, a.value]));
  const aliases = new Map(answers.map((a) => [a.fieldId, a.aliases || []]));
  return fieldsNow.map((f) => {
    const want = planned.get(f.id) || "";
    const row = { fieldId: f.id, shows: f.value || "" };
    if (want && !shows(f, want, aliases.get(f.id), strict)) return { ...row, ok: false, problem: f.kind === "file" ? "no file" : "wrong value" };
    if (!want && f.required && isEmpty(f)) return { ...row, ok: false, problem: "empty required" };
    return { ...row, ok: true, problem: null };
  });
}
