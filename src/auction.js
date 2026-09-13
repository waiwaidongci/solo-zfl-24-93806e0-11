/**
 * 拍卖核心业务逻辑。
 * 所有写操作都包在 better-sqlite3 的 IMMEDIATE 事务里：
 * 单条规则校验失败 -> 抛错 -> 整体回滚，不会留下半笔记录。
 * now 以毫秒时间戳注入，HTTP 层传 Date.now()，测试传合成时间。
 */

export const EXTENSION_MS = 2 * 60 * 1000; // 截拍前两分钟内出价自动顺延 2 分钟

export class AuctionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function assertInt(value, code, message) {
  if (!Number.isInteger(value)) throw new AuctionError(code, message, 400);
}

const getSessionStmt = (db) => db.prepare("SELECT * FROM sessions WHERE id = ?");
const getLotStmt = (db) => db.prepare("SELECT * FROM lots WHERE id = ?");

export function getSession(db, sessionId) {
  const session = getSessionStmt(db).get(sessionId);
  if (!session) throw new AuctionError("session_not_found", "场次不存在", 404);
  return session;
}

export function getLot(db, lotId) {
  const lot = getLotStmt(db).get(lotId);
  if (!lot) throw new AuctionError("lot_not_found", "拍品不存在", 404);
  return lot;
}

/* ---------------- 建场次 ---------------- */

export const createSession = (db, input, now) => {
  const { name, startAt, endAt, increment, commissionRate = 0.05 } = input;
  if (!name || !String(name).trim()) throw new AuctionError("name_required", "场次名称不能为空");
  assertInt(startAt, "invalid_time", "开拍时间无效");
  assertInt(endAt, "invalid_time", "截拍时间无效");
  if (endAt <= startAt) throw new AuctionError("invalid_time_range", "截拍时间必须晚于开拍时间", 400);
  assertInt(increment, "invalid_increment", "加价幅度必须是正整数");
  if (increment <= 0) throw new AuctionError("invalid_increment", "加价幅度必须大于 0", 400);
  if (!(commissionRate >= 0 && commissionRate < 1)) throw new AuctionError("invalid_commission", "佣金比例必须在 [0,1) 之间", 400);

  const tx = db.transaction(() =>
    db.prepare("INSERT INTO sessions (name, start_at, end_at, increment, commission_rate, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(String(name).trim(), startAt, endAt, increment, commissionRate, now)
  );
  const result = tx.immediate();
  return getSession(db, result.lastInsertRowid);
};

/* ---------------- 上架拍品 ---------------- */

export const listLot = (db, input, now) => {
  const { sessionId, ringNo, consignor, startPrice } = input;
  assertInt(startPrice, "invalid_start_price", "起拍价必须是正整数");
  if (startPrice <= 0) throw new AuctionError("invalid_start_price", "起拍价必须大于 0", 400);
  if (!consignor || !String(consignor).trim()) throw new AuctionError("consignor_required", "送拍人不能为空");

  const tx = db.transaction(() => {
    const session = getSession(db, sessionId);
    if (now >= session.end_at) throw new AuctionError("session_ended", "场次已截拍，不能上架", 409);
    const pigeon = db.prepare("SELECT * FROM pigeons WHERE ring_no = ?").get(ringNo);
    if (!pigeon) throw new AuctionError("pigeon_not_registered", "只能上架已登记鸽只", 404);
    if (pigeon.owner !== String(consignor).trim()) {
      throw new AuctionError("consignor_not_owner", `送拍人须与当前鸽主一致（当前鸽主：${pigeon.owner}）`, 403);
    }
    try {
      const result = db.prepare(`INSERT INTO lots (session_id, ring_no, consignor, start_price, ends_at)
                                 VALUES (?, ?, ?, ?, ?)`)
        .run(sessionId, ringNo, String(consignor).trim(), startPrice, session.end_at);
      return result.lastInsertRowid;
    } catch (error) {
      if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
        throw new AuctionError("already_listed", "该鸽只已在本场次上架", 409);
      }
      throw error;
    }
  });
  const lotId = tx.immediate();
  return getLot(db, lotId);
};

/* ---------------- 买家登记 + 缴保证金 ---------------- */

export const registerBuyer = (db, input, now) => {
  const { sessionId, name, deposit } = input;
  if (!name || !String(name).trim()) throw new AuctionError("name_required", "买家姓名不能为空");
  assertInt(deposit, "invalid_deposit", "保证金必须是正整数");
  if (deposit <= 0) throw new AuctionError("invalid_deposit", "必须先缴纳保证金才能出价", 400);

  const buyerName = String(name).trim();
  const tx = db.transaction(() => {
    getSession(db, sessionId);
    const existing = db.prepare("SELECT * FROM buyers WHERE session_id = ? AND name = ?").get(sessionId, buyerName);
    if (existing) return { buyer: existing, duplicated: true }; // 重复登记幂等返回，不重复收款
    const result = db.prepare("INSERT INTO buyers (session_id, name, deposit, deposit_paid_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, buyerName, deposit, now);
    const buyer = db.prepare("SELECT * FROM buyers WHERE id = ?").get(result.lastInsertRowid);
    db.prepare(`INSERT INTO ledger (entry_key, session_id, buyer_id, party, kind, amount, created_at)
                VALUES (?, ?, ?, ?, 'deposit_paid', ?, ?)`)
      .run(`deposit:buyer:${buyer.id}`, sessionId, buyer.id, buyerName, -deposit, now);
    return { buyer, duplicated: false };
  });
  return tx.immediate();
};

/* ---------------- 出价（含两分钟自动顺延） ---------------- */

export const placeBid = (db, input, now) => {
  const { lotId, buyerName, amount } = input;
  assertInt(amount, "invalid_amount", "出价必须是正整数（单位：元）");
  if (amount <= 0) throw new AuctionError("invalid_amount", "出价必须大于 0", 400);
  if (!buyerName || !String(buyerName).trim()) throw new AuctionError("buyer_required", "请先登记买家", 400);

  const tx = db.transaction(() => {
    const lot = getLot(db, lotId);
    if (lot.status !== "open") throw new AuctionError("lot_closed", "该拍品已截拍", 409);
    const session = getSession(db, lot.session_id);
    if (now < session.start_at) throw new AuctionError("session_not_started", "场次尚未开拍", 409);
    if (now >= lot.ends_at) throw new AuctionError("lot_ended", "该拍品已过截拍时间", 409);

    const buyer = db.prepare("SELECT * FROM buyers WHERE session_id = ? AND name = ?")
      .get(lot.session_id, String(buyerName).trim());
    if (!buyer) throw new AuctionError("buyer_not_registered", "买家未登记或未缴保证金，不能出价", 403);
    if (buyer.name === lot.consignor) throw new AuctionError("self_bid", "卖家不能对自己的拍品出价", 403);

    const top = db.prepare("SELECT amount FROM bids WHERE lot_id = ? ORDER BY amount DESC, id ASC LIMIT 1").get(lotId);
    const minNext = top ? top.amount + session.increment : lot.start_price;
    if (amount < minNext) {
      throw new AuctionError("bid_too_low", `出价不得低于 ${minNext} 元（${top ? "当前最高价 + 加价幅度" : "起拍价"}）`, 400);
    }

    const result = db.prepare("INSERT INTO bids (lot_id, buyer_id, amount, created_at) VALUES (?, ?, ?, ?)")
      .run(lotId, buyer.id, amount, now);

    // 截拍前两分钟内出价 -> 自动顺延到出价时刻 + 2 分钟
    let extended = false;
    if (lot.ends_at - now <= EXTENSION_MS) {
      db.prepare("UPDATE lots SET ends_at = ?, extended_count = extended_count + 1 WHERE id = ?")
        .run(now + EXTENSION_MS, lotId);
      extended = true;
    }
    const bid = db.prepare("SELECT * FROM bids WHERE id = ?").get(result.lastInsertRowid);
    return { bid, extended, endsAt: extended ? now + EXTENSION_MS : lot.ends_at };
  });
  return tx.immediate();
};

/* ---------------- 截拍（幂等，只确定一个最高价） ---------------- */

function closeLotInTx(db, lot, now) {
  if (lot.status !== "open") return { lot, changed: false }; // 已截拍 -> 幂等返回
  if (now < lot.ends_at) throw new AuctionError("close_not_due", `未到截拍时间（${new Date(lot.ends_at).toISOString()}）`, 409);
  const winning = db.prepare(`SELECT b.*, u.name AS buyer_name FROM bids b
                              JOIN buyers u ON u.id = b.buyer_id
                              WHERE b.lot_id = ? ORDER BY b.amount DESC, b.id ASC LIMIT 1`).get(lot.id);
  if (winning) {
    db.prepare(`UPDATE lots SET status = 'sold', hammer_price = ?, winner_buyer_id = ?, closed_at = ? WHERE id = ?`)
      .run(winning.amount, winning.buyer_id, now, lot.id);
  } else {
    db.prepare(`UPDATE lots SET status = 'unsold', closed_at = ? WHERE id = ?`).run(now, lot.id);
  }
  return { lot: getLot(db, lot.id), changed: true };
}

export const closeLot = (db, lotId, now) => {
  const tx = db.transaction(() => closeLotInTx(db, getLot(db, lotId), now));
  return tx.immediate();
};

export const closeSession = (db, sessionId, now) => {
  const tx = db.transaction(() => {
    getSession(db, sessionId);
    const lots = db.prepare("SELECT * FROM lots WHERE session_id = ? ORDER BY id").all(sessionId);
    const results = [];
    for (const lot of lots) {
      if (lot.status !== "open") { results.push({ lot, changed: false }); continue; }
      if (now < lot.ends_at) { results.push({ lot, changed: false, pending: true }); continue; }
      results.push(closeLotInTx(db, lot, now));
    }
    return results;
  });
  tx.immediate();
  return getSessionView(db, sessionId, now);
};

/* ---------------- 结算（佣金 + 保证金，幂等不重复扣款） ---------------- */

function ledgerExists(db, key) {
  return !!db.prepare("SELECT 1 FROM ledger WHERE entry_key = ?").get(key);
}

function addLedger(db, { key, sessionId, lotId = null, buyerId = null, party, kind, amount }, now) {
  db.prepare(`INSERT INTO ledger (entry_key, session_id, lot_id, buyer_id, party, kind, amount, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key, sessionId, lotId, buyerId, party, kind, amount, now);
}

export const settleSession = (db, sessionId, now) => {
  const tx = db.transaction(() => {
    const session = getSession(db, sessionId);
    const lots = db.prepare("SELECT * FROM lots WHERE session_id = ? ORDER BY id").all(sessionId);

    // 截拍是结算前提：到点的自动截拍，没到点的拒绝整体结算（回滚，不留半笔）
    for (const lot of lots) {
      if (lot.status === "open") {
        if (now >= lot.ends_at) closeLotInTx(db, lot, now);
        else throw new AuctionError("lots_still_open", `拍品 ${lot.ring_no} 尚未到截拍时间，不能结算`, 409);
      }
    }

    const freshLots = db.prepare("SELECT * FROM lots WHERE session_id = ? ORDER BY id").all(sessionId);
    for (const lot of freshLots) {
      if (lot.settle_status === "settled") continue; // 幂等：已结算的拍品跳过
      if (lot.status === "sold") {
        const winner = db.prepare("SELECT * FROM buyers WHERE id = ?").get(lot.winner_buyer_id);
        const commission = Math.round(lot.hammer_price * session.commission_rate);
        addLedger(db, { key: `hammer:lot:${lot.id}`, sessionId, lotId: lot.id, buyerId: winner.id, party: winner.name, kind: "hammer_charge", amount: -lot.hammer_price }, now);
        addLedger(db, { key: `commission:lot:${lot.id}`, sessionId, lotId: lot.id, party: "平台", kind: "commission", amount: commission }, now);
        addLedger(db, { key: `proceeds:lot:${lot.id}`, sessionId, lotId: lot.id, party: lot.consignor, kind: "sale_proceeds", amount: lot.hammer_price - commission }, now);

        // 成交后鸽只所有权转移给买受人（与结算同事务，只做一次）
        const pigeon = db.prepare("SELECT * FROM pigeons WHERE ring_no = ?").get(lot.ring_no);
        const transfers = JSON.parse(pigeon.transfers);
        transfers.push({ date: new Date(now).toISOString().slice(0, 10), from: lot.consignor, to: winner.name, note: `拍卖成交（场次 ${session.name}，成交价 ${lot.hammer_price}）` });
        db.prepare("UPDATE pigeons SET owner = ?, transfers = ? WHERE ring_no = ?")
          .run(winner.name, JSON.stringify(transfers), lot.ring_no);
      }
      db.prepare("UPDATE lots SET settle_status = 'settled', settled_at = ? WHERE id = ?").run(now, lot.id);
    }

    // 保证金结算：成交者冲抵货款，未成交者退还。entry_key 唯一，重复执行不会重复扣款
    const buyers = db.prepare("SELECT * FROM buyers WHERE session_id = ? ORDER BY id").all(sessionId);
    for (const buyer of buyers) {
      const key = `depsettle:buyer:${buyer.id}`;
      if (ledgerExists(db, key)) continue;
      const won = db.prepare("SELECT 1 FROM lots WHERE session_id = ? AND winner_buyer_id = ? LIMIT 1").get(sessionId, buyer.id);
      addLedger(db, {
        key, sessionId, buyerId: buyer.id, party: buyer.name,
        kind: won ? "deposit_applied" : "deposit_refund",
        amount: buyer.deposit
      }, now);
    }
    return { settled: true };
  });
  tx.immediate();
  return getSessionView(db, sessionId, now);
};

/* ---------------- 查询视图 ---------------- */

export function sessionPhase(session, now) {
  if (now < session.start_at) return "scheduled";
  if (now < session.end_at) return "live";
  return "ended";
}

export function lotView(db, lot, now) {
  const bids = db.prepare(`SELECT b.id, b.amount, b.created_at, u.name AS buyer
                           FROM bids b JOIN buyers u ON u.id = b.buyer_id
                           WHERE b.lot_id = ? ORDER BY b.amount DESC, b.id ASC`).all(lot.id);
  const session = getSessionStmt(db).get(lot.session_id);
  const top = bids[0] || null;
  const winner = lot.winner_buyer_id
    ? db.prepare("SELECT name FROM buyers WHERE id = ?").get(lot.winner_buyer_id)?.name
    : null;
  return {
    id: lot.id,
    sessionId: lot.session_id,
    ringNo: lot.ring_no,
    consignor: lot.consignor,
    startPrice: lot.start_price,
    status: lot.status,
    endsAt: lot.ends_at,
    extendedCount: lot.extended_count,
    hammerPrice: lot.hammer_price,
    winner,
    closedAt: lot.closed_at,
    settleStatus: lot.settle_status,
    settledAt: lot.settled_at,
    currentPrice: top ? top.amount : null,
    bidCount: bids.length,
    minNextBid: lot.status === "open" ? (top ? top.amount + session.increment : lot.start_price) : null,
    biddable: lot.status === "open" && now >= session.start_at && now < lot.ends_at,
    bids
  };
}

export function getSessionView(db, sessionId, now) {
  const session = getSession(db, sessionId);
  const lots = db.prepare("SELECT * FROM lots WHERE session_id = ? ORDER BY id").all(sessionId)
    .map(lot => lotView(db, lot, now));
  const buyers = db.prepare("SELECT * FROM buyers WHERE session_id = ? ORDER BY id").all(sessionId)
    .map(b => ({ id: b.id, name: b.name, deposit: b.deposit, depositPaidAt: b.deposit_paid_at }));
  const ledger = db.prepare("SELECT * FROM ledger WHERE session_id = ? ORDER BY id").all(sessionId)
    .map(e => ({ id: e.id, key: e.entry_key, lotId: e.lot_id, party: e.party, kind: e.kind, amount: e.amount, createdAt: e.created_at }));
  return {
    id: session.id,
    name: session.name,
    startAt: session.start_at,
    endAt: session.end_at,
    increment: session.increment,
    commissionRate: session.commission_rate,
    phase: sessionPhase(session, now),
    lots,
    buyers,
    ledger
  };
}

export function listSessions(db, now) {
  return db.prepare("SELECT * FROM sessions ORDER BY id DESC").all().map(session => {
    const lots = db.prepare("SELECT status, COUNT(*) AS n FROM lots WHERE session_id = ? GROUP BY status").all(session.id);
    const buyers = db.prepare("SELECT COUNT(*) AS n FROM buyers WHERE session_id = ?").get(session.id).n;
    return {
      id: session.id,
      name: session.name,
      startAt: session.start_at,
      endAt: session.end_at,
      increment: session.increment,
      commissionRate: session.commission_rate,
      phase: sessionPhase(session, now),
      lotCount: lots.reduce((sum, row) => sum + row.n, 0),
      openLots: lots.find(row => row.status === "open")?.n || 0,
      soldLots: lots.find(row => row.status === "sold")?.n || 0,
      unsoldLots: lots.find(row => row.status === "unsold")?.n || 0,
      buyerCount: buyers
    };
  });
}
