// origin.js
// Who may act on an application: only the dashboard page, on this computer.

// Names this computer answers to: itself, its .local name, or a home-network
// address (so you can review from your phone). A website that points its own
// domain at this computer (DNS rebinding) arrives with its domain as Host.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.local|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/i;

// Every action must come from the dashboard page itself, not a script or another site.
export function sameOrigin(headers) {
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host || !LOCAL_HOST.test(host) || headers.get("sec-fetch-site") !== "same-origin") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Reads need only the Host pin: the page names this computer, so a website
// that points its own domain here can't read what the app keeps.
export function localHost(headers) {
  const host = headers.get("host");
  return !!host && LOCAL_HOST.test(host);
}

