// roles.js
// The resume's roles with their dates and whether each is still going, so a
// written answer can use the right tense. A role is current only when its
// dates run to Present (or a date that hasn't come yet).

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// The last day of the month a date text names ("Jan 2025", "January 2025", "2025"), or null.
function endOf(text) {
  const m = /(?:([a-z]{3,9})\.?\s+)?(\d{4})/i.exec(String(text || ""));
  if (!m) return null;
  const month = m[1] ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) : 11;
  return new Date(Date.UTC(Number(m[2]), (month < 0 ? 11 : month) + 1, 0));
}

export function rolesOf(resume, now = new Date()) {
  const out = [];
  for (const section of resume?.sections || []) {
    for (const e of section.entries || []) {
      if (e.hidden || !e.dates || !(e.role || e.org)) continue;
      const parts = String(e.dates).split(/\s*(?:[–—]|-|\bto\b)\s*/i).filter(Boolean);
      if (/\bexpected\b/i.test(e.dates)) {
        out.push({ role: e.role || e.org, org: e.role ? e.org : "", dates: String(e.dates), current: true });
        continue;
      }
      if (parts.length < 2) {
        out.push({ role: e.role || e.org, org: e.role ? e.org : "", dates: String(e.dates), current: false });
        continue;
      }
      const last = parts[parts.length - 1];
      const end = /present|current|now|ongoing/i.test(last) ? null : endOf(last);
      out.push({ role: e.role || e.org, org: e.role ? e.org : "", dates: String(e.dates), current: !end || end >= now });
    }
  }
  return out;
}
