// Browser smoke test: opens every top-level page in a real browser, in both
// themes, at desktop and phone width, and fails if any page throws a
// JavaScript error or scrolls sideways on a phone. No sign-in, no secrets,
// nothing is written anywhere.
//
// Run from the repository root (needs Playwright and its Chromium):
//   python scripts/blog_agent/build_index.py
//   node scripts/checks/browser_smoke.mjs
//
// It also runs on every pull request (.github/workflows/site-checks.yml).
// Requests to outside services (Supabase, YouTube, fonts) may fail in some
// environments; failed requests are ignored, only page errors count.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";

// require() so a globally installed Playwright (NODE_PATH) works too
const { chromium } = createRequire(import.meta.url)("playwright");

const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}`;
const pages = readdirSync(".").filter((f) => f.endsWith(".html")).sort();
const views = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 375, height: 740 },
];
const themes = ["modern", "terminal"];

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  stdio: "ignore",
});
const stop = () => server.kill();
process.on("exit", stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/index.html`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("The local web server did not start");
}

await waitForServer();
const browser = await chromium.launch();
const problems = [];

for (const theme of themes) {
  for (const view of views) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height } });
    // The saved theme choice is read before the page draws (CLAUDE.md, "Two themes").
    await context.addInitScript((t) => {
      try { localStorage.setItem("amc-theme", t); } catch {}
    }, theme);
    for (const file of pages) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (err) => errors.push(err.message));
      try {
        await page.goto(`${BASE}/${file}`, { waitUntil: "load", timeout: 20000 });
        await page.waitForTimeout(400);
        const finalUrl = new URL(page.url());
        const forwarded = finalUrl.pathname !== `/${file}`;
        if (view.name === "phone" && !forwarded) {
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          if (overflow > 1) errors.push(`scrolls sideways by ${overflow}px at ${view.width}px wide`);
        }
      } catch (err) {
        errors.push(`did not load: ${err.message.split("\n")[0]}`);
      }
      for (const e of errors) problems.push(`${file} (${theme}, ${view.name}): ${e}`);
      await page.close();
    }
    await context.close();
  }
}

await browser.close();
stop();

console.log(`Opened ${pages.length} pages x ${themes.length} themes x ${views.length} widths.`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("No page errors.");
