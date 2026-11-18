# Job Pipeline

A private job-search dashboard for software, data, and ML internships and new-grad roles in Canada and for US roles with sponsorship.

## Public

`origin` is the owner's private `Keerat-Ghuman/job-pipeline` repository. No branch is live. The following actions require the owner's explicit approval in the current session.

- Change repository visibility.
- Deploy to production or publish project material.
- Change live data in an external service, including Google Sheets.
- Send emails or messages.
- Submit job applications.

## Checks

`$until-ready` runs the gate in `.claude/gate.json`.

1. Run `/opt/homebrew/bin/node scripts/check-local-setup.mjs` for local configuration and regression tests.
2. Run `PATH="/opt/homebrew/bin:$PATH" npm run build` with `NEXT_DIST_DIR=.next-gate` and `NEXT_TELEMETRY_DISABLED=1`.
3. Run `/opt/homebrew/bin/node /Users/keeratghuman/Projects/codex-harness/gate/codex-audit.mjs` with `CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex` and `CODEX_AUDIT_MODEL=gpt-6.2-astra`.

## Rules

- Keep `.env.local`, `credentials/`, `config/applyKit.json`, `data/`, `resumes/`, and `logs/` private. Never commit or print their contents.
- Use the gate checks for local verification. Do not run the live pipeline or use the dashboard to approve, send, apply, or fetch while verifying changes.
- Push only to `origin`. Never push to `upstream`.
