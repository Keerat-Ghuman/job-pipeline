// model.js
// One way to ask a model for a typed JSON answer, with no paid key:
// claude (your Claude subscription through the Claude Code command),
// gemini (your free key, via lib/ai.js) or none. APPLY_MODEL picks the first
// to try; a provider that fails falls through to the next, and the result
// says which answered and why the others didn't.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { generate } from "../ai.js";

export class ModelError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const NOT_SIGNED_IN = () => new ModelError("NOT_SIGNED_IN", "Open Claude Code and sign in");

// The first line of what Claude Code printed, with anything key-like cut out.
function firstLine(text) {
  const line = String(text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
  return line.replace(/\b(sk-[\w-]+|[\w-]{32,})\b/g, "[hidden]").slice(0, 200);
}

// Why Claude Code failed, from what it printed.
export function claudeFailure(text) {
  if (/log ?in|sign ?in|authenticat/i.test(text)) return NOT_SIGNED_IN();
  if (/rate.?limit|usage limit|limit (reached|exceeded)|too many requests/i.test(text)) {
    return new ModelError("RATE_LIMIT", "Your Claude plan's usage limit is reached. Try again later or use Gemini.");
  }
  const line = firstLine(text);
  return new ModelError("CLAUDE_ERROR", line ? `Claude Code stopped with an error: ${line}` : "Claude Code stopped with an error.");
}

const TIMEOUT_MS = 90_000;

// Variables that would make the CLI bill an API account, or leak a secret.
const DROP = new Set([
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX", "CLAUDECODE", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_ENTRYPOINT", "GEMINI_API_KEY",
]);
const SECRET = /KEY|TOKEN|SECRET|PASSWORD/;

export function claudeEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !DROP.has(k) && !SECRET.test(k)));
}

// cmd.exe's special characters, each escaped with ^ (the cross-spawn rules).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function cmdArg(arg) {
  const quoted = `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  // Twice: cmd.exe reads the line once, then the .cmd file's %* reads it again.
  return quoted.replace(CMD_META, "^$1").replace(CMD_META, "^$1");
}

// How to run `bin args`. On Windows a claude.cmd (the npm install) can only
// run through cmd.exe, so the line is built with every argument quoted and
// escaped; claude.exe and mac/linux run directly with no shell.
export function commandFor(bin, args, { platform = process.platform, comspec = process.env.ComSpec } = {}) {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(bin)) return { cmd: bin, args, verbatim: false };
  if (args.some((a) => /[\r\n]/.test(a))) throw new ModelError("CLAUDE_ERROR", "A line break can't be passed to Claude Code on Windows.");
  const line = [bin.replace(CMD_META, "^$1"), ...args.map(cmdArg)].join(" ");
  return { cmd: comspec || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}

// Which Claude models a caller may ask for. Anything else runs as sonnet.
export const CLAUDE_MODELS = ["sonnet", "opus"];

export function buildClaudeInvocation({ bin, system, schema, model = "sonnet", env = process.env, cwd, platform = process.platform }) {
  const args = [
    "-p", "--output-format", "json", "--json-schema", JSON.stringify(schema), "--model", CLAUDE_MODELS.includes(model) ? model : "sonnet",
    "--tools", "", "--strict-mcp-config", "--setting-sources", "project", "--no-session-persistence",
    "--system-prompt", system,
  ];
  return { ...commandFor(bin, args, { platform, comspec: env.ComSpec }), env: claudeEnv(env), cwd };
}

function onPath(name, env) {
  for (const dir of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) {
      const file = path.join(dir, name + ext);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

function inDesktopApp(home) {
  const root = path.join(home, "Library", "Application Support", "Claude", "claude-code");
  let found = [];
  try {
    for (const version of fs.readdirSync(root)) {
      for (const build of fs.readdirSync(path.join(root, version))) {
        const file = path.join(root, version, build, "claude.app", "Contents", "MacOS", "claude");
        if (fs.existsSync(file)) found.push({ file, version });
      }
    }
  } catch {}
  const v = (s) => s.split(".").map(Number);
  found.sort((a, b) => {
    const [x, y] = [v(a.version), v(b.version)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  });
  return found[0]?.file || null;
}

export function findClaude(env = process.env, home = os.homedir()) {
  return onPath("claude", env) || (env.CLAUDE_BIN && fs.existsSync(env.CLAUDE_BIN) ? env.CLAUDE_BIN : null) || inDesktopApp(home);
}

// Pulls the typed answer out of the CLI's JSON output.
export function parseClaudeOutput(stdout) {
  let out;
  try {
    out = JSON.parse(stdout);
  } catch {
    throw /log ?in|sign ?in|auth/i.test(stdout) ? NOT_SIGNED_IN() : new ModelError("BAD_JSON", "Claude answered in the wrong format.");
  }
  if (out.is_error) throw claudeFailure(String(out.result || ""));
  if (out.structured_output && typeof out.structured_output === "object") return out.structured_output;
  try {
    return JSON.parse(String(out.result || "").replace(/^```(json)?|```$/g, "").trim());
  } catch {
    throw new ModelError("BAD_JSON", "Claude answered in the wrong format.");
  }
}

let queue = Promise.resolve();

function runClaude({ system, prompt, schema, model }) {
  const bin = findClaude();
  if (!bin) return Promise.reject(new ModelError("NO_CLAUDE", "Claude Code is not installed"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "apply-claude-"));
  const inv = buildClaudeInvocation({ bin, system, schema, model, cwd });
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(inv.cmd, inv.args, { cwd, env: inv.env, stdio: ["pipe", "pipe", "pipe"], windowsVerbatimArguments: inv.verbatim });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new ModelError("SLOW", "Claude took too long to answer."));
      }, TIMEOUT_MS);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new ModelError("NO_CLAUDE", err.message));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          try {
            resolve(parseClaudeOutput(stdout));
          } catch (err) {
            reject(err);
          }
          return;
        }
        let said = stdout;
        try {
          said = String(JSON.parse(stdout).result || "");
        } catch {}
        reject(claudeFailure(`${stderr}\n${said}`));
      });
      child.stdin.end(prompt);
    }).finally(() => fs.rmSync(cwd, { recursive: true, force: true }));
  // One call at a time.
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

async function runGemini({ system, prompt, schema }) {
  if (!process.env.GEMINI_API_KEY) throw new ModelError("NO_KEY", "No Gemini key");
  return generate({ system, json: true, temperature: 0.2, prompt: `${prompt}\n\nReply with JSON only, matching this JSON schema:\n${JSON.stringify(schema)}` });
}

export const PROVIDERS = { claude: runClaude, gemini: runGemini };

// The providers to try, in order, ending with none.
export function providerOrder(env = process.env, claudeFound = !!findClaude(env)) {
  const pick = env.APPLY_MODEL || (claudeFound ? "claude" : env.GEMINI_API_KEY ? "gemini" : "none");
  return { claude: ["claude", "gemini"], gemini: ["gemini"], none: [] }[pick] || [];
}

// { data, provider, skipped: [{ provider, reason }] }. data is null when no
// provider answered; provider is then "none". `model` (sonnet by default, or
// opus) applies to the claude route only; gemini ignores it.
export async function ask({ system, prompt, schema, model }, { providers = PROVIDERS, order = providerOrder() } = {}) {
  const skipped = [];
  for (const name of order) {
    try {
      return { data: await providers[name]({ system, prompt, schema, model }), provider: name, skipped };
    } catch (err) {
      skipped.push({ provider: name, reason: err.message });
    }
  }
  return { data: null, provider: "none", skipped };
}
