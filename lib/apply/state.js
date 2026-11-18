// state.js
// Where one application stands, and what you can do from there. The table is
// the rule: every action checks it before doing anything.

export const STATES = {
  idle: { means: "Nothing open", actions: ["fill"] },
  filling: { means: "Reading and filling the form", actions: [] },
  review: { means: "Filled and read back, waiting on you", actions: ["fill", "check", "confirm", "submit", "close", "mark"] },
  blocked: { means: "Waiting on you in the Chrome window", actions: ["fill", "check", "close", "mark"] },
  failed: { means: "Filling stopped with an error", actions: ["fill", "close", "mark"] },
  lost: { means: "The Chrome tab is gone", actions: ["fill", "close", "mark"] },
  sending: { means: "Sending", actions: ["mark"] },
  sent: { means: "Sent", actions: ["close"] },
  "sent-dry": { means: "Dry run: stopped before sending", actions: ["fill", "close"] },
  unclear: { means: "Sent, but no confirmation seen", actions: ["check", "mark"] },
  refused: { means: "The form showed errors after sending", actions: ["fill", "check", "close", "mark"] },
};

// An application counts as open on its form while in any of these.
export const OPEN = new Set(["filling", "review", "blocked", "failed", "lost", "sending", "unclear", "refused", "sent-dry"]);

// Submit was clicked in these. Check only looks for a confirmation (sent),
// and only Fill, which reads and fills the form again, leads back to review.
export const CLICKED = new Set(["unclear", "refused"]);

export function can(state, action) {
  return !!STATES[state]?.actions.includes(action);
}

export function transition(app, to, detail = "", at = new Date()) {
  if (!STATES[to]) throw new Error(`Unknown state ${to}`);
  return { ...app, state: to, history: [...(app.history || []), { at: at.toISOString(), state: to, detail }] };
}
