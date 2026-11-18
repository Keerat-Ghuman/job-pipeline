// app/api/jobs/[id]/apply/route.js
// Fill a job's application form in the local Chrome, and send it only after
// you say yes. GET: { available, reason, site, application }.
// POST { action }: fill | check | confirm | submit | mark | close.
// See docs/form-apply.md. Agents never call confirm or submit.

import { NextResponse } from "next/server";
import { findJob } from "../../../../../lib/jobContext.js";
import { siteFor } from "../../../../../lib/apply/sites.js";
import { sameOrigin } from "../../../../../lib/apply/origin.js";
import { getApplication, fill, check, confirm, submit, mark, close } from "../../../../../lib/apply/runner.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOCAL_ONLY = "Filling application forms works only in the dashboard on your own computer.";
const STATUS_FOR = { NOT_FOUND: 404, BUSY: 409, STATE: 409, CHANGED: 409, OPEN_ELSEWHERE: 409, APPLIED: 409, NOT_READY: 409, LOST: 409, BAD_CODE: 403, EXPIRED: 403, NOT_SAME_ORIGIN: 403 };

const ok = (body) => NextResponse.json({ success: true, ...body });
const fail = (err) =>
  NextResponse.json({ success: false, code: err.code || "ERROR", error: err.message }, { status: STATUS_FOR[err.code] || (err.code ? 400 : 500) });

export async function GET(_req, { params: pendingParams }) {
  const params = await pendingParams;
  try {
    if (process.env.VERCEL) return ok({ available: false, reason: LOCAL_ONLY, site: null, application: null });
    const row = await findJob(params.id);
    if (!row) return fail({ code: "NOT_FOUND", message: "This job isn't in your sheet." });
    const site = siteFor(row.Link);
    return ok({ available: !!site.site, reason: site.reason || "", site: site.site, application: await getApplication(params.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request, { params: pendingParams }) {
  const params = await pendingParams;
  try {
    if (process.env.VERCEL) return fail({ code: "LOCAL_ONLY", message: LOCAL_ONLY });
    if (!sameOrigin(request.headers)) return fail({ code: "NOT_SAME_ORIGIN", message: "Do this from the dashboard page." });
    const body = await request.json().catch(() => ({}));
    const id = params.id;
    switch (body.action) {
      case "fill": {
        const edits = Array.isArray(body.answers)
          ? body.answers.filter((a) => a && typeof a.fieldId === "string").map((a) => ({ fieldId: a.fieldId, value: String(a.value ?? "") }))
          : [];
        const { application } = await fill(id, edits);
        return ok({ application });
      }
      case "check":
        return ok({ application: await check(id) });
      case "confirm":
        return ok(await confirm(id));
      case "submit": {
        if (typeof body.code !== "string") return fail({ code: "BAD_CODE", message: "That confirmation isn't valid. Press Submit application again." });
        return ok({ application: await submit(id, body.code) });
      }
      case "mark":
        return ok({ application: await mark(id, body.result) });
      case "close":
        return ok({ application: await close(id) });
      default:
        return fail({ code: "BAD_ACTION", message: "action must be fill, check, confirm, submit, mark or close." });
    }
  } catch (err) {
    return fail(err);
  }
}
