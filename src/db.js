import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const seed = {
  pigeons: [
    { ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚", vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ]
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pigeons (
  ring_no     TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  father_ring TEXT NOT NULL DEFAULT '',
  mother_ring TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '',
  loft        TEXT NOT NULL DEFAULT '',
  vaccines    TEXT NOT NULL DEFAULT '[]',
  transfers   TEXT NOT NULL DEFAULT '[]',
  races       TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  start_at        INTEGER NOT NULL,
  end_at          INTEGER NOT NULL,
  increment       INTEGER NOT NULL CHECK (increment > 0),
  commission_rate REAL NOT NULL DEFAULT 0.05 CHECK (commission_rate >= 0 AND commission_rate < 1),
  created_at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES sessions(id),
  ring_no         TEXT NOT NULL REFERENCES pigeons(ring_no),
  consignor       TEXT NOT NULL,
  start_price     INTEGER NOT NULL CHECK (start_price > 0),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sold','unsold')),
  ends_at         INTEGER NOT NULL,
  extended_count  INTEGER NOT NULL DEFAULT 0,
  hammer_price    INTEGER,
  winner_buyer_id INTEGER,
  closed_at       INTEGER,
  settle_status   TEXT NOT NULL DEFAULT 'none' CHECK (settle_status IN ('none','settled')),
  settled_at      INTEGER,
  UNIQUE (session_id, ring_no)
);
CREATE TABLE IF NOT EXISTS buyers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES sessions(id),
  name            TEXT NOT NULL,
  deposit         INTEGER NOT NULL CHECK (deposit > 0),
  deposit_paid_at INTEGER NOT NULL,
  UNIQUE (session_id, name)
);
CREATE TABLE IF NOT EXISTS bids (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id     INTEGER NOT NULL REFERENCES lots(id),
  buyer_id   INTEGER NOT NULL REFERENCES buyers(id),
  amount     INTEGER NOT NULL CHECK (amount > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bids_lot ON bids(lot_id, amount DESC, id ASC);
-- 资金流水：entry_key 唯一约束是结算幂等的最后防线，重复结算只会撞上已存在的键
CREATE TABLE IF NOT EXISTS ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_key  TEXT NOT NULL UNIQUE,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  lot_id     INTEGER,
  buyer_id   INTEGER,
  party      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_session ON ledger(session_id);
`;

function rowToPigeon(row) {
  return {
    ringNo: row.ring_no,
    owner: row.owner,
    fatherRing: row.father_ring,
    motherRing: row.mother_ring,
    color: row.color,
    loft: row.loft,
    vaccines: JSON.parse(row.vaccines),
    transfers: JSON.parse(row.transfers),
    races: JSON.parse(row.races)
  };
}

export function openDb(dbFile = join(rootDir, "data", "auction.db")) {
  if (dbFile !== ":memory:") mkdirSync(dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  migratePigeons(db);
  return db;
}

function migratePigeons(db) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM pigeons").get().n;
  if (count > 0) return;
  const jsonPath = join(rootDir, "data", "pigeons.json");
  let source = seed;
  if (existsSync(jsonPath)) {
    try {
      source = JSON.parse(readFileSync(jsonPath, "utf8"));
    } catch {
      source = seed;
    }
  }
  const insert = db.prepare(`INSERT OR IGNORE INTO pigeons
    (ring_no, owner, father_ring, mother_ring, color, loft, vaccines, transfers, races)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = db.transaction((pigeons) => {
    for (const p of pigeons) {
      insert.run(p.ringNo, p.owner, p.fatherRing || "", p.motherRing || "", p.color || "", p.loft || "",
        JSON.stringify(p.vaccines || []), JSON.stringify(p.transfers || []), JSON.stringify(p.races || []));
    }
  });
  tx(source.pigeons || []);
}

/* ---------- 鸽只登记（沿用原接口语义） ---------- */

export function listPigeons(db) {
  return db.prepare("SELECT * FROM pigeons ORDER BY rowid DESC").all().map(rowToPigeon);
}

export function getPigeon(db, ringNo) {
  const row = db.prepare("SELECT * FROM pigeons WHERE ring_no = ?").get(ringNo);
  return row ? rowToPigeon(row) : null;
}

export function createPigeon(db, input) {
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO pigeons (ring_no, owner, father_ring, mother_ring, color, loft, vaccines, transfers, races)
                VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', '[]')`)
      .run(input.ringNo, input.owner, input.fatherRing || "", input.motherRing || "", input.color || "", input.loft || "");
  });
  tx();
  return getPigeon(db, input.ringNo);
}

export function pigeonRelation(db, ringNo) {
  const pigeon = getPigeon(db, ringNo);
  if (!pigeon) return null;
  const father = pigeon.fatherRing ? getPigeon(db, pigeon.fatherRing) : null;
  const mother = pigeon.motherRing ? getPigeon(db, pigeon.motherRing) : null;
  const children = listPigeons(db).filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return { pigeon, father, mother, children };
}

export function addPigeonRecord(db, ringNo, kind, input, today) {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT * FROM pigeons WHERE ring_no = ?").get(ringNo);
    if (!row) return null;
    const pigeon = rowToPigeon(row);
    if (kind === "transfers") {
      const transfer = { date: input.date || today, from: pigeon.owner, to: input.to };
      pigeon.owner = input.to;
      pigeon.transfers.push(transfer);
      db.prepare("UPDATE pigeons SET owner = ?, transfers = ? WHERE ring_no = ?")
        .run(pigeon.owner, JSON.stringify(pigeon.transfers), ringNo);
    }
    if (kind === "races") {
      pigeon.races.push({ date: input.date || today, event: input.event, distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0) });
      db.prepare("UPDATE pigeons SET races = ? WHERE ring_no = ?").run(JSON.stringify(pigeon.races), ringNo);
    }
    if (kind === "vaccines") {
      pigeon.vaccines.push({ date: input.date || today, name: input.name });
      db.prepare("UPDATE pigeons SET vaccines = ? WHERE ring_no = ?").run(JSON.stringify(pigeon.vaccines), ringNo);
    }
    return pigeon;
  });
  return tx();
}
