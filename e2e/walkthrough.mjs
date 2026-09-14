/**
 * 真实浏览器 E2E：建场 -> 上架 -> 登记缴保证金 -> 出价 -> 两分钟顺延 ->
 * 并发截拍（唯一最高价）-> 结算（幂等）-> 重启后仍可查询。
 * 运行：npm run e2e
 */
process.env.LD_LIBRARY_PATH = [
  "/workspace/.syslibs/usr/lib/aarch64-linux-gnu",
  "/workspace/.syslibs/lib/aarch64-linux-gnu",
  process.env.LD_LIBRARY_PATH || ""
].filter(Boolean).join(":");

import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotsDir = join(rootDir, "e2e", "shots");
mkdirSync(shotsDir, { recursive: true });
const DB_FILE = join(rootDir, "data", "e2e.db");
const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;

for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_FILE + suffix, { force: true });

let passed = 0;
function ok(name) { passed += 1; console.log(`  ✓ ${name}`); }
async function shot(page, name) { await page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: true }); }

async function startServer() {
  const db = openDb(DB_FILE);
  const server = createApp(db);
  await new Promise(resolve => server.listen(PORT, resolve));
  return { db, server, close: () => new Promise(r => { server.close(() => { db.close(); r(); }); }) };
}

async function api(path, options) {
  const res = await fetch(BASE + path, options ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) } : undefined);
  return res.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const toLocalInput = ms => {
  const d = new Date(ms); const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

async function clearToast(page) {
  await page.evaluate(() => {
    const el = document.querySelector("#flash");
    el.style.display = "none";
    el.textContent = "";
  });
}

async function expectToast(page, text) {
  await page.waitForFunction(
    (expected) => {
      const el = document.querySelector("#flash");
      return el && el.style.display !== "none" && el.textContent.includes(expected);
    },
    text,
    { timeout: 8000 }
  );
}

async function bid(page, lotId, buyer, amount) {
  await page.fill(`[data-bid-buyer="${lotId}"]`, buyer);
  await page.fill(`[data-bid-amount="${lotId}"]`, String(amount));
  await clearToast(page);
  await page.click(`[data-bid-submit="${lotId}"]`);
}

async function main() {
  console.log("== E2E：真实浏览器全流程走查 ==");
  let app = await startServer();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(10000);

  /* ---------- 1. 建场次 ---------- */
  console.log("1) 建场次");
  await page.goto(BASE);
  await page.click("#tab-auction");
  await page.fill('#session-form [name=name]', "2026 秋季精品赛鸽专场");
  await page.fill('#session-form [name=startAt]', toLocalInput(Date.now() - 1000));
  await page.fill('#session-form [name=endAt]', toLocalInput(Date.now() + 240_000));
  await page.fill('#session-form [name=increment]', "100");
  await page.fill('#session-form [name=commissionPct]', "5");
  await clearToast(page);
  await page.click("#create-session-btn");
  await expectToast(page, "场次已创建");
  ok("场次创建成功");
  const sessions = await api("/api/auction/sessions");
  const sessionId = sessions[0].id;
  assert.ok(sessions[0].endAt - sessions[0].startAt >= 180_000, "场次时长足够演示顺延");

  /* ---------- 2. 上架拍品（送拍人=当前鸽主） ---------- */
  console.log("2) 上架拍品");
  await page.selectOption("#lot-pigeon", "CHN-2026-001");
  assert.equal(await page.inputValue("#lot-consignor"), "北岸棚", "送拍人自动取当前鸽主");
  await page.fill('#lot-form [name=startPrice]', "1000");
  await clearToast(page);
  await page.click("#create-lot-btn");
  await expectToast(page, "拍品已上架");
  await page.selectOption("#lot-pigeon", "CHN-2022-188");
  await page.fill('#lot-form [name=startPrice]', "500");
  await clearToast(page);
  await page.click("#create-lot-btn");
  await expectToast(page, "拍品已上架");
  ok("两只已登记鸽只上架成功（CHN-2026-001 / CHN-2022-188）");

  // 未登记鸽只不能上架（API 边界）
  const badLot = await api(`/api/auction/sessions/${sessionId}/lots`, { ringNo: "NO-SUCH", consignor: "北岸棚", startPrice: 100 });
  assert.equal(badLot.error, "pigeon_not_registered");
  ok("未登记鸽只上架被拒绝");

  let view = await api(`/api/auction/sessions/${sessionId}`);
  const [lot1, lot2] = view.lots;
  ok(`拍品就位：lot${lot1.id}=${lot1.ringNo}（起拍 ${lot1.startPrice}），lot${lot2.id}=${lot2.ringNo}`);

  /* ---------- 3. 买家登记缴保证金 ---------- */
  console.log("3) 买家登记 + 缴保证金");
  for (const [name, deposit] of [["张三", 2000], ["李四", 3000], ["北岸棚", 1000]]) {
    await page.fill('#buyer-form [name=name]', name);
    await page.fill('#buyer-form [name=deposit]', String(deposit));
    await clearToast(page);
    await page.click("#register-buyer-btn");
    await expectToast(page, "买家已登记");
  }
  view = await api(`/api/auction/sessions/${sessionId}`);
  assert.equal(view.buyers.length, 3);
  ok("张三/李四/北岸棚 登记并缴保证金");

  /* ---------- 4. 出价（含边界） ---------- */
  console.log("4) 出价与边界校验");
  await bid(page, lot1.id, "张三", 1000);
  await expectToast(page, "出价成功");
  let after = await api(`/api/auction/sessions/${sessionId}`);
  assert.equal(after.lots.find(l => l.id === lot1.id).extendedCount, 0, "剩余>2分钟出价不顺延");
  ok("张三出价 1000（=起拍价），未触发顺延");

  await bid(page, lot1.id, "北岸棚", 1500);
  await expectToast(page, "卖家不能对自己的拍品出价");
  ok("卖家自拍被拒绝");

  await bid(page, lot1.id, "张三", 1050);
  await expectToast(page, "不得低于 1100");
  ok("低于「最高价+加价幅度」被拒绝");

  await bid(page, lot1.id, "李四", 1100);
  await expectToast(page, "出价成功");
  ok("李四出价 1100（=1000+幅度100）");
  await shot(page, "04-bidding");

  /* ---------- 5. 截拍前两分钟出价自动顺延 ---------- */
  console.log("5) 两分钟自动顺延（等待进入截拍前 30 秒…）");
  while (true) {
    view = await api(`/api/auction/sessions/${sessionId}`);
    const lot = view.lots.find(l => l.id === lot1.id);
    if (lot.endsAt - Date.now() <= 30_000) break; // 压到原截拍前 30 秒内出价，留出约 90 秒顺延窗口便于观察
    await sleep(1000);
  }
  const beforeBid = Date.now();
  await bid(page, lot1.id, "张三", 1200);
  await expectToast(page, "已自动顺延");
  view = await api(`/api/auction/sessions/${sessionId}`);
  const extended = view.lots.find(l => l.id === lot1.id);
  assert.equal(extended.extendedCount, 1);
  assert.ok(extended.endsAt >= beforeBid + 119_000 && extended.endsAt <= Date.now() + 121_000,
    `顺延到出价时刻+2分钟（实际 ${extended.endsAt}）`);
  ok(`张三 1200 出价触发顺延，新截拍时间 ${new Date(extended.endsAt).toLocaleTimeString("zh-CN")}`);
  await page.waitForSelector(`text=已顺延 1 次`, { timeout: 8000 });
  await shot(page, "05-extended");

  /* ---------- 5b. 场景一：原截拍时间已过、顺延窗口内，场次仍应显示进行中 ---------- */
  console.log("5b) 场景一：原截拍时间过后场次状态仍为「进行中」");
  const sessionEndAt = view.endAt;
  while (Date.now() < sessionEndAt + 2000) await sleep(500); // 等过原截拍时间
  assert.ok(Date.now() < extended.endsAt, "应仍处于顺延窗口内");
  view = await api(`/api/auction/sessions/${sessionId}`);
  assert.equal(view.phase, "live", "详情接口：原截拍时间过后场次应仍为进行中");
  assert.equal(view.lots.find(l => l.id === lot1.id).biddable, true, "顺延窗口内拍品仍可出价");
  const listed = await api("/api/auction/sessions");
  assert.equal(listed.find(s => s.id === sessionId).phase, "live", "列表接口：场次应仍为进行中");
  await page.waitForSelector("#sessions-table .pill.live", { timeout: 8000 });
  assert.ok((await page.textContent("#sessions-table .pill.live")).includes("进行中"), "场次列表应显示进行中");
  await page.waitForSelector("#session-detail h2 .pill.live", { timeout: 8000 });
  ok("原截拍时间过后：列表与详情均显示「进行中」，拍品继续接受出价");
  await shot(page, "05b-still-live-after-original-end");

  /* ---------- 5c. 场景二：未到顺延后的截拍时间，截拍给出明确未完成反馈 ---------- */
  console.log("5c) 场景二：未到顺延后截拍时间点击截拍 -> 明确反馈未完成");
  await clearToast(page);
  await page.click("#close-session-btn");
  await expectToast(page, "未到截拍时间");
  ok("界面提示「未到截拍时间」而非假成功");
  const rawClose = await fetch(`${BASE}/api/auction/sessions/${sessionId}/close`, { method: "POST" });
  assert.equal(rawClose.status, 409, "存在未到点拍品时接口应返回 409");
  const rawBody = await rawClose.json();
  assert.equal(rawBody.error, "lots_not_due");
  assert.ok(rawBody.details.pending.some(l => l.ringNo === "CHN-2026-001"), "明细应指明未到点拍品");
  view = await api(`/api/auction/sessions/${sessionId}`);
  assert.equal(view.lots.find(l => l.id === lot1.id).status, "open", "未到点的 lot1 仍在竞价中");
  assert.equal(view.lots.find(l => l.id === lot2.id).status, "unsold", "已到点的 lot2 被截拍（流拍）");
  ok("409 + 明细反馈；到点拍品已截拍，未到点拍品保持竞价中");
  await shot(page, "05c-close-not-due");

  /* ---------- 6. 并发截拍：只确定一个最高价 ---------- */
  console.log("6) 并发截拍（等待到点…）");
  while (Date.now() < extended.endsAt + 400) await sleep(500);
  const closes = await page.evaluate(async (lotId) => {
    return Promise.all(Array.from({ length: 6 }, () =>
      fetch(`/api/auction/lots/${lotId}/close`, { method: "POST" }).then(r => r.json())));
  }, lot1.id);
  assert.deepEqual([...new Set(closes.map(c => c.lot.hammer_price))], [1200], "并发截拍必须得到唯一最高价");
  assert.equal(closes.filter(c => c.changed).length, 1, "只有一次真正执行截拍");
  ok("6 路并发截拍：唯一成交价 1200，仅一次生效");

  await clearToast(page);
  await page.click("#close-session-btn");
  await expectToast(page, "没有新的到点拍品");
  ok("全部拍品已截拍后再点截拍：如实反馈「没有新的到点拍品」");
  view = await api(`/api/auction/sessions/${sessionId}`);
  assert.equal(view.lots.find(l => l.id === lot1.id).status, "sold");
  assert.equal(view.lots.find(l => l.id === lot1.id).winner, "张三");
  assert.equal(view.lots.find(l => l.id === lot2.id).status, "unsold");
  ok("CHN-2026-001 成交（张三 1200），CHN-2022-188 无出价流拍");
  await shot(page, "06-closed");

  /* ---------- 7. 结算：佣金 + 保证金，重复执行不重复扣款 ---------- */
  console.log("7) 结算");
  await clearToast(page);
  await page.click("#settle-session-btn");
  await expectToast(page, "结算完成");
  view = await api(`/api/auction/sessions/${sessionId}`);
  const ledger = view.ledger;
  const find = (kind, party) => ledger.find(e => e.kind === kind && e.party === party);
  assert.equal(find("hammer_charge", "张三").amount, -1200);
  assert.equal(find("commission", "平台").amount, 60, "佣金 = 1200 × 5%");
  assert.equal(find("sale_proceeds", "北岸棚").amount, 1140, "卖方所得 = 1200 - 60");
  assert.equal(find("deposit_applied", "张三").amount, 2000, "成交者保证金冲抵");
  assert.equal(find("deposit_refund", "李四").amount, 3000, "未成交者退还保证金");
  assert.equal(find("deposit_refund", "北岸棚").amount, 1000);
  ok("佣金 60 / 卖方所得 1140 / 保证金冲抵与退还全部正确");
  const ledgerCount = ledger.length;

  await clearToast(page);
  await page.click("#settle-session-btn");
  await expectToast(page, "结算完成");
  view = await api(`/api/auction/sessions/${sessionId}`);
  assert.equal(view.ledger.length, ledgerCount, "重复结算不产生新流水");
  assert.equal(view.ledger.filter(e => e.kind === "commission").reduce((s, e) => s + e.amount, 0), 60, "佣金不会被重复扣");
  ok("重复结算：账本不变，不重复扣款");
  await shot(page, "07-settled");

  const pigeons = await api("/api/pigeons");
  assert.equal(pigeons.find(p => p.ringNo === "CHN-2026-001").owner, "张三", "成交后鸽只所有权转移给买受人");
  ok("鸽只所有权已转移：北岸棚 → 张三");

  await browser.close();
  await app.close();

  /* ---------- 8. 重启后仍可查询 ---------- */
  console.log("8) 重启服务，验证持久化");
  app = await startServer();
  const browser2 = await chromium.launch();
  const page2 = await browser2.newPage({ viewport: { width: 1440, height: 960 } });
  await page2.goto(BASE);
  await page2.click("#tab-auction");
  await page2.click(`[data-session="${sessionId}"]`);
  await page2.waitForSelector("text=已成交", { timeout: 8000 });
  await page2.waitForSelector("text=佣金（平台）", { timeout: 8000 });
  const reopened = await api(`/api/auction/sessions/${sessionId}`);
  assert.equal(reopened.lots.find(l => l.id === lot1.id).hammerPrice, 1200);
  assert.equal(reopened.lots.find(l => l.id === lot1.id).settleStatus, "settled");
  assert.equal(reopened.ledger.length, ledgerCount);
  ok("重启后成交、流拍、结算流水全部可查");
  await shot(page2, "08-after-restart");
  await browser2.close();
  await app.close();

  console.log(`\n== E2E 全部通过（${passed} 项断言组） ==`);
}

main().catch(error => { console.error("\nE2E 失败:", error); process.exit(1); });
