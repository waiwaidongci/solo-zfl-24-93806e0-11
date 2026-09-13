export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>赛鸽血统环号登记站 · 在线拍卖</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --green:#2e7d4f; --amber:#a86a00; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; font-size:16px; }
    main { padding:22px 28px; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    button.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); }
    button.warn { background:var(--red); }
    button:disabled { opacity:.45; cursor:not-allowed; }
    .tabs { display:flex; gap:8px; margin-bottom:18px; }
    .tabs button { background:#fff; color:var(--ink); border:1px solid var(--line); }
    .tabs button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
    .cols { display:grid; grid-template-columns:360px 1fr; gap:22px; align-items:start; }
    .card { display:grid; gap:8px; } .meta { color:var(--muted); font-size:13px; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.live { background:#e7f4ec; color:var(--green); border-color:#bfe0cd; }
    .pill.scheduled { background:#fff4e0; color:var(--amber); border-color:#ecd9ae; }
    .pill.ended { background:#eef1f4; color:var(--muted); }
    .pill.sold { background:#e7f4ec; color:var(--green); border-color:#bfe0cd; }
    .pill.unsold { background:#fbeae8; color:var(--red); border-color:#ecc7c3; }
    .section { margin-top:14px; }
    .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; }
    .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    table { width:100%; border-collapse:collapse; background:#fff; } th,td { border-bottom:1px solid var(--line); padding:8px 10px; text-align:left; font-size:14px; vertical-align:top; }
    th { color:var(--muted); font-weight:600; font-size:13px; }
    tr.pick { cursor:pointer; } tr.pick:hover { background:#f2f7fb; } tr.pick.sel { background:#e8f1f8; }
    .bidbox { display:grid; grid-template-columns:1fr 110px auto; gap:8px; align-items:end; }
    .bidbox input { padding:7px; }
    .countdown { font-variant-numeric:tabular-nums; font-weight:700; }
    .flash { position:fixed; right:18px; bottom:18px; max-width:420px; padding:12px 16px; border-radius:8px; color:#fff; background:var(--accent); box-shadow:0 6px 24px rgba(0,0,0,.18); display:none; z-index:9; }
    .flash.err { background:var(--red); }
    .neg { color:var(--red); } .pos { color:var(--green); }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{padding:16px;} .cols{grid-template-columns:1fr;} .relation{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header>
    <div><h1>赛鸽血统环号登记站</h1><div class="meta">档案、血统、转让、归巢成绩 · 在线拍卖</div></div>
    <button id="reload">刷新</button>
  </header>
  <main>
    <div class="tabs">
      <button id="tab-registry" class="active">鸽只登记</button>
      <button id="tab-auction">在线拍卖</button>
    </div>

    <section id="view-registry">
      <div class="cols">
        <form id="form">
          <h2>创建鸽只档案</h2>
          <label>足环号</label><input name="ringNo" required>
          <label>鸽主</label><input name="owner" required>
          <label>父鸽足环号</label><input name="fatherRing">
          <label>母鸽足环号</label><input name="motherRing">
          <label>羽色</label><input name="color" required>
          <label>出生棚号</label><input name="loft" required>
          <button>保存档案</button>
        </form>
        <section>
          <div class="toolbar"><input id="search" placeholder="输入足环号查询血统"><button id="searchBtn">查询</button></div>
          <div class="panel" id="detail"></div>
          <div class="section grid" id="cards"></div>
        </section>
      </div>
    </section>

    <section id="view-auction" style="display:none">
      <div class="cols">
        <div>
          <form id="session-form">
            <h2>建场次（管理员）</h2>
            <label>场次名称</label><input name="name" required placeholder="如：2026 秋季精品赛鸽专场">
            <label>开拍时间</label><input name="startAt" type="datetime-local" required>
            <label>截拍时间</label><input name="endAt" type="datetime-local" required>
            <label>加价幅度（元）</label><input name="increment" type="number" min="1" step="1" value="100" required>
            <label>佣金比例（%）</label><input name="commissionPct" type="number" min="0" max="99" step="0.1" value="5" required>
            <button id="create-session-btn">创建场次</button>
          </form>
          <form id="lot-form" class="section">
            <h2>上架拍品</h2>
            <label>选择鸽只（仅已登记，送拍人自动取当前鸽主）</label><select name="ringNo" id="lot-pigeon" required></select>
            <label>送拍人</label><input name="consignor" id="lot-consignor" required readonly>
            <label>起拍价（元）</label><input name="startPrice" type="number" min="1" step="1" value="1000" required>
            <button id="create-lot-btn">上架到当前场次</button>
          </form>
          <form id="buyer-form" class="section">
            <h2>买家登记 · 缴保证金</h2>
            <label>买家姓名</label><input name="name" required placeholder="登记并缴保证金后才能出价">
            <label>保证金（元）</label><input name="deposit" type="number" min="1" step="1" value="2000" required>
            <button id="register-buyer-btn">登记并缴保证金</button>
          </form>
        </div>
        <section>
          <div class="panel">
            <h2>场次列表</h2>
            <table id="sessions-table"><thead><tr><th>场次</th><th>状态</th><th>开拍</th><th>截拍</th><th>加价幅度</th><th>佣金</th><th>拍品</th><th>买家</th></tr></thead><tbody></tbody></table>
          </div>
          <div class="panel section" id="session-detail"><p class="meta">请选择场次查看拍品、出价与结算。</p></div>
        </section>
      </div>
    </section>
  </main>
  <div class="flash" id="flash"></div>

  <script>
    const $ = sel => document.querySelector(sel);
    const flash = $("#flash");
    let flashTimer = null;
    function toast(message, isErr) {
      flash.textContent = message;
      flash.className = "flash" + (isErr ? " err" : "");
      flash.style.display = "block";
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => flash.style.display = "none", 3600);
    }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) { const err = new Error(data.message || data.error || "请求失败"); err.code = data.error; throw err; }
      return data;
    }
    const fmtTime = ms => ms ? new Date(ms).toLocaleString("zh-CN", { hour12:false }) : "-";
    const fmtMoney = n => n == null ? "-" : n.toLocaleString("zh-CN") + " 元";
    const phaseText = { scheduled:"未开拍", live:"进行中", ended:"已结束" };
    const lotStatusText = { open:"竞价中", sold:"已成交", unsold:"已流拍" };
    const kindText = { deposit_paid:"保证金缴纳", hammer_charge:"成交款（应付）", commission:"佣金（平台）", sale_proceeds:"卖方所得", deposit_applied:"保证金冲抵货款", deposit_refund:"保证金退还" };

    /* ================= 鸽只登记（原有功能） ================= */
    const form = $("#form"), cards = $("#cards"), detail = $("#detail"), search = $("#search");
    let pigeons = [];
    function renderCards() {
      cards.innerHTML = pigeons.map(p => '<article class="card"><h3>'+p.ringNo+'</h3><span class="pill">'+p.owner+'</span><div class="meta">'+p.color+' · '+p.loft+'</div><div>父：'+(p.fatherRing || "未登记")+'</div><div>母：'+(p.motherRing || "未登记")+'</div><label>录入转让</label><input data-to="'+p.ringNo+'" placeholder="新归属人"><button data-transfer="'+p.ringNo+'">保存转让</button><label>归巢成绩</label><input data-race="'+p.ringNo+'" placeholder="赛事/距离/名次，如200公里/200/6"><button data-score="'+p.ringNo+'">保存成绩</button></article>').join("");
      document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.transfer; const to = document.querySelector('[data-to="'+CSS.escape(ringNo)+'"]').value;
        try { await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/transfers', { method:'POST', body: JSON.stringify({ to }) }); await loadRegistry(); toast("转让已保存"); } catch (e) { toast(e.message, true); }
      });
      document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.score; const raw = document.querySelector('[data-race="'+CSS.escape(ringNo)+'"]').value.split("/");
        try { await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/races', { method:'POST', body: JSON.stringify({ event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) }) }); await loadRegistry(); toast("成绩已保存"); } catch (e) { toast(e.message, true); }
      });
    }
    function renderRelation(data) {
      if (!data) { detail.innerHTML = '<h2>血统查询</h2><p class="meta">请输入足环号查看父母、子代、转让和成绩。</p>'; return; }
      const p = data.pigeon;
      detail.innerHTML = '<h2>'+p.ringNo+' 血统档案</h2><div class="relation"><div class="small"><b>父鸽</b><br>'+((data.father && data.father.ringNo) || p.fatherRing || "未登记")+'</div><div class="small"><b>本鸽</b><br>'+p.owner+' · '+p.color+'</div><div class="small"><b>母鸽</b><br>'+((data.mother && data.mother.ringNo) || p.motherRing || "未登记")+'</div></div><div><b>子代</b> '+(data.children.map(c => c.ringNo).join("、") || "暂无")+'</div><div class="meta">转让：'+(p.transfers.map(t => t.from+"→"+t.to).join(" / ") || "暂无")+'</div><div class="meta">归巢：'+(p.races.map(r => r.event+" 第"+r.rank+"名").join(" / ") || "暂无")+'</div>';
    }
    async function loadRegistry(){ pigeons = await api("/api/pigeons"); renderCards(); renderRelation(null); fillPigeonSelect(); }
    $("#searchBtn").onclick = async () => { try { renderRelation(await api('/api/pigeons/'+encodeURIComponent(search.value)+'/relation')); } catch (e) { toast(e.message, true); } };
    form.onsubmit = async event => {
      event.preventDefault();
      try { await api("/api/pigeons", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); form.reset(); await loadRegistry(); toast("档案已保存"); } catch (e) { toast(e.message, true); }
    };

    /* ================= 在线拍卖 ================= */
    let sessions = [];
    let currentSessionId = null;
    let currentView = null;
    const sessionsTable = $("#sessions-table tbody");
    const sessionDetail = $("#session-detail");

    function fillPigeonSelect() {
      const sel = $("#lot-pigeon");
      sel.innerHTML = pigeons.map(p => '<option value="'+p.ringNo+'" data-owner="'+p.owner+'">'+p.ringNo+'（鸽主：'+p.owner+'）</option>').join("");
      syncConsignor();
    }
    function syncConsignor() {
      const sel = $("#lot-pigeon");
      const opt = sel.selectedOptions && sel.selectedOptions[0];
      $("#lot-consignor").value = opt ? opt.dataset.owner : "";
    }
    $("#lot-pigeon").onchange = syncConsignor;

    function toLocalInput(ms) {
      const d = new Date(ms); const pad = n => String(n).padStart(2, "0");
      return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes());
    }

    $("#session-form").onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(event.target);
      try {
        const created = await api("/api/auction/sessions", { method:"POST", body: JSON.stringify({
          name: f.get("name"), startAt: new Date(f.get("startAt")).getTime(), endAt: new Date(f.get("endAt")).getTime(),
          increment: Number(f.get("increment")), commissionRate: Number(f.get("commissionPct")) / 100
        }) });
        toast("场次已创建");
        await loadSessions();
        selectSession(created.id);
      } catch (e) { toast(e.message, true); }
    };

    $("#lot-form").onsubmit = async event => {
      event.preventDefault();
      if (!currentSessionId) return toast("请先在右侧选择场次", true);
      const f = new FormData(event.target);
      try {
        await api('/api/auction/sessions/'+currentSessionId+'/lots', { method:"POST", body: JSON.stringify({
          ringNo: f.get("ringNo"), consignor: f.get("consignor"), startPrice: Number(f.get("startPrice"))
        }) });
        toast("拍品已上架");
        await loadSessions(); await loadSessionView();
      } catch (e) { toast(e.message, true); }
    };

    $("#buyer-form").onsubmit = async event => {
      event.preventDefault();
      if (!currentSessionId) return toast("请先在右侧选择场次", true);
      const f = new FormData(event.target);
      try {
        await api('/api/auction/sessions/'+currentSessionId+'/buyers', { method:"POST", body: JSON.stringify({
          name: f.get("name"), deposit: Number(f.get("deposit"))
        }) });
        toast("买家已登记并缴纳保证金");
        event.target.reset();
        await loadSessions(); await loadSessionView();
      } catch (e) { toast(e.message, true); }
    };

    async function loadSessions() {
      sessions = await api("/api/auction/sessions");
      sessionsTable.innerHTML = sessions.map(s =>
        '<tr class="pick'+(s.id===currentSessionId?' sel':'')+'" data-session="'+s.id+'"><td><b>'+s.name+'</b></td>'+
        '<td><span class="pill '+s.phase+'">'+phaseText[s.phase]+'</span></td>'+
        '<td class="meta">'+fmtTime(s.startAt)+'</td><td class="meta">'+fmtTime(s.endAt)+'</td>'+
        '<td>'+fmtMoney(s.increment)+'</td><td>'+(s.commissionRate*100).toFixed(1)+'%</td>'+
        '<td>'+s.lotCount+'（成交 '+s.soldLots+' / 流拍 '+s.unsoldLots+'）</td><td>'+s.buyerCount+'</td></tr>').join("") ||
        '<tr><td colspan="8" class="meta">暂无场次，请在左侧创建。</td></tr>';
      document.querySelectorAll("[data-session]").forEach(row => row.onclick = () => selectSession(Number(row.dataset.session)));
    }

    function selectSession(id) {
      currentSessionId = id;
      loadSessions();
      loadSessionView();
    }

    function countdown(ms) {
      const remain = ms - Date.now();
      if (remain <= 0) return "已到点";
      const s = Math.floor(remain / 1000);
      return Math.floor(s / 60) + "分" + (s % 60) + "秒";
    }

    function renderSessionView(v) {
      currentView = v;
      const lotsRows = v.lots.map(lot => {
        const top = lot.currentPrice != null ? fmtMoney(lot.currentPrice) : "暂无出价";
        const state = lot.status === "open"
          ? '<span class="pill '+(lot.biddable?"live":"scheduled")+'">'+(lot.biddable?"竞价中":"未开拍")+'</span>'
          : '<span class="pill '+lot.status+'">'+lotStatusText[lot.status]+'</span>';
        const hammer = lot.status === "sold" ? '<div class="meta">成交价 <b>'+fmtMoney(lot.hammerPrice)+'</b> · 买受人 '+lot.winner+'</div>'
          : lot.status === "unsold" ? '<div class="meta">无有效出价，流拍</div>' : "";
        const settled = lot.settleStatus === "settled" ? '<span class="pill">已结算</span>' : "";
        const bids = lot.bids.slice(0, 5).map(b => '<div class="meta">'+b.buyer+' 出价 '+fmtMoney(b.amount)+' · '+fmtTime(b.created_at)+'</div>').join("");
        const bidBox = lot.status === "open"
          ? '<div class="bidbox"><input data-bid-buyer="'+lot.id+'" placeholder="买家姓名" list="buyers-'+v.id+'"><input data-bid-amount="'+lot.id+'" type="number" min="'+lot.minNextBid+'" step="'+v.increment+'" placeholder="≥ '+lot.minNextBid+'"><button data-bid-submit="'+lot.id+'">出价</button></div>'
          : "";
        return '<tr data-lot-row="'+lot.id+'"><td><b>'+lot.ringNo+'</b><div class="meta">送拍人：'+lot.consignor+'</div></td>'+
          '<td>'+fmtMoney(lot.startPrice)+'</td>'+
          '<td><b>'+top+'</b><div class="meta">出价 '+lot.bidCount+' 次 · 下一口 ≥ '+fmtMoney(lot.minNextBid)+'</div></td>'+
          '<td>'+state+' '+settled+'<div class="meta">截拍 '+fmtTime(lot.endsAt)+'</div>'+(lot.status==='open'?'<div class="countdown" data-countdown="'+lot.endsAt+'">'+countdown(lot.endsAt)+'</div>':'')+(lot.extendedCount?'<div class="meta">已顺延 '+lot.extendedCount+' 次</div>':'')+hammer+'</td>'+
          '<td>'+bidBox+bids+'</td></tr>';
      }).join("");

      const buyers = v.buyers.map(b => '<span class="pill">'+b.name+' · 保证金 '+fmtMoney(b.deposit)+'</span>').join(" ") || '<span class="meta">暂无买家登记</span>';
      const ledgerRows = v.ledger.map(e => '<tr><td>'+(kindText[e.kind] || e.kind)+'</td><td>'+e.party+'</td><td class="'+(e.amount<0?'neg':'pos')+'">'+(e.amount<0?'-':'+')+fmtMoney(Math.abs(e.amount))+'</td><td class="meta">'+fmtTime(e.createdAt)+'</td></tr>').join("");
      const ledgerTable = v.ledger.length
        ? '<h3>资金流水（保证金 / 佣金 / 成交款）</h3><table id="ledger-table"><thead><tr><th>项目</th><th>当事方</th><th>金额</th><th>时间</th></tr></thead><tbody>'+ledgerRows+'</tbody></table>'
        : "";

      sessionDetail.innerHTML =
        '<h2>'+v.name+' <span class="pill '+v.phase+'">'+phaseText[v.phase]+'</span></h2>'+
        '<div class="meta">开拍 '+fmtTime(v.startAt)+' · 截拍 '+fmtTime(v.endAt)+' · 加价幅度 '+fmtMoney(v.increment)+' · 佣金 '+(v.commissionRate*100).toFixed(1)+'% · 截拍前 2 分钟内出价自动顺延 2 分钟</div>'+
        '<div class="section"><button class="warn" id="close-session-btn" data-close-session="'+v.id+'">截拍到点拍品</button> '+
        '<button id="settle-session-btn" data-settle-session="'+v.id+'">结算（佣金 + 保证金）</button> '+
        '<button class="ghost" id="refresh-session-btn">刷新</button></div>'+
        '<div class="section"><h3>登记买家（'+v.buyers.length+'）</h3><datalist id="buyers-'+v.id+'">'+v.buyers.map(b=>'<option value="'+b.name+'">').join("")+'</datalist>'+buyers+'</div>'+
        '<div class="section"><h3>拍品（'+v.lots.length+'）</h3><table><thead><tr><th>拍品</th><th>起拍价</th><th>当前价</th><th>状态 / 截拍</th><th>出价</th></tr></thead><tbody>'+(lotsRows || '<tr><td colspan="5" class="meta">暂无拍品</td></tr>')+'</tbody></table></div>'+
        '<div class="section">'+ledgerTable+'</div>';

      $("#close-session-btn").onclick = () => closeSession(v.id);
      $("#settle-session-btn").onclick = () => settleSession(v.id);
      $("#refresh-session-btn").onclick = () => loadSessionView();
      document.querySelectorAll("[data-bid-submit]").forEach(btn => btn.onclick = async () => {
        const lotId = btn.dataset.bidSubmit;
        const buyer = document.querySelector('[data-bid-buyer="'+lotId+'"]').value;
        const amount = Number(document.querySelector('[data-bid-amount="'+lotId+'"]').value);
        try {
          const result = await api('/api/auction/lots/'+lotId+'/bids', { method:"POST", body: JSON.stringify({ buyerName: buyer, amount }) });
          toast(result.extended ? "出价成功，截拍时间已自动顺延 2 分钟" : "出价成功");
          await loadSessionView();
        } catch (e) { toast(e.message, true); }
      });
    }

    async function loadSessionView() {
      if (!currentSessionId) return;
      try { renderSessionView(await api('/api/auction/sessions/'+currentSessionId)); } catch (e) { toast(e.message, true); }
    }

    async function closeSession(id) {
      try {
        const view = await api('/api/auction/sessions/'+id+'/close', { method:"POST" });
        toast("截拍完成");
        renderSessionView(view); await loadSessions();
      } catch (e) { toast(e.message, true); }
    }
    async function settleSession(id) {
      try {
        const view = await api('/api/auction/sessions/'+id+'/settle', { method:"POST" });
        toast("结算完成（重复执行不会重复扣款）");
        renderSessionView(view); await loadSessions();
      } catch (e) { toast(e.message, true); }
    }

    /* ================= 页签与轮询 ================= */
    $("#tab-registry").onclick = () => switchTab("registry");
    $("#tab-auction").onclick = () => switchTab("auction");
    function switchTab(tab) {
      $("#tab-registry").classList.toggle("active", tab === "registry");
      $("#tab-auction").classList.toggle("active", tab === "auction");
      $("#view-registry").style.display = tab === "registry" ? "" : "none";
      $("#view-auction").style.display = tab === "auction" ? "" : "none";
      if (tab === "auction") { loadSessions(); loadSessionView(); }
    }
    $("#reload").onclick = () => { loadRegistry(); loadSessions(); loadSessionView(); };

    const now = Date.now();
    document.querySelector('#session-form [name=startAt]').value = toLocalInput(now);
    document.querySelector('#session-form [name=endAt]').value = toLocalInput(now + 30 * 60 * 1000);
    setInterval(() => {
      document.querySelectorAll("[data-countdown]").forEach(el => { el.textContent = countdown(Number(el.dataset.countdown)); });
    }, 1000);
    setInterval(() => {
      if ($("#view-auction").style.display !== "none") {
        loadSessions();
        const active = document.activeElement;
        const typing = active && active.tagName === "INPUT" && sessionDetail.contains(active);
        if (!typing) loadSessionView(); // 正在输入出价时暂停重绘，避免清掉输入
      }
    }, 3000);

    loadRegistry();
    loadSessions();
  </script>
</body>
</html>`;
