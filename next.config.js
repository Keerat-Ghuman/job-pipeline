import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The gate (.claude/hooks/qa-gate.mjs) builds into its own folder so the
  // dashboard's dev server keeps running from .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  // On Vercel each API route is bundled on its own. These lines make sure the
  // CV PDFs and the Apply kit file are shipped with the routes that read them.
  outputFileTracingIncludes: {
    "/api/resume": ["./resumes/**/*"],
    "/api/approve": ["./resumes/**/*"],
    "/api/kit": ["./config/applyKit.json", "./config/applyKit.example.json"],
  },
};

export default nextConfig;
