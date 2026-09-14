import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { openDb, createPigeon, getPigeon } from "../src/db.js";
import {
  EXTENSION_MS, createSession, listLot, registerBuyer, placeBid,
  closeLot, closeSession, settleSession, getSessionView, listSessions, fmtCn
} from "../src/auction.js";
import { createApp } from "../src/app.js";

const T0 = 1_800_000_000_000; // 固定时间基准，测试注入合成时间

function freshDb() {
  return openDb(":memory:");
}

/** 建一个进行中的场次 + 一只上架鸽，返回上下文 */
function setupLive(db, { startPrice = 1000, increment = 100, commissionRate = 0.05, ringNo = "CHN-2026-001", consignor = "北岸棚" } = {}) {
  const session = createSession(db, { name: "测试专场", startAt: T0, endAt: T0 + 600_000, increment, commissionRate }, T0 - 1000);
  const lot = listLot(db, { sessionId: session.id, ringNo, consignor, startPrice }, T0 - 500);
  return { session, lot };
}

function expectError(fn, code) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, code, `期望错误码 ${code}，实际 ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`期望抛出 ${code}，但成功执行了`);
}

/* ================= 建场与上架 ================= */

test("建场：参数校验", () => {
  const db = freshDb();
  expectError(() => createSession(db, { name: "", startAt: T0, endAt: T0 + 1, increment: 100 }, T0), "name_required");
  expectError(() => createSession(db, { name: "x", startAt: T0, endAt: T0, increment: 100 }, T0), "invalid_time_range");
  expectError(() => createSession(db, { name: "x", startAt: T0, endAt: T0 + 1, increment: 0 }, T0), "invalid_increment");
  expectError(() => createSession(db, { name: "x", startAt: T0, endAt: T0 + 1, increment: -5 }, T0), "invalid_increment");
  expectError(() => createSession(db, { name: "x", startAt: T0, endAt: T0 + 1, increment: 100, commissionRate: 1 }, T0), "invalid_commission");
  const ok = createSession(db, { name: "正常场", startAt: T0, endAt: T0 + 1000, increment: 100 }, T0);
  assert.equal(ok.name, "正常场");
});

test("上架：仅允许已登记鸽只", () => {
  const db = freshDb();
  const session = createSession(db, { name: "s", startAt: T0, endAt: T0 + 600_000, increment: 100 }, T0);
  expectError(() => listLot(db, { sessionId: session.id, ringNo: "NO-SUCH-RING", consignor: "北岸棚", startPrice: 100 }, T0), "pigeon_not_registered");
});

test("上架：送拍人须与当前鸽主一致", () => {
  const db = freshDb();
  const session = createSession(db, { name: "s", startAt: T0, endAt: T0 + 600_000, increment: 100 }, T0);
  expectError(() => listLot(db, { sessionId: session.id, ringNo: "CHN-2026-001", consignor: "别人", startPrice: 100 }, T0), "consignor_not_owner");
  const ok = listLot(db, { sessionId: session.id, ringNo: "CHN-2026-001", consignor: "北岸棚", startPrice: 100 }, T0);
  assert.equal(ok.consignor, "北岸棚");
});

test("上架：同一鸽只同一场次不能重复上架；截拍后不能上架", () => {
  const db = freshDb();
  const session = createSession(db, { name: "s", startAt: T0, endAt: T0 + 600_000, increment: 100 }, T0);
  listLot(db, { sessionId: session.id, ringNo: "CHN-2026-001", consignor: "北岸棚", startPrice: 100 }, T0);
  expectError(() => listLot(db, { sessionId: session.id, ringNo: "CHN-2026-001", consignor: "北岸棚", startPrice: 100 }, T0), "already_listed");
  expectError(() => listLot(db, { sessionId: session.id, ringNo: "CHN-2022-188", consignor: "育种棚", startPrice: 100 }, T0 + 600_001), "session_ended");
});

/* ================= 买家登记 ================= */

test("登记：保证金必须为正；重复登记幂等不重复收款", () => {
  const db = freshDb();
  const { session } = setupLive(db);
  expectError(() => registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 0 }, T0), "invalid_deposit");
  const first = registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  assert.equal(first.duplicated, false);
  const again = registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0 + 1);
  assert.equal(again.duplicated, true);
  assert.equal(again.buyer.id, first.buyer.id);
  const ledger = db.prepare("SELECT * FROM ledger WHERE session_id = ?").all(session.id);
  assert.equal(ledger.filter(e => e.kind === "deposit_paid").length, 1, "重复登记不能重复扣保证金");
});

/* ================= 出价规则 ================= */

test("出价：未开拍 / 未登记 / 自拍 / 起拍价 / 加价幅度 / 截拍后", () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  registerBuyer(db, { sessionId: session.id, name: "北岸棚", deposit: 2000 }, T0); // 卖家也登记了买家身份

  expectError(() => placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, T0 - 1), "session_not_started");
  expectError(() => placeBid(db, { lotId: lot.id, buyerName: "李四", amount: 1000 }, T0), "buyer_not_registered");
  expectError(() => placeBid(db, { lotId: lot.id, buyerName: "北岸棚", amount: 1000 }, T0), "self_bid");
  expectError(() => placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 999 }, T0), "bid_too_low");

  const first = placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, T0); // 恰好等于起拍价
  assert.equal(first.bid.amount, 1000);
  expectError(() => placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1099 }, T0 + 1), "bid_too_low");
  const second = placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1100 }, T0 + 2); // 恰好 = 最高+幅度
  assert.equal(second.bid.amount, 1100);

  expectError(() => placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 5000 }, T0 + 600_000), "lot_ended");
});

test("出价：失败写入不留半笔记录", () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  expectError(() => placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1 }, T0), "bid_too_low");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bids WHERE lot_id = ?").get(lot.id).n, 0);
  assert.equal(db.prepare("SELECT extended_count FROM lots WHERE id = ?").get(lot.id).extended_count, 0);
});

/* ================= 两分钟自动顺延 ================= */

test("顺延：剩余 >2 分钟不顺延（边界 120001ms）", () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  const endsAt = lot.ends_at;
  const now = endsAt - EXTENSION_MS - 1; // 剩余 120001ms
  const result = placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, now);
  assert.equal(result.extended, false);
  assert.equal(db.prepare("SELECT ends_at FROM lots WHERE id = ?").get(lot.id).ends_at, endsAt);
});

test("顺延：剩余 ≤2 分钟顺延到出价时刻 +2 分钟（边界 120000ms）", () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  const now = lot.ends_at - EXTENSION_MS; // 剩余恰好 120000ms
  const result = placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, now);
  assert.equal(result.extended, true);
  assert.equal(result.endsAt, now + EXTENSION_MS);
  const fresh = db.prepare("SELECT * FROM lots WHERE id = ?").get(lot.id);
  assert.equal(fresh.ends_at, now + EXTENSION_MS);
  assert.equal(fresh.extended_count, 1);
  // 顺延后的窗口内仍可出价，且再次触发顺延
  const again = placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1100 }, now + 60_000);
  assert.equal(again.extended, true);
  assert.equal(again.endsAt, now + 60_000 + EXTENSION_MS);
});

/* ================= 截拍 ================= */

test("截拍：未到点拒绝；无出价流拍；有出价唯一最高价成交；重复截拍幂等", () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  const lot2 = listLot(db, { sessionId: session.id, ringNo: "CHN-2022-188", consignor: "育种棚", startPrice: 500 }, T0);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  registerBuyer(db, { sessionId: session.id, name: "李四", deposit: 2000 }, T0);
  placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, T0);
  placeBid(db, { lotId: lot.id, buyerName: "李四", amount: 1500 }, T0 + 1);

  expectError(() => closeLot(db, lot.id, T0 + 599_999), "close_not_due");

  const closed = closeLot(db, lot.id, T0 + 600_000);
  assert.equal(closed.lot.status, "sold");
  assert.equal(closed.lot.hammer_price, 1500, "只确定一个最高价");

  const closedUnsold = closeLot(db, lot2.id, T0 + 600_000);
  assert.equal(closedUnsold.lot.status, "unsold", "无出价应流拍");

  const again = closeLot(db, lot.id, T0 + 700_000);
  assert.equal(again.changed, false);
  assert.equal(again.lot.hammer_price, 1500, "重复截拍结果不变");
});

test("截拍：并发截拍只产生一个成交价（HTTP 级）", async () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1200 }, T0);

  // 用注入时钟的 app：所有请求看到的 now 都已过截拍点
  const server = createApp(db, () => T0 + 600_000);
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      fetch(`${base}/api/auction/lots/${lot.id}/close`, { method: "POST" }).then(r => r.json())
    ));
    const hammers = new Set(results.map(r => r.lot.hammer_price));
    assert.deepEqual([...hammers], [1200], "并发截拍必须得到同一个最高价");
    assert.equal(results.filter(r => r.changed).length, 1, "只有一次真正执行了截拍");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lots WHERE id = ? AND status = 'sold'").get(lot.id).n, 1);
  } finally {
    server.close();
  }
});

test("出价：并发同价出价只有一笔成功（HTTP 级）", async () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  registerBuyer(db, { sessionId: session.id, name: "李四", deposit: 2000 }, T0);
  const server = createApp(db, () => T0 + 1000);
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const results = await Promise.all(["张三", "李四", "张三", "李四"].map(name =>
      fetch(`${base}/api/auction/lots/${lot.id}/bids`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buyerName: name, amount: 1000 })
      }).then(r => r.status)
    ));
    assert.equal(results.filter(s => s === 201).length, 1, "同价并发出价只能成交一笔");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bids WHERE lot_id = ?").get(lot.id).n, 1);
  } finally {
    server.close();
  }
});

/* ================= 结算 ================= */

test("结算：成交 -> 佣金/卖方所得/成交款/保证金冲抵；流拍 -> 退还；所有权转移", () => {
  const db = freshDb();
  const { session, lot } = setupLive(db, { commissionRate: 0.05 });
  const lot2 = listLot(db, { sessionId: session.id, ringNo: "CHN-2022-188", consignor: "育种棚", startPrice: 500 }, T0);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  registerBuyer(db, { sessionId: session.id, name: "李四", deposit: 3000 }, T0);
  placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, T0);
  placeBid(db, { lotId: lot.id, buyerName: "李四", amount: 2000 }, T0 + 1);

  const view = settleSession(db, session.id, T0 + 600_000); // 未截拍的到点拍品自动截拍后结算
  const ledger = view.ledger;
  const byKind = (kind, party) => ledger.find(e => e.kind === kind && e.party === party);

  assert.equal(view.lots.find(l => l.id === lot.id).status, "sold");
  assert.equal(view.lots.find(l => l.id === lot2.id).status, "unsold");

  assert.equal(byKind("hammer_charge", "李四").amount, -2000, "买受人应付成交款");
  assert.equal(byKind("commission", "平台").amount, 100, "佣金 = 2000 * 5%");
  assert.equal(byKind("sale_proceeds", "北岸棚").amount, 1900, "卖方所得 = 成交价 - 佣金");
  assert.equal(byKind("deposit_applied", "李四").amount, 3000, "成交者保证金冲抵货款");
  assert.equal(byKind("deposit_refund", "张三").amount, 2000, "未成交者保证金退还");
  assert.equal(ledger.filter(e => e.kind === "commission").length, 1, "流拍不收佣金");

  const pigeon = getPigeon(db, "CHN-2026-001");
  assert.equal(pigeon.owner, "李四", "成交后鸽只所有权转移给买受人");
  assert.ok(pigeon.transfers.some(t => t.to === "李四" && t.from === "北岸棚"));
});

test("结算：重复执行不重复扣款；并发结算结果一致（HTTP 级）", async () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  registerBuyer(db, { sessionId: session.id, name: "李四", deposit: 2000 }, T0);
  placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, T0);
  placeBid(db, { lotId: lot.id, buyerName: "李四", amount: 1500 }, T0 + 1);
  closeLot(db, lot.id, T0 + 600_000);

  const server = createApp(db, () => T0 + 600_000);
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await Promise.all(Array.from({ length: 6 }, () =>
      fetch(`${base}/api/auction/sessions/${session.id}/settle`, { method: "POST" })));
    const again = await fetch(`${base}/api/auction/sessions/${session.id}/settle`, { method: "POST" }).then(r => r.json());
    const ledger = db.prepare("SELECT * FROM ledger WHERE session_id = ?").all(session.id);
    const count = kind => ledger.filter(e => e.kind === kind).length;
    assert.equal(count("commission"), 1, "佣金只扣一次");
    assert.equal(count("hammer_charge"), 1, "成交款只记一次");
    assert.equal(count("sale_proceeds"), 1, "卖方所得只记一次");
    assert.equal(count("deposit_applied"), 1, "保证金冲抵只一次");
    assert.equal(count("deposit_refund"), 1, "保证金退还只一次");
    assert.equal(count("deposit_paid"), 2, "两笔保证金缴纳");
    assert.equal(again.ledger.length, ledger.length, "重复结算返回同一账本");
    const commissionTotal = ledger.filter(e => e.kind === "commission").reduce((s, e) => s + e.amount, 0);
    assert.equal(commissionTotal, 75, "佣金总额 = 1500 * 5%");
  } finally {
    server.close();
  }
});

test("结算：有拍品未到截拍时间 -> 整体拒绝且不留半笔流水", () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, T0);
  expectError(() => settleSession(db, session.id, T0 + 599_999), "lots_still_open");
  const kinds = db.prepare("SELECT kind FROM ledger WHERE session_id = ?").all(session.id).map(e => e.kind);
  assert.deepEqual(kinds, ["deposit_paid"], "回滚后只剩保证金缴纳记录");
  assert.equal(db.prepare("SELECT status FROM lots WHERE id = ?").get(lot.id).status, "open");
});

/* ================= 场次状态与截拍反馈（顺延场景） ================= */

test("场次状态：顺延的拍品决定场次是否结束", () => {
  const db = freshDb();
  const { session, lot } = setupLive(db); // 场次 T0 ~ T0+600_000
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  // 截拍前 30 秒出价 -> 顺延到 T0+600_000-30_000+120_000 = T0+690_000
  placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, T0 + 570_000);

  const duringExtension = T0 + 600_001; // 原截拍时间已过，顺延窗口内
  assert.equal(listSessions(db, duringExtension)[0].phase, "live", "场次列表应显示进行中");
  assert.equal(getSessionView(db, session.id, duringExtension).phase, "live", "场次详情应显示进行中");
  assert.equal(getSessionView(db, session.id, duringExtension).lots[0].biddable, true, "顺延窗口内仍可出价");

  const afterExtension = T0 + 690_001; // 顺延后的截拍时间也过了
  assert.equal(listSessions(db, afterExtension)[0].phase, "ended");
  assert.equal(getSessionView(db, session.id, afterExtension).phase, "ended");
});

test("截拍：部分到点 -> 到点的截拍、未到点的明确反馈（HTTP 409）", async () => {
  const db = freshDb();
  const { session, lot } = setupLive(db);
  const lot2 = listLot(db, { sessionId: session.id, ringNo: "CHN-2022-188", consignor: "育种棚", startPrice: 500 }, T0);
  registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
  placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, T0 + 570_000); // lot1 顺延到 T0+690_000，lot2 仍是 T0+600_000

  const server = createApp(db, () => T0 + 600_001); // lot2 到点，lot1 未到点
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/auction/sessions/${session.id}/close`, { method: "POST" });
    assert.equal(res.status, 409, "有未到点拍品时不能返回成功");
    const body = await res.json();
    assert.equal(body.error, "lots_not_due");
    assert.ok(body.message.includes("CHN-2026-001"), "提示要指明未到点拍品");
    assert.equal(body.details.pending.length, 1);
    assert.equal(body.details.pending[0].ringNo, "CHN-2026-001");
    assert.equal(body.details.closed.length, 1, "到点的 lot2 应被截拍");
    assert.equal(body.details.closed[0].status, "unsold");
    assert.equal(db.prepare("SELECT status FROM lots WHERE id = ?").get(lot2.id).status, "unsold");
    assert.equal(db.prepare("SELECT status FROM lots WHERE id = ?").get(lot.id).status, "open", "未到点的 lot1 仍是竞价中");
  } finally {
    server.close();
  }

  // 全部到点后 -> 成功并带截拍明细
  const server2 = createApp(db, () => T0 + 690_001);
  await new Promise(resolve => server2.listen(0, resolve));
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  try {
    const res = await fetch(`${base2}/api/auction/sessions/${session.id}/close`, { method: "POST" });
    assert.equal(res.status, 200);
    const view = await res.json();
    assert.equal(view.closeSummary.closed.length, 1);
    assert.equal(view.closeSummary.closed[0].status, "sold");
    assert.equal(view.closeSummary.closed[0].hammerPrice, 1000);
    assert.equal(view.closeSummary.closed[0].winner, "张三");
    assert.equal(view.closeSummary.alreadyClosed.length, 1, "lot2 此前已截拍");
    assert.equal(view.lots.every(l => l.status !== "open"), true);
  } finally {
    server2.close();
  }
});

/* ================= 时区 ================= */

test("时区：截拍提示按北京时间（UTC+8）呈现，与服务进程时区无关", () => {
  const db = freshDb();
  const { lot } = setupLive(db);
  const endsAt = T0 + 600_000;
  const expected = fmtCn(endsAt);

  const err = expectError(() => closeLot(db, lot.id, T0 + 599_999), "close_not_due");
  assert.ok(err.message.includes(expected), `提示应包含北京时间 ${expected}，实际：${err.message}`);
  assert.ok(err.message.includes("UTC+8"), "提示应说明时区含义");

  // 已知时刻校验：UTC 2027-01-15 16:00:00 即北京时间 2027-01-16 00:00:00
  assert.equal(fmtCn(Date.UTC(2027, 0, 15, 16, 0, 0)), "2027-01-16 00:00:00");

  // 切换进程时区后，同一截拍时刻的提示时间不变
  const oldTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    assert.equal(fmtCn(endsAt), expected, "进程时区不影响格式化结果");
    const err2 = expectError(() => closeLot(db, lot.id, T0 + 599_999), "close_not_due");
    assert.ok(err2.message.includes(expected), "美东时区下提示仍是同一北京时间");
  } finally {
    process.env.TZ = oldTz;
  }
});

/* ================= 持久化 ================= */

test("持久化：关闭重开数据库后拍卖数据仍可查询", () => {
  const file = join(tmpdir(), `auction-persist-${process.pid}.db`);
  rmSync(file, { force: true });
  try {
    let db = openDb(file);
    const { session, lot } = setupLive(db);
    registerBuyer(db, { sessionId: session.id, name: "张三", deposit: 2000 }, T0);
    placeBid(db, { lotId: lot.id, buyerName: "张三", amount: 1000 }, T0);
    closeLot(db, lot.id, T0 + 600_000);
    settleSession(db, session.id, T0 + 600_000);
    db.close();

    db = openDb(file); // 模拟重启
    const view = getSessionView(db, session.id, T0 + 700_000);
    assert.equal(view.lots[0].status, "sold");
    assert.equal(view.lots[0].hammerPrice, 1000);
    assert.equal(view.lots[0].settleStatus, "settled");
    assert.ok(view.ledger.some(e => e.kind === "commission"));
    assert.equal(listSessions(db, T0 + 700_000)[0].soldLots, 1);
    db.close();
  } finally {
    rmSync(file, { force: true });
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
  }
});
