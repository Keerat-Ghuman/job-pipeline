# Job Pipeline: notes for AI assistants

Read this before changing anything. README.md explains how the code works;
this file says how to work on it.

## What this is

A job-search pipeline for entry-level startup, operations, finance and
AI-training roles. A scheduled run pulls about 10,000 postings, filters,
dedupes and scores them against `config/profile.json`, and writes the best to
the owner's Google Sheet. A Next.js 14 dashboard (`app/`) reads and updates the
same sheet. Plain JavaScript (ES modules), no TypeScript, no CSS framework.

## The three versions

Changes flow one way: **main → hosted → public.**

| Version | Where | What it is |
| --- | --- | --- |
| `main` | this folder | The owner's local app. Sheets, launchd, email. |
| `hosted` | `../Job-pipeline-hosted` (a git worktree of this repo on branch `hosted`) | The multi-user website: Supabase, Google sign-in, Vercel, GitHub Actions. Its own README and `docs/`. |
| public | `../job-pipeline-public` (separate clone) | What friends install. Made only by `scripts/publish.sh`, never edited by hand. |

Working in `../Job-pipeline-hosted`? It runs differently: read its
`README.md` and `docs/hosted.md` for how. The "Running it" section below is
for `main` only.

Rules:

- Build shared work (UI, wording, scoring, filters, fetchers) on `main` first.
  Then run `./scripts/sync.sh "What changed"`. It tests main, merges it into
  `hosted` and tests that, then publishes. Do not build the same change
  again on `hosted`.
- Only changes that exist just for the website (database, sign-in,
  per-user data, deploy) start on `hosted`.
- If the merge into `hosted` conflicts, resolve it in `../Job-pipeline-hosted`,
  keeping hosted's data layer and main's UI and wording, run `npm test` there,
  commit, and run `sync.sh` again.
- The folders may not exist on a friend's machine. `sync.sh` skips whichever
  is missing.

## Private data (never commit, print or publish)

- `.env.local`, `credentials/`, `config/applyKit.json`, `resumes/*.pdf`,
  `data/`, `logs/` are gitignored. Keep them that way.
- `.publish-blocklist` (gitignored) lists personal strings. `publish.sh` stops
  if any appear in a published file. Never put a real name, email, phone or
  sheet ID in code, tests, docs or examples. Use made-up examples.
- Never echo key values. Refer to settings by variable name. If someone pastes
  a key into chat, tell them to put it in `.env.local` themselves and to rotate
  it.
- AI features use the person's own free-tier Gemini key. Never add anything
  that spends money by default.

## Running it

- The owner's dashboard runs on **localhost:3001** from launchd
  (`~/Library/LaunchAgents/com.jobpipeline.dashboard.plist`). Do not start a
  second server on 3001. Restart it with
  `launchctl kickstart -k gui/$(id -u)/com.jobpipeline.dashboard`.
- The pipeline runs every 4 hours from `com.jobpipeline.daily.plist` via
  `run-daily.sh`. Run it by hand with `npm run pipeline`.
- Restart the dashboard after editing `config/companies.json`: the fetchers
  read it at startup.
- `npm run doctor` checks a setup and says how to fix it.

## Definition of done

A change is not finished until all of these pass, in this order:

1. `npm test` (node's built-in runner, `tests/*.test.mjs`). Add or update a
   test for any change to `lib/`.
2. `npm run build`.
3. Any UI change: open the dashboard in the browser at desktop and phone
   widths (375px), click through the changed screen, and check that the
   change shows up. If it doesn't, restart the dashboard (see above) before
   anything else. Also check that acting on a job doesn't reload the list or
   jump to the top.
4. Any UI or wording change: run the unslop pass. Follow `DESIGN.md` (one
   amber accent, colour only for state) and `VOICE.md` (plain words, the
   status names listed there).
5. Changes to install or setup: run `./scripts/check-fresh.sh`, and update
   `scripts/install-windows.ps1` to match `scripts/install-mac.sh`.
6. Shared work: `./scripts/sync.sh "What changed"`.

When you report back, say which of these steps ran and which you skipped.

## Wording

The dashboard says **Potential matches** (status `Awaiting approval`, worth a
look) and **Good matches** (status `Needs Manual Apply`, apply on the
company's site). The sheet keeps the old status values. Only the labels
changed. See `VOICE.md`.

## Friend packs

`npm run install-pack` installs a friend's `profile.json`, `applyKit.json` and
`resume.json`. A friend's details live in their pack, never in this repo.
