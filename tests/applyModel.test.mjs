import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeInvocation, claudeEnv, parseClaudeOutput, ask, providerOrder, commandFor, claudeFailure } from "../lib/apply/model.js";

test("the claude call uses the subscription: exact args, and no keys in its environment", () => {
  const env = {
    HOME: "/h", PATH: "/bin", USER: "ada",
    ANTHROPIC_API_KEY: "x", ANTHROPIC_AUTH_TOKEN: "x", ANTHROPIC_BASE_URL: "x", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1",
    CLAUDECODE: "1", CLAUDE_CODE_OAUTH_TOKEN: "x", CLAUDE_CODE_ENTRYPOINT: "cli", GEMINI_API_KEY: "x",
    GOOGLE_SERVICE_ACCOUNT_KEY_PATH: "/k", SMTP_APP_PASSWORD: "p", SOME_SECRET: "s", GITHUB_TOKEN: "t",
  };
  const schema = { type: "object" };
  const inv = buildClaudeInvocation({ bin: "/bin/claude", system: "SYS", schema, env, cwd: "/tmp/empty", platform: "darwin" });
  assert.equal(inv.cmd, "/bin/claude");
  assert.equal(inv.verbatim, false);
  assert.deepEqual(inv.args, [
    "-p", "--output-format", "json", "--json-schema", JSON.stringify(schema), "--model", "sonnet",
    "--tools", "", "--strict-mcp-config", "--setting-sources", "project", "--no-session-persistence",
    "--system-prompt", "SYS",
  ]);
  assert.deepEqual(inv.env, { HOME: "/h", PATH: "/bin", USER: "ada" });
  assert.equal(inv.cwd, "/tmp/empty");
  assert.deepEqual(claudeEnv({ A: "1" }), { A: "1" });
});

test("claude output: structured_output first, then JSON in result, errors mean sign in", () => {
  assert.deepEqual(parseClaudeOutput(JSON.stringify({ structured_output: { a: 1 }, result: "" })), { a: 1 });
  assert.deepEqual(parseClaudeOutput(JSON.stringify({ result: '```json\n{"b":2}\n```' })), { b: 2 });
  assert.throws(() => parseClaudeOutput(JSON.stringify({ is_error: true, result: "Invalid API key · Please run /login" })), (e) => e.code === "NOT_SIGNED_IN" && e.message === "Open Claude Code and sign in");
  assert.throws(() => parseClaudeOutput("Please log in"), (e) => e.code === "NOT_SIGNED_IN");
  assert.throws(() => parseClaudeOutput(JSON.stringify({ result: "not json" })), (e) => e.code === "BAD_JSON");
});

test("falls back claude, then gemini, then none, saying why", async () => {
  const signedOut = async () => {
    throw Object.assign(new Error("Open Claude Code and sign in"), { code: "NOT_SIGNED_IN" });
  };
  const gemini = async () => ({ ok: true });
  const r1 = await ask({ system: "", prompt: "", schema: {} }, { providers: { claude: signedOut, gemini }, order: ["claude", "gemini"] });
  assert.deepEqual(r1, { data: { ok: true }, provider: "gemini", skipped: [{ provider: "claude", reason: "Open Claude Code and sign in" }] });
  const noKey = async () => {
    throw new Error("No Gemini key");
  };
  const r2 = await ask({}, { providers: { claude: signedOut, gemini: noKey }, order: ["claude", "gemini"] });
  assert.equal(r2.provider, "none");
  assert.equal(r2.data, null);
  assert.equal(r2.skipped.length, 2);
});

test("APPLY_MODEL picks where to start; the default depends on what is installed", () => {
  assert.deepEqual(providerOrder({ APPLY_MODEL: "gemini" }, true), ["gemini"]);
  assert.deepEqual(providerOrder({ APPLY_MODEL: "none" }, true), []);
  assert.deepEqual(providerOrder({}, true), ["claude", "gemini"]);
  assert.deepEqual(providerOrder({ GEMINI_API_KEY: "k" }, false), ["gemini"]);
  assert.deepEqual(providerOrder({}, false), []);
});

test("on Windows claude.exe runs directly and claude.cmd runs through cmd.exe with every argument escaped", () => {
  const exe = commandFor("C:\\npm\\claude.exe", ["-p", ""], { platform: "win32" });
  assert.deepEqual(exe, { cmd: "C:\\npm\\claude.exe", args: ["-p", ""], verbatim: false });
  const cmd = commandFor("C:\\Users\\Ada Lovelace\\npm\\claude.cmd", ["-p", "", '{"a":"b c"}', "Plain words, (no) & 100% | x"], { platform: "win32", comspec: "C:\\cmd.exe" });
  assert.equal(cmd.cmd, "C:\\cmd.exe");
  assert.equal(cmd.verbatim, true);
  assert.deepEqual(cmd.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(
    cmd.args[3],
    '"C:\\Users\\Ada^ Lovelace\\npm\\claude.cmd ^^^"-p^^^" ^^^"^^^" ^^^"{\\^^^"a\\^^^":\\^^^"b^^^ c\\^^^"}^^^" ^^^"Plain^^^ words^^^,^^^ ^^^(no^^^)^^^ ^^^&^^^ 100^^^%^^^ ^^^|^^^ x^^^""',
  );
  assert.throws(() => commandFor("C:\\npm\\claude.cmd", ["a\nb"], { platform: "win32" }), { code: "CLAUDE_ERROR" });
  assert.deepEqual(commandFor("/usr/local/bin/claude.cmd", ["x"], { platform: "darwin" }).cmd, "/usr/local/bin/claude.cmd");
  const win = buildClaudeInvocation({ bin: "C:\\npm\\claude.cmd", system: "S", schema: {}, env: { ComSpec: "C:\\cmd.exe" }, cwd: "C:\\t", platform: "win32" });
  assert.equal(win.cmd, "C:\\cmd.exe");
  assert.equal(win.verbatim, true);
});

test("a failed claude call says why: signed out, plan limit, or its first error line with keys hidden", () => {
  assert.equal(claudeFailure("Error: Not logged in. Please run /login").code, "NOT_SIGNED_IN");
  assert.equal(claudeFailure("Failed to authenticate").message, "Open Claude Code and sign in");
  const limit = claudeFailure("Claude AI usage limit reached|1760000000");
  assert.equal(limit.code, "RATE_LIMIT");
  assert.equal(limit.message, "Your Claude plan's usage limit is reached. Try again later or use Gemini.");
  assert.equal(claudeFailure("429 rate_limit_error").code, "RATE_LIMIT");
  const other = claudeFailure("\nboom: bad flag sk-ant-api03-abcdef\nstack line");
  assert.equal(other.code, "CLAUDE_ERROR");
  assert.equal(other.message, "Claude Code stopped with an error: boom: bad flag [hidden]");
  assert.equal(claudeFailure("").message, "Claude Code stopped with an error.");
  assert.throws(() => parseClaudeOutput(JSON.stringify({ is_error: true, result: "Claude AI usage limit reached" })), { code: "RATE_LIMIT" });
});

test("the model option picks opus for the claude route; anything else stays sonnet; gemini ignores it", async () => {
  const arg = (model) => {
    const inv = buildClaudeInvocation({ bin: "/bin/claude", system: "S", schema: {}, model, env: {}, cwd: "/t", platform: "darwin" });
    return inv.args[inv.args.indexOf("--model") + 1];
  };
  assert.equal(arg(undefined), "sonnet");
  assert.equal(arg("opus"), "opus");
  assert.equal(arg("sonnet"), "sonnet");
  assert.equal(arg("gpt-9"), "sonnet");
  const seen = [];
  const claude = async (q) => (seen.push(q.model), { ok: true });
  await ask({ system: "", prompt: "", schema: {}, model: "opus" }, { providers: { claude }, order: ["claude"] });
  assert.deepEqual(seen, ["opus"]);
});
