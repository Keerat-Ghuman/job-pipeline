import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [
  "app",
  "lib",
  "tests",
  "package.json",
  "scripts",
  "config/applyKit.example.json",
  "config/companies.json",
  "config/countries.json",
  "config/keywords.json",
  "config/resume.example.json",
  "config/xSearches.json",
];

const fixture = mkdtempSync(join(tmpdir(), "job-pipeline-tests-"));
try {
  for (const file of files) {
    cpSync(join(root, file), join(fixture, file), { recursive: true });
  }
  // Scoring expectations use config/profile.json from b38a9a43df8785e77961d4fba9ba9e245d6fcac5.
  copyFileSync(join(root, "scripts/fixtures/upstream-profile.json"), join(fixture, "config/profile.json"));
  const linkType = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"), linkType);

  const testFiles = readdirSync(join(fixture, "tests"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => `tests/${entry.name}`)
    .sort();
  if (testFiles.length === 0) throw new Error("No tests/*.test.mjs files found.");

  const args = ["--test", ...process.argv.slice(2), ...testFiles];
  const result = spawnSync(process.execPath, args, { cwd: fixture, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
