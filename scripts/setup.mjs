#!/usr/bin/env node
// One-shot setup: verify dependencies, start the Next.js dev server, open
// the dashboard. Use npm run service:install separately for the always-on app.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const DEV_URL = "http://127.0.0.1:3000";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function step(msg) {
  console.log(`\n=> ${msg}`);
}

function done(msg) {
  console.log(`   ${msg}`);
}

function fail(msg) {
  console.error(`\nsetup: ${msg}`);
  process.exit(1);
}

function preflight() {
  if (!fs.existsSync(path.join(REPO_ROOT, "node_modules", "next"))) {
    fail(
      "Dependencies not installed. Run this first:\n" +
      "  npm install\n" +
      "Then re-run `npm run setup`.",
    );
  }
}

function spawnDevServer() {
  return spawn(NPM, ["run", "dev"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function openDashboard(url) {
  switch (process.platform) {
    case "darwin":
      spawnSync("open", [url], { stdio: "ignore" });
      break;
    case "win32":
      spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
      break;
    default:
      spawnSync("xdg-open", [url], { stdio: "ignore" });
      break;
  }
}

// `next dev` returns as soon as the process is up, not when it is listening.
// Poll /api/health so the browser open does not beat the server to the punch.
async function waitForServer(maxMs = 120000) {
  const url = `${DEV_URL}/api/health`;
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        if (data && data.ok === true) return true;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  if (lastErr) {
    console.error(`   last error while polling: ${lastErr.message ?? lastErr}`);
  }
  return false;
}

async function main() {
  console.log("Spent setup");
  console.log(`  platform: ${process.platform}`);
  console.log(`  repo:     ${REPO_ROOT}`);

  preflight();

  step("Starting dev server");
  console.log(`   ${DEV_URL}`);
  console.log("   Press Ctrl+C to stop.");
  const dev = spawnDevServer();

  step("Waiting for server to come up");
  const ready = await waitForServer();
  if (ready) {
    done("server is healthy");
    step("Opening dashboard");
    openDashboard(DEV_URL);
  } else {
    console.error("   server did not respond within 120s.");
    console.error("   check the dev server output above for errors.");
  }

  printCheatSheet();

  await new Promise((resolve) => {
    dev.on("exit", (code, signal) => {
      if (signal === "SIGINT" || signal === "SIGTERM") {
        resolve();
        return;
      }
      if (code != null && code !== 0) {
        fail(`dev server exited with status ${code}`);
      }
      resolve();
    });
  });
}

function printCheatSheet() {
  console.log("");
  console.log("================================================================");
  console.log(`  Done. Spent is at ${DEV_URL}`);
  console.log("================================================================");
  console.log("");
  console.log("Useful commands:");
  console.log("  npm run dev                    start the dev server (frontend + API)");
  console.log("  Ctrl+C                         stop the dev server");
  console.log("  npm run service:install        install the always-on production app");
  console.log("  npm run menubar:install:mac    build and install the macOS menubar");
  console.log("  npm run menubar:install:windows build and install the Windows menubar");
  console.log("");
  console.log("Tip: bookmark the URL above so the daily flow is one click.");
  console.log("");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
