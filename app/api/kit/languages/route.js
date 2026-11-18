// app/api/kit/languages/route.js
// POST { languages: ["English", "French"] }: saves the languages the person
// speaks in config/applyKit.json, then re-checks open jobs so roles needing
// those languages come back (and ones needing others are flagged).

import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { loadApplyKit } from "../../../../lib/applyKit.js";
import { withLanguages } from "../../../../lib/languages.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  // A page on another site can't send JSON from this one without a preflight,
  // but check the origin too so it can't change your languages.
  const origin = request.headers.get("origin");
  if (!request.headers.get("content-type")?.startsWith("application/json") || (origin && new URL(origin).host !== request.headers.get("host"))) {
    return NextResponse.json({ success: false, error: "Bad request." }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Send the languages as JSON." }, { status: 400 });
  }
  if (!Array.isArray(body?.languages)) {
    return NextResponse.json({ success: false, error: "Pick at least one language." }, { status: 400 });
  }
  try {
    const kit = withLanguages(loadApplyKit(), body.languages);
    const file = path.join(process.cwd(), "config", "applyKit.json");
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(kit, null, 2) + "\n");
    fs.renameSync(`${file}.tmp`, file);
    let rechecked = null;
    try {
      const [{ getAllJobs }, { recheckEligibility }] = await Promise.all([
        import("../../../../lib/sheets.js"),
        import("../../../../lib/pipeline.js"),
      ]);
      rechecked = await recheckEligibility(await getAllJobs(), kit.eligibility);
    } catch (err) {
      console.error("Languages saved, but the job re-check failed", err.message);
    }
    return NextResponse.json({ success: true, languages: kit.eligibility.languages, rechecked });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
