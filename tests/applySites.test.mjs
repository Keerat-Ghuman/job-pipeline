import { test } from "node:test";
import assert from "node:assert/strict";
import { siteFor, isAtsHost } from "../lib/apply/sites.js";

test("greenhouse board links and company links with gh_jid use the link as the form", () => {
  assert.deepEqual(siteFor("https://boards.greenhouse.io/acme/jobs/123"), { site: "greenhouse", formUrl: "https://boards.greenhouse.io/acme/jobs/123" });
  assert.equal(siteFor("https://job-boards.greenhouse.io/acme/jobs/9").site, "greenhouse");
  assert.equal(siteFor("https://acme.com/careers?gh_jid=555").site, "greenhouse");
});

test("lever and ashby links point at their form pages", () => {
  assert.deepEqual(siteFor("https://jobs.lever.co/acme/abc-123"), { site: "lever", formUrl: "https://jobs.lever.co/acme/abc-123/apply" });
  assert.equal(siteFor("https://jobs.lever.co/acme/abc-123/apply").formUrl, "https://jobs.lever.co/acme/abc-123/apply");
  assert.deepEqual(siteFor("https://jobs.ashbyhq.com/acme/0f1e"), { site: "ashby", formUrl: "https://jobs.ashbyhq.com/acme/0f1e/application" });
});

test("other sites say why, and point to Open application", () => {
  const multi = siteFor("https://apply.workable.com/acme/j/1");
  assert.equal(multi.site, null);
  assert.match(multi.reason, /several pages/);
  assert.match(siteFor("https://acme.wd5.myworkdayjobs.com/x").reason, /needs an account/);
  assert.match(siteFor("https://example.com/job").reason, /Greenhouse, Lever and Ashby/);
  assert.equal(siteFor("not a link").site, null);
  assert.equal(siteFor("https://jobs.lever.co/acme").site, null);
});

test("forms are filled only on Greenhouse, Lever and Ashby hosts; this computer only in tests", () => {
  for (const h of ["boards.greenhouse.io", "job-boards.greenhouse.io", "greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"]) assert.ok(isAtsHost(h, {}), h);
  for (const h of ["acme.com", "greenhouse.io.evil.example", "notgreenhouse.io", "lever.co", "ashbyhq.com", "127.0.0.1", "localhost"]) assert.ok(!isAtsHost(h, {}), h);
  assert.ok(isAtsHost("127.0.0.1", { NODE_ENV: "test" }));
  assert.ok(isAtsHost("localhost", { NODE_ENV: "test" }));
});
