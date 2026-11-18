import test from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "../lib/apply/origin.js";

const h = (o) => new Headers(o);
const page = (host, origin = `http://${host}`) => h({ host, origin, "sec-fetch-site": "same-origin" });

test("the dashboard page on this computer or the home network may act", () => {
  for (const host of ["localhost:3001", "127.0.0.1:3001", "rishis-mac.local:3001", "192.168.1.20:3001", "10.0.0.5:3001", "172.20.1.1:3001"]) {
    assert.ok(sameOrigin(page(host)), host);
  }
});

test("other sites, scripts and rebinding domains may not", () => {
  assert.ok(!sameOrigin(page("evil.example:3001")), "rebinding domain as Host");
  assert.ok(!sameOrigin(page("localhost:3001", "http://evil.example")), "cross-site origin");
  assert.ok(!sameOrigin(h({ host: "localhost:3001", origin: "http://localhost:3001", "sec-fetch-site": "cross-site" })), "cross-site fetch");
  assert.ok(!sameOrigin(h({ host: "localhost:3001" })), "curl with no origin");
  assert.ok(!sameOrigin(page("172.32.0.1:3001")), "public address");
});
