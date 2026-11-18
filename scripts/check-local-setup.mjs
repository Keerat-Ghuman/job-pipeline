import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv } from "./doctor.mjs";
import { checkListingEligibility } from "../lib/eligibilityRun.js";
import { PROFILE, resumeFileFor } from "../lib/profile.js";
import { scoreAndTag } from "../lib/scorer.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

function checkPersonalProfile() {
  const read = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
  const kit = read("config/applyKit.json");
  const resume = read("data/resume.json");
  assert.ok(resume.name && resume.sections.length > 0);
  assert.deepEqual(kit.eligibility.workIn, ["Canada"]);
  assert.equal(kit.eligibility.requireUsSponsorship, true);
  assert.deepEqual(Object.keys(PROFILE.tracks).sort(), ["data", "ml", "software"]);

  for (const [title, track] of [
    ["Software Developer Intern", "software"],
    ["Data Analyst Intern", "data"],
    ["Machine Learning Engineer Intern", "ml"],
  ]) {
    const result = scoreAndTag({ title, location: "Toronto, ON", description: "" });
    assert.equal(result.cvVersion, track, title);
    assert.ok(result.matchScore >= 55, title);
    assert.ok(kit.summaries[track]);
    assert.equal(resumeFileFor(track), "resume.pdf");
  }
  for (const title of ["Senior Software Engineer", "Staff Machine Learning Engineer", "Financial Analyst"]) {
    assert.ok(scoreAndTag({ title, location: "Toronto, ON", description: "" }).matchScore < 55, title);
  }
  for (const file of [".env.local", "config/applyKit.json", "data/resume.json", "resumes/resume.pdf"]) {
    git("check-ignore", file);
    assert.equal(statSync(join(root, file)).mode & 0o077, 0, file);
  }
  const file = readFileSync(join(root, "resumes", "resume.pdf"));
  assert.equal(file.subarray(0, 5).toString(), "%PDF-");
  const env = readEnv();
  assert.deepEqual(
    [env.AUTO_SEND_EMAILS, env.MAX_EMAILS_PER_RUN, env.AUTO_APPROVE_MIN_SCORE, env.READ_JOB_ALERTS, env.ALLOW_CLEAR],
    ["false", "0", "101", "false", "false"],
  );
  assert.equal(env.SMTP_APP_PASSWORD, "");
  assert.equal(checkListingEligibility({ title: "Software Intern", location: "Seattle, WA" }, kit.eligibility).verdict, "no");
  console.log("Personal profile, private résumé files, and manual-review settings passed.");
}

// Upstream scoring assertions depend on the original profile values. Run the
// current tracked source and tests with that fixture, without copying private
// application data or overwriting the personalized checkout.
function checkUpstreamSuite() {
  const fixture = mkdtempSync(join(tmpdir(), "job-pipeline-tests-"));
  try {
    const files = git("ls-files", "-z", "--", "app", "config", "lib", "resumes", "scripts", "tests", "package.json").split("\0").filter(Boolean);
    for (const file of files) {
      const target = join(fixture, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, file), target);
    }
    writeFileSync(join(fixture, "config/profile.json"), git("show", "HEAD:config/profile.json"));
    symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
    execFileSync(process.execPath, ["--test", "tests/*.test.mjs"], { cwd: fixture, stdio: "inherit" });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

checkPersonalProfile();
if (!process.argv.includes("--profile-only")) checkUpstreamSuite();
