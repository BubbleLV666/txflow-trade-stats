/* TxFlow Trade Stats — static, no backend. Reads the public TxFlow API (POST api.txflow.com/info) straight from the browser. */
(() => {
'use strict';
const API = 'https://api.txflow.com/info';
const VERSION = 'v1.0';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = x => { const v = parseFloat(x); return isFinite(v) ? v : 0; };
const fmt = (x, d = 2) => x == null || !isFinite(x) ? '—' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (x, d = 2) => x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(x), d);
const money = (x, d = 2) => x == null || !isFinite(x) ? '—' : (x < 0 ? '−' : '') + '$' + fmt(Math.abs(x), d);
const smoney = (x, d = 2) => x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + '$' + fmt(Math.abs(x), d);
const big = x => { const a = Math.abs(x); return a >= 1e9 ? fmt(x / 1e9, 2) + 'B' : a >= 1e6 ? fmt(x / 1e6, 2) + 'M' : a >= 1e4 ? fmt(x / 1e3, 1) + 'K' : fmt(x, 0); };
const usd = x => (x < 0 ? '−' : '') + '$' + big(Math.abs(x));   // axis labels: −$1.2K, never $-1.2K
const cls = x => x > 1e-9 ? 'pos' : x < -1e-9 ? 'neg' : '';
const pxf = p => p == null ? '—' : p >= 1000 ? fmt(p, 2) : p >= 1 ? fmt(p, 3) : fmt(p, 5);
const pad2 = v => String(v).padStart(2, '0');
/* every date of the site is written day.month.year (24-hour time); local time unless utc is set */
function fmtDt(ms, o = {}) {
  const d = new Date(ms), g = o.utc ? [d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear(), d.getUTCHours(), d.getUTCMinutes()] : [d.getDate(), d.getMonth() + 1, d.getFullYear(), d.getHours(), d.getMinutes()];
  return pad2(g[0]) + '.' + pad2(g[1]) + (o.year ? '.' + String(g[2]).slice(-2) : '') + (o.noTime ? '' : ' ' + pad2(g[3]) + ':' + pad2(g[4]));
}
const dt = us => fmtDt(us / 1000);
const dtl = us => fmtDt(us / 1000, { year: true });
const dtlU = us => fmtDt(us / 1000, { year: true, utc: true });
const dur = s => { s = Math.max(0, s | 0); const d = s / 86400 | 0, h = (s % 86400) / 3600 | 0, m = (s % 3600) / 60 | 0; return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; };
const store = { get(k, d) { try { const v = localStorage.getItem('tf_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('tf_' + k, JSON.stringify(v)); } catch (e) { } } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- throttled POST /info (the rate limit is not documented: stay polite, ~5 requests per second) */
const bucket = { tokens: 12, t: Date.now() };
async function take(w) {
  for (;;) {
    const now = Date.now(); bucket.tokens = Math.min(12, bucket.tokens + (now - bucket.t) / 1000 * 5); bucket.t = now;
    if (bucket.tokens >= w) { bucket.tokens -= w; return; }
    await sleep(Math.max(60, (w - bucket.tokens) / 5 * 1000));
  }
}
async function info(body, w = 1) {
  for (let a = 0; a < 5; a++) {
    await take(w);
    let r; try { r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch (e) { await sleep(800 * (a + 1)); continue; }
    if (r.status === 429) { bucket.tokens = 0; await sleep(1500 * (a + 1)); continue; }
    if (r.status >= 500) { await sleep(700 * (a + 1)); continue; }
    let data = null; try { data = await r.json(); } catch (e) { }
    if (!r.ok || (data && !Array.isArray(data) && (data.status === 'err' || (data.code != null && data.code !== 0) || (data.message && Object.keys(data).length === 1)))) { const err = new Error((data && (data.message || data.reason || data.msg)) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
    return data;
  }
  throw new Error('API unavailable or rate limit exceeded, please try again later');
}
/* Pages are returned newest first, at most 300 rows each, and `offset` is ignored: walk back in time with endTimeMs (inclusive, duplicates are dropped by id). */
async function pullBack(body, o) {
  const out = [], seen = new Set(); let end = o.to;
  for (let guard = 0; guard < 500; guard++) {
    const page = await info({ ...body, startTimeMs: Math.max(0, Math.floor(o.from)), endTimeMs: Math.ceil(end), limit: 300 }, 1);
    if (o.live && !o.live()) return null;
    if (!Array.isArray(page)) break;
    let added = 0; for (const r of page) { const k = o.id(r); if (!seen.has(k)) { seen.add(k); out.push(o.norm(r)); added++; } }
    if (o.onPage) o.onPage(out);
    if (page.length < 300 || !added || out.length >= o.cap) break;
    end = Math.min(...page.map(o.t));
  }
  return out;
}

/* ---- API rows -> the shape the UI works with (the UI keeps times in microseconds) */
const US = 1000;
const coinName = c => String(c || '').replace(/-USDC$/, '');
const normFill = f => ({ tid: Number(f.tid) || 0, tradeId: f.tid + '_' + f.oid, createdAt: f.time * US, size: f.sz, price: f.px, fee: f.fee, closedPnl: f.closedPnl, role: /maker/i.test(f.tradeSide) ? 'MAKER' : 'TAKER', side: f.side === 'B' ? 'BUY' : 'SELL', marketDisplayName: coinName(f.coin), marketId: f.coin,
  lev: f.leverage, mmode: f.marginMode, startPos: parseFloat(f.startPosition) || 0, twap: !!f.twapId, reduceOnly: !!f.reduceOnly, feeToken: f.feeToken, instrumentId: f.instrumentId, hash: f.hash });
const normFunding = x => ({ time: x.time * US, payment: x.usdc, marketDisplayName: coinName(x.coin), rate: x.fundingRate, szi: x.szi });
const normSpotFill = f => ({ ...normFill(f), marketDisplayName: f.symbol || f.coin });
/* Balance movements seen from the perpetuals account: sign +1 = money in, −1 = money out, 0 = does not touch it (spot-only moves, vault events). */
const normTransfer = (x, me) => {
  const d = x.delta || {}, t = String(d.type || ''), amt = Math.abs(parseFloat(d.usdcValue != null ? d.usdcValue : d.amount) || 0), lc = a => String(a || '').toLowerCase();
  let type = 'OTHER', sign = 0, cp = '';
  if (t === 'deposit') { type = 'DEPOSIT'; sign = 1; } else if (t === 'withdraw') { type = 'WITHDRAWAL'; sign = -1; }
  else if (t === 'multiChainDeposit') { type = 'DEPOSIT'; sign = d.destinationDex === 'perp' ? 1 : 0; }
  else if (t === 'multiChainWithdraw') { type = 'WITHDRAWAL'; sign = d.sourceDex === 'perp' ? -1 : 0; }
  else if (t === 'tokenSend') {
    const from = lc(d.user) === me, to = lc(d.destination) === me; type = from && to ? 'TRANSFER' : to ? 'RECEIVED' : 'SENT'; cp = to && !from ? lc(d.user) : from && !to ? lc(d.destination) : '';
    if (from && to) sign = d.destinationDex === 'perp' && d.sourceDex !== 'perp' ? 1 : d.sourceDex === 'perp' && d.destinationDex !== 'perp' ? -1 : 0;
    else if (to) sign = d.destinationDex === 'perp' ? 1 : 0; else if (from) sign = d.sourceDex === 'perp' ? -1 : 0;
  }
  return { createdAt: x.time * US, type: sign ? type : 'OTHER', kind: t, cp, chain: d.chain || d.network || '', sign, amount: amt, status: d.status && !/complet/i.test(d.status) ? 'PENDING' : 'APPLIED' };
};
const normOpen = o => ({ marketDisplayName: coinName(o.coin), side: o.side === 'B' ? 'BUY' : 'SELL', price: o.limitPx, remainingSize: o.sz, timeInForce: o.tif, createdAt: o.timestamp * US,
  orderType: o.orderType, reduceOnly: !!o.reduceOnly, isTrigger: !!o.isTrigger, isTpsl: !!o.isPositionTpsl, triggerPx: o.triggerPx, triggerCondition: o.triggerCondition, origSize: o.origSz, marginMode: o.marginMode, leverage: o.leverage, cloid: o.cloid, instrumentId: o.asset });
const normOrder = x => { const o = x.order || {}, avg = parseFloat(o.avgFillPrice); return { oid: o.oid, status: String(x.status || '').toUpperCase().replace('CANCELLED', 'CANCELED'), timeInForce: o.tif, price: o.limitPx, originalSize: o.origSz, filledSize: avg > 0 ? parseFloat(o.filledAmount) / avg : 0, avgFillPrice: o.avgFillPrice, side: o.side === 'B' ? 'BUY' : 'SELL', createdAt: o.timestamp * US, updatedAt: (x.statusTimestamp || o.timestamp) * US,
  marketDisplayName: coinName(o.coin), orderType: o.orderType, reduceOnly: !!o.reduceOnly, pnl: o.pnl, roe: o.roe, entryPrice: o.entryPrice, marginMode: o.marginMode, leverage: o.leverage, dir: o.dir }; };
function normAccount(ch, transfers) {
  const ms = ch.marginSummary || {}, positions = {};
  (ch.assetPositions || []).forEach((ap, i) => {
    const p = ap.position || ap, lv = p.leverage || {};
    positions[i] = { marketId: p.coin, marketDisplayName: coinName(p.coin), size: p.szi, markPx: p.markPx, positionValueNotional: p.positionValue, unrealizedPnl: p.unrealizedPnl, averageEntryPrice: p.entryPx,
      leverage: lv.value, marginMode: /iso/i.test(lv.type || '') ? 'ISOLATED' : 'CROSS', marginUsed: p.marginUsed, liquidationPx: p.liquidationPx,
      instrumentId: p.asset, roe: p.returnOnEquity, adl: p.adlQuantile, marginRatio: p.marginRatio, cumFee: p.cumFee, closedPnl: p.closedPnl, maxLeverage: p.maxLeverage,
      mode: ap.type, tpsl: (ap.tpsl || []).map(t => ({ tp: t.tpTriggerPrice, sl: t.slTriggerPrice, tpOrderPrice: t.tpOrderPrice, slOrderPrice: t.slOrderPrice, qty: t.quantity, tpType: t.tpOrderType, slType: t.slOrderType, at: t.createTime ? t.createTime * US : null })),
      fundingSinceOpen: p.cumFunding && p.cumFunding.sinceOpen, fundingSinceChange: p.cumFunding && p.cumFunding.sinceChange, updatedAt: p.updateTime ? p.updateTime * US : null };
  });
  let dep = 0, pd = 0, pw = 0;
  (transfers || []).forEach(t => { if (t.status === 'APPLIED') dep += t.sign * t.amount; else if (t.sign > 0) pd += t.amount; else if (t.sign < 0) pw += t.amount; });
  return { equity: ms.accountValue, freeCollateral: ch.withdrawable, maintenanceMargin: ch.crossMaintenanceMarginUsed, netDeposits: transfers ? dep : null, pendingDeposits: pd, pendingWithdrawals: pw, positions,
    totalNtlPos: ms.totalNtlPos, totalMarginUsed: ms.totalMarginUsed, totalRawUsd: ms.totalRawUsd, crossMarginRatio: ch.crossMarginRatio, vaultEquity: ch.vaultEquity, equityPlusHold: ch.accountValuePlusWithdrawHold, rawUsdPlusHold: ch.totalRawUsdPlusWithdrawHold, stateTime: ch.time };
}

/* ---------------------------------------------------------------- state */
let S = null, runId = 0, autoTimer = null;
const OLD_CARDS = ['summary', 'volume', 'pnl', 'risk', 'positions', 'activity', 'curve', 'bymarket', 'daily', 'hourly', 'orderflow', 'feetier', 'funding', 'transfers', 'orders', 'fills'];
const DEFAULT_CARDS = [...OLD_CARDS, 'volday', 'leverage', 'trades', 'spot', 'vaults', 'referral', 'campaigns', 'conditional', 'leaderboards', 'equity', 'pnlchart', 'perf', 'dailytable', 'rewards', 'orderhist', 'tradehist'];
let enabled = new Set(store.get('cards', DEFAULT_CARDS));
{ const seen = new Set(store.get('cards_seen', OLD_CARDS)); DEFAULT_CARDS.forEach(id => { if (!seen.has(id)) enabled.add(id); }); store.set('cards_seen', DEFAULT_CARDS); store.set('cards', [...enabled]); }   // cards added in later versions switch on automatically

/* ---------------------------------------------------------------- charts */
function lineChart(box, pts, o) {
  const W = box.clientWidth || 500, H = box.clientHeight || 220, m = { l: 54, r: 10, t: 8, b: 22 };
  if (pts.length < 2) { box.innerHTML = '<div class="empty">Not enough data</div>'; return; }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); if (o.zero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
  if (y1 - y0 < (o.minRange || 1e-9)) { const c = (y0 + y1) / 2; y0 = c - (o.minRange || 1) / 2; y1 = c + (o.minRange || 1) / 2; }
  const pad = (y1 - y0) * .08; y0 -= pad; y1 += pad;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const X = t => m.l + (t - x0) / ((x1 - x0) || 1) * (W - m.l - m.r), Y = v => H - m.b - (v - y0) / ((y1 - y0) || 1) * (H - m.t - m.b);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v); g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--ink-3)">${o.axis(v)}</text>`; }
  for (let i = 0; i <= 4; i++) { const t = x0 + (x1 - x0) * i / 4; g += `<text x="${X(t)}" y="${H - 5}" text-anchor="${i == 0 ? 'start' : i == 4 ? 'end' : 'middle'}" font-size="11" fill="var(--ink-3)">${o.xfmt(t)}</text>`; }
  if (o.zero) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
  const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
  const base = Y(Math.max(y0, Math.min(y1, 0)));
  const gid = 'ga' + (lineChart.n = (lineChart.n || 0) + 1);
  const area = o.area ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.color}" stop-opacity=".34"/><stop offset="1" stop-color="${o.color}" stop-opacity="0"/></linearGradient></defs><path d="${d}L${X(x1)} ${base}L${X(x0)} ${base}Z" fill="url(#${gid})"/>` : '';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}${area}<path d="${d}" fill="none" stroke="${o.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><g class="hv" style="display:none"><line y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)"/><circle r="4" fill="${o.color}" stroke="var(--surface)" stroke-width="2"/></g></svg><div class="tt"></div>`;
  hover(box, W, H, (px) => {
    let lo = 0, hi = pts.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (X(pts[mid][0]) < px) lo = mid + 1; else hi = mid; }
    const p = pts[lo]; return { x: X(p[0]), y: Y(p[1]), html: `<span class="k">${o.tfmt(p[0])}</span><br><b class="num">${o.tip(p[1])}</b>` };
  });
}
function barChart(box, items, o) {
  const W = box.clientWidth || 500, H = box.clientHeight || 220, m = { l: 54, r: 8, t: 8, b: 24 };
  if (!items.length) { box.innerHTML = '<div class="empty">No data</div>'; return; }
  let y0 = Math.min(0, ...items.map(i => i.v)), y1 = Math.max(0, ...items.map(i => i.v)); if (y1 === y0) y1 = y0 + 1;
  const Y = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b), bw = (W - m.l - m.r) / items.length, gap = Math.min(2, bw * .15);
  let g = ''; for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v); g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--ink-3)">${o.axis(v)}</text>`; }
  const step = Math.ceil(items.length / 8);
  const bars = items.map((it, i) => {
    const w = Math.max(1, Math.min(bw - gap, 56)), x = m.l + i * bw + (bw - w) / 2, yy = Y(Math.max(it.v, 0)), h = Math.max(1, Math.abs(Y(it.v) - Y(0)));
    const lab = i % step === 0 ? `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--ink-3)">${esc(it.label)}</text>` : '';
    return `<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="${Math.min(3, w / 3)}" fill="${o.color}" data-i="${i}"/>${lab}`;
  }).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--ink-3)"/>${bars}</svg><div class="tt"></div>`;
  const tip = $('.tt', box), svg = $('svg', box);
  box.onmousemove = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), i = Math.max(0, Math.min(items.length - 1, Math.floor((px - m.l) / bw)));
    tip.style.display = 'block'; tip.innerHTML = `<span class="k">${esc(items[i].label)}</span><br><b class="num">${o.tip(items[i].v, items[i])}</b>`;
    const bx = box.getBoundingClientRect(); let lx = e.clientX - bx.left + 14; if (lx > bx.width - 150) lx = e.clientX - bx.left - 150; tip.style.left = lx + 'px'; tip.style.top = '8px';
  };
  box.onmouseleave = () => tip.style.display = 'none';
}
function hover(box, W, H, f) {
  const svg = $('svg', box), hv = $('.hv', svg), tip = $('.tt', box);
  box.onmousemove = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), p = f(px);
    hv.style.display = ''; const l = hv.firstChild; l.setAttribute('x1', p.x); l.setAttribute('x2', p.x);
    const c = hv.lastChild; c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
    tip.style.display = 'block'; tip.innerHTML = p.html;
    const bx = box.getBoundingClientRect(); let lx = e.clientX - bx.left + 14; if (lx > bx.width - 150) lx = e.clientX - bx.left - 150; tip.style.left = lx + 'px'; tip.style.top = '8px';
  };
  box.onmouseleave = () => { hv.style.display = 'none'; tip.style.display = 'none'; };
}
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const tshort = t => fmtDt(t / 1000);
const dshort = t => fmtDt(t / 1000, { noTime: true });

/* ---------------------------------------------------------------- derived data */
function fillStats(fills) {
  const r = { n: fills.length, vol: 0, mvol: 0, tvol: 0, fees: 0, pnl: 0, wins: 0, losses: 0, winSum: 0, lossSum: 0, buyVol: 0, sellVol: 0, byM: {}, byDay: {}, byHour: Array(24).fill(0), curve: [], maxWin: 0, maxLoss: 0 };
  if (!fills.length) return r;
  const asc = fills.slice().sort((a, b) => a.createdAt - b.createdAt);
  let cum = 0;
  for (const f of asc) {
    const v = n(f.size) * n(f.price), fee = n(f.fee), pnl = n(f.closedPnl), maker = f.role === 'MAKER';
    r.vol += v; r.fees += fee; r.pnl += pnl; if (maker) r.mvol += v; else r.tvol += v;
    if (f.side === 'BUY') r.buyVol += v; else r.sellVol += v;
    if (pnl > 0) { r.wins++; r.winSum += pnl; r.maxWin = Math.max(r.maxWin, pnl); } else if (pnl < 0) { r.losses++; r.lossSum += pnl; r.maxLoss = Math.min(r.maxLoss, pnl); }
    const m = r.byM[f.marketDisplayName] || (r.byM[f.marketDisplayName] = { fills: 0, vol: 0, mvol: 0, fees: 0, pnl: 0, wins: 0, losses: 0 });
    m.fills++; m.vol += v; if (maker) m.mvol += v; m.fees += fee; m.pnl += pnl; if (pnl > 0) m.wins++; else if (pnl < 0) m.losses++;
    const d = new Date(f.createdAt / 1000), key = d.toISOString().slice(0, 10);
    const dd = r.byDay[key] || (r.byDay[key] = { vol: 0, net: 0 }); dd.vol += v; dd.net += pnl - fee;
    r.byHour[d.getUTCHours()] += v;
    cum += pnl - fee; r.curve.push([f.createdAt, cum]);
  }
  r.t0 = asc[0].createdAt; r.t1 = asc[asc.length - 1].createdAt;
  if (r.curve.length > 900) { const k = r.curve.length / 900; r.curve = Array.from({ length: 900 }, (_, i) => r.curve[Math.floor(i * k)]).concat([r.curve[r.curve.length - 1]]); }
  return r;
}
function riskCalc(a, mk) {
  const eq = n(a.equity), pos = Object.values(a.positions || {}), out = { eq, rows: [], gross: 0, long: 0, short: 0, mm: 0, im: 0 };
  for (const p of pos) {
    const m = mk[p.marketId] || {}, mid = n(p.markPx), s = n(p.size), notl = Math.abs(n(p.positionValueNotional)) || Math.abs(s * mid);
    const mmf = n(m.maintenanceMarginFraction) || 0.03;
    out.gross += notl; if (s > 0) out.long += notl; else out.short += notl; out.mm += notl * mmf; out.im += n(p.marginUsed);
    out.rows.push({ p, s, mid, notl, mmf });
  }
  if (a.maintenanceMargin != null && isFinite(parseFloat(a.maintenanceMargin))) out.mm = n(a.maintenanceMargin);   // exchange-reported maintenance margin (cross)
  for (const r of out.rows) {   // liquidation price: the exchange's own value when it gives one, otherwise a cross-margin estimate with all other marks held fixed
    const { s, mid, mmf } = r, ex = n(r.p.liquidationPx);
    if (ex > 0) { r.liq = ex; r.dist = Math.abs(ex - mid) / mid * 100; continue; }
    if (r.p.marginMode === 'ISOLATED') { r.liq = null; continue; }
    const den = s - mmf * Math.abs(s), mmOther = out.mm - mmf * Math.abs(s) * mid;
    const lp = den ? (mmOther - eq + s * mid) / den : null;
    r.liq = lp && lp > 0 ? lp : null; r.dist = r.liq ? Math.abs(r.liq - mid) / mid * 100 : null;
  }
  out.buffer = eq - out.mm; out.lev = eq > 0 ? out.gross / eq : null;
  return out;
}

/* ---- periods: Total / weekly epochs (Mon 00:00 – Sun 23:59 GMT, per the TxFlow docs) / current week / custom range */
const WEEK = 7 * 86400e3;
let period = { key: 'cur' };   // every visit opens on the current week (not remembered between visits)
const EPOCH1 = Date.UTC(2026, 9, 12);   // Epoch I (Season One) started Mon 12 Oct 2026 00:00 GMT; the API's currentEpochEndsAt = Sun 18 Oct 23:59:59 GMT
/* Weeks, oldest first: Week 1 = Epoch I of Season 1 (from 12 Oct 2026); earlier Monday–Sunday weeks (n ≤ 0) are "Pre-season". The list starts at the week of the address's first deposit (at least 2 and at most 40 weeks back). */
function weeksList() {
  const now = Date.now(), k0 = Math.floor((now - EPOCH1) / WEEK), first = S && S.transfers && S.transfers.length ? Math.min(...S.transfers.map(x => x.createdAt)) / US : now, kmin = Math.max(Math.min(Math.floor((first - EPOCH1) / WEEK), k0 - 2), k0 - 39), a = [];
  for (let k = kmin; k <= k0; k++) { const from = EPOCH1 + k * WEEK; a.push({ n: k + 1, from, to: Math.min(from + WEEK, now), end: from + WEEK - 1, cur: k === k0 }); }
  return a;
}
const wkLabel = w => w.n >= 1 ? 'Week ' + w.n : 'Pre-season ' + new Date(w.from).toISOString().slice(5, 10).split('-').reverse().join('.');
const PRESETS = [['24h', '24 h', 'Last 24 hours', 864e5], ['7d', '7 d', 'Last 7 days', 7 * 864e5], ['30d', '30 d', 'Last 30 days', 30 * 864e5], ['90d', '90 d', 'Last 90 days', 90 * 864e5]];
function getPeriod(S) {   // null = all time; else { label, from, to } in microseconds
  if (period.key === 'total') return null;
  const pz = PRESETS.find(x => x[0] === period.key); if (pz) return { label: pz[2], from: (Date.now() - pz[3]) * 1000, to: Date.now() * 1000 };
  if (period.key === 'custom') return period.from && period.to ? { label: dtlU(period.from * 1000) + ' – ' + dtlU(period.to * 1000) + ' GMT', from: period.from * 1000, to: period.to * 1000 } : null;
  const w = weeksList();
  if (period.key === 'cur') { const c = w[w.length - 1]; return { label: `Current week (${c.n})`, from: c.from * 1000, to: Date.now() * 1000 }; }
  const m = /^w(-?\d+)$/.exec(period.key), c = m && w.find(x => x.n === +m[1]);
  return c ? { label: wkLabel(c), from: c.from * 1000, to: c.to * 1000 } : null;
}
const inP = (pr, us) => !pr || (us >= pr.from && us <= pr.to);
const periodFunding = S => (S.funding || []).filter(x => inP(getPeriod(S), x.time)).reduce((a, x) => a + n(x.payment), 0);
const fsub = S => { const pr = getPeriod(S); return pr ? pr.label : 'from loaded fills'; };
/* 14-day volume (completed UTC days + today) and the fee tier it puts the account in */
function feeInfo(S) {
  const f = S.fee, v = S.vlm; if (!f || !f.feeSchedule) return null;
  const tiers = ((f.feeSchedule.tiers || {}).vip || []).map((t, i) => ({ level: i, name: 'VIP ' + i, cutoff: n(t.ntlCutoff), addBps: n(t.add) * 1e4, crossBps: n(t.cross) * 1e4 }));
  const vol = v ? v.d14 : 0; let cur = 0; tiers.forEach(t => { if (vol >= t.cutoff) cur = t.level; });
  return { tiers, cur, vol, name: 'VIP ' + cur, addBps: n(f.userAddRate) * 1e4, crossBps: n(f.userCrossRate) * 1e4 };
}
/* ---- hover explanations: label text -> plain-language definition (shown on every row / table header with a match) */
const TIPS = {
  // account / profit
  'PnL by account': 'Equity minus net deposits: everything gained or lost, including unrealized PnL, fees and funding.',
  'ROI on deposit': 'PnL by account divided by net deposits.',
  'Net deposits': 'All deposits minus all withdrawals.',
  'Free collateral': 'Equity that is not locked as initial margin: what is available for new positions.',
  'Unrealized PnL': 'Profit or loss of the currently open positions at today\'s mark prices. Not locked in until the positions are closed.',
  'PnL over period (by equity)': 'Change of the account PnL curve (/portfolio) during the selected period. Deposits and withdrawals are not counted.',
  'Active since': 'Time of the first deposit or transfer to this account.',
  'Pending deposits': 'Deposits that were sent but not yet credited.',
  'Pending withdrawals': 'Withdrawals that were requested but not yet completed.',
  'Realized PnL (closedPnl)': 'Profit or loss locked in by closing (reducing) positions, before fees and funding.',
  'Realized PnL (by fills)': 'Sum of closedPnl over all trades (loaded fills). Unrealized PnL is not included.',
  'Fees over period': 'Trading fees paid on fills in the selected period. Makers usually pay 0.',
  'Funding over period': 'Funding payments received (+) or paid (−) for holding perpetual positions during the period.',
  'PnL by equity over period': 'Change of equity during the period without deposits and withdrawals. Includes unrealized PnL and any exchange credits.',
  'PnL per $1M volume': 'Net PnL divided by volume, scaled to $1,000,000 traded. A way to compare edge across different sizes. Negative = costs exceed gains.',
  // volume / fees
  'Turnover / deposit': 'Total volume divided by net deposits: how many times the deposit was "turned over".',
  'Fee tier': 'Your trading-fee level. It depends on your rolling 30-day volume (see "Fee tier progress").',
  'Average fill size': 'Total volume divided by the number of fills.',
  'Maker / taker (by volume)': 'Maker = your resting limit order was filled by someone else (usually 0 fee). Taker = you removed liquidity from the book and paid the taker fee. Shown as a share of volume.',
  // trading style
  'Fills': 'Number of executed trades. One order can be split into several fills.',
  'Volume': 'Total notional traded = sum of size × price over all fills.',
  'Fills per hour': 'Number of fills divided by the time between the first and the last fill in the sample.',
  'Win rate (closing fills)': 'Share of closing fills (fills that reduce a position) with positive realized PnL. Opening fills have no PnL and are ignored.',
  'Average win / loss': 'Average realized PnL of the winning closing fills / of the losing closing fills (before fees).',
  'Profit factor': 'Sum of all winning closing fills divided by the absolute sum of all losing closing fills (before fees). Above 1 means wins outweigh losses; 1.5 = $1.50 won for every $1 lost; below 1 = losing.',
  'Best / worst': 'Largest single winning and largest single losing closing fill (closedPnl, before fees).',
  'Closed PnL − fees': 'Sum of closedPnl of all fills minus all fees paid. Funding and unrealized PnL are not included.',
  'Buys / sells': 'Share of volume that was bought vs sold. A strong tilt means a directional bias or a net long/short position.',
  // risk
  'Maintenance margin': 'Minimum equity needed to keep the positions open. If equity falls below it, liquidation starts.',
  'Margin used (initial)': 'Collateral currently locked by open positions (initial margin).',
  'Buffer to liquidation': 'Equity minus maintenance margin: how much more equity can be lost before liquidation. The % is relative to total position size (gross).',
  'Gross / leverage': 'Gross = sum of the absolute sizes of all positions. Leverage = gross ÷ equity.',
  'Longs': 'Total notional of long positions.',
  'Shorts': 'Total notional of short positions.',
  'Net exposure': 'Longs minus shorts: your net directional exposure. The % shows how one-sided the book is.',
  // orders
  'Resting buy notional': 'Total value of open buy limit orders waiting in the order book.',
  'Resting sell notional': 'Total value of open sell limit orders waiting in the order book.',
  'Filled / placed (by size)': 'Filled size divided by the originally placed size over the sampled orders. Low values mean most orders are cancelled before being hit.',
  'Avg. order size': 'Average notional (price × original size) of the sampled orders.',
  'Median time to cancel': 'Typical time between placing an order and cancelling it (cancelled orders only).',
  'Time in force': 'ALO = post-only (maker only). GTC = good till cancelled. IOC = immediate-or-cancel. FOK = fill-or-kill.',
  // fee tier / limits / season
  'Maker / taker fee': 'Fee per trade in basis points (1 bps = 0.01%). Negative = rebate.',
  'Volume to next tier': 'Additional 30-day volume needed to reach the next fee tier.',
  'Markets with leverage set': 'Markets where a leverage value is stored for this account.',
  'Highest leverage set': 'Highest per-market leverage setting. It is a setting, not the leverage currently used.',
  'Lowest leverage set': 'Lowest per-market leverage setting.',
  'Average leverage set': 'Average of the per-market leverage settings.',
  'Order rate-limit pool (used / cap)': 'Allowance for placing orders. Higher realized volume raises the cap.',
  'Cancel rate-limit pool (used / cap)': 'Allowance for cancelling orders.',
  'Total points distributed': 'Sum of the season points of all participants = everything distributed so far.',
  'Average per week': 'Total points distributed divided by the number of weekly drops.',
  'Received': 'Funding payments received.',
  'Paid': 'Funding payments paid.',
  'Cross / isolated': 'Cross = all positions share one collateral pool. Isolated = collateral is limited to each position.',
  'Equity': 'Account value: balance plus unrealized PnL.',
  'Fees': 'Trading fees paid in the period.',
  'Fees (all time)': 'Trading fees paid since the account started.',
  'Fees, all time': 'Trading fees paid since the account started.',
  'Fees, 24h': 'Trading fees paid over the last 24 hours.',
  'Funding (loaded history)': 'Sum of funding payments in the loaded history (the API returns the latest 1,000 payments).',
    'Participants': 'Addresses that have points in the current season.',
  'Next drop': 'Time until the next weekly points distribution.',
  'Last drop (local time)': 'Time of the latest weekly points distribution, in your local time.',
  'Volume, all time': 'Total volume traded since the account started.',
  'Turnover': 'Volume divided by deposit.',
  // table headers
  'uPnL': 'Unrealized PnL of the position at the current mark price.',
  'uPnL %': 'Unrealized PnL as a percentage of the entry price move (direction-adjusted).',
  'Margin': 'Collateral locked by this position.',
  'Liq. price': 'Estimated liquidation price with all other marks unchanged (cross margin). An estimate, not the exchange formula.',
  'To liq.': 'Distance from the current mark price to the estimated liquidation price.',
  'Maker %': 'Share of this market\'s volume traded as maker.',
  'Closed PnL': 'Sum of closedPnl in this market, before fees.',
  'Net': 'Closed PnL minus fees in this market.',
  'Win %': 'Share of closing fills with positive PnL in this market.',
  'Realized PnL': 'Sum of closedPnl in the window (before funding and unrealized PnL).',
};

const tipFor = k => TIPS[String(k).replace(/<[^>]*>/g, '').trim()];
const row = (k, v, title) => { const t = title || tipFor(k); return `<div class="row"${t ? ` data-tip="${esc(t)}"` : ''}><span>${k}</span><b class="num">${v}</b></div>`; };
const SHOWN = { fills: 100, orders: 100, ohist: 100, trades: 50 };
const moreNote = (k, total, what) => total <= SHOWN[k] ? '' : `<p class="note">Showing the latest ${fmt(SHOWN[k], 0)} of ${fmt(total, 0)} ${what}. <button class="linkbtn" data-more="${k}" type="button">Show 200 more</button> <button class="linkbtn" data-more="${k}:all" type="button">Show all</button></p>`;
const CARDS = [
  { id: 'summary', title: 'Account', w: 4, render(S) {
    const a = S.account, eq = n(a.equity), hasDep = a.netDeposits != null, dep = n(a.netDeposits), pnl = eq + n(a.vaultEquity) - dep;
    const upnl = Object.values(a.positions || {}).reduce((x, p) => x + n(p.unrealizedPnl), 0);
    const vault = n(a.vaultEquity), total = eq + vault;
    return `<div class="big num">${money(total)}</div>${vault ? '<div class="muted" style="margin:-6px 0 6px">perps equity + vaults</div>' : ''}<div class="rows">` + (vault ? row('Perps equity', money(eq)) : '') +
      row('PnL by account', hasDep ? `<span class="${cls(pnl)}">${smoney(pnl)}</span>` : '—', 'equity + vault equity − net deposits') +
      row('ROI on deposit', hasDep && dep > 0 ? `<span class="${cls(pnl)}">${sgn(pnl / dep * 100, 1)}%</span>` : '—') +
      row('Net deposits', hasDep ? money(dep) : '—') + row('Free collateral', money(n(a.freeCollateral)), 'withdrawable balance reported by the exchange') +
      row('Unrealized PnL', `<span class="${cls(upnl)}">${smoney(upnl)}</span>`, 'sum of unrealizedPnl of open positions at current mark prices') +
      (n(a.pendingDeposits) ? row('Pending deposits', money(n(a.pendingDeposits))) : '') + (n(a.pendingWithdrawals) ? row('Pending withdrawals', money(n(a.pendingWithdrawals))) : '') +
      (vault ? row('Vault equity', money(vault), 'equity held by this account in the clearinghouse as vault deposits (included in the total above)') : '') +
      row('Active since', S.transfers && S.transfers.length ? dtl(Math.min(...S.transfers.map(x => x.createdAt))) : '—', 'time of the first deposit/withdrawal') +
      row('First fill', S.fills.length && S.fillsDone && !getPeriod(S) && S.fills.length < parseInt($('#depth').value, 10) ? dtl(Math.min(...S.fills.map(x => x.createdAt))) : '—', 'shown when the whole fill history is loaded') +
      row('Open positions / orders', `${fmt(Object.keys(a.positions || {}).length, 0)} / ${fmt((S.openOrders || []).length, 0)}`) +
      (a.stateTime ? row('State as of', dtl(a.stateTime * US)) : '') + `</div>` +
      `<p class="note">Perpetuals account. Spot balances, vaults and campaigns have their own cards; the equity and PnL history is in the charts below.</p>`;
  } },
  { id: 'volume', title: 'Volume & fees', w: 4, render(S) {
    const V = S.vlm, t = feeInfo(S), dep = n(S.account.netDeposits), pr = getPeriod(S), F = S.fs;
    const feeRow = row('Fee tier', t ? `${t.name} · maker ${fmt(t.addBps, 2)} bps · taker ${fmt(t.crossBps, 2)} bps` : '—');
    if (pr) return `<div class="big num">$${big(F.vol)}</div><div class="rows">` + row('Period', esc(pr.label)) + row('Fills', fmt(F.n, 0)) +
      row('Fees over period', money(F.fees)) + row('Maker / taker (by volume)', `${fmt(F.mvol / (F.vol || 1) * 100, 0)}% / ${fmt(F.tvol / (F.vol || 1) * 100, 0)}%`) +
      row('Average fill size', F.n ? money(F.vol / F.n, 0) : '—') + row('Turnover / deposit', S.account.netDeposits != null && dep > 0 ? fmt(F.vol / dep, 1) + '×' : '—') +
      feeRow + row('Volume, last 14 days', V ? '$' + big(V.d14) : '—') + `</div>` +
      (S.fillsDone ? '' : '<p class="note">Period fills are still loading…</p>') + (S.fillsCapped ? '<p class="note">Reached the 100,000-fill limit — the period is not fully counted.</p>' : '');
    const OV = S.hist && S.hist.ov || {}, ov = k => OV[k] ? '$' + big(n(OV[k].volume)) : '—', all = OV.ALLTIME ? n(OV.ALLTIME.volume) : null;
    return `<div class="big num">${all != null ? '$' + big(all) : V ? '$' + big(V.d14) : '—'}</div><div class="muted" style="margin:-6px 0 6px">${all != null ? 'volume, all time' : 'last 14 days · the fee tier basis'}</div><div class="rows">` +
      row('Today (UTC)', V ? '$' + big(V.today) : '—') + row('Last 24 hours', ov('24H')) + row('Last 7 days', ov('7D')) + row('Last 30 days', ov('30D')) + row('Last 90 days', ov('90D')) +
      row('Last 14 days (fee tier basis)', V ? '$' + big(V.d14) : '—', 'completed UTC days plus today') +
      row('Turnover / deposit (all time)', all != null && S.account.netDeposits != null && dep > 0 ? fmt(all / dep, 1) + '×' : '—') +
      row('Fees (loaded fills)', S.fillsDone || S.fills.length ? money(F.fees) : '—', 'trading fees paid on the fills loaded below') + feeRow + `</div>` +
      `<p class="note">Volumes come from the exchange's own statistics. Pick a period above (a week, a custom range or “All time”) for fills-based volume and fees.</p>`;
  } },
  { id: 'pnl', title: 'Profit', w: 4, render(S) {
    const a = S.account, hasDep = a.netDeposits != null, eqp = n(a.equity) + n(a.vaultEquity) - n(a.netDeposits), pr = getPeriod(S), F = S.fs;
    const fund = S.funding ? S.funding.reduce((s, x) => s + n(x.payment), 0) : null;
    if (pr) {
      const pf = periodFunding(S), net = F.pnl - F.fees + pf, oldest = S.funding && S.funding.length ? Math.min(...S.funding.map(x => x.time)) : null;
      return `<div class="big num ${cls(net)}">${smoney(net)}</div><div class="rows">` + row('Period', esc(pr.label)) +
        row('Realized PnL (closedPnl)', `<span class="${cls(F.pnl)}">${smoney(F.pnl)}</span>`) + row('Fees', money(-F.fees)) +
        row('Funding over period', `<span class="${cls(pf)}">${smoney(pf)}</span>`) +
        (() => { const hs = histSeries(S, 'pnl'); return S.hist && hs.length ? row('PnL by exchange stats', `<span class="${cls(hs[hs.length - 1][1])}">${smoney(hs[hs.length - 1][1])}</span>`, 'change of the exchange-reported cumulative PnL (realized + unrealized, without deposits and withdrawals) over the period, in whole UTC days') : ''; })() +
        row('PnL per $1M volume', F.vol > 0 ? smoney(net / F.vol * 1e6, 0) : '—') + `</div>` +
        `<p class="note">Big number = realized − fees + funding.${S.funding && S.funding.length >= 30000 ? ' Funding was capped at 30,000 payments, the period may be incomplete.' : ''}</p>`;
    }
    const net = F.pnl - F.fees;
    return `<div class="big num ${cls(hasDep ? eqp : net)}">${hasDep ? smoney(eqp) : smoney(net)}</div><div class="rows">` +
      row('PnL by account', hasDep ? `<span class="${cls(eqp)}">${smoney(eqp)}</span>` : '—', 'equity + vault equity − net deposits: includes unrealized PnL, fees, funding and any exchange credits') +
      (S.hist && S.hist.ov.ALLTIME ? row('PnL by exchange stats', `<span class="${cls(n(S.hist.ov.ALLTIME.pnl))}">${smoney(n(S.hist.ov.ALLTIME.pnl))}</span>`, 'all-time PnL reported by TxFlow (realized + unrealized, without deposits and withdrawals; transfers from other addresses count as deposits)') +
        row('ROE (exchange stats)', `<span class="${cls(n(S.hist.ov.ALLTIME.roe))}">${sgn(n(S.hist.ov.ALLTIME.roe), 2)}%</span>`) + row('Max drawdown', fmt(n(S.hist.ov.ALLTIME.maxDrawdown), 2) + '%') : '') +
      row('Realized PnL (loaded fills)', S.fills.length ? `<span class="${cls(F.pnl)}">${smoney(F.pnl)}</span>` : '—', 'sum of closedPnl over the fills loaded below; unrealized is not included') +
      row('Fees (loaded fills)', S.fills.length ? money(-F.fees) : '—') +
      row('Funding (loaded history)', fund == null ? '—' : `<span class="${cls(fund)}">${smoney(fund)}</span>`) +
      row('PnL per $1M volume', F.vol > 0 ? smoney(net / F.vol * 1e6, 0) : '—', 'realized PnL − fees over the loaded fills, per $1,000,000 traded') + `</div>` +
      `<p class="note">“By account” and “realized” can differ: they include different things (fees, unrealized PnL, funding, credits). Realized figures cover only the loaded fills (see the “Fills” menu).</p>`;
  } },
  { id: 'risk', title: 'Risk & liquidation', sub: 'now', w: 6, render(S) {
    const R = S.risk, eq = Math.max(R.eq, 1e-6), pm = Math.min(100, R.mm / eq * 100), pi = Math.min(100, R.im / eq * 100);
    const tot = R.long + R.short || 1;
    return `<div class="rows">` + row('Equity', money(R.eq)) + row('Maintenance margin', money(R.mm)) + row('Margin used (initial)', money(R.im)) +
      row('Buffer to liquidation', `<span class="${R.buffer < eq * .3 ? 'neg' : ''}">${money(R.buffer)}</span>${R.gross ? ` · ${fmt(R.buffer / R.gross * 100, 1)}% of gross` : ''}`) +
      row('Gross / leverage', `${money(R.gross, 0)} · ${R.lev == null ? '—' : fmt(R.lev, 2) + '×'}`) +
      (S.account.crossMarginRatio != null ? row('Cross margin ratio', fmt(n(S.account.crossMarginRatio), 2) + '%', 'maintenance margin ÷ equity as reported by the exchange; liquidation starts at 100%') : '') +
      (S.account.totalNtlPos != null ? row('Total position notional', money(n(S.account.totalNtlPos), 0), 'sum of position values reported by the exchange') : '') +
      (S.account.totalRawUsd != null ? row('Raw USD balance', money(n(S.account.totalRawUsd)), 'cash balance before unrealized PnL') : '') +
      (S.account.equityPlusHold != null ? row('Equity incl. withdraw hold', money(n(S.account.equityPlusHold)), 'account value including funds held for pending withdrawals') : '') + `</div>` +
      `<div class="bar2" title="fill: share of equity used as margin"><span style="width:${pi}%;background:var(--s1);opacity:.35"></span><span style="width:${pm}%;background:var(--s2)"></span></div>
       <div class="legend"><span><i style="background:var(--s2)"></i>maintenance</span><span><i style="background:var(--s1);opacity:.4"></i>initial</span></div>
       <div class="rows" style="margin-top:12px">` + row('Longs', `<span class="pos">${money(R.long, 0)}</span>`) + row('Shorts', `<span class="neg">${money(R.short, 0)}</span>`) + row('Net exposure', `<span class="${cls(R.long - R.short)}">${smoney(R.long - R.short, 0)}</span> · ${sgn((R.long - R.short) / tot * 100, 0)}% of total`) + `</div>
       <div class="bar2"><span style="width:${R.long / tot * 100}%;background:var(--good);opacity:.85"></span><span style="left:${R.long / tot * 100}%;width:${R.short / tot * 100}%;background:var(--bad);opacity:.85"></span></div>`;
  } },
  { id: 'positions', title: 'Open positions', sub: 'now', w: 12, render(S) {
    const R = S.risk; if (!R.rows.length) return '<div class="empty">No open positions</div>';
    const rows = R.rows.slice().sort((a, b) => b.notl - a.notl);
    const tpslCell = (p, k, mid) => { const v = (p.tpsl || []).filter(t => n(t[k])); return v.length ? v.map(t => `${pxf(n(t[k]))}<br><span class="muted">${mid ? sgn((n(t[k]) - mid) / mid * 100, 2) + '%' : ''} · ${n(t.qty) ? fmt(n(t.qty), 4) : 'all'}</span>`).join('<br>') : '—'; };
    const tk = S.tickers || {}, adlTip = 'Auto-deleveraging quantile reported by the exchange: 1 = lowest priority, 5 = first in line to be deleveraged.';
    return `<div class="scroll"><table><thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Size $</th><th>Entry</th><th>Mark</th><th>uPnL</th><th>uPnL %</th><th title="Return on the margin used by this position (reported by the exchange)">ROE %</th><th>Leverage</th><th>Max lev.</th><th>Margin</th><th>Liq. price</th><th>To liq.</th><th title="Take-profit trigger price set on this position, with the distance from the mark price; “all” = the whole position">Take profit</th><th title="Stop-loss trigger price set on this position, with the distance from the mark price">Stop loss</th><th title="${adlTip}">ADL</th><th title="Realized PnL of this position since it was opened (closedPnl from the exchange)">Realized</th><th title="Fees paid on this position since it was opened">Fees</th><th title="Funding of this position since it was opened, as reported by the exchange (+ received, − paid)">Funding since open</th><th title="Current funding rate per hour (market data)">Funding rate/h</th><th>Updated</th></tr></thead><tbody>` +
      rows.map(({ p, s, mid, notl, liq, dist }) => { const up = n(p.unrealizedPnl), ent = n(p.averageEntryPrice), pc = ent ? (s > 0 ? 1 : -1) * (mid - ent) / ent * 100 : 0, t = tk[p.instrumentId], fu = p.fundingSinceOpen == null || p.fundingSinceOpen === '' ? null : -n(p.fundingSinceOpen);
        return `<tr><td>${esc(p.marketDisplayName)}</td><td><span class="tag ${s > 0 ? 'ok' : 'bad'}">${s > 0 ? '▲ LONG' : '▼ SHORT'}</span></td><td class="num">${fmt(Math.abs(s), 4)}</td><td class="num">${money(notl)}</td><td class="num">${pxf(ent)}</td><td class="num">${pxf(mid)}</td><td class="num ${cls(up)}">${smoney(up, 2)}</td><td class="num ${cls(pc)}">${sgn(pc, 2)}%</td><td class="num ${cls(n(p.roe))}">${p.roe == null ? '—' : sgn(n(p.roe), 2) + '%'}</td><td class="num">${esc(p.leverage)}× ${p.marginMode === 'ISOLATED' ? 'iso' : 'cross'}</td><td class="num">${p.maxLeverage ? esc(p.maxLeverage) + '×' : '—'}</td><td class="num">${money(n(p.marginUsed))}</td><td class="num">${liq ? pxf(liq) : '—'}</td><td class="num">${dist == null ? '—' : fmt(dist, 1) + '%'}</td><td class="num">${tpslCell(p, 'tp', mid)}</td><td class="num">${tpslCell(p, 'sl', mid)}</td><td class="num">${p.adl == null ? '—' : esc(p.adl)}</td><td class="num ${cls(n(p.closedPnl))}">${p.closedPnl == null ? '—' : smoney(n(p.closedPnl), 2)}</td><td class="num">${p.cumFee == null ? '—' : money(n(p.cumFee), 2)}</td><td class="num ${cls(fu)}">${fu == null ? '—' : smoney(fu, 2)}</td><td class="num ${t ? cls(-n(t.fundingRate) * (s > 0 ? 1 : -1)) : ''}">${t ? sgn(n(t.fundingRate) * 100, 4) + '%' : '…'}</td><td class="num">${p.updatedAt ? dt(p.updatedAt) : '—'}</td></tr>`; }).join('') + `</tbody></table></div>
      <p class="note">Liquidation prices, ROE, ADL and cumulative figures are the ones reported by the exchange. “Funding since open” uses the exchange's cumFunding with the sign flipped (positive = received); the funding-rate colour shows whether the rate pays or costs this side. Leverage is the setting of each position.</p>`;
  } },
  { id: 'activity', title: 'Trading style', sub: fsub, w: 4, render(S) {
    const F = S.fs; if (!S.fills.length) return S.fillsDone ? '<div class="empty">No fills</div>' : '<div class="empty">Loading fills…</div>';
    const span = (F.t1 - F.t0) / 1e6, closed = F.wins + F.losses, pf = F.lossSum ? F.winSum / -F.lossSum : null;
    return `<div class="rows">` + row('Fills', fmt(F.n, 0)) + row('Period', `${dtl(F.t0)} – ${dtl(F.t1)}`) + row('Volume', '$' + big(F.vol)) +
      row('Maker / taker (by volume)', `${fmt(F.mvol / (F.vol || 1) * 100, 0)}% / ${fmt(F.tvol / (F.vol || 1) * 100, 0)}%`) +
      row('Average fill size', money(F.vol / F.n, 0)) + row('Fills per hour', span > 60 ? fmt(F.n / (span / 3600), 1) : '—') +
      row('Win rate (closing fills)', closed ? fmt(F.wins / closed * 100, 1) + '%' : '—') +
      row('Average win / loss', closed ? `${smoney(F.wins ? F.winSum / F.wins : 0, 3)} / ${smoney(F.losses ? F.lossSum / F.losses : 0, 3)}` : '—') +
      row('Profit factor', pf == null ? '—' : fmt(pf, 2)) + row('Best / worst', `${smoney(F.maxWin, 2)} / ${smoney(F.maxLoss, 2)}`) +
      row('Closed PnL − fees', `<span class="${cls(F.pnl - F.fees)}">${smoney(F.pnl - F.fees, 2)}</span>`) +
      row('Buys / sells', `${fmt(F.buyVol / (F.vol || 1) * 100, 0)}% / ${fmt(F.sellVol / (F.vol || 1) * 100, 0)}%`) + `</div>`;
  } },
  { id: 'curve', title: 'Realized PnL curve', sub: S => 'closedPnl − fees · ' + fsub(S), w: 8, render() { return '<div class="chartbox" data-ch="curve"></div>'; },
    after(el, S) { const b = $('[data-ch=curve]', el); if (S.fs.curve.length < 2) { b.innerHTML = '<div class="empty">Need more fills</div>'; return; }
      lineChart(b, S.fs.curve, { color: css('--s1'), zero: true, minRange: 0.5, axis: v => smoney(v, Math.abs(v) < 10 ? 2 : 0), tip: v => smoney(v, 2), xfmt: tshort, tfmt: tshort }); } },
  { id: 'daily', title: 'Volume by day', sub: S => 'UTC · ' + fsub(S), w: 6, render() { return '<div class="chartbox" data-ch="daily"></div>'; },
    after(el, S) { const b = $('[data-ch=daily]', el), items = Object.keys(S.fs.byDay).sort().map(k => ({ label: k.slice(8) + '.' + k.slice(5, 7), v: S.fs.byDay[k].vol, net: S.fs.byDay[k].net }));
      barChart(b, items, { color: css('--s2'), axis: usd, tip: (v, it) => `$${fmt(v, 0)} · net ${smoney(it.net, 2)}` }); } },
  { id: 'hourly', title: 'Activity by hour', sub: S => 'UTC, volume · ' + fsub(S), w: 6, render() { return '<div class="chartbox" data-ch="hourly"></div>'; },
    after(el, S) { barChart($('[data-ch=hourly]', el), S.fs.byHour.map((v, h) => ({ label: String(h).padStart(2, '0'), v })), { color: css('--s3'), axis: usd, tip: v => '$' + fmt(v, 0) }); } },
  { id: 'bymarket', title: 'Markets', sub: fsub, w: 12, render(S) {
    const F = S.fs, ks = Object.keys(F.byM); if (!ks.length) return '<div class="empty">No data</div>';
    const rows = ks.map(k => { const m = F.byM[k]; return { k, ...m, net: m.pnl - m.fees, win: (m.wins + m.losses) ? m.wins / (m.wins + m.losses) * 100 : null }; });
    const key = S.sortKey || 'vol', dir = S.sortDir || -1; rows.sort((a, b) => ((a[key] > b[key]) - (a[key] < b[key])) * dir || 0);
    const th = (k, t) => `<th data-sort="${k}">${t}${k === key ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    return `<div class="scroll"><table><thead><tr>${th('k', 'Market')}${th('fills', 'Fills')}${th('vol', 'Volume $')}${th('mk', 'Maker %')}${th('pnl', 'Closed PnL')}${th('fees', 'Fees')}${th('net', 'Net')}${th('win', 'Win %')}</tr></thead><tbody>` +
      rows.map(r => `<tr><td>${esc(r.k)}</td><td class="num">${r.fills}</td><td class="num">${fmt(r.vol, 0)}</td><td class="num">${fmt(r.mvol / (r.vol || 1) * 100, 0)}</td><td class="num ${cls(r.pnl)}">${smoney(r.pnl, 2)}</td><td class="num">${fmt(r.fees, 2)}</td><td class="num ${cls(r.net)}">${smoney(r.net, 2)}</td><td class="num">${r.win == null ? '—' : fmt(r.win, 0)}</td></tr>`).join('') + `</tbody></table></div>`;
  } },
  { id: 'orderflow', title: 'Order flow', sub: S => S.orders ? `${fmt(S.orders.length, 0)} orders · ${getPeriod(S) ? getPeriod(S).label : 'recent'}` : '', w: 4, render(S) {
    const o = S.orders; if (!o) return '<div class="empty">Loading orders…</div>'; if (!o.length) return '<div class="empty">No orders</div>';
    const st = {}, tif = {}, life = []; let plac = 0, filled = 0, buy = 0;
    for (const x of o) { st[x.status] = (st[x.status] || 0) + 1; tif[x.timeInForce] = (tif[x.timeInForce] || 0) + 1; const px = n(x.price); plac += n(x.originalSize) * px; filled += n(x.filledSize) * (n(x.avgFillPrice) || px); if (/CANCEL/.test(x.status)) life.push((x.updatedAt - x.createdAt) / 1e6); if (x.side === 'BUY') buy++; }
    life.sort((a, b) => a - b); const med = life.length ? life[life.length >> 1] : null, pc = (k, m) => fmt(k / m * 100, 0) + '%';
    return `<div class="rows">` + Object.entries(st).sort((a, b) => b[1] - a[1]).map(([k, v]) => row(esc(k.toLowerCase().replace(/_/g, ' ')), `${fmt(v, 0)} · ${pc(v, o.length)}`)).join('') +
      row('Filled / placed (by size)', plac ? fmt(filled / plac * 100, 1) + '%' : '—') + row('Avg. order size', '$' + fmt(plac / o.length, 0)) +
      row('Median time to cancel', med == null ? '—' : med < 120 ? fmt(med, 1) + ' s' : dur(med)) +
      row('Time in force', Object.entries(tif).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${pc(v, o.length)}`).join(' · ')) +
      row('Order types', Object.entries(o.reduce((m, x) => (m[x.orderType || '—'] = (m[x.orderType || '—'] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${pc(v, o.length)}`).join(' · ')) +
      row('Reduce-only orders', pc(o.filter(x => x.reduceOnly).length, o.length)) + row('Realized PnL of these orders', `<span class="${cls(o.reduce((a, x) => a + n(x.pnl), 0))}">${smoney(o.reduce((a, x) => a + n(x.pnl), 0), 2)}</span>`, 'sum of the pnl field the exchange reports on these orders') +
      row('Buys / sells', `${pc(buy, o.length)} / ${pc(o.length - buy, o.length)}`) + `</div>` + (o.length >= 3000 ? '<p class="note">Only the orders loaded so far are analyzed (the latest 3,000 at most).</p>' : '');
  } },
  { id: 'feetier', title: 'Fee tier progress', sub: '14-day volume', w: 4, render(S) {
    const t = feeInfo(S); if (!t) return '<div class="empty">No data</div>';
    const ct = t.tiers[t.cur] || {}, nx = t.tiers[t.cur + 1], bp = x => fmt(x, 2), pct = nx ? Math.min(100, t.vol / nx.cutoff * 100) : 100;
    return `<div class="big">${esc(t.name)}</div><div class="rows">` +
      row('14-day volume', '$' + big(t.vol), 'rolling 14-day volume of completed UTC days plus today; TxFlow assesses the tier at the end of each UTC day') +
      row('Maker / taker fee', `${bp(t.addBps)} / ${bp(t.crossBps)} bps`) + (S.fee && n(S.fee.activeReferralDiscount) ? row('Referral discount', fmt(n(S.fee.activeReferralDiscount) * 100, 2) + '%') : '') +
      row('Base tier fee (VIP 0)', `${bp((t.tiers[0] || {}).addBps)} / ${bp((t.tiers[0] || {}).crossBps)} bps`, 'standard maker / taker fee before any volume tier') +
      (nx ? row(`Next: ${esc(nx.name)}`, `$${big(nx.cutoff)} · taker ${bp(nx.crossBps)} bps`) + row('Volume to next tier', '$' + big(Math.max(0, nx.cutoff - t.vol))) : row('Next tier', 'highest tier reached')) + `</div>` +
      `<div class="bar2" title="progress to the next tier"><span style="width:${pct}%;background:var(--s3)"></span></div>` +
      `<div class="scroll" style="max-height:200px;margin-top:8px"><table><thead><tr><th>Tier</th><th>14d volume ≥</th><th>Maker</th><th>Taker</th></tr></thead><tbody>` +
      t.tiers.map(x => `<tr${x.level === t.cur ? ' style="background:var(--surface-2)"' : ''}><td>${x.level === t.cur ? '▶ ' : ''}${esc(x.name)}</td><td class="num">${x.cutoff ? '$' + big(x.cutoff) : '—'}</td><td class="num">${bp(x.addBps)}</td><td class="num">${bp(x.crossBps)}</td></tr>`).join('') + `</tbody></table></div><p class="note">Fees in bps. The tier is estimated from the daily volume the API returns (last 14 days); your actual rates may include referral discounts or fee credits.</p>`;
  } },
  { id: 'funding', title: 'Funding', w: 4, render(S) {
    const pr = getPeriod(S), f = S.funding && S.funding.filter(x => inP(pr, x.time)); if (!f) return '<div class="empty">No data</div>'; if (!f.length) return '<div class="empty">No payments</div>';
    const tot = f.reduce((s, x) => s + n(x.payment), 0), by = {}; f.forEach(x => by[x.marketDisplayName] = (by[x.marketDisplayName] || 0) + n(x.payment));
    const top = Object.entries(by).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
    return `<div class="big num ${cls(tot)}">${smoney(tot, 2)}</div><div class="rows">` + top.map(([k, v]) => row(esc(k), `<span class="${cls(v)}">${smoney(v, 3)}</span>`)).join('') + row('Received', `<span class="pos">${smoney(f.filter(x => n(x.payment) > 0).reduce((a, x) => a + n(x.payment), 0), 2)}</span>`) + row('Paid', `<span class="neg">${smoney(f.filter(x => n(x.payment) < 0).reduce((a, x) => a + n(x.payment), 0), 2)}</span>`) + `</div>` +
      (() => { const m = {}; f.forEach(x => { const o = m[x.marketDisplayName] || (m[x.marketDisplayName] = { n: 0, sum: 0, rate: 0, abs: 0 }); o.n++; o.sum += n(x.payment); o.rate += n(x.rate); o.abs += Math.abs(n(x.szi)); });
        const rs = Object.entries(m).sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum)).slice(0, 40);
        return `<div class="scroll" style="max-height:220px;margin-top:8px"><table><thead><tr><th>Market</th><th>Payments</th><th>Total</th><th title="Average funding rate per hour over the loaded payments">Avg rate/h</th></tr></thead><tbody>` + rs.map(([k, o]) => `<tr><td>${esc(k)}</td><td class="num">${o.n}</td><td class="num ${cls(o.sum)}">${smoney(o.sum, 3)}</td><td class="num">${sgn(o.rate / o.n * 100, 4)}%</td></tr>`).join('') + `</tbody></table></div>`; })() +
      `<p class="note">${f.length} payments loaded (+ received, − paid).${S.fundingDone ? '' : ' Still loading…'}</p>`;
  } },
  { id: 'transfers', title: 'Deposits & withdrawals', w: 4, render(S) {
    const pr = getPeriod(S), t = S.transfers && S.transfers.filter(x => inP(pr, x.createdAt)); if (!t) return '<div class="empty">No data</div>'; if (!t.length) return '<div class="empty">No transfers</div>';
    const net = t.filter(x => x.status === 'APPLIED').reduce((s, x) => s + x.sign * x.amount, 0);
    const sum = (type) => t.filter(x => x.status === 'APPLIED' && x.type === type && x.sign).reduce((s, x) => s + x.amount, 0), cnt = type => t.filter(x => x.type === type).length;
    const bonus = S.camp && S.camp.bonus, bn = bonus && bonus.reward && /claim|issu/i.test((bonus.state || '') + (bonus.reward.state || '')) ? bonus.reward : null, short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
    const label = x => x.type === 'RECEIVED' ? `received from <span title="${esc(x.cp)}">${short(x.cp)}</span>` : x.type === 'SENT' ? `sent to <span title="${esc(x.cp)}">${short(x.cp)}</span>` : x.type === 'TRANSFER' ? 'spot ↔ perp' : x.type === 'OTHER' ? esc(x.kind) : x.type.toLowerCase();
    return `<div class="big num">${smoney(net, 2)}</div><div class="rows">` + row('Deposited', `<span class="pos">${money(sum('DEPOSIT'))}</span> · ${cnt('DEPOSIT')}`) + row('Withdrawn', `<span class="neg">${money(sum('WITHDRAWAL'))}</span> · ${cnt('WITHDRAWAL')}`) +
      (cnt('RECEIVED') ? row('Received from other addresses', `<span class="pos">${money(sum('RECEIVED'))}</span> · ${cnt('RECEIVED')}`, 'incoming transfers sent to this address by another address (for example rewards or bonuses paid out by TxFlow)') : '') +
      (cnt('SENT') ? row('Sent to other addresses', `<span class="neg">${money(sum('SENT'))}</span> · ${cnt('SENT')}`) : '') + row('Operations', fmt(t.length, 0)) + `</div>` +
      `<div class="scroll" style="max-height:260px;margin-top:8px"><table><thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>Chain</th><th>Status</th></tr></thead><tbody>` +
      t.slice(0, 100).map(x => `<tr><td class="num">${dtl(x.createdAt)}</td><td><span class="tag ${x.sign > 0 ? 'ok' : x.sign < 0 ? 'bad' : ''}">${label(x)}</span></td><td class="num ${x.sign < 0 ? 'neg' : x.sign > 0 ? 'pos' : ''}">${x.sign < 0 ? '−' : x.sign > 0 ? '+' : ''}${money(x.amount)}</td><td>${esc(x.chain || '—')}</td><td>${x.status === 'APPLIED' ? 'done' : 'pending'}</td></tr>`).join('') + `</tbody></table></div>` +
      `<p class="note">${t.length > 100 ? 'Showing the latest 100 of ' + t.length + '. ' : ''}Net = deposits − withdrawals ± transfers between addresses. Movements that do not touch the perps account (spot, vault events) are listed with their API name and not counted.${bn ? ` This address received the new-user bonus (${esc(bn.amount)} ${esc(bn.type)}); TxFlow pays such bonuses out as small incoming transfers.` : ''}</p>`;
  } },
  { id: 'orders', title: 'Open orders', sub: 'incl. TP/SL · now', w: 6, render(S) {
    const tps = ((S.cond && S.cond.tpsl) || []).flatMap(t => [['tp', 'Take profit'], ['sl', 'Stop loss']].filter(([k]) => n(t[k + 'TriggerPrice'])).map(([k, lab]) => ({ marketDisplayName: coinName(t.coin), side: t.side === 'B' ? 'BUY' : 'SELL', orderType: lab + ' ' + String(t[k + 'OrderType'] || 'market').toLowerCase(), price: n(t[k + 'OrderPrice']), triggerPx: t[k + 'TriggerPrice'], triggerCondition: '', remainingSize: t.quantity, origSize: t.quantity, all: !n(t.quantity), timeInForce: '—', leverage: t.leverage, marginMode: t.marginMode, reduceOnly: true, isTpsl: true, isTrigger: true, createdAt: t.createTime * US })));
    const o = (S.openOrders || []).concat(tps); if (!o.length) return '<div class="empty">No open orders</div>';
    const by = {}; o.forEach(x => by[x.marketDisplayName] = (by[x.marketDisplayName] || 0) + 1);
    return `<div class="rows">` + row('Total', fmt(o.length, 0)) + row('Markets', Object.keys(by).length) + row('Buys / sells', `${o.filter(x => x.side === 'BUY').length} / ${o.filter(x => x.side === 'SELL').length}`) +
      row('Resting buy notional', money(o.filter(x => x.side === 'BUY').reduce((a, x) => a + n(x.price) * n(x.remainingSize), 0), 0)) + row('Resting sell notional', money(o.filter(x => x.side === 'SELL').reduce((a, x) => a + n(x.price) * n(x.remainingSize), 0), 0)) +
      (() => { const cnt = (f) => { const m = {}; o.forEach(x => { const k = f(x); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${fmt(v, 0)}`).join(' · '); };
        return row('Order types', cnt(x => x.orderType || '—')) + row('Time in force', cnt(x => x.timeInForce || '—')) + row('Reduce-only / TP-SL / trigger', `${fmt(o.filter(x => x.reduceOnly).length, 0)} / ${fmt(o.filter(x => x.isTpsl).length, 0)} / ${fmt(o.filter(x => x.isTrigger).length, 0)}`) +
          row('Partially filled', fmt(o.filter(x => n(x.origSize) > n(x.remainingSize) + 1e-12).length, 0)) + row('Oldest order', dt(Math.min(...o.map(x => x.createdAt)))); })() + `</div>` +
      `<div class="scroll" style="margin-top:8px;max-height:260px"><table><thead><tr><th>Market</th><th>Side</th><th>Type</th><th>Price</th><th>Trigger</th><th>Remaining</th><th>Size</th><th>TIF</th><th>Lev.</th><th>Flags</th><th>Created</th></tr></thead><tbody>` +
      o.slice(0, SHOWN.orders).map(x => `<tr><td>${esc(x.marketDisplayName)}</td><td><span class="${x.side === 'BUY' ? 'pos' : 'neg'}">${x.side === 'BUY' ? '▲ BUY' : '▼ SELL'}</span></td><td>${esc(x.orderType || '—')}</td><td class="num">${n(x.price) ? pxf(n(x.price)) : '<span class="muted">market</span>'}</td><td class="num">${n(x.triggerPx) ? esc(x.triggerCondition || '') + ' ' + pxf(n(x.triggerPx)) : '—'}</td><td class="num">${x.all ? 'all' : fmt(n(x.remainingSize), 4)}</td><td class="num">${x.all ? 'all' : fmt(n(x.origSize), 4)}</td><td>${esc(x.timeInForce)}</td><td class="num">${x.leverage ? esc(x.leverage) + '× ' + (/iso/i.test(x.marginMode) ? 'iso' : 'x') : '—'}</td><td>${[x.reduceOnly && 'reduce', x.isTpsl && 'tp/sl', x.isTrigger && 'trigger'].filter(Boolean).join(' ') || '—'}</td><td class="num">${dt(x.createdAt)}</td></tr>`).join('') + `</tbody></table></div>${moreNote('orders', o.length, 'open orders')}`;
  } },
  { id: 'fills', title: 'Recent fills', sub: fsub, w: 6, render(S) {
    if (!S.fills.length) return '<div class="empty">No fills</div>';
    return `<div class="scroll"><table><thead><tr><th>Time</th><th>Market</th><th>Side</th><th title="Opens/adds to a position, or reduces/closes it (from the position size before the fill)">Action</th><th>Price</th><th>Size</th><th>$</th><th>Role</th><th>Lev.</th><th>Fee</th><th>Closed PnL</th><th>Net</th></tr></thead><tbody>` +
      S.fills.slice(0, SHOWN.fills).map(f => { const sz = n(f.size), v = sz * n(f.price), p = n(f.closedPnl) - n(f.fee), sg = f.side === 'BUY' ? 1 : -1, sp = f.startPos || 0, act = !sp || Math.sign(sp) === sg ? (sp ? 'add' : 'open') : (sz > Math.abs(sp) + 1e-12 ? 'flip' : Math.abs(Math.abs(sp) - sz) < 1e-9 ? 'close' : 'reduce');
        return `<tr><td class="num">${dt(f.createdAt)}</td><td>${esc(f.marketDisplayName)}</td><td><span class="${f.side === 'BUY' ? 'pos' : 'neg'}">${f.side === 'BUY' ? '▲ BUY' : '▼ SELL'}</span></td><td>${act}${f.twap ? ' · twap' : ''}</td><td class="num">${pxf(n(f.price))}</td><td class="num">${fmt(sz, 4)}</td><td class="num">${fmt(v, 1)}</td><td><span class="tag ${f.role === 'MAKER' ? 'ok' : 'warn'}">${f.role.toLowerCase()}</span></td><td class="num">${f.lev ? esc(f.lev) + '× ' + (/iso/i.test(f.mmode) ? 'iso' : 'x') : '—'}</td><td class="num">${fmt(n(f.fee), 4)}</td><td class="num ${cls(n(f.closedPnl))}">${n(f.closedPnl) ? smoney(n(f.closedPnl), 3) : '—'}</td><td class="num ${cls(p)}">${n(f.closedPnl) || n(f.fee) ? smoney(p, 3) : '—'}</td></tr>`; }).join('') + `</tbody></table></div>${moreNote('fills', S.fills.length, 'loaded fills')}`;
  } },
  { id: 'volday', title: 'Daily volume', sub: 'last 14 days · UTC', w: 6, render() { return '<div class="chartbox" data-ch="volday"></div>'; },
    after(el, S) { const f = S.fee, b = $('[data-ch=volday]', el); if (!f || !Array.isArray(f.dailyUserVlm)) { b.innerHTML = '<div class="empty">No data</div>'; return; }
      const lab = ms => { const d = new Date(ms).toISOString(); return d.slice(8, 10) + '.' + d.slice(5, 7); };
      const items = f.dailyUserVlm.slice().sort((a, b) => a.date - b.date).map(x => ({ label: lab(+x.date), v: n(x.exchange) })); items.push({ label: lab(Date.now()) + '*', v: n(f.volumeToday) });
      barChart(b, items, { color: css('--s2'), axis: usd, tip: v => '$' + fmt(v, 0) }); } },
  { id: 'leverage', title: 'Leverage & order style', sub: fsub, w: 4, render(S) {
    const L = S.ls; if (!S.fills.length) return S.fillsDone ? '<div class="empty">No fills</div>' : '<div class="empty">Loading fills…</div>';
    const tot = L.open + L.close || 1, bars = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `<div class="hbar"><div class="hbl"><span>${esc(k)}</span><b class="num">${fmt(v / (L.vol || 1) * 100, 1)}% · $${big(v)}</b></div><div class="hbt"><i style="width:${v / (L.vol || 1) * 100}%"></i></div></div>`).join('');
    return `<div class="rows">` + row('Volume-weighted leverage', L.vol ? fmt(L.wlev / L.vol, 2) + '×' : '—', 'leverage setting of each fill, weighted by its notional') + row('Highest leverage used', L.maxLev ? L.maxLev + '×' : '—') +
      row('Opening / adding fills', `${fmt(L.open, 0)} · ${fmt(L.open / tot * 100, 0)}%`, 'fills that open or add to a position') + row('Closing / reducing fills', `${fmt(L.close, 0)} · ${fmt(L.close / tot * 100, 0)}%`) + row('Position flips', fmt(L.flip, 0), 'fills that close a position and open the opposite one') +
      row('Closed longs', `${fmt(L.closeLong.n, 0)} · <span class="${cls(L.closeLong.pnl)}">${smoney(L.closeLong.pnl, 2)}</span>`, 'closing fills of long positions: count and realized PnL') + row('Closed shorts', `${fmt(L.closeShort.n, 0)} · <span class="${cls(L.closeShort.pnl)}">${smoney(L.closeShort.pnl, 2)}</span>`) +
      row('Reduce-only fills', fmt(L.ro, 0)) + row('TWAP fills', fmt(L.twap, 0)) + row('Fee token', Object.entries(L.fee).map(([k, v]) => `${esc(k)} ${fmt(v, 2)}`).join(' · ')) + `</div>` +
      `<div class="rows" style="margin-top:10px"><div class="row"><span><b>Volume by leverage</b></span><span></span></div></div>` + bars(Object.fromEntries(Object.entries(L.lev).map(([k, v]) => [k + '×', v]))) +
      `<div class="rows" style="margin-top:10px"><div class="row"><span><b>Volume by margin mode</b></span><span></span></div></div>` + bars(L.modes);
  } },
  { id: 'trades', title: 'Best & worst closed orders', sub: S => S.orders ? `${fmt(S.orders.length, 0)} orders · ${getPeriod(S) ? getPeriod(S).label : 'recent'}` : '', w: 6, render(S) {
    const o = S.orders; if (!o) return '<div class="empty">Loading orders…</div>';
    const c = o.filter(x => n(x.pnl) !== 0); if (!c.length) return '<div class="empty">No closed orders with PnL</div>';
    const srt = c.slice().sort((a, b) => n(b.pnl) - n(a.pnl)), tbl = (title, a) => `<div class="rows" style="margin-top:8px"><div class="row"><span><b>${title}</b></span><span></span></div></div><div class="scroll" style="max-height:230px"><table><thead><tr><th>Time</th><th>Market</th><th>Order</th><th>Entry</th><th>Exit</th><th>Size $</th><th>PnL</th><th>ROE %</th></tr></thead><tbody>` +
      a.map(x => `<tr><td class="num">${dt(x.createdAt)}</td><td>${esc(x.marketDisplayName)}</td><td>${esc(x.dir || x.side)} ${esc((x.orderType || '').toLowerCase())}</td><td class="num">${pxf(n(x.entryPrice))}</td><td class="num">${pxf(n(x.avgFillPrice))}</td><td class="num">${fmt(n(x.filledSize) * (n(x.avgFillPrice) || n(x.price)), 0)}</td><td class="num ${cls(n(x.pnl))}">${smoney(n(x.pnl), 2)}</td><td class="num ${cls(n(x.roe))}">${sgn(n(x.roe), 2)}%</td></tr>`).join('') + `</tbody></table></div>`;
    const wins = srt.filter(x => n(x.pnl) > 0), losses = srt.filter(x => n(x.pnl) < 0).reverse();
    return (wins.length ? tbl('Best ' + Math.min(8, wins.length), wins.slice(0, 8)) : '<div class="empty">No profitable orders</div>') + (losses.length ? tbl('Worst ' + Math.min(8, losses.length) + ' (losing orders)', losses.slice(0, 8)) : '<div class="empty">No losing orders in the loaded history</div>') + `<p class="note">From the orders returned by the API (latest ${fmt(o.length, 0)}); PnL and ROE are the exchange's per-order values.</p>`;
  } },
  { id: 'spot', title: 'Spot', w: 6, render(S) {
    const sp = S.spot, bal = sp && sp.balances || []; if (!sp) return '<div class="empty">Loading…</div>';
    const px = b => b.coin === 'USDC' ? 1 : n(b.midPrice) || n(b.lastPrice), val = b => n(b.total) * px(b), tot = bal.reduce((a, b) => a + val(b), 0), F = S.spotFills || [], fv = F.reduce((a, f) => a + n(f.size) * n(f.price), 0);
    return `<div class="big num">${money(tot)}</div><div class="muted" style="margin:-6px 0 6px">spot balances at mid price</div>` +
      (bal.length ? `<div class="scroll" style="max-height:200px"><table><thead><tr><th>Asset</th><th>Total</th><th>On hold</th><th>Price</th><th>Value</th><th>Entry value</th><th>PnL</th></tr></thead><tbody>` +
        bal.map(b => { const v = val(b), e = n(b.entryNtl), p = e > 0 ? v - e : null; return `<tr><td>${esc(b.displayName || b.coin)}</td><td class="num">${fmt(n(b.total), 4)}</td><td class="num">${fmt(n(b.hold), 4)}</td><td class="num">${px(b) ? pxf(px(b)) : '—'}</td><td class="num">${money(v)}</td><td class="num">${e > 0 ? money(e) : '—'}</td><td class="num ${cls(p)}">${p == null ? '—' : smoney(p, 2)}</td></tr>`; }).join('') + `</tbody></table></div>` : '<div class="empty">No spot balances</div>') +
      `<div class="rows" style="margin-top:10px">` + row('Spot fills', S.spotFills ? fmt(F.length, 0) : 'loading…') + row('Spot volume (loaded)', S.spotFills ? '$' + big(fv) : '—') + row('Spot fees (loaded)', S.spotFills ? money(F.reduce((a, f) => a + n(f.fee), 0), 4) : '—') + `</div>` +
      (F.length ? `<div class="scroll" style="max-height:200px;margin-top:8px"><table><thead><tr><th>Time</th><th>Pair</th><th>Side</th><th>Price</th><th>Size</th><th>$</th><th>Role</th><th>Fee</th></tr></thead><tbody>` +
        F.slice(0, 40).map(f => `<tr><td class="num">${dt(f.createdAt)}</td><td>${esc(f.marketDisplayName)}</td><td><span class="${f.side === 'BUY' ? 'pos' : 'neg'}">${f.side === 'BUY' ? '▲ BUY' : '▼ SELL'}</span></td><td class="num">${pxf(n(f.price))}</td><td class="num">${fmt(n(f.size), 4)}</td><td class="num">${fmt(n(f.size) * n(f.price), 2)}</td><td>${f.role.toLowerCase()}</td><td class="num">${fmt(n(f.fee), 4)}</td></tr>`).join('') + `</tbody></table></div>` : '');
  } },
  { id: 'vaults', title: 'Vaults', w: 6, render(S) {
    const sv = S.selfVault, vs = S.vaults; if (!sv && !vs) return '<div class="empty">Loading…</div>';
    let h = '';
    if (sv) h += `<div class="rows"><div class="row"><span><b>This address is a vault: ${esc(sv.name)}</b></span><span></span></div>` + row('TVL', money(n(sv.tvl), 0)) + row('Leader', esc(sv.leader.slice(0, 6) + '…' + sv.leader.slice(-4))) + row('Leader commission', fmt(n(sv.leaderCommission) * 100, 1) + '%') +
      row('Followers', fmt((sv.followers || []).length, 0)) + row('Created', dtl(sv.createTimeMillis * US)) + row('Deposits', sv.allowDeposits ? 'open' : 'closed') + row('Max withdrawable', money(n(sv.maxWithdrawable), 0)) + `</div>`;
    if (vs && vs.length) h += `<div class="scroll"><table><thead><tr><th>Vault</th><th>Your equity</th><th>Cost basis</th><th>PnL</th><th>All-time PnL</th><th>TVL</th><th>Commission</th><th>Entered</th><th>Locked until</th></tr></thead><tbody>` +
      vs.map(v => { const d = v.detail || {}, me = (d.followers || []).find(x => String(x.user).toLowerCase() === S.addr) || {}; return `<tr><td title="${esc(v.vaultAddress)}">${esc(d.name || v.vaultAddress.slice(0, 8) + '…')}${d.isClosed ? ' (closed)' : ''}</td><td class="num">${money(n(v.equity), 0)}</td><td class="num">${me.costBasis ? money(n(me.costBasis), 0) : '—'}</td><td class="num ${cls(n(me.pnl))}">${me.pnl != null ? smoney(n(me.pnl), 0) : '—'}</td><td class="num ${cls(n(me.allTimePnl))}">${me.allTimePnl != null ? smoney(n(me.allTimePnl), 0) : '—'}</td><td class="num">${d.tvl ? money(n(d.tvl), 0) : '—'}</td><td class="num">${d.leaderCommission != null ? fmt(n(d.leaderCommission) * 100, 1) + '%' : '—'}</td><td class="num">${me.vaultEntryTime ? dtl(me.vaultEntryTime * US) : '—'}</td><td class="num">${v.lockedUntilTimestamp ? dtl(v.lockedUntilTimestamp * US) : '—'}</td></tr>`; }).join('') + `</tbody></table></div><p class="note">Vault deposits of this address (equity, cost basis and PnL as reported by each vault).</p>`;
    return h || '<div class="empty">No vault deposits</div>';
  } },
  { id: 'referral', title: 'Referral', w: 4, render(S) {
    const r = S.ref; if (!r) return S.camp ? '<div class="empty">No data</div>' : '<div class="empty">Loading…</div>';
    return `<div class="big num">${money(n(r.totalEarned))}</div><div class="muted" style="margin:-6px 0 6px">total referral earnings</div><div class="rows">` + row('Traders referred', fmt(n(r.tradersReferred), 0)) + row('Pending commission', money(n(r.pendingCommission))) + row('Net rebate', money(n(r.netRebate))) +
      (S.fee ? row('Active referral discount', fmt(n(S.fee.activeReferralDiscount) * 100, 2) + '%') : '') + `</div><p class="note">Zeros mean the address has no referral activity.</p>`;
  } },
  { id: 'campaigns', title: 'Campaigns & points', w: 8, render(S) {
    const c = S.camp; if (!c) return '<div class="empty">Loading…</div>';
    const P = c.pts, U = c.unlock, A = c.ascent, R = c.royale, B = c.bonus, ts = ms => dtlU(ms * US) + ' GMT', left = ms => { const s = (ms - Date.now()) / 1000; return s > 0 ? 'in ' + dur(s) : 'ended'; };
    let h = '<div class="rows">';
    if (P) h += row('Points season', 'Season 1 · week ' + (weeksList().slice(-1)[0] || { n: 1 }).n) + row('Week ends', P.currentEpochEndsAt ? `${ts(P.currentEpochEndsAt)} · ${left(P.currentEpochEndsAt)}` : '—', 'the points snapshot is taken when the epoch (week) ends') +
      row('Points updated', P.lastUpdateAt ? dtlU(P.lastUpdateAt * US) + ' GMT' : '—', 'time of the last points distribution (credited on the Tuesday after an epoch ends)') +
      row('Your points and ranks', '<span class="muted">not provided by the API</span>', 'TxFlow returns real points, history and ranks only to the signed-in owner (the public overview shows 0 for every address)') + (P.isRisk ? row('Risk flag', 'set') : '');
    h += '</div>';
    { const done = P && P.lastUpdateAt ? Math.max(0, Math.floor((P.lastUpdateAt - EPOCH1) / WEEK)) : 0, trader = done * 1250000, ref = done * 152000;   // epochs finished before the last distribution
      h += `<div class="rows" style="margin-top:12px"><div class="row"><span><b>Points distributed so far</b> <span class="tag warn">from the docs, not from the API</span></span><span>${done ? '≈ ' + fmt(trader, 0) + ' – ' + fmt(trader + ref, 0) : '—'}</span></div>` +
        row('Weekly drops made', fmt(done, 0), 'first drop on Tuesday 20 Oct 2026, then every Tuesday after an epoch ends (TxFlow docs); the last one is taken from the API update time') +
        row('Pool per week (docs)', `trader ${fmt(1250000, 0)} · referral up to ${fmt(152000, 0)}`, 'Trader pool 1,250,000 points per week (82%), referral pool up to 152,000 per week (10%); Growth Reserve 488,000 per month (8%) is not counted here') + `</div>`; }
    h += `<p class="note"><b>TxFlow's API does not provide points yet.</b> Your points, their history and ranks (and the total number of points distributed) are not available through the public API — the points page of TxFlow shows them only to the signed-in owner. Check them on app.txflow.com/points.</p>`;
    if (U && U.activityInfo) { const a = U.activityInfo, d = U.userActivityData || {}, vol = n(d.userVolume), cfg = a.tradeConfig || [], next = cfg.find(x => vol < x.tradeVolume);
      h += `<div class="rows" style="margin-top:12px"><div class="row"><span><b>Trade Unlock</b> · ${ts(a.startTime)} → ${ts(a.endTime)}</span><span>${left(a.endTime)}</span></div>` + row('Your volume', '$' + big(vol)) + row('Platform volume', '$' + big(n(d.platformVolume))) + row('Your share', fmt(n(d.ratio) * 100, 4) + '%') +
        row('Estimated fee credits', fmt(n(d.evaluateFc), 2)) + row('Next level', next ? `${esc(next.name)} · $${big(next.tradeVolume)} (${fmt(Math.max(0, next.tradeVolume - vol) / 1e6, 1)}M to go)` : 'all levels reached') + row('Registered', U.userStatus ? 'yes' : (U.canRegister ? 'no (open)' : 'no')) + `</div>` +
        `<div class="scroll" style="max-height:170px"><table><thead><tr><th>Level</th><th>Volume ≥</th><th>Fee credits</th></tr></thead><tbody>` + cfg.map(x => `<tr><td>${esc(x.name)}</td><td class="num">$${big(x.tradeVolume)}</td><td class="num">${fmt(x.fcAmount, 0)}</td></tr>`).join('') + `</tbody></table></div>`; }
    if (A && A.activity) h += `<div class="rows" style="margin-top:12px"><div class="row"><span><b>${esc(A.activity.name)}</b> · ${ts(A.activity.startTime)} → ${ts(A.activity.endTime)}</span><span>${left(A.activity.endTime)}</span></div>` + row('Registered', A.user && A.user.isRegistered ? 'yes' : 'no') + row('Eligibility', esc(A.user ? A.user.eligibility : '—')) + `</div>`;
    if (B) h += `<div class="rows" style="margin-top:12px"><div class="row"><span><b>New user bonus</b></span><span>${esc(B.state || '—')}</span></div>` + row('Eligible', B.eligible ? `yes${B.eligibilitySource ? ' · ' + esc(B.eligibilitySource.toLowerCase().replace(/_/g, ' ')) : ''}` : 'no') +
      (B.windowStart ? row('Window', `${ts(B.windowStart)} → ${ts(B.windowEnd)}`) : '') + (B.reward ? row('Reward', `${esc(B.reward.amount)} ${esc(B.reward.type)} · ${esc(String(B.reward.state || '').toLowerCase())}`, 'FC = fee credits') : '') +
      (B.tasks || []).map(t => row(esc(String(t.taskCode).replace(/_/g, ' ')), `${fmt(n(t.current), 2)} / ${fmt(n(t.target), 0)} · ${esc(String(t.state).toLowerCase())}`)).join('') + `</div>`;
    return h + `<p class="note">Points and some campaign data are returned by the API only to the signed-in owner of the address, so personal figures may show zeros.</p>`;
  } },
  { id: 'leaderboards', title: 'Points', sub: 'TxFlow Points · Season 1', w: 12, render(S) {
    const c = S.camp; if (!c) return '<div class="empty">Loading…</div>';
    const mask = (S.addr.slice(0, 6) + '...' + S.addr.slice(-4)).toLowerCase(), B = S.boards || {};
    const actOf = code => code === 'trader_royale' ? c.royale1 && c.royale1.activity : code === 'trader_royale_2' ? c.royale && c.royale.activity : ((c.bull && c.bull.activities) || []).find(a => a.activityCode === code);
    const userOf = code => code === 'trader_royale' ? c.royale1 && c.royale1.user : code === 'trader_royale_2' ? c.royale && c.royale.user : (((c.bull && c.bull.activities) || []).find(a => a.activityCode === code) || {}).user;
    const ranked = LB_BOARDS.find(b => (userOf(b.code) || {}).rank > 0), sel = LB_BOARDS.find(b => b.code === LB_SEL) || ranked || LB_BOARDS[1], u = userOf(sel.code) || {}, a = actOf(sel.code) || {}, L = B[sel.code], ts = ms => dtlU(ms * US) + ' GMT';
    let h = '';
    const P = c.pts, pl = c.plb || [];
    h += `<div class="rows" style="margin-top:12px"><div class="row"><span><b>Points (Season 1)</b></span><span></span></div>` + (P ? row('Current epoch', esc(P.currentEpochId || '—') + ' · Season 1') + row('Epoch ends', P.currentEpochEndsAt ? `${ts(P.currentEpochEndsAt)} · ${(P.currentEpochEndsAt - Date.now()) > 0 ? 'in ' + dur((P.currentEpochEndsAt - Date.now()) / 1000) : 'ended'}` : '—') +
      row('Points updated', P.lastUpdateAt ? dtlU(P.lastUpdateAt * US) + ' GMT' : '—', 'time of the last points distribution (credited on the Tuesday after an epoch ends)') +
      row('Your points and ranks', '<span class="muted">not provided by the API</span>', 'TxFlow returns real points, history and ranks only to the signed-in owner (the public overview shows 0 for every address)') : '') +
      row('Points leaderboard', pl.length ? fmt(pl.length, 0) + ' rows' : 'empty — the API publishes no points ranking') + `</div><p class="note">Personal points, their history and ranks are available only to the signed-in owner (the API answers “unauthorized”), and the public overview returns zeros for every address, so the dashboard cannot show real points. Type your points into the stats image form instead.</p>`;
    if (pl.length) { const ks = Object.keys(pl[0]).slice(0, 6); h += `<div class="scroll" style="max-height:300px"><table><thead><tr>${ks.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${pl.slice(0, 100).map(r => `<tr${String(r.address || r.userAddress || '').toLowerCase() === mask ? ' style="background:var(--surface-2);font-weight:700"' : ''}>${ks.map(k => `<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
    return h;
  } },
  { id: 'equity', title: 'Equity', sub: S => 'daily · ' + (getPeriod(S) ? getPeriod(S).label : 'all time'), w: 6, render() { return '<div class="chartbox" data-ch="equity"></div>'; },
    after(el, S) { const b = $('[data-ch=equity]', el); if (!S.hist) { b.innerHTML = '<div class="empty">Loading…</div>'; return; }
      lineChart(b, histSeries(S, 'eq'), { color: css('--s1'), area: true, minRange: 1, axis: v => money(v, 0), tip: v => money(v, 2), xfmt: dshort, tfmt: dshort }); } },
  { id: 'pnlchart', title: 'PnL over period', sub: S => 'cumulative, daily · ' + (getPeriod(S) ? getPeriod(S).label : 'all time'), w: 6, render() { return '<div class="chartbox" data-ch="pnlh"></div>'; },
    after(el, S) { const b = $('[data-ch=pnlh]', el); if (!S.hist) { b.innerHTML = '<div class="empty">Loading…</div>'; return; }
      lineChart(b, histSeries(S, 'pnl'), { color: css('--s2'), zero: true, minRange: 1, axis: v => smoney(v, 0), tip: v => smoney(v, 2), xfmt: dshort, tfmt: dshort }); } },
  { id: 'perf', title: 'Performance (exchange stats)', sub: 'computed by TxFlow', w: 6, render(S) {
    const H = S.hist; if (!H) return '<div class="empty">Loading…</div>';
    const names = { '24H': 'Last 24 hours', '7D': 'Last 7 days', '30D': 'Last 30 days', '90D': 'Last 90 days', 'ALLTIME': 'All time' };
    let h = `<div class="scroll"><table><thead><tr><th>Window</th><th>PnL</th><th title="Return on equity over the window, in percent">ROE</th><th>Volume</th><th title="Largest peak-to-trough drop of equity in the window">Max drawdown</th></tr></thead><tbody>` +
      Object.entries(names).map(([k, t]) => { const o = H.ov[k]; return o ? `<tr><td>${t}</td><td class="num ${cls(n(o.pnl))}">${smoney(n(o.pnl), 2)}</td><td class="num ${cls(n(o.roe))}">${sgn(n(o.roe), 2)}%</td><td class="num">$${big(n(o.volume))}</td><td class="num">${fmt(n(o.maxDrawdown), 2)}%</td></tr>` : `<tr><td>${t}</td><td colspan="4" class="muted">no data</td></tr>`; }).join('') + `</tbody></table></div>`;
    const apr = (d, t) => { const a = H.apr[d]; return a ? row(t, `<span class="${cls(n(a.combinedApr))}">${sgn(n(a.combinedApr), 1)}%</span> · profit ${smoney(n(a.totalProfit), 2)} on avg ${money(n(a.totalAvgCapital), 0)}`, 'annualized return on the average capital of the account over the window, deposits and withdrawals taken into account') : ''; };
    h += `<div class="rows" style="margin-top:8px">` + apr(7, 'APR, last 7 days') + apr(30, 'APR, last 30 days') +
      (H.apr[30] ? row('Deposits / withdrawals (30d)', `${money(n(H.apr[30].totalDeposit), 0)} / ${money(n(H.apr[30].totalWithdrawal), 0)}`) : '') +
      (H.top ? row('Realized PnL (all time)', `<span class="${cls(n(H.top.totalRealizedPnl))}">${smoney(n(H.top.totalRealizedPnl), 2)}</span>`, 'realized PnL reported by the exchange since the first activity') + row('Total PnL (all time)', `<span class="${cls(n(H.top.totalPnl))}">${smoney(n(H.top.totalPnl), 2)}</span>`, 'realized + unrealized, without deposits and withdrawals') : '') + `</div>`;
    return h + `<p class="note">Figures come straight from the TxFlow stats endpoints (userOverview, multiUserApr, multiUserPnl).</p>`;
  } },
  { id: 'dailytable', title: 'Daily account history', sub: S => getPeriod(S) ? getPeriod(S).label : 'all time', w: 12, render(S) {
    const H = S.hist; if (!H) return '<div class="empty">Loading…</div>'; const pr = getPeriod(S);
    const rows = H.pnl.filter(r => n(r.totalCurrEquity) || n(r.totalPrevEquity) || n(r.totalDayNetFlow)).filter(r => !pr || (Date.parse(r.pnlDate + 'T00:00:00Z') + 864e5 > pr.from / US && Date.parse(r.pnlDate + 'T00:00:00Z') <= pr.to / US)).slice().reverse();
    if (!rows.length) return '<div class="empty">No history for this period</div>';
    return `<div class="scroll" style="max-height:340px"><table><thead><tr><th>Date (UTC)</th><th>Equity</th><th title="Equity change over the day, including deposits and withdrawals">Change</th><th>Deposits</th><th>Withdrawals</th><th>Transfers in/out</th><th title="PnL of the day = change of equity minus net flow">Day PnL</th><th title="Cumulative PnL since the first activity">Cumulative PnL</th><th title="Cumulative realized PnL">Cumulative realized</th></tr></thead><tbody>` +
      rows.map((r, i) => { const dp = n(r.totalEquityChange) - n(r.totalDayNetFlow); return `<tr><td class="num">${esc(r.pnlDate)}</td><td class="num">${money(n(r.totalCurrEquity), 2)}</td><td class="num ${cls(n(r.totalEquityChange))}">${smoney(n(r.totalEquityChange), 2)}</td><td class="num">${n(r.totalDayDeposit) ? money(n(r.totalDayDeposit), 2) : '—'}</td><td class="num">${n(r.totalDayWithdrawal) ? money(n(r.totalDayWithdrawal), 2) : '—'}</td><td class="num">${n(r.totalDayTransferIn) || n(r.totalDayTransferOut) ? money(n(r.totalDayTransferIn), 2) + ' / ' + money(n(r.totalDayTransferOut), 2) : '—'}</td><td class="num ${cls(dp)}">${smoney(dp, 2)}</td><td class="num ${cls(n(r.totalPnl))}">${smoney(n(r.totalPnl), 2)}</td><td class="num ${cls(n(r.totalRealizedPnl))}">${smoney(n(r.totalRealizedPnl), 2)}</td></tr>`; }).join('') + `</tbody></table></div>`;
  } },
  { id: 'rewards', title: 'Rewards hub', sub: 'TxFlow campaigns', w: 6, render(S) {
    const R = S.rewards; if (R === undefined) return '<div class="empty">Loading…</div>'; if (!R) return '<div class="empty">No data</div>';
    const ts = ms => ms && ms < 4e12 ? dtlU(ms * US) : 'no end date', sec = (title, a) => !(a && a.length) ? '' : `<div class="rows" style="margin-top:8px"><div class="row"><span><b>${title}</b></span><span>${a.length}</span></div>` +
      a.map(x => row(`${esc(x.title)} <span class="tag ${/ongoing|live|active/i.test(x.status) ? 'ok' : ''}">${esc(String(x.status || '').toLowerCase())}</span>${x.targetUrl ? ` <a href="${esc(x.targetUrl)}" target="_blank" rel="noopener">open ↗</a>` : ''}<br><span class="muted">${esc(x.subTitle || '')}</span>`, `${x.startTime ? dtlU(x.startTime * US) : ''} → ${ts(x.endTime)}`)).join('') + `</div>`;
    return (sec('Featured', R.featured) + sec('Activities', R.activities) + sec('History', R.history)) || '<div class="empty">No campaigns</div>';
  } },
  { id: 'orderhist', title: 'Order history', sub: S => S.orders ? `${fmt(S.orders.length, 0)} orders · ${getPeriod(S) ? getPeriod(S).label : 'recent'}` : '', w: 12, render(S) {
    const o = S.orders; if (!o) return '<div class="empty">Loading orders…</div>'; if (!o.length) return '<div class="empty">No orders</div>';
    const st = {}; o.forEach(x => st[x.status] = (st[x.status] || 0) + 1);
    return `<div class="rows">` + row('Orders loaded', fmt(o.length, 0) + (S.ordersDone ? '' : ' · loading…')) + row('By status', Object.entries(st).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k.toLowerCase().replace(/_/g, ' '))} ${fmt(v, 0)}`).join(' · ')) + `</div>` +
      `<div class="scroll" style="max-height:420px;margin-top:8px"><table><thead><tr><th>Time</th><th>Market</th><th>Order</th><th>Price</th><th>Avg fill</th><th>Size</th><th>Filled</th><th>Status</th><th>PnL</th><th>ROE %</th><th>Lev.</th><th>TIF</th><th>Flags</th></tr></thead><tbody>` +
      o.slice(0, SHOWN.ohist).map(x => `<tr><td class="num">${dt(x.createdAt)}</td><td>${esc(x.marketDisplayName)}</td><td><span class="${x.side === 'BUY' ? 'pos' : 'neg'}">${x.side === 'BUY' ? '▲' : '▼'} ${esc(x.dir || x.side)}</span> ${esc(String(x.orderType || '').toLowerCase())}</td><td class="num">${n(x.price) ? pxf(n(x.price)) : '—'}</td><td class="num">${n(x.avgFillPrice) ? pxf(n(x.avgFillPrice)) : '—'}</td><td class="num">${fmt(n(x.originalSize), 4)}</td><td class="num">${fmt(n(x.filledSize), 4)}</td><td>${esc(x.status.toLowerCase().replace(/_/g, ' '))}</td><td class="num ${cls(n(x.pnl))}">${n(x.pnl) ? smoney(n(x.pnl), 2) : '—'}</td><td class="num ${cls(n(x.roe))}">${n(x.roe) ? sgn(n(x.roe), 2) + '%' : '—'}</td><td class="num">${x.leverage ? esc(x.leverage) + '× ' + (/iso/i.test(x.marginMode) ? 'iso' : 'x') : '—'}</td><td>${esc(x.timeInForce || '—')}</td><td>${x.reduceOnly ? 'reduce' : '—'}</td></tr>`).join('') + `</tbody></table></div>` + moreNote('ohist', o.length, 'orders');
  } },
  { id: 'tradehist', title: 'Trade history', sub: S => 'positions from open to close · ' + fsub(S), w: 12, render(S) {
    if (!S.fills.length) return S.fillsDone ? '<div class="empty">No fills</div>' : '<div class="empty">Loading fills…</div>';
    const T = tradeCycles(S.fills), done = T.filter(t => !t.open && !t.incomplete); if (!T.length) return '<div class="empty">No trades</div>';
    const w = done.filter(t => t.net > 0), l = done.filter(t => t.net < 0), avg = a => a.length ? a.reduce((x, t) => x + t.net, 0) / a.length : 0, dur2 = ms => dur(ms / 1000);
    const list = T.slice().sort((a, b) => (b.open - a.open) || (b.t1 - a.t1));
    return `<div class="rows">` + row('Trades (closed / open)', `${fmt(done.length, 0)} / ${fmt(T.filter(t => t.open).length, 0)}`, 'a trade = one position of a market from the first opening fill until it is fully closed (or reversed)') +
      row('Win rate (by net PnL)', done.length ? fmt(w.length / done.length * 100, 1) + '%' : '—') + row('Average win / loss', done.length ? `${smoney(avg(w), 2)} / ${smoney(avg(l), 2)}` : '—') +
      row('Best / worst trade', done.length ? `${smoney(Math.max(...done.map(t => t.net)), 2)} / ${smoney(Math.min(...done.map(t => t.net)), 2)}` : '—') + row('Average duration', done.length ? dur2(done.reduce((a, t) => a + (t.t1 - t.t0) / 1000, 0) / done.length) : '—') + `</div>` +
      `<div class="scroll" style="max-height:420px;margin-top:8px"><table><thead><tr><th>Market</th><th>Side</th><th>Opened</th><th>Closed</th><th>Held</th><th>Max size</th><th>Avg entry</th><th>Avg exit</th><th>Volume</th><th>Realized</th><th>Fees</th><th>Net</th><th>Fills</th></tr></thead><tbody>` +
      list.slice(0, SHOWN.trades).map(t => `<tr><td>${esc(t.m)}</td><td><span class="tag ${t.side > 0 ? 'ok' : 'bad'}">${t.side > 0 ? '▲ LONG' : '▼ SHORT'}</span></td><td class="num">${dt(t.t0)}${t.incomplete ? ' *' : ''}</td><td class="num">${t.open ? '<span class="tag warn">open</span>' : dt(t.t1)}</td><td class="num">${dur2((t.open ? Date.now() * 1000 : t.t1) / 1000 - t.t0 / 1000)}</td><td class="num">${fmt(t.maxQ, 4)}</td><td class="num">${t.inQ ? pxf(t.inV / t.inQ) : '—'}</td><td class="num">${t.outQ ? pxf(t.outV / t.outQ) : '—'}</td><td class="num">$${big(t.vol)}</td><td class="num ${cls(t.pnl)}">${smoney(t.pnl, 2)}</td><td class="num">${fmt(t.fee, 2)}</td><td class="num ${cls(t.net)}">${smoney(t.net, 2)}</td><td class="num">${t.n}</td></tr>`).join('') + `</tbody></table></div>` + moreNote('trades', list.length, 'trades') +
      `<p class="note">Built from the loaded fills. * = the position was already open before the first loaded fill, so its start (and entry price) is incomplete — load more fills in the “Fills” menu or pick “All time”.</p>`;
  } },
  { id: 'conditional', title: 'TP/SL, trigger & TWAP orders', sub: 'now / history', w: 6, render(S) {
    const c = S.cond; if (!c) return '<div class="empty">Loading…</div>';
    const sec = (title, a) => { const keys = ['coin', 'dir', 'side', 'limitPx', 'triggerPx', 'triggerCondition', 'sz', 'origSz', 'orderType', 'status', 'state', 'timestamp'], ks = a.length ? keys.filter(k => a.some(x => x[k] != null || (x.order && x.order[k] != null))) : [];
      const val = (x, k) => { const v = x[k] != null ? x[k] : x.order && x.order[k]; return k === 'timestamp' ? dt(v * US) : esc(k === 'coin' ? coinName(v) : v == null ? '—' : v); };
      return `<div class="rows" style="margin-top:6px"><div class="row"><span><b>${title}</b></span><span>${fmt(a.length, 0)}</span></div></div>` + (a.length ? `<div class="scroll" style="max-height:160px"><table><thead><tr>${ks.map(k => `<th>${k}</th>`).join('')}</tr></thead><tbody>${a.slice(0, 40).map(x => `<tr>${ks.map(k => `<td>${val(x, k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''); };
    const mkts = {}; Object.values(S.account.positions).forEach(p => mkts[p.marketId] = n(p.markPx));
    const tpslSec = (title, a, hist) => { const price = x => n(x) ? pxf(n(x)) : '—', dist = (x, c) => n(x) && mkts[c] ? ` <span class="muted">${sgn((n(x) - mkts[c]) / mkts[c] * 100, 2)}%</span>` : '';
      return `<div class="rows" style="margin-top:6px"><div class="row"><span><b>${title}</b></span><span>${fmt(a.length, 0)}</span></div></div>` + (a.length ? `<div class="scroll" style="max-height:200px"><table><thead><tr><th>Market</th><th title="Side of the closing order">Closes</th><th>Take profit</th><th>Stop loss</th><th title="0 = the whole position">Size</th><th>Order type</th><th>Mode</th><th>Lev.</th><th>Created</th>${hist ? '<th>State</th>' : ''}</tr></thead><tbody>` +
        a.slice(0, 40).map(x => `<tr><td>${esc(coinName(x.coin))}</td><td>${x.side === 'B' ? 'buy (short)' : 'sell (long)'}</td><td class="num">${price(x.tpTriggerPrice)}${hist ? '' : dist(x.tpTriggerPrice, x.coin)}</td><td class="num">${price(x.slTriggerPrice)}${hist ? '' : dist(x.slTriggerPrice, x.coin)}</td><td class="num">${n(x.quantity) ? fmt(n(x.quantity), 4) : 'all'}</td><td>${esc([n(x.tpTriggerPrice) && x.tpOrderType, n(x.slTriggerPrice) && x.slOrderType].filter(Boolean).join(' / ').toLowerCase() || '—')}</td><td>${esc(String(x.positionMode || '').toLowerCase())} ${/iso/i.test(x.marginMode || '') ? 'iso' : 'cross'}</td><td class="num">${x.leverage ? esc(x.leverage) + '×' : '—'}</td><td class="num">${x.createTime ? dt(x.createTime * US) : '—'}</td>${hist ? `<td>${esc(String(x.state || '').toLowerCase())}${x.cancelSource ? ' · ' + esc(String(x.cancelSource).replace(/([A-Z])/g, ' $1').trim().toLowerCase()) : ''}</td>` : ''}</tr>`).join('') + `</tbody></table></div>` : ''); };
    return tpslSec('Position TP/SL orders (open)', c.tpsl, false) + tpslSec('TP/SL history', c.htpsl || [], true) + sec('Trigger orders (open)', c.trig) + sec('Trigger orders (history)', c.htrig) + sec('TWAP orders (history)', c.twap) + sec('TWAP slice fills', c.twapSl);
  } },
];
const TITLES = Object.fromEntries(CARDS.map(c => [c.id, c.title]));


/* ---------------------------------------------------------------- render */
function cardsHTML(S, list, pr) {
  const addr = S.addr;
  return `<div class="hdr"><code class="addr">${esc(addr)}</code><span class="tag ${pr ? 'warn' : ''}">${pr ? esc(pr.label) : 'all time'}</span><span class="muted" id="upd"></span></div>` + list.map(c =>
    `<section class="card w${c.w}" data-card="${c.id}"><h2>${c.title}${c.sub ? `<span class="sub">${typeof c.sub === 'function' ? c.sub(S) : c.sub}</span>` : ''}</h2>${c.render(S)}</section>`).join('');
}
function drawAll(out, list) { list.forEach(c => { if (c.after) { try { c.after($(`[data-card=${c.id}]`, out), S); } catch (e) { console.error(c.id, e); } } }); }
/* positions of every market from the first opening fill until the position is flat (or reversed), built from the per-fill startPosition */
function tradeCycles(fills) {
  const asc = fills.slice().sort((a, b) => a.createdAt - b.createdAt || a.tid - b.tid), cur = {}, out = [], mk = (m, side, f, incomplete) => ({ m, side, t0: f.createdAt, t1: f.createdAt, n: 0, vol: 0, fee: 0, pnl: 0, inQ: 0, inV: 0, outQ: 0, outV: 0, maxQ: 0, open: true, incomplete });
  for (const f of asc) {
    const m = f.marketDisplayName, sz = n(f.size), px = n(f.price), sg = f.side === 'BUY' ? 1 : -1, sp = f.startPos || 0, eps = 1e-9 * Math.max(1, Math.abs(sp));
    let c = cur[m]; if (!c) c = cur[m] = mk(m, sp === 0 ? sg : Math.sign(sp), f, sp !== 0);
    c.n++; c.vol += sz * px; c.fee += n(f.fee); c.pnl += n(f.closedPnl); c.t1 = f.createdAt;
    if (sg === c.side) { c.inQ += sz; c.inV += sz * px; c.maxQ = Math.max(c.maxQ, Math.abs(sp + sg * sz)); }
    else {
      const closeQ = Math.min(sz, Math.abs(sp)); c.outQ += closeQ; c.outV += closeQ * px;
      if (Math.abs(sp) - sz <= eps) {   // flat or reversed: this trade ends here
        c.open = false; c.net = c.pnl - c.fee; out.push(c); delete cur[m];
        const rest = sz - Math.abs(sp); if (rest > eps) { const r = cur[m] = mk(m, sg, f, false); r.n = 1; r.vol = rest * px; r.inQ = rest; r.inV = rest * px; r.maxQ = rest; }
      }
    }
  }
  Object.values(cur).forEach(c => { c.net = c.pnl - c.fee; out.push(c); });
  return out;
}
/* leverage / margin / opening-closing breakdown from the per-fill fields (leverage, marginMode, startPosition) */
function levStats(fills) {
  const r = { vol: 0, wlev: 0, maxLev: 0, lev: {}, modes: {}, open: 0, close: 0, flip: 0, twap: 0, ro: 0, closeLong: { n: 0, pnl: 0 }, closeShort: { n: 0, pnl: 0 }, fee: {} };
  for (const f of fills) {
    const sz = n(f.size), v = sz * n(f.price), sg = f.side === 'BUY' ? 1 : -1, sp = f.startPos || 0, L = n(f.lev);
    r.vol += v; r.wlev += L * v; r.maxLev = Math.max(r.maxLev, L); r.lev[L] = (r.lev[L] || 0) + v; r.modes[f.mmode || '?'] = (r.modes[f.mmode || '?'] || 0) + v;
    if (f.twap) r.twap++; if (f.reduceOnly) r.ro++; r.fee[f.feeToken || '?'] = (r.fee[f.feeToken || '?'] || 0) + n(f.fee);
    if (!sp || Math.sign(sp) === sg) r.open++;
    else { r.close++; if (sz > Math.abs(sp) + 1e-12) r.flip++; const t = sp > 0 ? r.closeLong : r.closeShort; t.n++; t.pnl += n(f.closedPnl); }
  }
  return r;
}
function prepare() { S.risk = riskCalc(S.account, S.mk); S.fs = fillStats(S.fills); S.ls = levStats(S.fills); }
function render() {
  if (!S) return;
  prepare();
  const ORDER = ['summary', 'volume', 'pnl', 'equity', 'pnlchart', 'risk', 'positions', 'activity', 'curve', 'perf', 'leverage', 'daily', 'volday', 'hourly', 'bymarket', 'trades', 'orderflow', 'dailytable', 'tradehist', 'orderhist', 'funding', 'transfers', 'orders', 'conditional', 'fills', 'spot', 'feetier', 'vaults', 'referral', 'campaigns', 'leaderboards', 'rewards'], ix = c => { const i = ORDER.indexOf(c.id); return i < 0 ? 99 : i; };
  const out = $('#out'), list = CARDS.filter(c => enabled.has(c.id)).sort((a, b) => ix(a) - ix(b)), pr = getPeriod(S);
  out.innerHTML = cardsHTML(S, list, pr);
  const draw = () => drawAll(out, list);
  draw(); cancelAnimationFrame(render.raf); render.raf = requestAnimationFrame(() => { const w = out.clientWidth; if (w !== render.w) { render.w = w; draw(); } });
  out.querySelectorAll('th').forEach(th => { const t = tipFor(th.textContent.replace(/[\s↓↑]+$/, '')); if (t) th.title = t; });
  $('#upd').textContent = 'updated ' + new Date().toLocaleTimeString('en-US', { hour12: false });
  $('#welcome').hidden = true;
}

/* ---------------------------------------------------------------- loading */
function status(html, err) { const s = $('#status'); s.className = 'status' + (err ? ' err' : '') + (/^Loading/.test(html) ? ' busy' : ''); s.innerHTML = (/^Loading/.test(html) ? '<i class="spin"></i>' : '') + html; }
let MK = null;
async function loadMarkets() { if (MK) return MK; const d = await info({ type: 'perpMeta' }); MK = Object.fromEntries((d.universe || []).map(m => [m.name, { maxLeverage: m.maxLeverage, maintenanceMarginFraction: 1 / (2 * (m.maxLeverage || 20)) }])); return MK; }   // fallback only: maintenance fraction = 1 / (2 × max leverage)
const vlmOf = f => { if (!f || !Array.isArray(f.dailyUserVlm)) return null; const d = f.dailyUserVlm.slice().sort((a, b) => a.date - b.date).map(x => n(x.exchange)), today = n(f.volumeToday), sum = a => a.reduce((x, y) => x + y, 0); return { today, d7: sum(d.slice(-6)) + today, d14: sum(d) + today }; };

async function loadWallet(addr, opts = {}) {
  const my = ++runId; addr = addr.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) { status('Invalid address: expected 0x followed by 40 hex characters', true); return; }
  if (!opts.silent) { status('Loading wallet data…'); S = null; $('#out').innerHTML = ''; }
  const safe = p => p.catch(e => (console.warn(e), null));
  let ch;
  try { ch = await info({ type: 'clearinghouseState', user: addr }); } catch (e) { status('Error: ' + esc(e.message), true); return; }
  if (my !== runId) return;
  const [mk, transfers, open, fee] = await Promise.all([
    loadMarkets().catch(() => ({})),
    safe(pullBack({ type: 'userNonFundingLedgerUpdates', user: addr, accountTypes: ['spot', 'perp'] }, { from: 0, to: Date.now() + 6e4, cap: 3000, id: x => x.hash + x.time, t: x => x.time, norm: x => normTransfer(x, addr) })),
    safe(info({ type: 'frontendOpenOrders', user: addr, exchangeId: 0, accountType: ['perps'] })),
    safe(info({ type: 'feeTierRates', accountType: 'perps', user: addr }))]);
  if (my !== runId) return;
  const keepFills = opts.keep && S ? S.fills : [];
  S = { addr, idx: 0, account: normAccount(ch, transfers), mk, fee, vlm: vlmOf(fee), transfers, openOrders: Array.isArray(open) ? open.map(normOpen) : [],
    funding: opts.keep && S ? S.funding : undefined, fills: keepFills, fillsDone: false, sortKey: S && S.sortKey, sortDir: S && S.sortDir,
    ...(opts.keep && S ? { hist: S.hist, spot: S.spot, spotFills: S.spotFills, vaults: S.vaults, selfVault: S.selfVault, ref: S.ref, camp: S.camp, cond: S.cond } : {}) };
  location.hash = addr;
  rememberWallet(addr);
  renderPeriodBar();
  render();
  loadFills(my, opts.keep);
  loadFunding(my); loadOrders(my); loadHistory(my); loadExtra(my);
}
/* equity / PnL history, period summaries and APR computed by the exchange (works for any address, no sign-in) + the rewards hub list */
let REWARDS = null;
async function loadHistory(my) {
  const addr = S.addr, live = () => my === runId && S && S.addr === addr, safe = p => p.catch(e => (console.warn(e), null)), day = ms => new Date(ms).toISOString().slice(0, 10);
  const first = S.transfers && S.transfers.length ? Math.min(...S.transfers.map(x => x.createdAt)) / US : Date.now() - 30 * 864e5;
  const body = { user_addresses: [addr], start_date: day(Math.max(first - 864e5, Date.now() - 360 * 864e5)), end_date: day(Date.now()) }, per = ['24H', '7D', '30D', '90D', 'ALLTIME'];
  const [pnl, eq, apr7, apr30, ...ovs] = await Promise.all([safe(info({ type: 'multiUserPnl', ...body })), safe(info({ type: 'multiUserEquitySnapshots', ...body })),
    safe(info({ type: 'multiUserApr', user_addresses: [addr], period_days: 7 })), safe(info({ type: 'multiUserApr', user_addresses: [addr], period_days: 30 })),
    ...per.map(p => safe(info({ type: 'userOverview', user_address: addr, period: p })))]);
  if (!live()) return;
  S.hist = { pnl: (pnl && pnl.data) || [], eq: (eq && eq.data) || [], top: pnl, apr: { 7: apr7, 30: apr30 }, ov: Object.fromEntries(per.map((p, i) => [p, ovs[i]])) };
  if (REWARDS !== null) S.rewards = REWARDS;
  render();
  if (!REWARDS) { REWARDS = await safe(info({ type: 'rewardsHubList', lang: 'en' })) || false; }
  if (live()) { S.rewards = REWARDS; render(); }
}
/* daily series of the selected period: 'eq' = equity, 'pnl' = PnL rebased to the start of the period */
function histSeries(S, kind) {
  const H = S.hist; if (!H) return []; const rows = kind === 'eq' ? H.eq : H.pnl, key = kind === 'eq' ? 'snapshotDate' : 'pnlDate', pr = getPeriod(S), t = r => Date.parse(r[key] + 'T00:00:00Z');
  let i0 = rows.findIndex(r => n(r.totalEquity) || n(r.totalCurrEquity) || n(r.totalPnl)); if (i0 < 0) return []; const live = rows.slice(i0);
  const sel = pr ? live.filter(r => t(r) + 864e5 > pr.from / US && t(r) <= pr.to / US) : live;
  const prev = pr && sel.length ? live.find(r => t(r) === t(sel[0]) - 864e5) : null, base = prev ? n(prev.totalPnl) : 0;
  return sel.map(r => [t(r) * US, kind === 'eq' ? n(r.totalEquity) : n(r.totalPnl) - base]);
}
/* everything else the public API has for an address: spot, vaults, referrals, campaigns, conditional orders */
async function loadExtra(my) {
  const addr = S.addr, live = () => my === runId && S && S.addr === addr, safe = p => p.catch(e => (console.warn(e), null)), q = (type, extra = {}) => safe(info({ type, user: addr, ...extra }));
  const [spot, vEq, ref, selfV, tpsl, trig, htrig, twap, twapSl, unlock, royale, ascent, pts, bonus, royale1, bull, plb] = await Promise.all([
    q('spotClearinghouseState'), q('uservaultequities'), q('userReferralOverview'), safe(info({ type: 'vaultDetails', vaultAddress: addr })),
    q('tpslOrders'), q('triggerOrders'), q('historicalTriggerOrders'), q('twapHistory'), q('userTwapSliceFills'),
    q('getTradeUnlockActivity'), q('traderRoyaleInfo', { activityCode: 'trader_royale_2' }), q('activityInfo'), q('getUserPointsOverview'), q('newUserBonusInfo'),
    q('traderRoyaleInfo', { activityCode: 'trader_royale' }), q('pnlRoiInfo', { activityCode: 'bull_pit' }), safe(info({ type: 'pointsLeaderboard', pageNo: 1, pageSize: 100 }))]);
  if (!live()) return;
  S.spot = spot; S.ref = ref; S.selfVault = selfV && selfV.name ? selfV : null;
  S.cond = { tpsl: Array.isArray(tpsl) ? tpsl : [], trig: Array.isArray(trig) ? trig : [], htrig: Array.isArray(htrig) ? htrig : [], twap: Array.isArray(twap) ? twap : [], twapSl: twapSl && twapSl.twapSliceFills || [] };
  const htpsl = await safe(info({ type: 'historicalTpslOrders', user: addr })); if (!live()) return; S.cond.htpsl = Array.isArray(htpsl) ? htpsl : [];
  S.camp = { unlock, royale, ascent, pts, bonus, royale1, bull, plb: plb && plb.leaderboard || [] };
  render(); loadTickers(my);
  const eq = Array.isArray(vEq) ? vEq.slice(0, 12) : [];
  S.vaults = await Promise.all(eq.map(async v => ({ ...v, detail: await safe(info({ type: 'vaultDetails', vaultAddress: v.vaultAddress })) })));
  if (!live()) return; render();
  try { const sf = await pullBack({ type: 'userFills', user: addr, accountType: ['spot'] }, { from: 0, to: Date.now() + 6e4, cap: 3000, id: f => f.tid + '_' + f.oid, t: f => f.time, norm: normSpotFill, live }); if (sf && live()) { S.spotFills = sf; render(); } } catch (e) { console.warn(e); if (live()) S.spotFills = S.spotFills || []; }
}
/* competition leaderboards (top 50, addresses are masked by the API as 0x1234…abcd) */
const fullOf = m => { const k = String(m).toLowerCase(); for (const a of KNOWN) if (maskOf(a) === k) return a; return m; };
const LB_BOARDS = [{ code: 'trader_royale', type: 'traderRoyaleLeaderboardPage', title: 'Trader Royale', metric: 'vol' }, { code: 'trader_royale_2', type: 'traderRoyaleLeaderboardPage', title: 'Trader Royale 2', metric: 'vol' },
  { code: 'bull_pit_pnl', type: 'pnlRoiLeaderboardPage', title: 'Bull Pit · PnL', metric: 'pnl' }, { code: 'bull_pit_roi', type: 'pnlRoiLeaderboardPage', title: 'Bull Pit · ROI', metric: 'roi' }];
const LBC = {}; let LB_SEL = null;
const KNOWN = new Set(store.get('known', []));   // full addresses opened on this site (only in this browser): used to show the full address in a masked leaderboard row
const maskOf = a => (a.slice(0, 6) + '...' + a.slice(-4)).toLowerCase();
async function loadBoards(my) {
  const addr = S.addr, live = () => my === runId && S && S.addr === addr;
  for (const b of LB_BOARDS) {
    if (!LBC[b.code]) { try { LBC[b.code] = await info({ type: b.type, activityCode: b.code, pageNo: 1, pageSize: 50 }); } catch (e) { console.warn(e); LBC[b.code] = null; } }
    if (!live()) return; S.boards = LBC; render();
  }
}
const TK = {};   // marketTicker cache by instrument id
async function loadTickers(my) {
  if (!S) return; const addr = S.addr, live = () => my === runId && S && S.addr === addr, ids = new Map();
  Object.values(S.account.positions).forEach(p => p.instrumentId != null && ids.set(String(p.instrumentId), 1));
  S.tkIds = [...ids.keys()];
  const need = [...ids.keys()].filter(id => !TK[id] || Date.now() - TK[id].at > 60000).slice(0, 40);
  for (let i = 0; i < need.length; i += 5) {
    await Promise.all(need.slice(i, i + 5).map(async id => { try { const t = await info({ type: 'marketTicker', instrumentId: Number(id) }); if (t && t.coin) TK[id] = { ...t, at: Date.now() }; } catch (e) { } }));
    if (!live()) return; S.tickers = TK; render();
  }
  S.tickers = TK; render();
}
async function loadFunding(my) {
  const addr = S.addr, pr = getPeriod(S), live = () => my === runId && S && S.addr === addr; S.fundingDone = false;
  try {
    const r = await pullBack({ type: 'userFundings', user: addr }, { from: pr ? pr.from / US : 0, to: pr ? pr.to / US : Date.now() + 6e4, cap: pr ? 30000 : 3000, id: x => x.time + x.coin, t: x => x.time, norm: normFunding, live });
    if (r === null || !live()) return; S.funding = r;
  } catch (e) { if (!live()) return; console.warn(e); S.funding = S.funding || []; }
  S.fundingDone = true; render();
}
async function loadOrders(my) {
  const addr = S.addr, pr = getPeriod(S), live = () => my === runId && S && S.addr === addr; S.orders = null; S.ordersDone = false;
  try {
    const r = await pullBack({ type: 'historicalOrders', user: addr }, { from: pr ? pr.from / US : 0, to: pr ? pr.to / US : Date.now() + 6e4, cap: pr ? 20000 : 3000, id: x => x.order.oid, t: x => x.order.timestamp, norm: normOrder, live,
      onPage: out => { if (live()) { S.orders = out.slice(); render(); } } });
    if (r === null || !live()) return; S.orders = r;
  } catch (e) { if (!live()) return; console.warn(e); S.orders = S.orders || []; }
  S.ordersDone = true; render();
}
let fillSeq = 0;
async function loadFills(my, incremental) {
  const seq = ++fillSeq, addr = S.addr, pr = getPeriod(S), CAP = 100000, depth = pr ? CAP : parseInt($('#depth').value, 10), live = () => my === runId && seq === fillSeq && S && S.addr === addr;
  let from = pr ? pr.from / US : 0; const to = pr ? pr.to / US : Date.now() + 6e4, prev = incremental ? S.fills : [];
  if (incremental && prev.length) from = Math.max(...prev.map(f => f.createdAt)) / US; else S.fills = [];
  S.fillsCapped = false; S.fillsDone = false;
  const merge = out => { const seen = new Set(), all = []; for (const f of out.concat(prev)) if (!seen.has(f.tradeId)) { seen.add(f.tradeId); all.push(f); } all.sort((a, b) => b.createdAt - a.createdAt); return all; };
  try {
    const out = await pullBack({ type: 'userFills', user: addr, accountType: ['perps'] }, { from, to, cap: depth, id: f => f.tid + '_' + f.oid, t: f => f.time, norm: normFill, live,
      onPage: out => { if (!live() || incremental) return; S.fills = merge(out); status(`Loading fills${pr ? ' of period' : ''}: ${fmt(S.fills.length, 0)}${pr ? '' : ' of ' + fmt(depth, 0)}<span class="bar"><i style="width:${pr ? 60 : Math.min(100, S.fills.length / depth * 100)}%"></i></span>`); render(); } });
    if (out === null || !live()) return;
    S.fills = merge(out); S.fillsCapped = !!pr && out.length >= CAP;
  } catch (e) { if (live()) { status('Fills loaded only partially: ' + esc(e.message) + ' — pick a smaller number in the “Fills” menu or try again.', true); S.fillsDone = true; render(); } return; }
  if (!live()) return;
  S.fillsDone = true; render(); loadTickers(my);
  const capped = !pr && S.fills.length >= depth, more = [...$('#depth').options].map(o => +o.value).find(v => v > depth);
  if (!S.fills.length && !Object.keys(S.account.positions).length && !n(S.account.equity) && !(S.transfers && S.transfers.length)) { status('No activity on TxFlow for this address. Check the address.', true); return; }
  status(capped ? `Analyzed the most recent ${fmt(S.fills.length, 0)} fills — older history exists. ${more ? `<button class="linkbtn" id="moreBtn" type="button">Analyze up to ${fmt(more, 0)}</button> or ` : 'This is the maximum depth. '}${more ? 'pick a larger number in the “Fills” menu above to include more.' : ''}`
    : `Done. Fills analyzed: ${fmt(S.fills.length, 0)}${pr ? ' for period “' + esc(pr.label) + '”' : ' (full history)'}.`);
}

/* ---------------------------------------------------------------- UI wiring */
function rememberWallet(a) { const r = [a, ...store.get('recent', []).filter(x => x !== a)].slice(0, 5); store.set('recent', r); renderRecent(); KNOWN.add(a.toLowerCase()); store.set('known', [...KNOWN].slice(-500)); }
function renderRecent() { const r = store.get('recent', []); $('#recent').innerHTML = r.map(a => `<button class="chip" data-a="${a}">${a.slice(0, 6)}…${a.slice(-4)}</button>`).join(''); }
$('#recent').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { $('#addr').value = b.dataset.a; loadWallet(b.dataset.a); } });
$('#form').addEventListener('submit', e => { e.preventDefault(); loadWallet($('#addr').value.trim()); });
$('#out').addEventListener('click', e => {
  const mo = e.target.closest('[data-more]'); if (mo && S) { const [k, all] = mo.dataset.more.split(':'); SHOWN[k] = all ? 1e9 : SHOWN[k] + 200; render(); return; }
  const lb = e.target.closest('[data-lb]'); if (lb && S) { LB_SEL = lb.dataset.lb; render(); return; }
  const th = e.target.closest('th[data-sort]'); if (th && S) { const k = th.dataset.sort; S.sortDir = S.sortKey === k ? -(S.sortDir || -1) : (k === 'k' ? 1 : -1); S.sortKey = k; render(); }
});
function renderCardsList() { $('#cardsList').innerHTML = CARDS.map(c => `<label class="chk"><input type="checkbox" data-c="${c.id}" ${enabled.has(c.id) ? 'checked' : ''}> ${c.title}</label>`).join(''); }
$('#cardsList').addEventListener('change', e => { const c = e.target.dataset.c; if (!c) return; e.target.checked ? enabled.add(c) : enabled.delete(c); store.set('cards', [...enabled]); render(); });
$('#cardsAll').onclick = () => { enabled = new Set(CARDS.map(c => c.id)); store.set('cards', [...enabled]); renderCardsList(); render(); };
$('#cardsNone').onclick = () => { enabled = new Set(); store.set('cards', []); renderCardsList(); render(); };
$('#cardsReset').onclick = () => { enabled = new Set(DEFAULT_CARDS); store.set('cards', [...enabled]); renderCardsList(); render(); };
$('#btnCards').onclick = () => { const p = $('#cardsPanel'); p.hidden = !p.hidden; $('#btnCards').setAttribute('aria-expanded', String(!p.hidden)); };
$('#depth').value = String(store.get('depth', 3000)); if (!$('#depth').value) $('#depth').value = '3000';
$('#depth').onchange = () => { store.set('depth', parseInt($('#depth').value, 10)); if (S) loadFills(runId, false); };
$('#status').addEventListener('click', e => { if (e.target.id !== 'moreBtn') return; const cur = +$('#depth').value, nx = [...$('#depth').options].map(o => +o.value).find(v => v > cur); if (nx) { $('#depth').value = String(nx); store.set('depth', nx); if (S) loadFills(runId, false); } });
$('#auto').checked = false;   // off by default, not remembered between visits
function setAuto() { clearInterval(autoTimer); if ($('#auto').checked) autoTimer = setInterval(() => { if (S && !document.hidden) loadWallet(S.addr, { silent: true, keep: true }); }, 60000); }
$('#auto').onchange = () => setAuto();
const root = document.documentElement; { const t = store.get('theme', null); if (t) root.dataset.theme = t; }
$('#btnTheme').onclick = () => { const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; root.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', root.dataset.theme); render(); };
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
/* ---- period bar */
function renderPeriodBar() {
  const w = weeksList(), bar = $('#periodbar'), k = period.key, fmtD = ms => fmtDt(ms, { utc: true, noTime: true });
  const btn = (key, label, small) => `<button class="pbtn ${k === key ? 'on' : ''}" data-p="${key}">${label}${small ? `<small>${small}</small>` : ''}</button>`;
  bar.innerHTML = btn('total', 'All time') + PRESETS.map(x => btn(x[0], x[1])).join('') + w.filter(x => !x.cur).map(x => btn('w' + x.n, x.n >= 1 ? 'Week ' + x.n : 'Pre-season', fmtD(x.from) + '–' + fmtD(x.end))).join('') +
    (w.length ? btn('cur', 'Current', w[w.length - 1].cur ? 'week ' + w[w.length - 1].n : '') : '') + btn('custom', 'Custom range…') +
    `<span class="pdesc" title="Weeks (TxFlow points epochs) run from Monday 00:00 GMT to Sunday 23:59 GMT. Week 1 = Epoch I of Season One, started on 12 Oct 2026 and ends on 18 Oct 23:59:59 GMT (the end time comes from the TxFlow API). Trading before that is covered by All time or a custom range.">ⓘ weeks: Mon–Sun, 00:00 GMT</span>`;
  $('#custom').hidden = k !== 'custom'; $('#pnote').textContent = 'Weeks (TxFlow points epochs) run from Monday 00:00 GMT (UTC) to Sunday 23:59 GMT. Week 1 of Season 1 started on 12 Oct 2026; the points snapshot is taken when a week ends. Earlier Monday–Sunday weeks are shown as Pre-season (back to the first deposit, at most 40 weeks); use a custom range for anything older.';
}
const toGmtInput = ms => { const d = new Date(ms); return pad2(d.getUTCDate()) + '.' + pad2(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()); };
const parseGmt = v => { v = v.trim(); let m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?: (\d{1,2}):(\d{2}))?$/.exec(v), Y, M, D; if (m) { D = +m[1]; M = +m[2]; Y = +m[3]; } else { m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v); if (!m) return NaN; Y = +m[1]; M = +m[2]; D = +m[3]; } return Date.UTC(Y, M - 1, D, +(m[4] || 0), +(m[5] || 0)); };
function applyPeriod(p) {
  period = p; renderPeriodBar();
  if (!S) return; S.fills = []; S.fillsDone = false; render(); loadFills(runId, false); loadFunding(runId); loadOrders(runId);
}
$('#periodbar').addEventListener('click', e => {
  const b = e.target.closest('[data-p]'); if (!b) return; const key = b.dataset.p;
  if (key === 'custom') { const now = Date.now(); if (!period.from) { $('#pf').value = toGmtInput(now - 86400e3); $('#pt').value = toGmtInput(now); } period = { ...period, key: 'custom' }; renderPeriodBar(); if (period.from && period.to) applyPeriod(period); return; }
  applyPeriod({ key });
});
$('#pgo').onclick = () => { const f = parseGmt($('#pf').value), t = parseGmt($('#pt').value); if (isNaN(f) || isNaN(t)) { status('Use the format DD.MM.YYYY HH:MM (GMT), e.g. 07.10.2026 00:00', true); return; } if (!(f < t)) { status('Range start must be before its end', true); return; } applyPeriod({ key: 'custom', from: f, to: t }); };

/* ---------------------------------------------------------------- Share card (canvas, for Discord) */
const SH = { week: null, tok: 0, cache: {}, fcache: {}, data: null, w: null, brand: null, size: 720,   // the only output format: 720 x 486 px
   name: store.get('sh_name', ''), bg: null, dim: Math.max(0, Math.min(85, +store.get('sh_dim', 55))), slots: store.get('sh_slots', null) };
// The logo is embedded as a data URI: an image loaded from a file next to the page taints the canvas when the page is opened from disk (file://),
// which makes canvas.toBlob() fail ("Tainted canvases may not be exported").
const BRAND_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGsAAAAtCAYAAACpvpV9AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAARTSURBVHhe7Zk9i9tIGMf/OVJck0NTHFyjBW2fCztd4s76ALegxlfHrTvZTWpD4jVcwJDKqeNGsPcBpOZOKbVf4MhAVOTAB7NsPkCukJ/Z8Vh2ZK2z8cD8QM3Ms3p5fvPyjPfBj4/wBQ4r+MFscBwvTpZFOFkW4WRZhJNlEU6WRThZFuFkWYSTZRFOlkU4WRbhZFmEk2URTpZFOFkW8eCY/p/FfAZZSrN5K7zHUSwKs3kD3uNm0wZ0n6ATgPkMIhd7vct90FrWo19+wpPoCQDg7zd/AV+qDw2eBWboGtfldW2Cmc/w/M/nELkwu2phPgMAzM/nZtcGcRGr+G1M+RSylOhf9hF0AiSDpPY9vyetZQWdAP3LPgDg1a+vcPPpBt1hF+EoNEPXkKXElE/NZnU/kQukF2nV9ixQ90sGiRrp1F4sCiSDZO0+dZAsWUpcf7w2uwHt/scs60571vKf//D5389mcyvCYQiRC8zP5xC5gMgFsosMACBygWJRbLQ3EaWTTTLMz+e117EteXW0liVygddP/8DLxy9x8+nG7N4bWcpGSxqxr6hDwXxWLfed3cv9t6C1rEOzb/JFLlTSKHF6Ir+2R+0L73GMl2PERYz+ZR/9yz7iIkZ32FUxzGcYL8cYL8drz49mkWofL8eqXe9rUgQ9NBuaQgWB2WaSDJK1ouFQy03QCdAdddVeNOVTnPXOEI6q5TS9SDee5fle7TuacSb6XixLCZELNTDCUYjTzqlaSmUpwXwG78S73WNXg0kfYJSTfWZo65nlnVQfrl91UAlM16HQiwv68KvFFdJJqvY9k3AUIi7ijSuaRWaogoQAQDpJMeVTJIME8/O5KpSCTqBmBhUwej7Y6ijwIf9QxWsVM8XVva9Ja1nHABUevMfVTLtaXJlhd4ISqxc2hCwl0klVuZIsEuL53lq7LCXE+0rIaecUMIQ2GchWy8KqwpOlRDSLUCyKnR+dDBK8+PnFxrVrv2QnVUJJggkJ8E4qOaYQFZcLNesolpbApkeEg8qi9Vy/vjWylMgmGZjPEA53n/HasG15J6jfjDOF0HZA+10bDiqreFfc+/kl6ATwfE9t3np1dghoRpkzxYRmh3noJlmUB73o0EU24aCy7hsqbLKLTFWd/HfeeuTWoS9zZuXGfIbuqBoc8uOtDJo9dOkyKE4vMpoOaKtlnfXOVCJkKVEsCrCaI8VdoCKG+QzRLEI0i8B7HN1hd+1nLLP4AHArUpOh72kk35yN2zhaWbzHERcxoP1uSJUV8xniIkY4ClXyoFVg1N/koNmEbJIhnaRgPgPvcUSzSJXzIhd4+9vbtXhaOun5+swiMYF2cG86s1r/kMtWh0KdplVNE+qWMv2j9H5qN/9G3x+wStTXErMrlr6ZBoV4X19EsdWhmDBj9LzVPWcbrWU57p+jXQYdmzhZFuFkWYSTZRFOlkU4WRbhZFmEk2URTpZFOFkW4WRZhJNlEf8DCyk/NafhH30AAAAASUVORK5CYII=';
{ const im = new Image(); im.onload = () => { SH.brand = im; try { shRedraw(); } catch (e) { } }; im.src = BRAND_LOGO; }
store.set('sh_logo', null);   // the logo upload was removed; free the stored data
{ const b = store.get('sh_bg', null); if (b) { const im = new Image(); im.onload = () => { SH.bg = im; }; im.src = b; } }
const shKey = () => `sh_${S.addr}_${SH.week}`;
async function fetchRange(fromUs, toUs, tok) {   // null when superseded
  return pullBack({ type: 'userFills', user: S.addr, accountType: ['perps'] }, { from: fromUs / US, to: toUs / US, cap: 100000, id: f => f.tid + '_' + f.oid, t: f => f.time, norm: normFill, live: () => tok === SH.tok });
}
async function fetchFunding(fromUs, toUs, tok) {
  return pullBack({ type: 'userFundings', user: S.addr }, { from: fromUs / US, to: toUs / US, cap: 30000, id: x => x.time + x.coin, t: x => x.time, norm: normFunding, live: () => tok === SH.tok });
}
function weekData(w, fills, funding) {
  const byDay = Array(7).fill(0), byHour = Array(24).fill(0), byMkt = {}, active = new Set();
  let vol = 0, fees = 0, closed = 0, mk = 0, buyV = 0, sellV = 0, maxFill = 0, wins = 0, losses = 0, winS = 0, lossS = 0, best = 0, worst = 0;
  const byMktNet = {};
  for (const f of fills) {
    const v = n(f.size) * n(f.price), t = f.createdAt / 1000, k = Math.max(0, Math.min(6, Math.floor((t - w.from) / 864e5))), pnl = n(f.closedPnl);
    byDay[k] += v; byHour[new Date(t).getUTCHours()] += v; vol += v; fees += n(f.fee); closed += pnl;
    if (f.role === 'MAKER') mk += v; if (f.side === 'BUY') buyV += v; else sellV += v;
    if (v > maxFill) maxFill = v; byMkt[f.marketDisplayName] = (byMkt[f.marketDisplayName] || 0) + v; active.add(k);
    byMktNet[f.marketDisplayName] = (byMktNet[f.marketDisplayName] || 0) + pnl - n(f.fee);
    if (pnl > 0) { wins++; winS += pnl; if (pnl > best) best = pnl; } else if (pnl < 0) { losses++; lossS += pnl; if (pnl < worst) worst = pnl; }
  }
  const fund = (funding || []).filter(x => x.time >= w.from * 1000 && x.time <= w.to * 1000).reduce((a, x) => a + n(x.payment), 0);
  const days = w.cur ? Math.max(1, Math.min(7, Math.ceil((Date.now() - w.from) / 864e5))) : 7;
  let streak = 0, run = 0; byDay.forEach(v => { run = v > 0 ? run + 1 : 0; streak = Math.max(streak, run); });
  let winStreak = 0, wrun = 0; fills.slice().sort((a, b) => a.createdAt - b.createdAt).forEach(f => { const p = n(f.closedPnl); if (p > 0) { wrun++; winStreak = Math.max(winStreak, wrun); } else if (p < 0) wrun = 0; });
  return { w, byDay, byHour, byMkt, byMktNet, winStreak, vol, fees, closed, fund, fills: fills.length, makerVol: mk, makerShare: vol ? mk / vol : 0, buyV, sellV, maxFill, wins, losses, winS, lossS, best, worst,
    streak, active: active.size, days };
}
/* ---- catalogue of stats the user can put on the card (any 6) */
const POSC = '#5ee08a', NEGC = '#ff7a7a', WHITE = '#f1f7f3';
const sc = (v, txt) => [txt, v > 0 ? POSC : v < 0 ? NEGC : WHITE];
const topMkt = d => Object.entries(d.byMkt).sort((a, b) => b[1] - a[1])[0];
const SHM = [
  { id: 'avg_daily', g: 'Activity', label: 'Avg. daily volume', f: d => ['$' + big(d.vol / d.days)] },
  { id: 'active_days', g: 'Activity', label: 'Active days', f: d => [`${d.active} / ${d.days}`] },
  { id: 'fills', g: 'Activity', label: 'Fills', f: d => [fmt(d.fills, 0)] },
  { id: 'fills_day', g: 'Activity', label: 'Fills per active day', f: d => [d.active ? fmt(d.fills / d.active, 0) : '—'] },
  { id: 'avg_fill', g: 'Activity', label: 'Avg. fill size', f: d => [d.fills ? '$' + fmt(d.vol / d.fills, 0) : '—'] },
  { id: 'largest_fill', g: 'Activity', label: 'Largest fill', f: d => [d.fills ? '$' + big(d.maxFill) : '—'] },
  { id: 'best_day', g: 'Activity', label: 'Best day (volume)', f: d => { const m = Math.max(...d.byDay); return m > 0 ? ['$' + big(m) + ' · ' + dayLbl(d.w.from + d.byDay.indexOf(m) * 864e5, { weekday: 'short' })] : ['—']; } },
  { id: 'streak', g: 'Activity', label: 'Longest active streak', f: d => [`${d.streak} day${d.streak === 1 ? '' : 's'}`] },
  { id: 'peak_hour', g: 'Activity', label: 'Most active hour (UTC)', f: d => { const m = Math.max(...d.byHour); return m > 0 ? [String(d.byHour.indexOf(m)).padStart(2, '0') + ':00'] : ['—']; } },
  { id: 'markets', g: 'Activity', label: 'Markets traded', f: d => [fmt(Object.keys(d.byMkt).length, 0)] },
  { id: 'top_market', g: 'Activity', label: 'Top market', f: d => { const t = topMkt(d); return t ? [`${t[0].replace('-USD', '')} · ${fmt(t[1] / d.vol * 100, 0)}%`] : ['—']; } },
  { id: 'maker_share', g: 'Activity', label: 'Maker share', f: d => [fmt(d.makerShare * 100, 0) + '%'] },
  { id: 'maker_vol', g: 'Activity', label: 'Maker volume', f: d => ['$' + big(d.makerVol)] },
  { id: 'taker_vol', g: 'Activity', label: 'Taker volume', f: d => ['$' + big(d.vol - d.makerVol)] },
  { id: 'buy_sell', g: 'Activity', label: 'Buys / sells (volume)', f: d => d.vol ? [`${fmt(d.buyV / d.vol * 100, 0)}% / ${fmt(d.sellV / d.vol * 100, 0)}%`] : ['—'] },
  { id: 'vs_prev', g: 'Activity', label: 'Volume vs previous week', f: d => d.prevVol === undefined ? ['…'] : (d.prevVol ? sc(d.vol - d.prevVol, sgn((d.vol / d.prevVol - 1) * 100, 1) + '%') : ['—', WHITE]) },
  { id: 'fees', g: 'Costs', label: 'Fees paid', f: d => [money(-d.fees), WHITE] },
  { id: 'fee_bps', g: 'Costs', label: 'Fee rate (bps of volume)', f: d => [d.vol ? fmt(d.fees / d.vol * 1e4, 2) + ' bps' : '—'] },
  { id: 'realized_net', g: 'Performance (P&L)', pnl: true, label: 'Realized PnL (net of fees)', f: d => sc(d.closed - d.fees, smoney(d.closed - d.fees)) },
  { id: 'realized_gross', g: 'Performance (P&L)', pnl: true, label: 'Realized PnL (gross)', f: d => sc(d.closed, smoney(d.closed)) },
  { id: 'funding', g: 'Performance (P&L)', pnl: true, label: 'Funding', f: d => sc(d.fund, smoney(d.fund)) },
  { id: 'net_total', g: 'Performance (P&L)', pnl: true, label: 'Net PnL (realized − fees + funding)', f: d => sc(d.closed - d.fees + d.fund, smoney(d.closed - d.fees + d.fund)) },
  { id: 'edge_bps', g: 'Performance (P&L)', pnl: true, label: 'Net edge (bps of volume)', f: d => { const e = d.vol ? (d.closed - d.fees + d.fund) / d.vol * 1e4 : null; return e == null ? ['—', WHITE] : sc(e, sgn(e, 2) + ' bps'); } },
  { id: 'pnl_per_m', g: 'Performance (P&L)', pnl: true, label: 'Net PnL per $1M volume', f: d => { const e = d.vol ? (d.closed - d.fees + d.fund) / d.vol * 1e6 : null; return e == null ? ['—', WHITE] : sc(e, smoney(e, 0)); } },
  { id: 'win_rate', g: 'Performance (P&L)', pnl: true, label: 'Win rate (closing fills)', f: d => [d.wins + d.losses ? fmt(d.wins / (d.wins + d.losses) * 100, 1) + '%' : '—', WHITE] },
  { id: 'profit_factor', g: 'Performance (P&L)', pnl: true, label: 'Profit factor', f: d => [d.lossS ? fmt(d.winS / -d.lossS, 2) : '—', WHITE] },
  { id: 'best_market', g: 'Performance (P&L)', pnl: true, label: 'Best market (net PnL)', f: d => { const e = Object.entries(d.byMktNet).sort((a, b) => b[1] - a[1])[0]; return e ? sc(e[1], e[0].replace('-USD', '') + '  ' + smoney(e[1])) : ['—', WHITE]; } },
  { id: 'worst_market', g: 'Performance (P&L)', pnl: true, label: 'Worst market (net PnL)', f: d => { const e = Object.entries(d.byMktNet).sort((a, b) => a[1] - b[1])[0]; return e ? sc(e[1], e[0].replace('-USD', '') + '  ' + smoney(e[1])) : ['—', WHITE]; } },
  { id: 'win_streak', g: 'Performance (P&L)', pnl: true, label: 'Longest winning streak', f: d => [`${d.winStreak} fill${d.winStreak === 1 ? '' : 's'}`, WHITE] },
  { id: 'best_fill', g: 'Performance (P&L)', pnl: true, label: 'Best single fill', f: d => sc(d.best, smoney(d.best)) },
  { id: 'worst_fill', g: 'Performance (P&L)', pnl: true, label: 'Worst single fill', f: d => sc(d.worst, smoney(d.worst)) },
];
const SHP = {
  default: ['realized_net', 'net_total', 'funding', 'fees', 'avg_daily', 'active_days'],
  activity: ['fills', 'avg_fill', 'maker_share', 'fees', 'avg_daily', 'active_days'],
  trader: ['win_rate', 'profit_factor', 'edge_bps', 'top_market', 'best_day', 'streak'],
};
{ const ok = new Set(SHM.map(m => m.id)); if (!Array.isArray(SH.slots) || SH.slots.length !== 6 || SH.slots.some(x => !ok.has(x))) SH.slots = SHP.default.slice(); }
function shItems(d) {
  const by = Object.fromEntries(SHM.map(m => [m.id, m]));
  return SH.slots.map(id => { const m = by[id] || by.fills, r = m.f(d); return [m.label, r[0], r[1] || WHITE]; });
}
const SHPNL = new Set(SHM.filter(m => m.pnl).map(m => m.id));
const shHasPnl = () => SH.slots.some(id => SHPNL.has(id));
const shSync = () => { $('#shPnl').checked = shHasPnl(); };
const dayLbl = (ms, o) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
async function loadShare() {
  const tok = ++SH.tok, w = weeksList().find(x => x.n === SH.week); if (!w) return;
  $('#shWeek').textContent = `${w.n >= 1 ? 'Week ' + w.n : 'Pre-season'} ·${dayLbl(w.from, { day: '2-digit', month: '2-digit' })} – ${dayLbl(w.end, { day: '2-digit', month: '2-digit' })}${w.cur ? ' (current)' : ''}`;
  const pv = store.get(shKey(), {}); $('#shPts').value = pv.pts ?? ''; $('#shRank').value = pv.rank ?? '';
  const key = S.addr + ':' + S.idx + ':' + w.n, hit = SH.cache[key];
  if (hit && !w.cur) { SH.data = weekData(w, hit, SH.fcache[key] || []); drawPreview(); ensurePrev(); return; }
  $('#shMsg').textContent = 'Loading fills for this week…'; SH.data = null; drawPreview();
  try { const fills = await fetchRange(w.from * 1000, w.to * 1000, tok); if (!fills || tok !== SH.tok) return; const fund = await fetchFunding(w.from * 1000, w.to * 1000, tok); if (!fund || tok !== SH.tok) return; SH.cache[key] = fills; SH.fcache[key] = fund; SH.data = weekData(w, fills, fund); $('#shMsg').textContent = fills.length >= 100000 ? 'Capped at 100,000 fills.' : ''; }
  catch (e) { $('#shMsg').textContent = 'Could not load fills: ' + e.message; }
  drawPreview(); ensurePrev();
}
async function ensurePrev() {
  const d = SH.data; if (!d || d.prevVol !== undefined || !SH.slots.includes('vs_prev')) return;
  const prev = weeksList().find(x => x.n === d.w.n - 1); if (!prev) { d.prevVol = null; drawPreview(); return; }
  const tok = SH.tok, key = S.addr + ':' + S.idx + ':' + prev.n; let fills = SH.cache[key];
  if (!fills) { try { fills = await fetchRange(prev.from * 1000, prev.to * 1000, tok); } catch (e) { return; } if (!fills || tok !== SH.tok) return; SH.cache[key] = fills; }
  const limit = d.w.cur ? prev.from + (Date.now() - d.w.from) : Infinity;   // current week: compare with the same elapsed time of the previous week
  d.prevVol = fills.reduce((a, f) => f.createdAt / 1000 <= limit ? a + n(f.size) * n(f.price) : a, 0); drawPreview();
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawShare(cv, d, preview, R = 1.5) {   // layout is 1200 x 810; R = output pixel scale
  const W = 1200, H = 810; cv.width = W * R; cv.height = H * R; const c = cv.getContext('2d'); c.setTransform(R, 0, 0, R, 0, 0);
  const FONT = '"Inter","Segoe UI",system-ui,-apple-system,sans-serif', GREEN = '#7dffa6', MUT = '#8aa597', POS = '#5ee08a', NEG = '#ff7a7a';
  const T = (str, x, y, size, color, weight = 600, align = 'left', ls = 0) => { c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color; c.textAlign = align; if ('letterSpacing' in c) c.letterSpacing = ls + 'px'; c.fillText(str, x, y); if ('letterSpacing' in c) c.letterSpacing = '0px'; };
  // background
  rr(c, 0, 0, W, H, 34); c.save(); c.clip();
  let g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#060d0a'); g.addColorStop(1, '#0b1c14'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  if (SH.bg) { const sc = Math.max(W / SH.bg.width, H / SH.bg.height), dw = SH.bg.width * sc, dh = SH.bg.height * sc; c.drawImage(SH.bg, (W - dw) / 2, (H - dh) / 2, dw, dh); c.fillStyle = `rgba(4,10,7,${SH.dim / 100})`; c.fillRect(0, 0, W, H); }
  g = c.createRadialGradient(W * .88, 40, 10, W * .88, 40, 520); g.addColorStop(0, 'rgba(70,210,120,.20)'); g.addColorStop(1, 'rgba(70,210,120,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.restore(); rr(c, .5, .5, W - 1, H - 1, 34); c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 1; c.stroke();
  // header: logo + name
  const name = SH.name.trim();
  // header: embedded logo + title; no placeholder icon
  const lg = SH.brand; let tx = 56, wordmark = false;
  if (lg) {
    const asp = lg.width / lg.height, lh = 64, lw = Math.min(lh * asp, 280);
    if (asp <= 1.4) { rr(c, 56, 46, lw, lh, 16); c.fillStyle = 'rgba(94,224,138,.13)'; c.fill(); c.strokeStyle = 'rgba(94,224,138,.4)'; c.lineWidth = 1.5; c.stroke(); }
    const pad = asp <= 1.4 ? 10 : 0; c.drawImage(lg, 56 + pad, 46 + pad, lw - 2 * pad, lh - 2 * pad);
    tx = 56 + lw + 24; wordmark = asp > 1.8;
  }
  if (name || !wordmark) T(name || 'TxFlow Trade Stats', tx, 92, wordmark ? 40 : 46, '#f1f7f3', 700);
  T('Weekly stats · unofficial', W - 56, 90, 20, MUT, 500, 'right');
  // pills
  const w = d.w, pillTxt = w.n >= 1 ? 'WEEK ' + w.n : 'PRE-SEASON'; c.font = `700 20px ${FONT}`; if ('letterSpacing' in c) c.letterSpacing = '2px'; const pw = c.measureText(pillTxt).width + 40; if ('letterSpacing' in c) c.letterSpacing = '0px';
  rr(c, 56, 146, pw, 42, 21); c.fillStyle = 'rgba(94,224,138,.14)'; c.fill(); c.strokeStyle = 'rgba(94,224,138,.55)'; c.lineWidth = 1.5; c.stroke();
  T(pillTxt, 56 + pw / 2, 175, 20, GREEN, 700, 'center', 2);
  const range = `${dayLbl(w.from, { day: 'numeric', month: 'short' })} – ${dayLbl(w.end, { day: 'numeric', month: 'short' })}`;
  T(`${w.n >= 1 ? 'Season 1  ·  ' : ''}${range}${w.cur ? '  ·  in progress' : ''}`, 56 + pw + 20, 175, 24, '#b9cbc0', 500);
  // panels
  const panel = (x, y, wd, h, hl) => { rr(c, x, y, wd, h, 26); c.fillStyle = SH.bg ? (hl ? 'rgba(14,60,38,.55)' : 'rgba(6,14,10,.55)') : (hl ? 'rgba(94,224,138,.07)' : 'rgba(255,255,255,.045)'); c.fill(); c.strokeStyle = hl ? 'rgba(94,224,138,.4)' : 'rgba(255,255,255,.09)'; c.lineWidth = 1.5; c.stroke(); };
  const PY = 214, PH = 276;
  panel(56, PY, 640, PH, false); panel(724, PY, 420, PH, true);
  T('VOLUME TRADED', 90, PY + 52, 20, GREEN, 700, 'left', 3);
  T('$' + big(d.vol), 90, PY + 150, 100, '#f4faf6', 800);
  T(`total notional traded ${w.cur ? 'so far this week' : 'this week'} · not profit`, 90, PY + 184, 20, MUT, 500);
  const mx = Math.max(...d.byDay, 1), bx = 90, bw = 58, gap = 24, base = PY + 238;
  d.byDay.forEach((v, i) => { const h = Math.max(4, v / mx * 40), x = bx + i * (bw + gap); rr(c, x, base - h, bw, h, 7); c.fillStyle = v > 0 ? (v === mx ? 'rgba(200,215,205,.55)' : 'rgba(160,180,168,.38)') : 'rgba(160,180,168,.18)'; c.fill(); T(dayLbl(w.from + i * 864e5, { weekday: 'short' }), x + bw / 2, base + 24, 17, MUT, 500, 'center'); });
  const pv = store.get(shKey(), {}), pts = parseFloat(pv.pts), rank = parseFloat(pv.rank);
  if (isFinite(pts)) {
    T('POINTS', 758, PY + 52, 20, GREEN, 700, 'left', 3);
    T(fmt(pts, pts % 1 ? 2 : 0), 758, PY + 164, 124, GREEN, 800);
    if (isFinite(rank)) T('Rank #' + fmt(rank, 0), 758, PY + 214, 30, '#d7e6dc', 600);
    if (d.vol > 0) T(`${fmt(pts / d.vol * 1e6, 1)} pts per $1M volume`, 758, PY + 252, 20, MUT, 500);
  } else if (preview) {
    c.save(); rr(c, 724 + 6, PY + 6, 408, PH - 12, 22); c.setLineDash([10, 8]); c.strokeStyle = 'rgba(94,224,138,.55)'; c.lineWidth = 2; c.stroke(); c.restore();
    T('POINTS', 758, PY + 52, 20, GREEN, 700, 'left', 3);
    T('←', 758, PY + 150, 84, GREEN, 700);
    T('Enter your points', 758, PY + 196, 32, '#e6f2ea', 700);
    T('Fill in “Points this week” and', 758, PY + 232, 20, MUT, 500);
    T('“Rank” in the form next to the card', 758, PY + 258, 20, MUT, 500);
  } else {
    T('FILLS', 758, PY + 52, 20, GREEN, 700, 'left', 3);
    T(fmt(d.fills, 0), 758, PY + 164, 124, GREEN, 800);
    T(`maker ${fmt(d.makerShare * 100, 0)}% by volume`, 758, PY + 214, 28, '#d7e6dc', 600);
    T(d.fills ? `avg fill $${fmt(d.vol / d.fills, 0)}` : '', 758, PY + 252, 20, MUT, 500);
  }
  // stats grid (6 user-chosen stats)
  shItems(d).forEach((it, i) => {
    const x = 56 + (i % 3) * 380, y = 540 + Math.floor(i / 3) * 100; T(it[0], x, y, 20, MUT, 500);
    let size = 46; c.font = `800 ${size}px ${FONT}`; while (c.measureText(it[1]).width > 330 && size > 24) { size -= 2; c.font = `800 ${size}px ${FONT}`; }
    T(it[1], x, y + 48, size, it[2], 800);
  });
  T('Data from the exchange API · unofficial', 56, H - 54, 17, '#5f776a', 500);
  T('Weeks: Mon 00:00 – Sun 23:59 GMT', 56, H - 28, 17, '#5f776a', 500);
}
function shPreviewSize() {
  const cv = $('#shCv'), box = $('#shSlotsBox'), host = box.parentElement;
  cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';   // shown at its real pixel size
  box.style.width = Math.min(cv.width, host.clientWidth || cv.width) + 'px';   // the boxes are as wide as the picture above them
}
function drawPreview() {
  const cv = $('#shCv'); if (!SH.data) { const c = cv.getContext('2d'); cv.width = SH.size; cv.height = Math.floor(SH.size * 810 / 1200); c.fillStyle = '#0a130e'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#8aa597'; c.font = '20px system-ui'; c.textAlign = 'center'; c.fillText('Loading…', cv.width / 2, cv.height / 2); shPreviewSize(); return; }
  drawShare(cv, SH.data, true, SH.size / 1200); shDims(); shPreviewSize();
  const need = !isFinite(parseFloat(store.get(shKey(), {}).pts)); $('#shPts').classList.toggle('need', need); $('#shRank').classList.toggle('need', need);
}
function buildSlots() {
  const dflt = SHP.default, by = Object.fromEntries(SHM.map(m => [m.id, m])), g = {};
  SHM.filter(m => !dflt.includes(m.id)).forEach(m => (g[m.g] = g[m.g] || []).push(m));
  const opt = m => `<option value="${m.id}"${tipFor(m.label) ? ` title="${esc(tipFor(m.label))}"` : ''}>${m.label}</option>`;
  const opts = `<optgroup label="Default stats (in card order)">${dflt.map(id => opt(by[id])).join('')}</optgroup>` +
    Object.entries(g).map(([k, a]) => `<optgroup label="${k}">${a.map(opt).join('')}</optgroup>`).join('');
  $('#shSlots').innerHTML = SH.slots.map((id, i) => `<div class="shslot"><span class="shn">${i + 1}</span><select data-i="${i}" aria-label="Stat ${i + 1}">${opts}</select></div>`).join('');
  [...$('#shSlots').querySelectorAll('select')].forEach((el, i) => { el.value = SH.slots[i]; });
}
function openShare() {
  if (!S) { status('Load an address first', true); return; }
  const ws = weeksList(); if (!ws.length) return;
  SH.week = ws[ws.length - 1].n;   // always open on the current week; ‹ goes to earlier weeks
  buildSlots(); shDims(); $('#shName').value = SH.name; shSync(); $('#shDim').value = String(SH.dim); $('#shDimV').textContent = SH.dim + '%'; $('#shBgNote').textContent = SH.bg ? 'Background image is used.' : 'No background selected.';
  $('#shareDlg').showModal(); loadShare();
}
const shStep = d => { const ws = weeksList(), i = ws.findIndex(x => x.n === SH.week), j = Math.max(0, Math.min(ws.length - 1, i + d)); SH.week = ws[j].n; loadShare(); };
$('#btnShare').onclick = openShare; $('#shClose').onclick = () => $('#shareDlg').close();
$('#shPrev').onclick = () => shStep(-1); $('#shNext').onclick = () => shStep(1);
let shT; const shRedraw = () => { clearTimeout(shT); shT = setTimeout(() => SH.data && drawPreview(), 100); };
$('#shName').oninput = e => { SH.name = e.target.value; store.set('sh_name', SH.name); shRedraw(); };
$('#shSlots').addEventListener('change', e => {
  const sel = e.target.closest('select'); if (!sel) return; const i = +sel.dataset.i, v = sel.value, old = SH.slots[i], j = SH.slots.indexOf(v);
  if (j >= 0 && j !== i) SH.slots[j] = old;   // picking an already used stat swaps the two slots
  SH.slots[i] = v; store.set('sh_slots', SH.slots); buildSlots(); shSync(); shRedraw(); ensurePrev();
});
$('#shPresets').addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if (!b) return; SH.slots = SHP[b.dataset.preset].slice(); store.set('sh_slots', SH.slots); buildSlots(); shSync(); shRedraw(); ensurePrev(); });
function shDims() { $('#shDims').textContent = `Actual size (1:1) · PNG ${SH.size} × ${Math.floor(SH.size * 810 / 1200)} px · about 330 KB`; }
$('#shPnl').onchange = e => {
  if (!e.target.checked) {   // hide P&L: replace every P&L stat by the first unused activity stat (visible in the dropdowns)
    SH.pnlBackup = SH.slots.slice(); store.set('sh_slots_backup', SH.pnlBackup);
    const fb = ['fills', 'avg_fill', 'maker_share', 'top_market', 'markets', 'fee_bps', 'best_day', 'streak', 'peak_hour', 'fills_day', 'largest_fill', 'maker_vol', 'taker_vol', 'buy_sell', 'vs_prev'];
    const used = new Set(SH.slots.filter(id => !SHPNL.has(id)));   // keep every non-P&L pick, fill the P&L slots with distinct activity stats
    SH.slots = SH.slots.map(id => { if (!SHPNL.has(id)) return id; const alt = fb.find(x => !used.has(x)); if (alt) used.add(alt); return alt || id; });
  } else {                   // show P&L again: restore the previous selection (or the defaults)
    const bk = SH.pnlBackup || store.get('sh_slots_backup', null), ok = new Set(SHM.map(m => m.id));
    SH.slots = Array.isArray(bk) && bk.length === 6 && bk.every(x => ok.has(x)) && bk.some(x => SHPNL.has(x)) ? bk.slice() : SHP.default.slice();
  }
  store.set('sh_slots', SH.slots); buildSlots(); shSync(); shRedraw(); ensurePrev();
};
const shSaveNums = () => { store.set(shKey(), { pts: $('#shPts').value, rank: $('#shRank').value }); shRedraw(); };
$('#shPts').oninput = shSaveNums; $('#shRank').oninput = shSaveNums;
$('#shBgBtn').onclick = () => $('#shBg').click();
$('#shBg').onchange = e => {
  const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
  rd.onload = () => { const im = new Image(); im.onload = () => {
      const k = Math.min(1, 1800 / im.width), cvs = document.createElement('canvas'); cvs.width = Math.round(im.width * k); cvs.height = Math.round(im.height * k);
      cvs.getContext('2d').drawImage(im, 0, 0, cvs.width, cvs.height);   // downscale + re-encode so it stays small enough to remember
      const url = cvs.toDataURL('image/jpeg', 0.88), small = new Image();
      small.onload = () => { SH.bg = small; store.set('sh_bg', url.length < 1.8e6 ? url : null); $('#shBgNote').textContent = 'Background image is used.'; shRedraw(); }; small.src = url;
    }; im.onerror = () => { $('#shBgNote').textContent = 'Could not read this image.'; }; im.src = rd.result; };
  rd.readAsDataURL(f); e.target.value = '';
};
$('#shBgClear').onclick = () => { SH.bg = null; store.set('sh_bg', null); $('#shBgNote').textContent = 'No background selected.'; shRedraw(); };
$('#shDim').oninput = e => { SH.dim = +e.target.value; $('#shDimV').textContent = SH.dim + '%'; store.set('sh_dim', SH.dim); shRedraw(); };
async function shBlob() { if (!SH.data) throw new Error('card is not ready yet'); const off = document.createElement('canvas'); drawShare(off, SH.data, false, SH.size / 1200); return new Promise(r => off.toBlob(r, 'image/png')); }
$('#shDl').onclick = async () => { try { const b = await shBlob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `txflow-week-${SH.week}-card.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); $('#shMsg').textContent = `Saved: ${SH.size} × ${Math.floor(SH.size * 810 / 1200)} px, ${fmt(b.size / 1024, 0)} KB.`; } catch (e) { $('#shMsg').textContent = e.message; } };
$('#shCopy').onclick = async () => { try { const b = await shBlob(); if (!navigator.clipboard || !window.ClipboardItem) throw new Error('this browser cannot copy images — use Download'); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); $('#shMsg').textContent = 'Image copied.'; } catch (e) { $('#shMsg').textContent = e.message; } };
/* ---- GMT date-time picker (English, independent of the browser locale) */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const cal = { el: $('#cal'), target: null, y: 0, m: 0, sel: null, hh: 0, mm: 0 };
const p2 = v => String(v).padStart(2, '0');
function calValue() { const [y, m, d] = cal.sel; return `${p2(d)}.${p2(m + 1)}.${y} ${p2(cal.hh)}:${p2(cal.mm)}`; }
function calRender() {
  const first = new Date(Date.UTC(cal.y, cal.m, 1)), lead = (first.getUTCDay() + 6) % 7, today = new Date(), tk = [today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()].join('-');
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(cal.y, cal.m, 1 - lead + i)), key = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()].join('-'), other = d.getUTCMonth() !== cal.m;
    cells += `<button type="button" class="calday${other ? ' other' : ''}${cal.sel && key === cal.sel.join('-') ? ' sel' : ''}${key === tk ? ' today' : ''}" data-d="${key}">${d.getUTCDate()}</button>`;
  }
  const hs = Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === cal.hh ? ' selected' : ''}>${p2(h)}</option>`).join(''), ms = Array.from({ length: 60 }, (_, m) => `<option value="${m}"${m === cal.mm ? ' selected' : ''}>${p2(m)}</option>`).join('');
  cal.el.innerHTML = `<div class="calhead"><button type="button" class="btn small" data-nav="-1" aria-label="Previous month">‹</button><b>${MONTHS[cal.m]} ${cal.y}</b><button type="button" class="btn small" data-nav="1" aria-label="Next month">›</button></div>
    <div class="calgrid calwd"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div><div class="calgrid">${cells}</div>
    <div class="caltime"><span>Time (GMT)</span><select id="calH">${hs}</select>:<select id="calM">${ms}</select>
      <button type="button" class="btn small" data-t="0:0">00:00</button><button type="button" class="btn small" data-t="23:59">23:59</button></div>
    <div class="calfoot"><button type="button" class="btn small" data-now="1">Now</button><span class="sp"></span><button type="button" class="btn small primary" data-done="1">Done</button></div>`;
}
function calOpen(input) {
  const v = parseGmt(input.value), dt = new Date(isNaN(v) ? Date.now() : v);
  cal.target = input; cal.y = dt.getUTCFullYear(); cal.m = dt.getUTCMonth(); cal.sel = isNaN(v) ? null : [cal.y, cal.m, dt.getUTCDate()];
  cal.hh = isNaN(v) ? (input.id === 'pt' ? 23 : 0) : dt.getUTCHours(); cal.mm = isNaN(v) ? (input.id === 'pt' ? 59 : 0) : dt.getUTCMinutes();
  calRender(); cal.el.hidden = false;
  const r = input.getBoundingClientRect(), w = 290, h = cal.el.offsetHeight;
  cal.el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  cal.el.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
}
const calClose = () => { cal.el.hidden = true; cal.target = null; };
const calApply = () => { if (cal.target && cal.sel) cal.target.value = calValue(); };
cal.el.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.nav) { cal.m += +t.dataset.nav; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } calRender(); return; }
  if (t.dataset.d) { cal.sel = t.dataset.d.split('-').map(Number); cal.y = cal.sel[0]; cal.m = cal.sel[1]; calApply(); calRender(); return; }
  if (t.dataset.t) { const [h, m] = t.dataset.t.split(':').map(Number); cal.hh = h; cal.mm = m; if (!cal.sel) { const n0 = new Date(); cal.sel = [n0.getUTCFullYear(), n0.getUTCMonth(), n0.getUTCDate()]; } calApply(); calRender(); return; }
  if (t.dataset.now) { const n0 = new Date(); cal.sel = [n0.getUTCFullYear(), n0.getUTCMonth(), n0.getUTCDate()]; cal.hh = n0.getUTCHours(); cal.mm = n0.getUTCMinutes(); cal.y = cal.sel[0]; cal.m = cal.sel[1]; calApply(); calRender(); return; }
  if (t.dataset.done) calClose();
});
cal.el.addEventListener('change', e => { if (e.target.id === 'calH') cal.hh = +e.target.value; if (e.target.id === 'calM') cal.mm = +e.target.value; if (!cal.sel) { const n0 = new Date(); cal.sel = [n0.getUTCFullYear(), n0.getUTCMonth(), n0.getUTCDate()]; } calApply(); });
document.addEventListener('mousedown', e => { if (!cal.el.hidden && !cal.el.contains(e.target) && !e.target.closest('[data-cal]')) calClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !cal.el.hidden) calClose(); });
document.querySelectorAll('[data-cal]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); calOpen($('#' + (el.dataset.cal || el.id))); }));
$('#pgo').addEventListener('click', calClose);
addEventListener('hashchange', () => { const h = location.hash.slice(1); if (/^0x[0-9a-fA-F]{40}/.test(h)) { const a = h.slice(0, 42).toLowerCase(); if (!S || S.addr !== a) { $('#addr').value = a; loadWallet(a); } } });
$('#ver').textContent = VERSION;
/* platform volume of the last 24 hours (all perpetual markets), shown in the header and refreshed every minute */
async function loadPlatform() {
  try {
    const d = await info({ type: 'allMarketTickers' }), p = d.filter(x => x.instrumentId < 1e4), vol = p.reduce((a, x) => a + n(x.dayNtlVlm), 0), spot = d.filter(x => x.instrumentId >= 1e4).reduce((a, x) => a + n(x.dayNtlVlm), 0);
    const oi = p.reduce((s, x) => s + n(x.openInterest) * n(x.markPx), 0), top = p.slice().sort((x, y) => n(y.openInterest) * n(y.markPx) - n(x.openInterest) * n(x.markPx)).slice(0, 3).map(x => `${coinName(x.coin)} $${big(n(x.openInterest) * n(x.markPx))}`).join(', ');
    $('#platOI').textContent = '$' + big(oi); 
    $('#platV').textContent = '$' + big(vol); $('#plat').title = `All ${p.length} perpetual markets on TxFlow.
Volume: last 24 hours (rolling window). Spot volume: $${big(spot)}.
OI: open interest in USD (open interest in coins × mark price). Largest: ${top}.
Updated ${new Date().toLocaleTimeString('en-US', { hour12: false })}.`;
  } catch (e) { $('#platV').textContent = '—'; $('#platOI').textContent = '—'; }
}
loadPlatform(); setInterval(() => { if (!document.hidden) loadPlatform(); }, 60000);


/* ---- Leaderboards tab: rankings of the past trading competitions of TxFlow (the API has no all-time / per-window ranking of PnL or volume) */
const LBT = { sel: store.get('lb_sel', null), meta: null, found: null, tok: 0 };
async function lbtMeta() {
  if (LBT.meta) return LBT.meta;
  const g = p => p.catch(() => null), [r1, r2, bull] = await Promise.all([g(info({ type: 'traderRoyaleInfo', activityCode: 'trader_royale' })), g(info({ type: 'traderRoyaleInfo', activityCode: 'trader_royale_2' })), g(info({ type: 'pnlRoiInfo', activityCode: 'bull_pit' }))]);
  const m = {}; if (r1 && r1.activity) m.trader_royale = r1.activity; if (r2 && r2.activity) m.trader_royale_2 = r2.activity; ((bull && bull.activities) || []).forEach(a => { m[a.activityCode] = a; });
  return LBT.meta = m;
}
function lbtUi() { $('#lbSel').innerHTML = LB_BOARDS.map(b => `<button data-c="${b.code}" class="${b.code === LBT.sel ? 'on' : ''}" type="button">${b.title}</button>`).join(''); }
const lbtStatus = (html, err, busy) => { const el = $('#lbStatus'); el.className = 'status' + (err ? ' err' : '') + (busy ? ' busy' : ''); el.innerHTML = (busy ? '<i class="spin"></i>' : '') + html; };
async function lbtLoad(force) {
  const tok = ++LBT.tok; lbtStatus('Loading the leaderboard…', false, true);
  try {
    const meta = await lbtMeta(); if (tok !== LBT.tok) return;
    if (!LB_BOARDS.some(b => b.code === LBT.sel)) { const live = LB_BOARDS.find(b => (meta[b.code] || {}).status === 1), last = LB_BOARDS.slice().sort((x, y) => ((meta[y.code] || {}).endTime || 0) - ((meta[x.code] || {}).endTime || 0))[0]; LBT.sel = (live || last).code; }
    lbtUi(); const b = LB_BOARDS.find(x => x.code === LBT.sel);
    if (force || !LBC[b.code]) LBC[b.code] = await info({ type: b.type, activityCode: b.code, pageNo: 1, pageSize: 50 }); if (tok !== LBT.tok) return;
    lbtStatus(''); lbtRender();
  } catch (e) { if (tok === LBT.tok) lbtStatus('Could not load the leaderboard: ' + esc(e.message), true); }
}
function lbtRender() {
  const b = LB_BOARDS.find(x => x.code === LBT.sel), a = (LBT.meta || {})[b.code] || {}, L = LBC[b.code], items = (L && L.page && L.page.items) || [], ts = ms => dtlU(ms * US) + ' GMT';
  $('#lbKpis').innerHTML = [['Competition', esc(a.name || b.title) + (a.status === 2 ? ' <small class="muted">finished</small>' : a.status === 1 ? ' <small class="pos">live</small>' : '')], ['Period', a.startTime ? `${ts(a.startTime)}<br>→ ${ts(a.endTime)}` : '—'], ['Prize pool', a.unlockedPrizePool ? fmt(n(a.unlockedPrizePool), 0) + ' <small class="muted">of ' + fmt(n(a.maxPrizePool), 0) + ' max</small>' : '—'],
    ['Total volume', a.totalVolume ? '$' + big(n(a.totalVolume)) : '—'], ['Participants', L ? fmt(n(L.participantCount), 0) : '—'], ['Stats updated', L && L.statsUpdatedAt ? dtl(L.statsUpdatedAt * US) : '—']].map(([k, v]) => `<div>${k}<b class="num" style="font-size:15px">${v}</b></div>`).join('');
  const me = new Set([LBT.found && LBT.found.mask, S && maskOf(S.addr)].filter(Boolean)), metric = b.metric === 'pnl' ? 'PnL' : b.metric === 'roi' ? 'ROI' : 'Final volume', medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r;
  $('#lbTable').innerHTML = !items.length ? '<tr><td class="empty" style="text-align:center">No data</td></tr>' : `<thead><tr><th>#</th><th style="text-align:left">Address</th><th>Taker volume</th><th>${metric}</th><th>Est. reward</th></tr></thead><tbody>` +
    items.map(r => `<tr class="lbrow${me.has(String(r.userAddress).toLowerCase()) ? ' me' : ''}"><td class="num"><span class="lbmedal">${medal(r.rank)}</span></td><td class="lbaddr" style="text-align:left">${esc(fullOf(r.userAddress))}</td><td class="num">$${big(n(r.takerVolume))}</td><td class="num ${b.metric === 'pnl' ? cls(n(r.pnl)) : ''}">${b.metric === 'pnl' ? smoney(n(r.pnl), 0) : b.metric === 'roi' ? fmt(n(r.roi) * 100, 1) + '%' : '$' + big(n(r.finalVolume))}</td><td class="num">${fmt(n(r.estimatedReward), 0)}</td></tr>`).join('') + '</tbody>';
  $('#lbNote').textContent = 'Top 50 of each competition. TxFlow shows the addresses in short form; a row shows the full address once you have opened that wallet on this site (it is remembered only in your browser). The wallet opened in My stats is highlighted.';
}
function lbtFind(text) {
  const t = String(text || '').trim().toLowerCase(), box = $('#lbFound');
  if (!/^0x[0-9a-f]{40}$/.test(t)) { box.innerHTML = '<div class="lbfoundbox neg">Enter a wallet address: 0x followed by 40 hex characters</div>'; return; }
  const mask = maskOf(t), b = LB_BOARDS.find(x => x.code === LBT.sel), L = LBC[b.code], r = ((L && L.page && L.page.items) || []).find(x => String(x.userAddress).toLowerCase() === mask);
  LBT.found = { mask }; KNOWN.add(t); store.set('known', [...KNOWN].slice(-500));
  box.innerHTML = r ? `<div class="lbfoundbox"><span class="lbaddr">${esc(t)}</span><b>Rank #${r.rank}</b><span>Taker volume $${big(n(r.takerVolume))}</span><span>Est. reward ${fmt(n(r.estimatedReward), 0)}</span></div>` : `<div class="lbfoundbox">Not in the top 50 of <b>${esc(b.title)}</b> (or it did not join).</div>`;
  lbtRender();
}
$('#lbSel').addEventListener('click', e => { const x = e.target.closest('button[data-c]'); if (!x) return; LBT.sel = x.dataset.c; store.set('lb_sel', LBT.sel); LBT.found = null; $('#lbFound').innerHTML = ''; lbtLoad(); });
$('#lbRefresh').onclick = () => lbtLoad(true);
$('#lbFind').addEventListener('submit', e => { e.preventDefault(); lbtFind($('#lbAddr').value); });
function showView(v, keepHash) {
  const lbv = v === 'lb';
  $('#viewStats').hidden = lbv; $('#viewLb').hidden = !lbv;
  document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
  $('#btnShare').hidden = lbv; $('#btnCards').hidden = lbv; if (lbv) $('#cardsPanel').hidden = true;
  if (!keepHash) history.replaceState(null, '', lbv ? '#leaderboards' : (S ? '#' + S.addr : location.pathname + location.search));
  if (lbv) lbtLoad();
}
$('#tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) showView(t.dataset.view); });
addEventListener('hashchange', () => { if (location.hash.slice(1) === 'leaderboards') showView('lb', true); else if ($('#viewStats').hidden) showView('stats', true); });
renderCardsList(); renderRecent(); setAuto(); renderPeriodBar();
{ const h = location.hash.slice(1); if (h === 'leaderboards') showView('lb', true); else if (/^0x[0-9a-fA-F]{40}/.test(h)) { const a = h.slice(0, 42); $('#addr').value = a; loadWallet(a); } }
})();
