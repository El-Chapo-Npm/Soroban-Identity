// Soroban Identity analytics dashboard — no build step, no dependencies.
"use strict";

const DAY = 86_400_000;
const SVG_NS = "http://www.w3.org/2000/svg";
const W = 640;
const H = 220;
const M = { top: 14, right: 48, bottom: 26, left: 40 };

const state = { summary: null, days: 30 };
const tooltip = document.getElementById("tooltip");
const numberFmt = new Intl.NumberFormat();
const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

function html(tag, props = {}, parent) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  if (parent) parent.appendChild(node);
  return node;
}

const fmt = (n) => numberFmt.format(n);
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtHour = (t) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const shortAddr = (a) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const countryName = (code) => {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};
const cssVar = (name) => `var(${name})`;

/** Round up to 1/2/5 × 10^n so gridlines land on readable values. */
function niceMax(v) {
  if (v <= 0) return 4;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return Math.max(4, nice * exp);
}

function yTicks(max) {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 100) / 100);
}

/** Bar path with 4px rounded data-end, square at the baseline. */
function barPath(x, y, w, h, rounded) {
  const r = rounded ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function showTooltip(evt, title, rows) {
  tooltip.replaceChildren();
  html("div", { className: "t-title", textContent: title }, tooltip);
  for (const r of rows) {
    const row = html("div", { className: "t-row" }, tooltip);
    if (r.color) html("span", { className: "t-key" }, row).style.background = r.color;
    html("span", { className: "t-val", textContent: r.value }, row);
    html("span", { className: "t-name", textContent: r.name }, row);
  }
  tooltip.hidden = false;

  let x;
  let y;
  if (evt.clientX !== undefined && evt.type.startsWith("pointer")) {
    x = evt.clientX;
    y = evt.clientY;
  } else {
    const rect = evt.target.getBoundingClientRect();
    x = rect.left + rect.width / 2;
    y = rect.top;
  }
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  tooltip.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, x + 12))}px`;
  tooltip.style.top = `${Math.max(8, y - th - 12)}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

// ── Axes ──────────────────────────────────────────────────────────────────────

function drawFrame(svg, max, xLabels) {
  const plotH = H - M.top - M.bottom;
  for (const v of yTicks(max)) {
    const y = M.top + plotH - (v / max) * plotH;
    el("line", { x1: M.left, x2: W - M.right, y1: y, y2: y, class: v === 0 ? "axis-line" : "grid-line" }, svg);
    el("text", { x: M.left - 6, y: y + 4, "text-anchor": "end", class: "tick" }, svg).textContent = fmt(v);
  }
  for (const { x, text } of xLabels) {
    el("text", { x, y: H - 6, "text-anchor": "middle", class: "tick" }, svg).textContent = text;
  }
}

/** ~5 evenly spaced x labels. */
function pickXLabels(points, xOf, label) {
  if (points.length === 0) return [];
  const step = Math.max(1, Math.ceil(points.length / 5));
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push({ x: xOf(i), text: label(points[i].t) });
  return out;
}

function emptyState(container, text) {
  container.replaceChildren(html("div", { className: "empty", textContent: text }));
}

// ── Line chart (cumulative series, crosshair hover) ───────────────────────────

function lineChart(container, points, { name, color, tooltipRows }) {
  if (points.length === 0) return emptyState(container, "No data in this range yet");

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": name });
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const xOf = (i) => M.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yOf = (v) => M.top + plotH - (v / max) * plotH;

  drawFrame(svg, max, pickXLabels(points, xOf, fmtDay));

  const d = points.map((p, i) => `${i ? "L" : "M"}${xOf(i)},${yOf(p.value)}`).join("");
  el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

  // Direct label on the last point.
  const last = points[points.length - 1];
  el("circle", { cx: xOf(points.length - 1), cy: yOf(last.value), r: 4, fill: color, stroke: cssVar("--surface-1"), "stroke-width": 2 }, svg);
  el("text", { x: xOf(points.length - 1) + 8, y: yOf(last.value) + 4, class: "direct-label" }, svg).textContent = fmt(last.value);

  // Hover layer: crosshair snaps to the nearest point.
  const cross = el("line", { y1: M.top, y2: M.top + plotH, class: "crosshair", visibility: "hidden" }, svg);
  const dot = el("circle", { r: 4, fill: color, stroke: cssVar("--surface-1"), "stroke-width": 2, visibility: "hidden" }, svg);
  const hit = el("rect", { x: M.left, y: M.top, width: plotW, height: plotH, class: "hit", tabindex: 0, "aria-label": `${name}: use arrow keys to read values` }, svg);
  let index = points.length - 1;

  const show = (evt) => {
    const p = points[index];
    cross.setAttribute("x1", xOf(index));
    cross.setAttribute("x2", xOf(index));
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", xOf(index));
    dot.setAttribute("cy", yOf(p.value));
    dot.setAttribute("visibility", "visible");
    showTooltip(evt, fmtDay(p.t), tooltipRows(p));
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    hideTooltip();
  };

  hit.addEventListener("pointermove", (evt) => {
    const box = svg.getBoundingClientRect();
    const x = ((evt.clientX - box.left) / box.width) * W;
    index = Math.max(0, Math.min(points.length - 1, Math.round(((x - M.left) / plotW) * (points.length - 1))));
    show(evt);
  });
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("focus", show);
  hit.addEventListener("blur", hide);
  hit.addEventListener("keydown", (evt) => {
    if (evt.key === "ArrowLeft") index = Math.max(0, index - 1);
    else if (evt.key === "ArrowRight") index = Math.min(points.length - 1, index + 1);
    else return;
    evt.preventDefault();
    show(evt);
  });

  container.replaceChildren(svg);
}

// ── Column chart (single or stacked, per-bar hover) ───────────────────────────

function columnChart(container, points, series, { name, label = fmtDay }) {
  if (points.length === 0) return emptyState(container, "No data in this range yet");

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": name });
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const totals = points.map((p) => series.reduce((s, k) => s + p[k.key], 0));
  const max = niceMax(Math.max(...totals));
  const slot = plotW / points.length;
  const barW = Math.max(2, Math.min(28, slot - 2)); // ≥2px surface gap between bars
  const xOf = (i) => M.left + i * slot + (slot - barW) / 2;
  const yScale = (v) => (v / max) * plotH;

  drawFrame(svg, max, pickXLabels(points, (i) => xOf(i) + barW / 2, label));

  points.forEach((p, i) => {
    const marks = [];
    let base = M.top + plotH;
    const nonZero = series.filter((s) => p[s.key] > 0);
    nonZero.forEach((s, j) => {
      const h = yScale(p[s.key]);
      const top = j === nonZero.length - 1;
      // 2px surface gap between stacked segments.
      const gap = j > 0 ? 2 : 0;
      const segH = Math.max(0, h - gap);
      marks.push(el("path", { d: barPath(xOf(i), base - h, barW, segH, top), fill: s.color, class: "mark" }, svg));
      base -= h;
    });

    const hit = el("rect", {
      x: M.left + i * slot, y: M.top, width: slot, height: plotH, class: "hit", tabindex: 0,
      "aria-label": `${label(p.t)}: ${series.map((s) => `${s.name} ${p[s.key]}`).join(", ")}`,
    }, svg);
    const show = (evt) => {
      marks.forEach((m) => m.classList.add("hover"));
      showTooltip(evt, label(p.t), series.map((s) => ({ color: s.color, name: s.name, value: fmt(p[s.key]) })));
    };
    const hide = () => {
      marks.forEach((m) => m.classList.remove("hover"));
      hideTooltip();
    };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", hide);
  });

  container.replaceChildren(svg);
}

// ── Horizontal bars (ranked lists) ────────────────────────────────────────────

function hbarChart(container, rows, { name, color, valueName }) {
  if (rows.length === 0) return emptyState(container, "No data yet");

  const rowH = 28;
  const labelW = 150;
  const valueW = 56;
  const h = rows.length * rowH;
  const svg = el("svg", { viewBox: `0 0 ${W} ${h}`, role: "img", "aria-label": name });
  const max = Math.max(...rows.map((r) => r.value));
  const plotW = W - labelW - valueW;

  rows.forEach((r, i) => {
    const y = i * rowH;
    const w = Math.max(2, (r.value / max) * plotW);
    el("text", { x: labelW - 10, y: y + rowH / 2 + 4, "text-anchor": "end", class: "bar-label" }, svg).textContent = r.label;
    // Horizontal bar: data-end on the right is rounded, baseline on the left square.
    const bar = el("path", {
      d: `M${labelW},${y + 5}H${labelW + w - 4}Q${labelW + w},${y + 5} ${labelW + w},${y + 9}V${y + rowH - 9}Q${labelW + w},${y + rowH - 5} ${labelW + w - 4},${y + rowH - 5}H${labelW}Z`,
      fill: color, class: "mark",
    }, svg);
    el("text", { x: labelW + w + 6, y: y + rowH / 2 + 4, class: "bar-value" }, svg).textContent = fmt(r.value);

    const hit = el("rect", { x: 0, y, width: W, height: rowH, class: "hit", tabindex: 0, "aria-label": `${r.title}: ${r.value} ${valueName}` }, svg);
    const show = (evt) => {
      bar.classList.add("hover");
      showTooltip(evt, r.title, [{ color, name: valueName, value: fmt(r.value) }, ...(r.extra ?? [])]);
    };
    const hide = () => {
      bar.classList.remove("hover");
      hideTooltip();
    };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", hide);
  });

  container.replaceChildren(svg);
}

// ── Legend & tables ───────────────────────────────────────────────────────────

function legend(container, series) {
  container.replaceChildren();
  for (const s of series) {
    const item = html("span", {}, container);
    html("i", {}, item).style.background = s.color;
    item.appendChild(document.createTextNode(s.name));
  }
}

function table(container, headers, rows) {
  const t = html("table");
  const tr = html("tr", {}, html("thead", {}, t));
  headers.forEach((h) => html("th", { textContent: h.label, className: h.num ? "num" : "" }, tr));
  const body = html("tbody", {}, t);
  for (const row of rows) {
    const r = html("tr", {}, body);
    headers.forEach((h) => html("td", { textContent: row[h.key], className: h.num ? "num" : "" }, r));
  }
  container.replaceChildren(t);
}

// ── Render ────────────────────────────────────────────────────────────────────

function card(name) {
  const c = document.querySelector(`[data-chart="${name}"]`);
  return {
    chart: c.querySelector(".chart"),
    legend: c.querySelector(".legend"),
    table: c.querySelector(".table-wrap"),
  };
}

function inRange(points) {
  if (!state.days) return points;
  const since = Date.now() - state.days * DAY;
  return points.filter((p) => p.t >= since);
}

function renderTiles(s) {
  const tiles = [
    { label: "DIDs", value: s.totals.dids, sub: `${fmt(s.totals.activeDids)} active · +${fmt(s.rates.didsLast24h)} in 24h` },
    { label: "Credentials issued", value: s.totals.credentialsIssued, sub: `${fmt(s.totals.credentialsRevoked)} revoked` },
    { label: "Issuance rate", value: s.rates.issuedPerHourLast24h, sub: `per hour · ${fmt(s.rates.issuedLast24h)} in 24h` },
    { label: "Verifications (24h)", value: s.rates.verificationsLast24h, sub: `${fmt(s.totals.verifications)} all time` },
    { label: "Active issuers", value: s.totals.activeIssuers, sub: `${fmt(s.topIssuers.length)} have issued` },
  ];
  const root = document.getElementById("tiles");
  root.replaceChildren();
  for (const t of tiles) {
    const tile = html("div", { className: "tile" }, root);
    html("div", { className: "label", textContent: t.label }, tile);
    html("div", { className: "value", textContent: fmt(t.value) }, tile);
    html("div", { className: "sub", textContent: t.sub }, tile);
  }
}

function render() {
  const s = state.summary;
  if (!s) return;
  const blue = cssVar("--series-1");
  const orange = cssVar("--series-2");

  renderTiles(s);

  // DIDs over time — cumulative line; the running total starts from all-time
  // history, so a narrower range still shows the true total.
  const dids = inRange(s.didsDaily).map((d) => ({ t: d.t, value: d.total, created: d.created }));
  const didsCard = card("dids");
  lineChart(didsCard.chart, dids, {
    name: "Total DIDs",
    color: blue,
    tooltipRows: (p) => [
      { color: blue, name: "total DIDs", value: fmt(p.value) },
      { name: "created that day", value: `+${fmt(p.created)}` },
    ],
  });
  table(didsCard.table, [{ key: "date", label: "Date" }, { key: "created", label: "Created", num: true }, { key: "total", label: "Total", num: true }],
    dids.map((d) => ({ date: fmtDay(d.t), created: fmt(d.created), total: fmt(d.value) })));

  // Issuance per day — issued vs revoked, stacked.
  const issuanceSeries = [
    { key: "issued", name: "Issued", color: blue },
    { key: "revoked", name: "Revoked", color: orange },
  ];
  const issuance = inRange(s.issuanceDaily);
  const issuanceCard = card("issuance");
  legend(issuanceCard.legend, issuanceSeries);
  columnChart(issuanceCard.chart, issuance, issuanceSeries, { name: "Credentials issued and revoked per day" });
  table(issuanceCard.table, [{ key: "date", label: "Date" }, { key: "issued", label: "Issued", num: true }, { key: "revoked", label: "Revoked", num: true }],
    issuance.map((d) => ({ date: fmtDay(d.t), issued: fmt(d.issued), revoked: fmt(d.revoked) })));

  // Hourly issuance rate (fixed 48h window).
  const hourly = s.issuanceHourly.map((p) => ({ t: p.t, value: p.value }));
  const hourlyCard = card("hourly");
  columnChart(hourlyCard.chart, hourly, [{ key: "value", name: "credentials", color: blue }], { name: "Credentials issued per hour", label: fmtHour });
  table(hourlyCard.table, [{ key: "hour", label: "Hour" }, { key: "value", label: "Issued", num: true }],
    hourly.map((p) => ({ hour: fmtHour(p.t), value: fmt(p.value) })));

  // Verification frequency — on-chain vs app-reported, stacked.
  const verifySeries = [
    { key: "onchain", name: "On-chain transactions", color: blue },
    { key: "reported", name: "Reported by apps", color: orange },
  ];
  const verifications = inRange(s.verificationsDaily);
  const verifyCard = card("verifications");
  legend(verifyCard.legend, verifySeries);
  columnChart(verifyCard.chart, verifications, verifySeries, { name: "Credential verifications per day" });
  table(verifyCard.table, [{ key: "date", label: "Date" }, { key: "onchain", label: "On-chain", num: true }, { key: "reported", label: "Reported", num: true }],
    verifications.map((d) => ({ date: fmtDay(d.t), onchain: fmt(d.onchain), reported: fmt(d.reported) })));
  const o = s.verificationOutcomes;
  const reasons = Object.entries(o.reasons).map(([k, v]) => `${k.replace(/_/g, " ")} ${fmt(v)}`).join(", ");
  document.getElementById("verify-outcomes").textContent =
    `Reported outcomes: ${fmt(o.valid)} valid, ${fmt(o.invalid)} invalid${reasons ? ` (${reasons})` : ""}. ` +
    `On-chain calls carry no outcome; simulated checks appear only if an app reports them.`;

  // Top issuers.
  const issuersCard = card("issuers");
  hbarChart(issuersCard.chart, s.topIssuers.map((i) => ({
    label: shortAddr(i.issuer),
    title: i.issuer,
    value: i.issued,
    extra: [
      { name: "revoked", value: fmt(i.revoked) },
      { name: "unique subjects", value: fmt(i.uniqueSubjects) },
      { name: "last issued", value: fmtDay(i.lastIssuedAt) },
    ],
  })), { name: "Top issuers by credentials issued", color: blue, valueName: "credentials" });
  table(issuersCard.table, [{ key: "issuer", label: "Issuer" }, { key: "issued", label: "Issued", num: true }, { key: "revoked", label: "Revoked", num: true }, { key: "subjects", label: "Subjects", num: true }, { key: "last", label: "Last issued" }],
    s.topIssuers.map((i) => ({ issuer: i.issuer, issued: fmt(i.issued), revoked: fmt(i.revoked), subjects: fmt(i.uniqueSubjects), last: fmtDay(i.lastIssuedAt) })));

  // Issuance by credential type.
  const typesCard = card("types");
  hbarChart(typesCard.chart, s.issuedByType.map((t) => ({ label: t.type, title: `${t.type} credentials`, value: t.issued })),
    { name: "Credentials issued by type", color: blue, valueName: "credentials" });
  table(typesCard.table, [{ key: "type", label: "Type" }, { key: "issued", label: "Issued", num: true }],
    s.issuedByType.map((t) => ({ type: t.type, issued: fmt(t.issued) })));

  // Geography.
  const geoCard = card("geo");
  const countries = s.geography.countries.slice(0, 15);
  const total = s.geography.withCountry || 1;
  hbarChart(geoCard.chart, countries.map((c) => ({
    label: countryName(c.country),
    title: `${countryName(c.country)} (${c.country})`,
    value: c.dids,
    extra: [{ name: "of located DIDs", value: `${Math.round((c.dids / total) * 100)}%` }],
  })), { name: "DIDs by country", color: blue, valueName: "DIDs" });
  table(geoCard.table, [{ key: "country", label: "Country" }, { key: "code", label: "Code" }, { key: "dids", label: "DIDs", num: true }],
    s.geography.countries.map((c) => ({ country: countryName(c.country), code: c.country, dids: fmt(c.dids) })));
  const hidden = s.geography.countries.length - countries.length;
  document.getElementById("geo-note").textContent =
    `${fmt(s.geography.withCountry)} DIDs declare a country, ${fmt(s.geography.withoutCountry)} do not` +
    (hidden > 0 ? `; ${hidden} more countries in the table.` : ".");

  document.getElementById("footer").textContent =
    `Updated ${new Date(s.generatedAt).toLocaleTimeString()}` +
    (s.latestLedger ? ` · indexed to ledger ${fmt(s.latestLedger)}` : "");
}

// ── Controls ──────────────────────────────────────────────────────────────────

document.getElementById("range").addEventListener("click", (evt) => {
  const btn = evt.target.closest("button[data-days]");
  if (!btn) return;
  state.days = Number(btn.dataset.days);
  for (const b of evt.currentTarget.querySelectorAll("button")) b.setAttribute("aria-checked", String(b === btn));
  render();
});

const reportSelect = document.getElementById("report");
reportSelect.addEventListener("change", () => {
  for (const format of ["csv", "json"]) {
    document.getElementById(`export-${format}`).href = `/api/export?report=${reportSelect.value}&format=${format}`;
  }
});

// ── Live updates (Server-Sent Events) ─────────────────────────────────────────

function setLive(stateName, label) {
  const live = document.getElementById("live");
  live.dataset.state = stateName;
  document.getElementById("live-label").textContent = label;
  // Keep the last render visible, dimmed, while disconnected.
  for (const c of document.querySelectorAll(".chart")) c.classList.toggle("stale", stateName === "error");
}

function connect() {
  const source = new EventSource("/api/stream");
  source.addEventListener("open", () => setLive("live", "Live"));
  source.addEventListener("summary", (evt) => {
    state.summary = JSON.parse(evt.data);
    setLive("live", "Live");
    render();
  });
  // EventSource reconnects on its own (retry: 5000 from the server).
  source.addEventListener("error", () => setLive("error", "Reconnecting…"));
}

connect();
