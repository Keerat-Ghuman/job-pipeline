// store.js (apply)
// data/applications/<jobId>.json, and a per-job lock file that covers fill,
// check and submit. The lock is made with exclusive create, so a second
// request or a second server process can't take it; one not touched for 3
// minutes is from a crashed or stuck run and is taken over.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR, readJson, listJson } from "../store.js";

export const LOCK_STALE_MS = 3 * 60_000;
const DIR = "applications";

export class ApplyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function check(jobId) {
  if (!/^[a-z0-9]{1,20}$/.test(String(jobId))) throw new ApplyError("BAD_ID", "That job id isn't valid.");
  return jobId;
}

const fileFor = (jobId) => path.join(DATA_DIR, DIR, `${check(jobId)}.json`);
const lockFor = (jobId) => path.join(DATA_DIR, DIR, `${check(jobId)}.lock`);

export function readApp(jobId) {
  return readJson(`${DIR}/${check(jobId)}`, null);
}

export function listApps() {
  return listJson(DIR);
}

// Temp file, fsync, rename, fsync the folder: the state is on disk before
// the caller goes on (the click after "sending" depends on it).
export function writeApp(app) {
  const file = fileFor(app.jobId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(app, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try {
    const dir = fs.openSync(path.dirname(file), "r");
    fs.fsyncSync(dir);
    fs.closeSync(dir);
  } catch {}
  return app;
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function tryLock(file, token, now) {
  try {
    const fd = fs.openSync(file, "wx");
    fs.writeSync(fd, JSON.stringify({ at: now, pid: process.pid, token }));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    return false;
  }
}

const isLive = (lock, now) => !!lock && now - (Number(lock.at) || 0) < LOCK_STALE_MS;

// Whether someone holds this job's lock and touched it in the last 3 minutes.
export function lockIsLive(jobId, now = Date.now()) {
  return isLive(readLock(lockFor(jobId)), now);
}

// The lock, or an ApplyError BUSY. touch() refreshes it during long work and
// release() frees it, both only while the file still carries this lock's
// token: a run whose lock went stale and was taken over can't refresh or
// delete the new holder's lock.
export function takeLock(jobId, now = Date.now()) {
  const file = lockFor(jobId);
  const token = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!tryLock(file, token, now)) {
    if (isLive(readLock(file), now)) throw new ApplyError("BUSY", "Something else is working on this application. Wait a moment and try again.");
    fs.rmSync(file, { force: true });
    if (!tryLock(file, token, now)) throw new ApplyError("BUSY", "Something else is working on this application. Wait a moment and try again.");
  }
  const mine = () => readLock(file)?.token === token;
  return {
    token,
    touch: () => mine() && (fs.writeFileSync(file, JSON.stringify({ at: Date.now(), pid: process.pid, token })), true),
    release: () => mine() && (fs.rmSync(file, { force: true }), true),
  };
}

// Writes update(disk) only when every field in `expect` still matches the
// file on disk, else an ApplyError CHANGED.
export function compareAndSwap(jobId, expect, update) {
  const disk = readApp(jobId);
  if (!disk || Object.entries(expect).some(([k, v]) => disk[k] !== v)) {
    throw new ApplyError("CHANGED", "This application changed since you reviewed it. Check it again before sending.");
  }
  return writeApp(update(disk));
}
