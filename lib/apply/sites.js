// sites.js
// Which job links have a form the app can fill, and the URL of that form.
// One row per supported site; anything else gets a reason to use Open
// application instead.

const SITES = [
  {
    site: "greenhouse",
    matches: (u) => /(^|\.)greenhouse\.io$/.test(u.hostname) || u.searchParams.has("gh_jid"),
    // An embedded board on a company site is followed to its form when the page loads.
    formUrl: (u) => u.href,
  },
  {
    site: "lever",
    matches: (u) => u.hostname === "jobs.lever.co" && parts(u).length >= 2,
    formUrl: (u) => `${u.origin}/${parts(u).slice(0, 2).join("/")}/apply`,
  },
  {
    site: "ashby",
    matches: (u) => u.hostname === "jobs.ashbyhq.com" && parts(u).length >= 2,
    formUrl: (u) => `${u.origin}/${parts(u).slice(0, 2).join("/")}/application`,
  },
];

const UNSUPPORTED = [
  { pattern: /workable\.com|bamboohr\.com|rippling\.com|jobvite\.com|jazzhr\.com|applytojob\.com/, reason: "This site's forms are often several pages long. Use Open application." },
  { pattern: /myworkdayjobs\.com|workday\.com|icims\.com|taleo\.net/, reason: "This site needs an account. Use Open application." },
];

const OTHER = "The app can fill forms on Greenhouse, Lever and Ashby only. Use Open application.";

// Hosts the app fills forms on. Tests serve their own forms on this computer.
export function isAtsHost(hostname, env = process.env) {
  if (env.NODE_ENV === "test" && (hostname === "127.0.0.1" || hostname === "localhost")) return true;
  return /(^|\.)greenhouse\.io$/.test(hostname) || hostname === "jobs.lever.co" || hostname === "jobs.ashbyhq.com";
}

function parts(u) {
  return u.pathname.split("/").filter(Boolean);
}

// { site, formUrl } for a supported link, else { site: null, reason }.
export function siteFor(link) {
  let u;
  try {
    u = new URL(String(link || "").trim());
  } catch {
    return { site: null, reason: "This job has no link to a form." };
  }
  const row = SITES.find((s) => s.matches(u));
  if (row) return { site: row.site, formUrl: row.formUrl(u) };
  const known = UNSUPPORTED.find((s) => s.pattern.test(u.hostname));
  return { site: null, reason: known ? known.reason : OTHER };
}
