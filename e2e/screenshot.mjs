/** 用持久化的 e2e 数据库重开服务并截图（验证重启后数据可查 + 中文字体渲染） */
process.env.LD_LIBRARY_PATH = [
  "/workspace/.syslibs/usr/lib/aarch64-linux-gnu",
  "/workspace/.syslibs/lib/aarch64-linux-gnu",
  process.env.LD_LIBRARY_PATH || ""
].filter(Boolean).join(":");

import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = openDb(join(rootDir, "data", "e2e.db"));
const server = createApp(db);
await new Promise(r => server.listen(3219, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto("http://127.0.0.1:3219");
await page.click("#tab-auction");
await page.click('[data-session="1"]');
await page.waitForSelector("text=已成交", { timeout: 8000 });
await page.waitForSelector("text=佣金（平台）", { timeout: 8000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(rootDir, "e2e", "shots", "09-restart-readable.png"), fullPage: true });
await browser.close();
await new Promise(r => server.close(r));
console.log("screenshot saved: e2e/shots/09-restart-readable.png");
