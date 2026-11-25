// Recovery pulse: draws the neighborhood totals from /market-data/*.json.
// Nothing here is about a single home: the files only hold totals and ~330 m squares.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtInt = (n) => Number(n).toLocaleString("en-US");
  const fmtM = (v) => "$" + (v / 1e6).toFixed(2) + "M";
  function el(tag, attrs, text) {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function niceDate(iso) {
    const d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  async function get(name) {
    const res = await fetch(`/market-data/${name}.json`);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.json();
  }

  function kpis(damage, permits, hmda) {
    $("k-destroyed").textContent = Math.round(damage.residential.share_destroyed * 100) + "%";
    $("k-destroyed-d").textContent = `of homes inspected were destroyed (${fmtInt(damage.residential.by_damage["Destroyed (>50%)"])} of ${fmtInt(damage.residential.total)})`;
    $("k-permits").textContent = fmtInt(permits.since_fire.new_home_permits);
    $("k-permits-d").textContent = `new-home permits since the fire, compared with about ${Math.round(permits.pre_fire_monthly_average_2020_2024)} a month before it`;
    $("k-done").textContent = fmtInt(permits.since_fire.completions);
    const y = hmda.years, last = y[y.length - 1], prev = y[y.length - 2];
    $("k-sales").textContent = fmtInt(last.purchase_mortgages);
    $("k-sales-d").textContent = `home purchases with a mortgage in ${last.year}, down from ${fmtInt(prev.purchase_mortgages)} in ${prev.year}`;
    $("asof").textContent = `Data pulled ${niceDate(permits.built_on)}.`;
  }

  function permitsChart(p) {
    const svg = $("permits-chart");
    const builtMonth = p.built_on.slice(0, 7);
    const months = p.months.filter((m) => m.month >= "2024-01" && m.month < builtMonth);
    const max = Math.max(20, ...months.map((m) => m.new_home_permits));
    const top = Math.ceil(max / 20) * 20;
    const y = (v) => 226 - (v / top) * 200;
    const step = 1120 / months.length, bw = Math.max(3, (step - 6) / 2);
    const g = el("g", { "font-size": 11, fill: "#4F5964" });
    for (let v = 0; v <= top; v += top / 4) {
      g.append(el("line", { x1: 48, x2: 1172, y1: y(v), y2: y(v), stroke: "#E6E0D4" }));
      g.append(el("text", { x: 40, y: y(v) + 4, "text-anchor": "end", class: "num" }, String(v)));
    }
    svg.append(g);
    months.forEach((m, i) => {
      const x0 = 52 + i * step;
      const mm = Number(m.month.slice(5));
      svg.append(el("rect", { x: x0, y: y(m.new_home_permits), width: bw, height: 226 - y(m.new_home_permits), fill: "#1B4F72", rx: 1.5 }));
      svg.append(el("rect", { x: x0 + bw + 1, y: y(m.completions), width: bw, height: 226 - y(m.completions), fill: "#D9822B", rx: 1.5 }));
      if (mm === 1 || mm === 7 || i === 0) svg.append(el("text", { x: x0 + bw, y: 246, "text-anchor": "middle", "font-size": 10, fill: "#4F5964" }, `${MON[mm - 1]} ${m.month.slice(2, 4)}`));
    });
    const fireIdx = months.findIndex((m) => m.month === "2025-01");
    if (fireIdx >= 0) {
      const fx = 52 + fireIdx * step - 3;
      svg.append(el("line", { x1: fx, x2: fx, y1: 16, y2: 226, stroke: "#121A22", "stroke-dasharray": "3 4" }));
      svg.append(el("text", { x: fx + 6, y: 24, "font-size": 12, "font-weight": 600, fill: "#121A22" }, "Fire, Jan 7, 2025"));
    }
    const peak = months.reduce((a, b) => (b.new_home_permits > a.new_home_permits ? b : a));
    const lastFull = months[months.length - 1];
    svg.setAttribute("aria-label", `Monthly new single-family home permits in Pacific Palisades from January 2024 to ${MON[Number(lastFull.month.slice(5)) - 1]} ${lastFull.month.slice(0, 4)}. About ${Math.round(p.pre_fire_monthly_average_2020_2024)} a month before the fire, peaking at ${peak.new_home_permits} in ${MON[Number(peak.month.slice(5)) - 1]} ${peak.month.slice(0, 4)}. Completions reached ${Math.max(...months.map((m) => m.completions))} in a month.`);
    $("permits-note").textContent = `New single-family home permits only. The current month is left out because it isn't over yet. ${p.definition}`;
  }

  // ---------- Finish forecast ----------
  function monthName(key) { return `${MON[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`; }
  function forecast(t) {
    const svg = $("forecast-chart");
    const rows = t.months;
    const total = t.since_fire.permits;
    const top = Math.ceil(total / 250) * 250;
    const x0 = 56, x1 = 1000, n = rows.length;
    const x = (i) => x0 + (i / (n - 1)) * (x1 - x0);
    const y = (v) => 246 - (v / top) * 222;
    const g = el("g", { "font-size": 11, fill: "#4F5964" });
    for (let v = 0; v <= top; v += top / 5) {
      g.append(el("line", { x1: x0, x2: x1, y1: y(v), y2: y(v), stroke: "#E6E0D4" }));
      g.append(el("text", { x: x0 - 8, y: y(v) + 4, "text-anchor": "end", class: "num" }, fmtInt(v)));
    }
    rows.forEach((r, i) => { if (r.month.endsWith("-01")) g.append(el("text", { x: x(i), y: 266, "text-anchor": "middle" }, r.month.slice(0, 4))); });
    svg.append(g);
    // Permits issued so far: the ceiling if every permitted home gets built.
    svg.append(el("line", { x1: x0, x2: x1, y1: y(total), y2: y(total), stroke: "#121A22", "stroke-dasharray": "3 4" }));
    svg.append(el("text", { x: x0 + 6, y: y(total) - 7, "font-size": 12, "font-weight": 600, fill: "#121A22" }, `${fmtInt(total)} rebuild permits issued so far`));
    const proj = rows.map((r, i) => [i, r]).filter(([, r]) => r.faster != null);
    const pts = (key) => proj.map(([i, r]) => `${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`);
    svg.append(el("polygon", { points: pts("faster").concat(pts("slower").reverse()).join(" "), fill: "#1B4F72", "fill-opacity": 0.1 }));
    svg.append(el("polyline", { points: pts("slower").join(" "), fill: "none", stroke: "#8A939C", "stroke-width": 2, "stroke-dasharray": "6 4" }));
    svg.append(el("polyline", { points: pts("faster").join(" "), fill: "none", stroke: "#1B4F72", "stroke-width": 2.5, "stroke-dasharray": "6 4" }));
    const done = rows.map((r, i) => [i, r]).filter(([, r]) => r.finished != null);
    svg.append(el("polyline", { points: done.map(([i, r]) => `${x(i).toFixed(1)},${y(r.finished).toFixed(1)}`).join(" "), fill: "none", stroke: "#D9822B", "stroke-width": 3 }));
    const [ni, nowRow] = done[done.length - 1];
    svg.append(el("circle", { cx: x(ni), cy: y(nowRow.finished), r: 4.5, fill: "#D9822B" }));
    svg.append(el("line", { x1: x(ni), x2: x(ni), y1: 48, y2: 246, stroke: "#B8B0A2", "stroke-dasharray": "2 4" }));
    svg.append(el("text", { x: x(ni) - 8, y: 64, "text-anchor": "end", "font-size": 12, fill: "#4F5964" }, "Today"));
    svg.append(el("text", { x: x(ni) + 8, y: 64, "font-size": 12, fill: "#4F5964" }, "Projected"));
    const last = rows[n - 1];
    const endLabel = (v, text, color, dy) => {
      svg.append(el("text", { x: x1 + 10, y: y(v) + 4 + dy, "font-size": 12, "font-weight": 600, fill: color, class: "num" }, `${fmtInt(v)} ${text}`));
    };
    const gap = y(last.slower) - y(last.faster) < 30 ? 9 : 0;
    endLabel(last.faster, "faster", "#1B4F72", -gap);
    endLabel(last.slower, "slower", "#4F5964", gap);
    // Plain-language summary: when half of the permitted homes would be done.
    const half = Math.ceil(total / 2);
    const firstAt = (key) => { const r = rows.find((q) => q[key] != null && q[key] >= half); return r ? monthName(r.month) : null; };
    const fHalf = firstAt("faster"), sHalf = firstAt("slower");
    const lede = $("forecast-lede");
    lede.replaceChildren();
    const b1 = document.createElement("strong"); b1.textContent = fHalf || `after ${last.month.slice(0, 4)}`;
    const b2 = document.createElement("strong"); b2.textContent = sHalf || `after ${last.month.slice(0, 4)}`;
    lede.append(`${fmtInt(t.since_fire.finished)} of ${fmtInt(total)} permitted rebuilds are finished. At the pace so far, half would be done by `, b1, `. At the pace Palisades homes were built before the fire: `, b2, ".");
    svg.setAttribute("aria-label", `Rebuilt homes finished in Pacific Palisades, so far and projected to ${monthName(last.month)}. ${fmtInt(nowRow.finished)} finished as of ${monthName(nowRow.month)}. Projected ${fmtInt(last.faster)} at the pace of rebuilds so far, or ${fmtInt(last.slower)} at the pre-fire pace, out of ${fmtInt(total)} permits.`);
    const ul = $("forecast-method");
    t.method.forEach((m) => { const li = document.createElement("li"); li.textContent = m; ul.append(li); });
    const sz = t.faster.by_size;
    const mo = (d) => Math.round(d / 30.44);
    $("forecast-observed").textContent = `Typical time from permit to finished at the pace so far: about ${mo(t.faster.all.median_days)} months (${sz.small.label.toLowerCase()}: ${mo(sz.small.median_days)}; ${sz.medium.label}: ${mo(sz.medium.median_days)}; ${sz.large.label.toLowerCase()}: ${mo(sz.large.median_days)}). Before the fire: about ${mo(t.slower.median_days)} months.`;
    $("forecast-caveats").textContent = t.caveats.join(" ");
  }

  // ---------- Block grid ----------
  const RAMPS = {
    destroyed: { colors: ["#EDE7DC", "#F2CFA3", "#E3A066", "#C56A35", "#8E3B1C"], cuts: [0.2, 0.4, 0.6, 0.8], labels: ["Under 20%", "20–40%", "40–60%", "60–80%", "80% or more"] },
    permits:   { colors: ["#E7EEF3", "#BFD3E2", "#86AECB", "#3F7AA3", "#1B4F72"], cuts: [1, 10, 25, 50], labels: ["None", "1–9", "10–24", "25–49", "50 or more"] },
    ratio:     { colors: ["#EDEBE4", "#D5E4D8", "#A8C9B0", "#6E9F7C", "#3E6A4C"], cuts: [0.1, 0.25, 0.5, 0.75], labels: ["Under 10%", "10–25%", "25–50%", "50–75%", "75% or more"] },
  };
  const NOTES = {
    destroyed: "Share of inspected homes destroyed in each square (about 330 m across). Squares with fewer than 10 homes are hidden.",
    permits: "New-home permits issued since the fire in each square. Squares with fewer than 10 homes are hidden.",
    ratio: "New-home permits as a share of homes destroyed in each square: a rough sign of how many neighbors are rebuilding. Squares with no homes destroyed are gray.",
  };
  let gridData = null;
  function band(v, cuts) { let i = 0; while (i < cuts.length && v >= cuts[i]) i++; return i; }
  function drawGrid(mode) {
    const svg = $("grid-map");
    svg.replaceChildren();
    const cells = gridData.cells;
    const s = Math.min(...cells.map((c) => c.south)), n = Math.max(...cells.map((c) => c.north));
    const w = Math.min(...cells.map((c) => c.west)), e = Math.max(...cells.map((c) => c.east));
    const dLat = gridData.cell_size_degrees.lat, dLon = gridData.cell_size_degrees.lon;
    const cols = Math.round((e - w) / dLon), rows = Math.round((n - s) / dLat);
    const size = Math.min(640 / cols, 520 / rows), pad = 10;
    svg.setAttribute("viewBox", `0 0 ${cols * size + pad * 2} ${rows * size + pad * 2}`);
    const ramp = RAMPS[mode];
    let hi = 0;
    cells.forEach((c) => {
      const col = Math.round((c.west - w) / dLon), row = Math.round((n - c.north) / dLat);
      const destroyed = Math.round(c.share_destroyed * c.homes_inspected);
      let v, fill, label;
      if (mode === "destroyed") { v = c.share_destroyed; label = `${Math.round(v * 100)}% of ${c.homes_inspected} homes destroyed`; }
      else if (mode === "permits") { v = c.new_home_permits_since_fire; label = `${v} new-home permits since the fire`; }
      else { v = destroyed ? c.new_home_permits_since_fire / destroyed : null; label = destroyed ? `${c.new_home_permits_since_fire} permits for ${destroyed} homes destroyed` : "No homes destroyed here"; }
      fill = v === null ? "#E4E1DA" : ramp.colors[band(v, ramp.cuts)];
      if (mode === "destroyed" && v >= 0.8) hi++;
      const r = el("rect", { x: pad + col * size + 0.75, y: pad + row * size + 0.75, width: size - 1.5, height: size - 1.5, rx: 2, fill });
      r.append(el("title", {}, label));
      svg.append(r);
    });
    $("grid-note").textContent = NOTES[mode];
    const legend = $("grid-legend");
    legend.replaceChildren();
    ramp.labels.forEach((l, i) => {
      const span = document.createElement("span");
      const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = ramp.colors[i];
      span.append(sw, l);
      legend.append(span);
    });
    const total = cells.length;
    svg.setAttribute("aria-label", mode === "destroyed"
      ? `Grid map of Pacific Palisades in ${total} squares. ${hi} squares lost 80% or more of their homes, mostly in the southern and central part of the neighborhood.`
      : `Grid map of Pacific Palisades in ${total} squares, colored by ${mode === "permits" ? "new-home permits since the fire" : "permits as a share of homes destroyed"}.`);
  }

  function salesTable(h) {
    const t = $("sales-table");
    const head = document.createElement("tr");
    ["Year", "Sales", "Median value", "Middle half"].forEach((x) => { const th = document.createElement("th"); th.textContent = x; head.append(th); });
    t.append(head);
    h.years.forEach((y) => {
      const tr = document.createElement("tr");
      [String(y.year), fmtInt(y.purchase_mortgages), fmtM(y.median_value), `${fmtM(y.p25_value)}–${fmtM(y.p75_value)}`].forEach((x) => { const td = document.createElement("td"); td.textContent = x; tr.append(td); });
      t.append(tr);
    });
    $("sales-note").textContent = h.caveats.join(" ");
  }

  function insTable(ins) {
    const t = $("ins-table");
    const head = document.createElement("tr");
    ["Year", "Renewed", "Not renewed", "New"].forEach((x) => { const th = document.createElement("th"); th.textContent = x; head.append(th); });
    t.append(head);
    ins.years.filter((y) => y.year >= 2017).forEach((y) => {
      const tr = document.createElement("tr");
      [String(y.year), fmtInt(y.renewed), fmtInt(y.non_renewed), fmtInt(y.new)].forEach((x) => { const td = document.createElement("td"); td.textContent = x; tr.append(td); });
      t.append(tr);
    });
  }

  function laChart(hpi) {
    const q = hpi.quarters.filter((x) => x.year >= 2019);
    const base = q.filter((x) => x.year === 2019).reduce((a, b) => a + b.index_sa, 0) / 4;
    const vals = q.map((x) => (x.index_sa / base) * 100);
    const lo = Math.floor(Math.min(...vals) / 10) * 10, hi = Math.ceil(Math.max(...vals) / 10) * 10;
    const x = (i) => 56 + (i / (q.length - 1)) * 1100, y = (v) => 190 - ((v - lo) / (hi - lo)) * 170;
    const svg = $("la-chart");
    const g = el("g", { "font-size": 11, fill: "#4F5964" });
    for (let v = lo; v <= hi; v += 10) {
      g.append(el("line", { x1: 56, x2: 1156, y1: y(v), y2: y(v), stroke: "#E6E0D4" }));
      g.append(el("text", { x: 48, y: y(v) + 4, "text-anchor": "end", class: "num" }, String(v)));
    }
    q.forEach((p, i) => { if (p.quarter === 1) g.append(el("text", { x: x(i), y: 210, "text-anchor": "middle" }, String(p.year))); });
    svg.append(g);
    svg.append(el("polyline", { points: vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "), fill: "none", stroke: "#1B4F72", "stroke-width": 2.5 }));
    const last = q[q.length - 1];
    svg.setAttribute("aria-label", `Los Angeles area home price index since 2019, set to 100 in 2019. It reached ${Math.round(vals[vals.length - 1])} in quarter ${last.quarter} of ${last.year}.`);
  }

  Promise.all(["damage", "permits", "grid", "hmda", "insurance", "la-metro-hpi", "rebuild-timing"].map(get))
    .then(([damage, permits, grid, hmda, insurance, hpi, timing]) => {
      kpis(damage, permits, hmda);
      permitsChart(permits);
      forecast(timing);
      gridData = grid;
      drawGrid("destroyed");
      document.querySelectorAll('input[name="grid-mode"]').forEach((r) => r.addEventListener("change", () => {
        drawGrid(r.value);
        try { if (window.posthog) window.posthog.capture("pulse_grid_mode", { mode: r.value }); } catch (e) { /* ignore */ }
      }));
      salesTable(hmda);
      insTable(insurance);
      laChart(hpi);
    })
    .catch((err) => {
      const p = document.createElement("p");
      p.className = "status-msg error";
      p.textContent = "Couldn't load the neighborhood data. Try reloading the page.";
      document.querySelector("main").prepend(p);
      console.error(err);
    });
})();
