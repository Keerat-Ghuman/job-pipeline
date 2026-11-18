# Fill and send application forms

Design for filling a job's web application form (Greenhouse, Lever, Ashby and
similar) from the dashboard, and sending it after you say yes for that
one application.
The concept comes from
[jev-job-search](https://github.com/qbeka/jev-job-search) (MIT, Copyright (c)
2026 Qendrim Beka). No jev code is copied; the ideas credited below are
re-implemented in plain JavaScript.

## What you see

1. A job's page shows a **Fill application** panel when the job's link is on a
   supported form site and the dashboard runs on your own computer.
2. **Fill application** opens the form in a separate Chrome window (its own
   profile in `data/apply-browser/`, apart from your everyday Chrome). The app
   fills every box it can, uploads your resume, and reads every box back.
3. The panel lists every question with the answer as the page now shows it,
   where the answer came from (your apply kit, a rule, written for this job,
   or "needs you"), and whether the page shows what was planned.
4. You can change any answer and press **Fill again**. Questions the app
   can't answer stay empty and are marked "needs you". A human check
   (CAPTCHA), a sign-in, a signature or an emailed code is left for you to do
   in the Chrome window.
5. **Submit application** is enabled only when every required box is filled,
   the page shows exactly what is listed, and nothing waits on you. It asks
   "Send this application to {company}? Nothing is sent until you say yes."
   On yes, the app reads the whole page again, refuses if any question was
   added, removed or changed, clicks the form's own submit button, and reads
   the result. A confirmation page marks the job Applied (follow-up in 7
   days). Anything else is reported, never retried.

From this panel nothing is sent without that click.
The form opens in Chrome on the
computer that runs the dashboard; you can review and say yes from your phone,
but human checks and sign-ins happen in that Chrome window.

### Who can say yes

The yes is two requests from the dashboard page itself. Opening the confirm
dialog asks the server for a one-time code bound to this application's plan
hash; it expires after 2 minutes and works once. Submit needs that code and a
same-origin browser request (`Origin` and `Sec-Fetch-Site: same-origin`), so a
script, a bot session or another website can't send an application.
Tests and the gate only ever use local forms, fakes and dry mode.


## Supported sites

A registry (`lib/apply/sites.js`) maps a job link to a site and the URL of its
form:

| Site | Link | Form URL |
| --- | --- | --- |
| Greenhouse | `boards.greenhouse.io`, `job-boards.greenhouse.io`, any link with `gh_jid` | the link (embedded boards load the `boards.greenhouse.io/embed/job_app` form) |
| Lever | `jobs.lever.co/{site}/{id}` | `…/{id}/apply` |
| Ashby | `jobs.ashbyhq.com/{org}/{id}` | `…/{id}/application` |

These three are single-page forms, and the tests carry a local copy of each.
Workable, BambooHR, Rippling, Jobvite and JazzHR forms are often multi-page and
have no test copy yet; Workday, iCIMS and Taleo need an account. For all of
those the panel says to use Open application. A form that shows a Next or
Continue button instead of a submit button is blocked as multi-page.

After an embedded Greenhouse board is followed (only to a frame on
`greenhouse.io`), the page the tab is on must be on `greenhouse.io` (any
subdomain), `jobs.lever.co` or `jobs.ashbyhq.com`. Anything else is blocked
with "The form isn't on Greenhouse, Lever or Ashby. Use Open application." and
nothing is filled.

## Data shapes

### Applicant facts (`lib/apply/facts.js`)

Built from `config/applyKit.json`. A new optional `applicant` section holds
the structured facts a form asks for; anything missing falls back to the
existing `profile` label rows (Full name, Email, Phone, LinkedIn) and
`eligibility.workIn`. Values containing `EDIT ME` count as missing.

```js
Facts = {
  name: { first, last, preferred },          // split from "Full name" if absent
  email, phone,                               // phone as typed
  location: { city, region, country },
  links: { linkedin, github, website },
  school: { name, degree, field, graduation, aliases }, // graduation "YYYY-MM"; aliases: other names a form's list may use
  workAuth: {
    authorizedIn: [country],                  // no sponsorship needed; defaults to eligibility.workIn
    sponsorshipLaterIn: [country],            // authorized now, sponsorship later (OPT style)
  },
  citizenship: [country],                     // optional; answers "Are you a citizen of X?". Defaults to Canada only if authorizedIn/eligibility.workIn says Canada
  demographics: { gender, race, hispanic, veteran, disability }, // each defaults to "decline"
  salaryIfRequired: "Negotiable",
  salaryNumber,                               // optional digits, used for number-only salary boxes
  earliestStart, willingToRelocate,           // strings / "yes" | "no" | ""
  answers: [{ question, answer }],            // standing answers, beat every rule and model (see below)
  resumeFile,                                 // from the job's track: resumes/<file>
}
```

**Standing answers take either shape.** `config/applyKit.json` keeps them as
`{ label, value }` rows in the top-level `answers` list; the code also accepts
`{ question, answer }` rows, in `applicant.answers` or the top-level `answers`.
`standingRows()` merges both lists into `{ question, answer }` (the applicant
list wins on a repeated question; rows with `EDIT ME` or no text are dropped).

**School names.** `lib/apply/facts.js` has a small table of other names for
common schools (for example "University of Western Ontario" and "Western
University"), and `applicant.school.aliases` adds your own. A dropdown or
autocomplete is tried with the name first, then each alias.

### Form field (read from the page)

```js
Field = {
  id,            // "f0", "f1" … stable for this read
  selector,      // unique CSS selector (stable ids, name, data-testid; never generated ids)
  kind,          // text | email | tel | url | number | date | textarea | select | radio | checkbox | file
  label, hint, section, required, maxLength,
  options,       // [{ value, label }] for select / radio / checkbox groups
  value,         // what the page shows now
  numeric,       // true for a number box (type=number, inputmode numeric, digit pattern)
  combobox,      // true for an autocomplete (role=combobox, aria-autocomplete)
}
```

### Answer plan

```js
Answer = {
  fieldId,
  value,         // string; option label for select/radio; "true"/"false" for a checkbox; file path for file
  source,        // "kit" | "rule" | "standing" | "model" | "written" | "takeover" | "you" | "none"
  aliases,       // optional other names to try for an autocomplete (school)
  note,          // why, shown to you ("Authorized in Canada", "Left for you. Signature")
}
```

### Application (one per job, `data/applications/<jobId>.json`)

```js
Application = {
  jobId, site, formUrl, company,
  state,         // see the state machine below
  fields: [Field], answers: [Answer],
  readBack: [{ fieldId, shows, ok, problem }], // problem: "wrong value" | "empty required" | "no file"
  blockers: [{ kind, detail }],  // human-check | sign-in | signature | emailed-code | unsupported-field | page-error | not-ats
  planHash,      // hash of formUrl + every field (id, label, kind, options) + answers + read-back
  target: { port, targetId },    // Chrome tab to reconnect to
  history: [{ at, state, detail }],
}
```

### State machine (`lib/apply/state.js`)

| State | Means | Actions allowed |
| --- | --- | --- |
| `idle` | nothing open | fill |
| `filling` | reading and filling (`failed` once its lock goes 3 minutes untouched) | none |
| `review` | filled and read back, waiting on you | fill, check, confirm, submit, close, mark |
| `blocked` | a human check, sign-in, multi-page form or "needs you" field | fill, check, close, mark |
| `failed` | filling crashed or the page broke | fill, close, mark |
| `lost` | the Chrome tab or window is gone | fill, close, mark |
| `sending` | written to disk before the click | mark |
| `sent` | confirmation page seen; job marked Applied | close |
| `sent-dry` | dry mode stopped before the click | fill, close |
| `unclear` | clicked, no confirmation seen | check, mark |
| `refused` | clicked, the page showed errors | fill, check, close, mark |

`sending` is written to disk (under the job's lock, re-read and compared
before writing) **before** the click, so a crash or a second click never sends
twice. `sending` and `unclear` refuse another submit until you mark the result
yourself (Applied, or Not sent); `check` can also settle `unclear` or `refused` when the
page now shows a confirmation, for example after you sent it by hand. The
table above is the code (`lib/apply/state.js`), not scattered flags.

After the click (`unclear`, `refused`), `check` only looks for a
confirmation: it never leads back to `review`. Fill reads and fills the form
again.

One lock per job covers fill, check and submit: a lock file created with
exclusive create, like `lib/fetchLock.js`, so it survives a dev reload. Each
lock carries a token, and only its holder can refresh or remove it. A fill
refreshes its lock every round and around every model call; a lock untouched
for 3 minutes is taken over, and the fill it belonged to is `failed`. A fill
writes its result only if the file is still that fill's `filling` (matched
by its `fillId`); if you marked or closed the application meanwhile, the
fill's result is dropped. Fill and submit are refused when the job is already
Applied in the sheet; fill also when another application is open on the same
form URL.

## How answers are chosen

In order; the first that gives an answer wins.

1. **Standing answers.** A `facts.answers` entry whose question matches the
   label after normalising (case, punctuation).
2. **Rules** (`lib/apply/rules.js`), a table of label patterns to fact keys:
   names, email, phone, links, location, school, degree, graduation, resume
   upload, how did you hear (left for you unless a standing answer exists),
   salary (`salaryIfRequired`, only if required), start date, relocation,
   demographic questions (the "decline" option unless you set a value),
   routine privacy and data consent boxes (ticked only if required).
   Name, email, phone and link rules apply to a short field name or a short
   ask for the detail ("Email", "What is your email address?", up to 8
   words). A yes/no question or a long sentence that merely contains
   "email" goes to the model, and a long
   sentence ending in a question mark in a text box is written as an open
   question. A number-only box (type number, numeric inputmode) never gets
   text: salary uses `salaryNumber` when the kit has one, else the box is
   left for you.
   Required routine agreements (the allowlist above) are ticked; optional ones (SMS, WhatsApp, marketing) are left unticked.
   Non-routine agreements (arbitration, NDA, non-compete, "I certify")
   and signatures are left for you.
3. **Work authorization gate.** "Are you authorized to work in X?" and "Will
   you require sponsorship?" are computed, never guessed: the country comes
   from the question, else the job's country when `Country/Remote` names
   exactly one; `authorizedIn` gives authorized Yes and sponsorship No,
   `sponsorshipLaterIn` gives authorized Yes and sponsorship Yes, any other
   country gives authorized No and sponsorship Yes. Left for you. No single
   country, negated or compound wording ("do you not require", "now or in the
   future" combined with another question), US sponsorship when the kit's
   `tnEligible` is set, and any question about visas, citizenship or
   clearance. The exception is a plain citizenship question naming one
   country ("Are you a Canadian citizen?", "citizen of Canada"): it is
   answered from the kit's `applicant.citizenship` list (Yes for a listed
   country, No for any other). If the kit has no list, it defaults to Canada
   only when `authorizedIn` or `eligibility.workIn` already says Canada, and
   is never invented otherwise; with no list the question is left for you. An
   inferred answer's note says "assumed from work authorization". Wordings
   that exclude or negate a country ("other than Canada", "non-US citizen",
   "not a U.S. citizen", "outside of Canada") are left for you.
   "Citizen or permanent resident", green card and clearance questions stay
   with you. The gate runs **last**, over every source (standing answers
   included), and overrules or clears any answer to these questions that
   doesn't match. Labels about authorization, visas, sponsorship, citizenship
   or clearance never reach the writer.
4. **Model mapping** for short fields still empty: the model picks one key
   from a closed list of fact keys (with definitions), or `unknown`. It never
   types a value; `valueFor(key)` does. Its pick passes the same gates.
5. **Written answers** for open questions ("Why this company?", "Tell us
   about a project"): the model writes from the posting, your resume text,
   your track summary and standing answers, with the repo's existing "no
   invented facts" system prompt, fitted to `maxLength`. A reply that states a
   number not found in those sources is rejected (same check as Resume
   Studio's rewording). A sentence that claims an outcome ("resulted in",
   "led to", "improved", "reduced", "saved", "the outcome was" and similar)
   whose content words aren't in the posting, resume, summary, standing
   answers or the question itself drops the whole answer to "needs you". The
   writer also gets each resume role with its dates, marked CURRENT (no end
   date) or ENDED, and is told to use the past tense for ended roles. You see
   and can edit every written answer.
6. Anything else: empty, marked "needs you". Required + empty blocks Submit.

Selects and radios are matched to their options in code (normalised text,
yes/no synonyms, "decline to self-identify" phrasings). If no option matches,
the field is left for you.

## Why jev uses a small model, and what we use instead

jev's small model is not smarter than Claude. Filling a form is mostly many
small "which of these does this box want" choices. jev sends those to a cheap,
fast model that can only answer by picking from a fixed list with a
probability, because that costs about a cent per ten forms, answers in about a
second and can't ramble. Claude is kept for the few sentences that need
writing. The real safety comes from code checks around the model, not the
model. We keep the fixed list and the code checks, answer most boxes with
rules, and use your Claude subscription (or free Gemini) for the rest. Claude
Code's `--json-schema` option gives the same typed answers.

## The free model route

No paid key. `lib/apply/model.js` has one interface, `ask({ system, prompt,
json })`, and three providers, picked by `APPLY_MODEL` (`claude` | `gemini` |
`none`), defaulting to `claude` if the `claude` command is installed, else
`gemini` if `GEMINI_API_KEY` is set, else `none`:

- **claude**: runs `claude -p --output-format json --json-schema … --model
  sonnet --tools "" --strict-mcp-config --setting-sources project
  --no-session-persistence` with its own system prompt, in an empty temporary
  folder, so it uses your Claude subscription login and loads no hooks or
  project rules. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_BASE_URL` and the Bedrock/Vertex switches are removed from its
  environment, because with them set the CLI bills an API account. The
  command is found on PATH, then `CLAUDE_BIN`, then inside the Claude desktop
  app. On Windows `claude.exe` is preferred; a `claude.cmd` runs through
  `cmd.exe` with every argument quoted and escaped. A failed call says why:
  not signed in ("Open Claude Code and sign in"), the plan's usage limit, too
  slow, or the first line of the error; each falls back to Gemini. One call at a time, 90-second timeout. These calls count against
  your plan's usage limits; they cost nothing extra.
- **gemini**: the existing `lib/ai.js` `generate()` (free tier, your key).
- **none**: rules and the gate only; everything else is "needs you".

Most fields never reach a model: rules, standing answers and the gate cover
names, contact, links, school, authorization, sponsorship, demographics and
consents. A typical form makes one mapping call (all leftover short fields at
once) and one writing call (all open questions at once).

## Browser

Chrome driven over the DevTools protocol with Node's built-in WebSocket, as
`scripts/qa-ui.mjs` already does. No new package. Chrome runs headed (you
need to see it for human checks) with
`--user-data-dir=data/apply-browser --remote-debugging-port=0`. The app reads
the port from the profile's `DevToolsActivePort` file, so any request can
reconnect to the window; nothing is held in server memory.

- **Read**: one injected script lists the form's visible fields as `Field`s.
  It skips password boxes, controls outside the application form, and the
  "Apply with LinkedIn / autofill" helpers.
- **Lifecycle**: Chrome is spawned detached so a dashboard restart leaves it
  open. Before every action the app checks the port answers, the tab still
  exists and is on the form's host; otherwise the application is `lost`.
  One Chrome for all applications (one per profile), one tab per job.
- **Fill**: native value setter plus `input`/`change` events (React forms),
  clicks for radios and checkboxes, `DOM.setFileInputFiles` for the resume.
  Dropdowns are picked by option text (months match "September", "Sep" and
  "9") and checked afterwards. An Ashby Yes/No question (two buttons beside a
  hidden checkbox) is one radio-like field with options Yes and No: filled by
  clicking the button, read back from the pressed button. An autocomplete is
  typed into, the list is waited for, the best matching option is clicked
  (name first, then aliases) and the box is read back. A list with no
  matching or only ambiguous options is an error, so the field is left for
  you; a box that shows no list at all keeps the typed text.
- **Tab**: every step works only on the job's own tab by its stored target id,
  never the frontmost tab. The tab is brought forward so you can watch; if it
  is gone the application is `lost`.
- **Check**: re-reads the page and updates the read-back and blockers only.
  The planned answers are never replaced by what the page shows; if the
  form's questions changed, the answers move with their questions.
- **Read back**: every field is read again after filling and compared by kind
  (checkbox state, option label, normalised text, file name). Read back again
  right before the click.
- **Blockers**: reCAPTCHA, hCaptcha and Turnstile frames, password boxes,
  and "enter the code we emailed" pages are detected and reported. Never solved
  or bypassed.
- **Submit button**: exactly one button inside the form whose text says
  submit or apply. None, or more than one, blocks.
- **Result**: after the click the page is classified in code: a URL or text
  matching confirmation phrases ("thank you for applying", "application
  received", "submitted") is `sent`; new visible field errors are `refused`;
  anything else after 20 seconds is `unclear`. Errors already showing just
  before the click don't count.

Site passwords are never stored. The Chrome profile keeps site cookies on your
disk, like your everyday browser, inside the gitignored `data/` folder. While
that Chrome is open, its debugging port lets any program on your computer read
those cookies; close the window when you're done.

## Where it runs

Only the local dashboard. Every apply route refuses when `VERCEL` is set, so
the shared code is inert on the hosted site after `sync.sh`.

## Dry mode

Dry mode runs the whole flow but stops before the click: the state goes to
`sent-dry`, nothing is clicked, and the job's status is untouched. It is on
when `APPLY_DRY_RUN=true`, when `NODE_ENV` is `test`, and for any form on
`127.0.0.1` or `localhost`, so a test can't click for real. In tests the
browser refuses to open anything but `127.0.0.1`. The click itself is a
function passed in, which tests replace. Tests run against local copies of
Greenhouse-, Lever- and Ashby-style forms served by the test itself; without
Chrome installed those tests say so and skip.

## API

All under `app/api/jobs/[id]/apply/`, local only, JSON `{ success, … }`:

- `GET` → `{ available, reason, site, application }`.
- `POST { action: "fill" }` → starts filling in the background (lock per
  job), returns at once; the panel polls `GET` every 2 seconds.
- `POST { action: "fill", answers: [{ fieldId, value }] }` → your edits, then
  fill and read back again.
- `POST { action: "check" }` → read the page again (after you solved a
  human check or signed in).
- `POST { action: "confirm" }` → `{ code }`, one-time, 2 minutes, bound to
  the current `planHash`.
- `POST { action: "submit", code }` → same-origin only; refused unless state
  is `review`, read-back is clean, there are no blockers, the code is valid,
  the tab is still on the reviewed form's page (origin and path), the job
  isn't Applied in the sheet, and a fresh read of the page still hashes to
  the same `planHash`.
- `POST { action: "mark", result: "applied" | "not-sent" }` → you settle it
  yourself (sent by hand, or `unclear`).
- `POST { action: "close" }` → closes the tab, back to `idle`.

After `sent`, the app logs a timeline event on the job. That event and
`data/applications/<jobId>.json` are where the lead finder can plug in later.

## Defaults you can change

- Demographic questions answer "decline to self-identify" unless the kit's
  `applicant.demographics` says otherwise.
- Required agreement boxes on the routine allowlist (terms, privacy notice,
  "I have read", data processing consent) are ticked. Optional ones and anything non-routine (arbitration, NDA,
  non-compete, "I certify", signature) are left for you.
- Salary is only given when required, as `salaryIfRequired` ("Negotiable").

## Not built

- The hosted multi-user site. Every apply route is inert there.
- Multi-page forms and sites that need an account (Workday, iCIMS, Taleo,
  Workable ...). They are left for you.
- Answers for questions only you know. Claude never guesses; it stops and
  names the question.

## Credit

Ideas taken from jev-job-search (MIT, Copyright (c) 2026 Qendrim Beka): a
closed list of fact keys the model chooses from, a code-side gate that
overrules any work-authorization answer contradicting the profile, reading
every value back twice, writing `sending` before the click, classifying the
page after the click, and never passing a human check.
