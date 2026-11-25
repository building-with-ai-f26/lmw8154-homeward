// Homeward "Decide" page. Everything runs in the browser; the only network calls are
// the optional AI summary (rounded numbers only) and the public neighborhood data file.
(function () {
  "use strict";
  const C = window.HomewardCalc;
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";
  const thisYear = new Date().getFullYear();
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const form = $("inputs");

  // ---------- State ----------
  const EXAMPLE_PEOPLE = [
    { name: "Person 1", weights: { money: 4, stay: 2, hassle: 3, sooner: 2 } },
    { name: "Person 2", weights: { money: 3, stay: 5, hassle: 2, sooner: 1 } },
  ];
  let state = Object.assign({}, C.DEFAULTS, { homeValueStanding: 3.0 });
  let people = EXAMPLE_PEOPLE.map((p) => ({ name: p.name, weights: Object.assign({}, p.weights) }));
  let edited = false;

  function track(event, props) {
    // Analytics never get numbers or names: only which options were picked.
    try { if (window.posthog) window.posthog.capture(event, props || {}); } catch (e) { /* ignore */ }
  }

  // ---------- Saved state: a shared link first, then this browser's last visit ----------
  function encode(obj) {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decode(str) {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  }
  function loadPeople(list) {
    if (!Array.isArray(list)) return null;
    return list.slice(0, 8).map((p, i) => ({
      name: String(p && p.name || `Person ${i + 1}`).slice(0, 40),
      weights: ["money", "stay", "hassle", "sooner"].reduce((w, k) => {
        const n = Number(p && p.weights && p.weights[k]);
        w[k] = Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 3;
        return w;
      }, {}),
    }));
  }
  function restore() {
    let saved = null;
    if (window.__homewardShared) {
      try { saved = decode(window.__homewardShared); } catch (e) { saved = null; }
    }
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem("homeward:decide") || "null"); } catch (e) { saved = null; }
    }
    if (saved && typeof saved === "object") {
      const n = C.normalize(Object.assign({}, saved.i || {}, { homeValue: saved.i && saved.i.homeValue }));
      state = Object.assign(state, n);
      const hs = Number(saved.i && saved.i.homeValueStanding);
      if (Number.isFinite(hs) && hs > 0) state.homeValueStanding = Math.min(100, hs);
      people = loadPeople(saved.p) || people;
      edited = !!saved.e;
    }
  }
  function remember() {
    try { localStorage.setItem("homeward:decide", JSON.stringify(snapshot())); } catch (e) { /* private mode */ }
  }
  function snapshot() {
    const keep = Object.keys(C.DEFAULTS).concat(["homeValueStanding"]);
    const i = {};
    keep.forEach((k) => { i[k] = state[k]; });
    return { i, p: people, e: edited };
  }

  // ---------- Formatting and parsing the input boxes ----------
  const fmtDollars = (m) => "$" + Math.round(m * 1e6).toLocaleString("en-US");
  function display(kind, v) {
    if (kind === "dollars" || kind === "monthly") return fmtDollars(v);
    if (kind === "percent") return v + "%";
    return String(v);
  }
  const parse = C.parseAmount;
  // "Use my own numbers": which boxes still need filling in.
  let blanks = new Set();
  function visibleMoneyInputs() {
    return [...form.querySelectorAll("input[data-kind='dollars'], input[data-kind='monthly']")]
      .filter((inp) => !inp.closest("[data-for]").hidden);
  }
  function fieldKey(input) { return input.name === "homeValueStanding" ? "homeValueStanding" : input.name; }

  function fillForm() {
    form.querySelectorAll("input[data-kind]").forEach((inp) => {
      const key = fieldKey(inp);
      if (blanks.has(key)) { if (document.activeElement !== inp) inp.value = ""; inp.placeholder = "e.g. 2.4M"; }
      else if (document.activeElement !== inp) inp.value = display(inp.dataset.kind, state[key]);
      inp.closest(".money-field").classList.toggle("needs", blanks.has(key));
    });
    form.querySelectorAll('input[type="range"]').forEach((inp) => {
      inp.value = state[inp.name];
      $("o-" + inp.name).textContent = (inp.name === "premiumGrowthPct" ? "+" + state[inp.name] + "% a year" : (inp.name === "overrunPct" ? "+" : "") + state[inp.name] + "%");
    });
    form.querySelector(`input[name="situation"][value="${state.situation}"]`).checked = true;
    form.querySelector(`input[name="speed"][value="${state.speed}"]`).checked = true;
    form.querySelectorAll("[data-for]").forEach((el) => { el.hidden = !el.dataset.for.split(" ").includes(state.situation); });
    $("example-tag").textContent = edited ? "Your numbers · saved on this device" : "Example numbers · tap any box to edit";
    updateWaiting();
  }

  // ---------- Animated numbers ----------
  const shown = new Map();
  function setNumber(el, value, fmt) {
    const from = shown.has(el) ? shown.get(el) : value;
    shown.set(el, value);
    if (reduceMotion || from === value) { el.textContent = fmt(value); return; }
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / 450), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (value - from) * e);
      if (p < 1 && shown.get(el) === value) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function el(tag, attrs, text) {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------- Render ----------
  function inputsForCalc() {
    const i = Object.assign({}, state);
    if (state.situation === "standing") i.homeValue = state.homeValueStanding;
    return i;
  }

  function render() {
    const result = C.run(inputsForCalc());
    const s = result.inputs, c = result.chosen, sc = result.scenarios;
    const yearN = thisYear + s.sellInYears;
    const speed = C.SPEEDS[s.speed];
    $("speed-note").textContent = speed.note;

    // Verdict
    const sentences = {
      lot: `Rebuilding and selling in ${yearN} beats selling the lot now only if the rebuilt home sells for more than`,
      rebuilding: `Holding until ${yearN} beats selling when the rebuild is finished only if the home sells for more than`,
      standing: `Holding until ${yearN} beats selling now only if the home sells for more than`,
    };
    $("verdict-sentence").textContent = sentences[s.situation];
    setNumber($("breakeven"), c.breakEven, C.money);
    $("mb-value").textContent = C.money(c.breakEven);
    const g = c.breakEvenGrowthPct;
    const gText = g >= 0
      ? `Values would need to grow about ${g.toFixed(1)}% a year.`
      : `Values could fall up to ${Math.abs(g).toFixed(1)}% a year and holding would still come out ahead.`;
    $("verdict-sub").textContent = `${gText} Your ${speed.label.toLowerCase()} scenario projects ${C.money(c.priceN)} in ${yearN}.`;
    drawGauge(c, s, speed, yearN);
    $("explain-text").textContent = explanation(result, yearN);

    // Paths
    const better = c.sellLater >= c.sellNowAtN ? 1 : 0;
    const titles = result.paths;
    const notes = [
      s.situation === "rebuilding"
        ? `Net in ${thisYear + c.sellNowYear}, after costs. Worth ${C.money(c.sellNowAtN)} by ${yearN} at ${s.returnPct}% a year.`
        : `Net after selling costs, today. Worth ${C.money(c.sellNowAtN)} by ${yearN} at ${s.returnPct}% a year.`,
      `Net in ${yearN}, after ${s.situation === "standing" ? "monthly costs" : "rebuild and monthly costs"}. Slow to fast: ${C.money(sc.slow.sellLater)} to ${C.money(sc.fast.sellLater)}.`,
      `Home value in ${thisYear + 10}. Range ${C.money(sc.slow.stay.homeValue)} to ${C.money(sc.fast.stay.homeValue)}. You'd put in about ${C.money(c.stay.putIn)} on the way.`,
    ];
    const values = [c.sellNow, c.sellLater, c.stay.homeValue];
    [0, 1, 2].forEach((i) => {
      $(`p${i}-t`).textContent = titles[i];
      setNumber($(`p${i}-v`), values[i], C.money);
      $(`p${i}-n`).textContent = notes[i];
      $(`p${i}-t`).parentElement.classList.toggle("lead", i === better);
    });

    drawChart(result, yearN);
    renderLotCheck(result.lotCheck);
    renderFamily(s, c, titles);
  }

  // Plain-language reading of the break-even, built from the family's own numbers.
  function explanation(result, yearN) {
    const s = result.inputs, c = result.chosen;
    const carry = C.carrying(s, s.sellInYears);
    const costs = `${s.sellingCostPct}% selling costs, ${s.sellInYears} years of monthly costs (about ${C.money(carry)})`;
    const oop = c.outOfPocket > 0 ? `, the ${C.money(c.outOfPocket)} of rebuilding that insurance doesn't cover` : "";
    const earn = `what that money could have earned at ${s.returnPct}% a year (it would grow to about ${C.money(c.sellNowAtN)} by ${yearN})`;
    let first;
    if (s.situation === "lot") first = `If you rebuild and sell in ${yearN}, the home has to sell for at least ${C.money(c.breakEven)} for you to end up with more than selling the lot today for about ${C.money(c.sellNow)} after costs. That price covers ${costs}${oop}, and ${earn}.`;
    else if (s.situation === "rebuilding") first = `If you hold until ${yearN} instead of selling when the rebuild is done in ${thisYear + c.sellNowYear}, the home has to sell for at least ${C.money(c.breakEven)} to come out ahead. That price covers ${costs}${oop}, and ${earn}.`;
    else first = `If you hold until ${yearN}, the home has to sell for at least ${C.money(c.breakEven)} to beat selling now for about ${C.money(c.sellNow)} after costs. That price covers ${costs}, and ${earn}.`;
    const diff = c.priceN - c.breakEven;
    const second = `Your ${C.SPEEDS[s.speed].label.toLowerCase()} recovery scenario projects ${C.money(c.priceN)}, which is ${C.money(Math.abs(diff))} ${diff >= 0 ? "above" : "below"} that line. Try Slow and Fast to see how much room there is.`;
    return `${first} ${second}`;
  }

  function updateWaiting() {
    const needed = visibleMoneyInputs().some((inp) => blanks.has(fieldKey(inp)));
    $("results").classList.toggle("waiting", needed);
    $("waiting-note").hidden = !needed;
    $("mobile-bar").hidden = needed;
  }

  function drawGauge(c, s, speed, yearN) {
    const svg = $("gauge");
    svg.replaceChildren();
    const today = s.homeValue * (s.situation === "standing" ? 1 : 1 + s.newCodePremiumPct / 100);
    const vals = [c.breakEven, c.priceN, today];
    let lo = Math.min(...vals) * 0.8, hi = Math.max(...vals) * 1.15;
    lo = Math.max(0, Math.floor(lo * 2) / 2); hi = Math.ceil(hi * 2) / 2;
    const x = (v) => 20 + ((v - lo) / (hi - lo)) * 640;
    const be = Math.min(hi, Math.max(lo, c.breakEven));
    svg.append(
      el("rect", { x: x(lo), y: 44, width: x(be) - x(lo), height: 10, fill: "#C2611F", "fill-opacity": 0.6 }),
      el("rect", { x: x(be), y: 44, width: x(hi) - x(be), height: 10, fill: "#9FC3DA", "fill-opacity": 0.8 }),
      el("text", { x: x(lo), y: 76, "font-size": 11, fill: "#B9C6D0" }, s.situation === "lot" ? "Selling the lot wins" : "Selling early wins"),
      el("text", { x: x(hi), y: 76, "font-size": 11, fill: "#B9C6D0", "text-anchor": "end" }, "Holding wins"),
      el("line", { x1: x(be), x2: x(be), y1: 34, y2: 64, stroke: "#F3EFE6", "stroke-width": 2 }),
      el("circle", { cx: x(today), cy: 49, r: 7, fill: "#0F1E2B", stroke: "#F3EFE6", "stroke-width": 2 }),
      el("text", { x: Math.min(600, Math.max(80, x(today))), y: 100, "font-size": 12, fill: "#F3EFE6", "text-anchor": "middle" }, `Value today · ${C.money(today)}`),
      el("circle", { cx: x(c.priceN), cy: 49, r: 7, fill: "#F3EFE6" }),
      el("text", { x: Math.min(560, Math.max(120, x(c.priceN))), y: 24, "font-size": 12, "font-weight": 600, fill: "#F3EFE6", "text-anchor": "middle" }, `${speed.label} recovery, ${yearN} · ${C.money(c.priceN)}`)
    );
    svg.setAttribute("aria-label", `Scale from ${C.money(lo)} to ${C.money(hi)}. Break-even at ${C.money(c.breakEven)}. Value today ${C.money(today)}. ${speed.label} recovery projects ${C.money(c.priceN)} in ${yearN}, which is ${c.priceN >= c.breakEven ? "above" : "below"} the break-even.`);
  }

  function drawChart(result, yearN) {
    const s = result.inputs, c = result.chosen;
    const svg = $("chart");
    svg.replaceChildren();
    const start = s.situation === "standing" ? 0 : s.yearsToRebuild;
    const yrs = []; for (let t = start; t <= 10; t++) yrs.push(t);
    const series = {};
    for (const k of Object.keys(C.SPEEDS)) series[k] = C.projection(s, k, yrs);
    const all = [].concat(series.slow, series.fast, [c.breakEven]);
    const bottom = Math.max(0, Math.floor(Math.min(...all)) - 1);
    const stepV = Math.max(1, Math.ceil((Math.max(...all) - bottom) / 4));
    const top = bottom + stepV * 4;
    const x = (t) => 56 + (t / 10) * 530;
    const y = (v) => 236 - ((v - bottom) / (top - bottom)) * 210;
    const pts = (arr) => arr.map((v, i) => `${x(yrs[i]).toFixed(1)},${y(v).toFixed(1)}`);

    const grid = el("g", { "font-size": 11, fill: "#4F5964" });
    for (let i = 0; i <= 4; i++) {
      const v = bottom + i * stepV;
      grid.append(el("line", { x1: 56, x2: 586, y1: y(v), y2: y(v), stroke: "#E6E0D4" }));
      grid.append(el("text", { x: 46, y: y(v) + 4, "text-anchor": "end", class: "num" }, "$" + (Math.round(v * 10) / 10).toFixed(v % 1 ? 1 : 0) + "M"));
    }
    for (let t = 0; t <= 10; t += 2) grid.append(el("text", { x: x(t), y: 262, "text-anchor": "middle", class: "num" }, String(thisYear + t)));
    svg.append(grid);

    const defs = el("defs", {});
    const lg = el("linearGradient", { id: "fan", x1: 0, y1: 0, x2: 0, y2: 1 });
    lg.append(el("stop", { offset: 0, "stop-color": "#1B4F72", "stop-opacity": 0.22 }), el("stop", { offset: 1, "stop-color": "#1B4F72", "stop-opacity": 0.05 }));
    defs.append(lg); svg.append(defs);
    svg.append(el("polygon", { points: pts(series.fast).concat(pts(series.slow).reverse()).join(" "), fill: "url(#fan)" }));
    svg.append(el("polyline", { points: pts(series.slow).join(" "), fill: "none", stroke: "#1B4F72", "stroke-opacity": 0.35, "stroke-dasharray": "2 3" }));
    svg.append(el("polyline", { points: pts(series.fast).join(" "), fill: "none", stroke: "#1B4F72", "stroke-opacity": 0.35, "stroke-dasharray": "2 3" }));
    svg.append(el("line", { x1: x(0), x2: x(0), y1: 20, y2: 246, stroke: "#121A22", "stroke-opacity": 0.3 }));
    svg.append(el("text", { x: x(0) + 6, y: 30, "font-size": 11, fill: "#3C4651" }, "Today"));
    const bx = x(s.sellInYears);
    svg.append(el("line", { x1: bx - 18, x2: bx + 18, y1: y(c.breakEven), y2: y(c.breakEven), stroke: "#C2611F", "stroke-width": 2.5 }));
    const below = y(c.breakEven) > y(series[s.speed][s.sellInYears - start] || c.breakEven);
    svg.append(el("text", { x: bx, y: y(c.breakEven) + (below ? 18 : -9), "font-size": 11, fill: "#9A4A15", "text-anchor": "middle", "font-weight": 600 }, `Break-even, ${yearN}`));
    svg.append(el("polyline", { points: pts(series[s.speed]).join(" "), fill: "none", stroke: "#1B4F72", "stroke-width": 2.5, "stroke-linejoin": "round" }));
    const last = series[s.speed][series[s.speed].length - 1];
    svg.append(el("circle", { cx: x(10), cy: y(last), r: 4, fill: "#1B4F72" }));
    const labels = Object.keys(C.SPEEDS).map((k) => ({ k, v: series[k][series[k].length - 1] }));
    labels.forEach((l) => {
      const on = l.k === s.speed;
      svg.append(el("text", { x: 594, y: y(l.v) + 4, "font-size": 11, "font-weight": on ? 700 : 400, fill: on ? "#1B4F72" : "#4F5964", class: "num" }, `${C.SPEEDS[l.k].label} ${C.money(l.v)}`));
    });
    $("chart-title").textContent = s.situation === "standing" ? "Projected home value" : "Projected value of the rebuilt home";
    svg.setAttribute("aria-label", `Projected home value from ${thisYear + start} to ${thisYear + 10}. Slow recovery reaches ${C.money(labels[0].v)}, typical ${C.money(labels[1].v)}, fast ${C.money(labels[2].v)}. Break-even for a ${yearN} sale is ${C.money(c.breakEven)}.`);
  }

  function renderLotCheck(lc) {
    const row = $("lot-check-row");
    row.hidden = !lc;
    if (!lc) return;
    const pct = Math.round(lc.coveredShare * 100);
    $("lc-text").textContent = lc.gap > 0
      ? `Insurance covers about ${pct}% of the rest of the rebuild (${C.money(lc.cost)} with your overrun). You'd pay about ${C.money(lc.gap)} yourself.`
      : `Insurance covers the rest of the rebuild (${C.money(lc.cost)} with your overrun), with about ${C.money(lc.insurance - lc.cost)} to spare.`;
    $("lc-bar").style.width = pct + "%";
    $("lc-fine").textContent = "Gaps like this are often what decides between rebuilding and selling the lot, before market timing matters.";
  }

  // ---------- Family decision mode ----------
  const PRI = C.PRIORITIES;
  function renderPeopleEditors() {
    const wrap = $("people");
    wrap.replaceChildren();
    people.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = "person";
      const head = document.createElement("div");
      head.className = "person-head";
      const name = document.createElement("input");
      name.value = p.name; name.maxLength = 40;
      name.setAttribute("aria-label", `Name for family member ${idx + 1}`);
      name.addEventListener("input", () => { p.name = name.value || `Person ${idx + 1}`; changed(false); });
      const rm = document.createElement("button");
      rm.type = "button"; rm.className = "icon-btn no-print"; rm.textContent = "×";
      rm.setAttribute("aria-label", `Remove ${p.name}`);
      rm.disabled = people.length <= 1;
      rm.addEventListener("click", () => { people.splice(idx, 1); renderPeopleEditors(); changed(false); });
      head.append(name, rm);
      card.append(head);
      PRI.forEach((pr) => {
        const lab = document.createElement("label");
        lab.className = "slider";
        lab.style.paddingTop = "8px";
        const row = document.createElement("span");
        row.className = "row";
        const out = document.createElement("output");
        out.textContent = p.weights[pr.key];
        row.append(pr.label, out);
        const r = document.createElement("input");
        r.type = "range"; r.min = 0; r.max = 5; r.step = 1; r.value = p.weights[pr.key];
        r.addEventListener("input", () => { p.weights[pr.key] = Number(r.value); out.textContent = r.value; changed(false); });
        lab.append(row, r);
        card.append(lab);
      });
      wrap.append(card);
    });
    $("add-person").disabled = people.length >= 8;
  }

  function renderFamily(s, c, titles) {
    const fit = C.familyFit(s, c, people);
    const bars = $("fit-bars");
    bars.replaceChildren();
    const head = document.createElement("p");
    head.className = "small-caps";
    head.style.margin = "0";
    head.textContent = "Fit with your family's priorities";
    bars.append(head);
    fit.family.forEach((v, i) => {
      const row = document.createElement("div");
      row.className = "fit-row" + (i === fit.top ? " top" : "");
      const name = document.createElement("span"); name.textContent = titles[i];
      const track = document.createElement("span"); track.className = "track";
      const fill = document.createElement("span"); fill.style.width = Math.round(v * 100) + "%";
      track.append(fill);
      const pct = document.createElement("span"); pct.className = "num"; pct.style.textAlign = "right"; pct.textContent = Math.round(v * 100) + "%";
      row.append(name, track, pct);
      bars.append(row);
    });
    const tops = fit.each.map((p) => `${p.name}: ${titles[p.scores.indexOf(Math.max(...p.scores))]}`);
    $("fit-note").textContent = `Best fit for each person · ${tops.join(" · ")}. This scores fit with priorities; it is not a recommendation.`;

    // Scoring table, so the method is open.
    const table = $("fit-table");
    table.replaceChildren();
    const tr = (cells, th) => { const r = document.createElement("tr"); cells.forEach((x) => { const cell = document.createElement(th ? "th" : "td"); cell.textContent = x; r.append(cell); }); return r; };
    table.append(tr(["Priority"].concat(titles), true));
    table.append(tr(["Money (from your numbers)"].concat(fit.money.map((m) => m.toFixed(2)))));
    const F = C.FIT[s.situation];
    table.append(tr(["Staying in the neighborhood"].concat(F.stay.map(String))));
    table.append(tr(["Less hassle and stress"].concat(F.hassle.map(String))));
    table.append(tr(["Moving on sooner"].concat(F.sooner.map(String))));
  }

  // ---------- Changes ----------
  let trackTimer = null;
  function changed(fromNumbers) {
    if (fromNumbers) edited = true;
    fillForm();
    render();
    remember();
    clearTimeout(trackTimer);
    trackTimer = setTimeout(() => track("scenario_changed", { situation: state.situation, speed: state.speed }), 1500);
  }

  form.addEventListener("input", (e) => {
    const t = e.target;
    if (t.name === "situation" || t.name === "speed") { state[t.name] = t.value; return changed(false); }
    if (t.type === "range") { state[t.name] = Number(t.value); return changed(true); }
    if (t.dataset.kind) {
      const v = parse(t.dataset.kind, t.value);
      if (v === null) return;
      state[fieldKey(t)] = v;
      if (blanks.delete(fieldKey(t))) { t.closest(".money-field").classList.remove("needs"); updateWaiting(); }
      edited = true;
      render(); remember(); // the calculator caps out-of-range numbers itself
    }
  });
  // When a box loses focus, show the number the calculator actually used (capped, rounded).
  form.addEventListener("focusout", (e) => {
    if (!e.target.dataset || !e.target.dataset.kind) return;
    const lim = C.LIMITS.homeValue;
    state.homeValueStanding = Math.min(lim[1], Math.max(lim[0], state.homeValueStanding));
    const n = C.normalize(Object.assign({}, state));
    Object.keys(C.LIMITS).forEach((k) => { state[k] = n[k]; });
    fillForm(); remember();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  $("add-person").addEventListener("click", () => {
    people.push({ name: `Person ${people.length + 1}`, weights: { money: 3, stay: 3, hassle: 3, sooner: 3 } });
    renderPeopleEditors(); changed(false);
    track("family_member_added", { people: people.length });
  });

  // ---------- Start fresh / reset ----------
  $("fresh-btn").addEventListener("click", () => {
    blanks = new Set(visibleMoneyInputs().map(fieldKey));
    edited = true;
    fillForm(); remember();
    const first = visibleMoneyInputs()[0];
    if (first) first.focus();
    track("start_fresh", { situation: state.situation });
  });
  $("reset-btn").addEventListener("click", () => {
    const situation = state.situation;
    state = Object.assign({}, C.DEFAULTS, { homeValueStanding: 3.0, situation });
    people = EXAMPLE_PEOPLE.map((p) => ({ name: p.name, weights: Object.assign({}, p.weights) }));
    blanks = new Set();
    edited = false;
    renderPeopleEditors(); fillForm(); render(); remember();
    track("reset_examples", {});
  });

  // ---------- AI summary ----------
  $("ai-btn").addEventListener("click", async () => {
    const btn = $("ai-btn"), status = $("ai-status"), out = $("ai-out");
    if (/github\.io$/.test(location.hostname)) {
      status.className = "status-msg error";
      status.textContent = "The AI summary runs on the live Homeward app, not this static copy.";
      return;
    }
    btn.disabled = true; status.className = "status-msg"; status.textContent = "Writing your summary…";
    track("summary_requested", { situation: state.situation, speed: state.speed });
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers: C.roundedForSummary(C.run(inputsForCalc())) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Something went wrong. Try again in a minute.");
      out.replaceChildren();
      const p = document.createElement("p"); p.className = "ai-text"; p.textContent = body.summary;
      const h = document.createElement("p"); h.className = "small-caps"; h.style.margin = "4px 0 6px"; h.textContent = "Questions for your CPA or realtor";
      const ul = document.createElement("ul"); ul.className = "ai-list";
      (body.questions || []).forEach((q) => { const li = document.createElement("li"); li.textContent = q; ul.append(li); });
      out.append(p, h, ul);
      status.textContent = "Written by AI from rounded numbers. Check anything important with a professional.";
    } catch (err) {
      status.className = "status-msg error";
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Share and print ----------
  $("share-btn").addEventListener("click", async () => {
    const link = `${location.origin}${location.pathname}#s=${encode(snapshot())}`;
    const status = $("share-status");
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = "Link copied. Anyone you send it to sees these numbers; nothing is stored on our server.";
    } catch (e) {
      status.textContent = "Couldn't copy automatically. Copy this link: " + link;
    }
    track("share_link_created", {});
  });
  $("print-btn").addEventListener("click", () => { track("print_clicked", {}); window.print(); });

  // ---------- "When will my rebuild finish?" ----------
  // Uses neighborhood curves from public permit data. The permit month and size picked
  // here stay in this browser; analytics only hear which button was used.
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SIZE_KEYS = ["all", "small", "medium", "large"];
  let timing = null, timingState = "idle";
  function monthsAhead(n) {
    const d = new Date(); d.setDate(15); d.setMonth(d.getMonth() + Math.round(n));
    return `${MON[d.getMonth()]} ${d.getFullYear()}`;
  }
  function setupEstimate() {
    const ms = $("est-month"), ys = $("est-year");
    MON.forEach((m, i) => ms.append(new Option(m, String(i + 1))));
    for (let y = 2025; y <= Math.max(thisYear + 2, 2028); y++) ys.append(new Option(String(y), String(y)));
    $("estimate").addEventListener("toggle", loadTiming);
    ["est-month", "est-year", "est-size"].forEach((id) => $(id).addEventListener("change", drawEstimate));
  }
  async function loadTiming() {
    if (!$("estimate").open || timingState !== "idle") return;
    timingState = "loading";
    try {
      const res = await fetch("/market-data/rebuild-timing.json");
      if (!res.ok) throw new Error(String(res.status));
      timing = await res.json();
      timingState = "ready";
      const dt = new Date(timing.data_date + "T12:00:00");
      const note = $("est-note");
      note.replaceChildren();
      const link = document.createElement("a"); link.href = "/pulse#forecast-h"; link.textContent = "How this is estimated";
      note.append(`Based on ${timing.since_fire.permits.toLocaleString("en-US")} Palisades rebuild permits since the fire (${timing.since_fire.finished} finished so far) and ${timing.slower.permits} new-home permits from 2020–2024. City of LA data pulled ${MON[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}. Finished means the City issued a certificate of occupancy. Estimates, not promises. `, link);
    } catch (e) {
      timingState = "error";
    }
    drawEstimate();
  }
  function drawEstimate() {
    const out = $("est-out");
    out.replaceChildren();
    if (timingState === "error") { out.textContent = "Couldn't load the neighborhood data. Try reloading the page."; return; }
    if (timingState !== "ready") return;
    const sizeKey = SIZE_KEYS.includes($("est-size").value) ? $("est-size").value : "all";
    const r = C.rebuildEstimate(timing, $("est-year").value, $("est-month").value, sizeKey, new Date());
    if (!r) { const p = document.createElement("p"); p.className = "fine"; p.style.margin = "0"; p.textContent = "Pick the month your permit was issued, or when you expect it."; out.append(p); return; }
    const cases = [
      ["faster", "At the pace of rebuilds so far", r.faster],
      ["slower", "At the pace before the fire", r.slower],
    ];
    cases.forEach(([key, title, c]) => {
      const box = document.createElement("div"); box.className = "est-case" + (key === "slower" ? " slow" : "");
      const t = document.createElement("span"); t.className = "t"; t.textContent = title;
      const v = document.createElement("span"); v.className = "v";
      const when = document.createElement("strong");
      when.textContent = c.likely < 1 ? "any time now" : monthsAhead(c.likely);
      v.append(c.likely < 1 ? "Likely finished " : "Likely finished around ", when);
      const rng = document.createElement("span"); rng.className = "r";
      const hi = c.high > 60 ? `${monthsAhead(60).slice(-4)} or later` : monthsAhead(c.high);
      rng.textContent = `Most homes like yours: ${c.low < 1 ? "now" : monthsAhead(c.low)} to ${hi}`;
      const b = document.createElement("button"); b.type = "button";
      b.textContent = `Use ${c.years} year${c.years === 1 ? "" : "s"}`;
      b.setAttribute("aria-pressed", String(state.yearsToRebuild === c.years));
      b.addEventListener("click", () => {
        state.yearsToRebuild = c.years;
        blanks.delete("yearsToRebuild");
        changed(true);
        drawEstimate();
        track("rebuild_estimate_used", { pace: key, size: sizeKey });
      });
      box.append(t, v, rng, b);
      out.append(box);
    });
  }

  // ---------- Decoration and context ----------
  function drawContours() {
    const svg = $("contours");
    for (let i = 0; i < 14; i++) {
      let d = "";
      const base = 30 + i * 22, ph = i * 0.7;
      for (let xx = -20; xx <= 920; xx += 20) {
        const yy = base + 16 * Math.sin(xx / 140 + ph) + 9 * Math.sin(xx / 57 + ph * 1.7) + (xx / 900) * 40;
        d += (xx === -20 ? "M" : "L") + xx + "," + yy.toFixed(1) + " ";
      }
      svg.append(el("path", { d, fill: "none", stroke: "#9FC3DA", "stroke-opacity": (0.05 + (i % 4) * 0.025).toFixed(3) }));
    }
  }
  async function loadContext() {
    try {
      const res = await fetch("/market-data/permits.json");
      if (!res.ok) return;
      const d = await res.json();
      const strip = $("context");
      const a = document.createElement("span");
      const b = document.createElement("strong"); b.textContent = "Neighborhood context: ";
      a.append(b, `${d.since_fire.new_home_permits.toLocaleString("en-US")} new-home permits in Pacific Palisades since the fire`);
      const dt = new Date(d.built_on + "T12:00:00");
      const src = document.createElement("span"); src.textContent = `City of LA, LADBS · data pulled ${isNaN(dt) ? d.built_on : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      const link = document.createElement("a"); link.href = "/pulse"; link.textContent = "See the recovery pulse";
      strip.append(a, src, link);
      const hint = $("speed-data");
      hint.replaceChildren();
      const go = document.createElement("a"); go.href = "/pulse"; go.textContent = "See the recovery pulse →";
      hint.append(`So far in Pacific Palisades: ${d.since_fire.new_home_permits.toLocaleString("en-US")} new-home permits since the fire, ${d.since_fire.completions.toLocaleString("en-US")} homes finished. `, go);
      hint.hidden = false;
    } catch (e) { /* context is optional */ }
  }

  // Hide the phone bar once the results are on screen.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      $("mobile-bar").classList.toggle("hide", entries[0].isIntersecting);
    }, { threshold: 0.05 }).observe(document.querySelector(".verdict"));
  }

  restore();
  fillForm();
  renderPeopleEditors();
  drawContours();
  render();
  setupEstimate();
  loadContext();
})();
