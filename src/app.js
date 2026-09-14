import http from "node:http";
import {
  listPigeons, createPigeon, getPigeon, pigeonRelation, addPigeonRecord
} from "./db.js";
import {
  AuctionError, createSession, listLot, registerBuyer, placeBid,
  closeLot, closeSession, settleSession, getSessionView, listSessions
} from "./auction.js";
import { page } from "./page.js";

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export function createApp(db, now = () => Date.now()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      const today = () => new Date(now()).toISOString().slice(0, 10);

      if (req.method === "GET" && path === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(page);
      }

      /* ---------- 鸽只登记（原有功能） ---------- */
      if (req.method === "GET" && path === "/api/pigeons") return sendJson(res, 200, listPigeons(db));
      if (req.method === "POST" && path === "/api/pigeons") {
        const input = await body(req);
        if (!input.ringNo || !input.owner) return sendJson(res, 400, { error: "ring_and_owner_required" });
        if (getPigeon(db, input.ringNo)) return sendJson(res, 409, { error: "ring_exists" });
        return sendJson(res, 201, createPigeon(db, input));
      }
      const relationMatch = path.match(/^\/api\/pigeons\/(.+)\/relation$/);
      if (relationMatch && req.method === "GET") {
        const data = pigeonRelation(db, decodeURIComponent(relationMatch[1]));
        return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
      }
      const actionMatch = path.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
      if (actionMatch && req.method === "POST") {
        const pigeon = addPigeonRecord(db, decodeURIComponent(actionMatch[1]), actionMatch[2], await body(req), today());
        return pigeon ? sendJson(res, 200, pigeon) : sendJson(res, 404, { error: "pigeon_not_found" });
      }

      /* ---------- 在线拍卖 ---------- */
      if (req.method === "GET" && path === "/api/auction/sessions") {
        return sendJson(res, 200, listSessions(db, now()));
      }
      if (req.method === "POST" && path === "/api/auction/sessions") {
        const input = await body(req);
        return sendJson(res, 201, createSession(db, input, now()));
      }
      const sessionMatch = path.match(/^\/api\/auction\/sessions\/(\d+)$/);
      if (sessionMatch && req.method === "GET") {
        return sendJson(res, 200, getSessionView(db, Number(sessionMatch[1]), now()));
      }
      const sessionAction = path.match(/^\/api\/auction\/sessions\/(\d+)\/(lots|buyers|close|settle)$/);
      if (sessionAction && req.method === "POST") {
        const sessionId = Number(sessionAction[1]);
        const action = sessionAction[2];
        if (action === "lots") return sendJson(res, 201, listLot(db, { ...(await body(req)), sessionId }, now()));
        if (action === "buyers") return sendJson(res, 201, registerBuyer(db, { ...(await body(req)), sessionId }, now()));
        if (action === "close") return sendJson(res, 200, closeSession(db, sessionId, now()));
        if (action === "settle") return sendJson(res, 200, settleSession(db, sessionId, now()));
      }
      const lotAction = path.match(/^\/api\/auction\/lots\/(\d+)\/(bids|close)$/);
      if (lotAction && req.method === "POST") {
        const lotId = Number(lotAction[1]);
        if (lotAction[2] === "bids") return sendJson(res, 201, placeBid(db, { ...(await body(req)), lotId }, now()));
        return sendJson(res, 200, closeLot(db, lotId, now()));
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof AuctionError) {
        return sendJson(res, error.status, { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      }
      if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) {
        return sendJson(res, 409, { error: "conflict", message: error.message });
      }
      sendJson(res, 500, { error: "internal", message: error.message });
    }
  });
}
