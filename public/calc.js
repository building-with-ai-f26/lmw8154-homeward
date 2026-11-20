// Homeward calculator: all the math, in one place, with no network calls.
// Runs in the browser (window.HomewardCalc) and in Node for tests (require("./calc.js")).
// Every dollar figure is in millions. Every percent input is a whole number (6 means 6%).
//
// Simplifications (shown to users on the page):
//   - Rent or living costs that happen on every path are left out.
//   - Money from selling now is assumed to earn `returnPct` a year, so paths are
//     compared at the same future date.
//   - Recovery speeds are assumptions the user picks, not forecasts.
(function (root) {
  "use strict";

  const SPEEDS = {
    slow:    { label: "Slow",    growthPct: -2, note: "Values slip about 2% a year while the area rebuilds." },
    typical: { label: "Typical", growthPct: 3,  note: "Values grow about 3% a year once homes are rebuilt." },
    fast:    { label: "Fast",    growthPct: 6,  note: "Values grow about 6% a year as buyers return." },
  };

  const SITUATIONS = {
    lot:        { label: "Burned lot",    paths: ["Sell the lot now", "Rebuild, then sell", "Rebuild and stay"] },
    rebuilding: { label: "Rebuilding",    paths: ["Sell when finished", "Finish, then sell later", "Finish and stay"] },
    standing:   { label: "Home survived", paths: ["Sell now", "Hold, then sell", "Stay"] },
  };

  // Example numbers shown on first visit. Clearly labeled as examples on the page.
  const DEFAULTS = {
    situation: "lot",
    lotValue: 2.4,          // what the lot would sell for today
    homeValue: 4.6,         // home once rebuilt, in today's dollars (standing: home today)
    rebuildCostLeft: 1.8,
    insuranceLeft: 0.9,     // insurance money still to come for the rebuild
    insuranceIfSell: 0,     // insurance you'd still get if you sell the lot instead
    monthlyCarry: 0.0055,   // $5,500 a month: mortgage, property tax, HOA, upkeep
    monthlyInsurance: 0.004,// $4,000 a month
    sellingCostPct: 6,
    yearsToRebuild: 2,
    sellInYears: 3,
    returnPct: 4,
    speed: "typical",
    overrunPct: 10,
    premiumGrowthPct: 15,
    newCodePremiumPct: 0,
  };

  // Limits keep the math sane and are also what the server accepts for the AI summary.
  const LIMITS = {
    lotValue: [0, 50], homeValue: [0.1, 100], rebuildCostLeft: [0, 50], insuranceLeft: [0, 50],
    insuranceIfSell: [0, 50], monthlyCarry: [0, 1], monthlyInsurance: [0, 0.5],
    sellingCostPct: [0, 15], yearsToRebuild: [1, 6], sellInYears: [1, 15], returnPct: [0, 10],
    overrunPct: [0, 60], premiumGrowthPct: [0, 50], newCodePremiumPct: [0, 25],
  };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // Fill gaps with defaults and keep every number inside its limits.
  function normalize(input) {
    // Copy only the fields we know, so odd keys in a shared link (like "__proto__") are ignored.
    const s = Object.assign({}, DEFAULTS);
    const src = input && typeof input === "object" ? input : {};
    for (const k of Object.keys(DEFAULTS)) if (Object.prototype.hasOwnProperty.call(src, k)) s[k] = src[k];
    if (!SITUATIONS[s.situation]) s.situation = DEFAULTS.situation;
    if (!SPEEDS[s.speed]) s.speed = DEFAULTS.speed;
    for (const k of Object.keys(LIMITS)) {
      const n = Number(s[k]);
      s[k] = Number.isFinite(n) ? clamp(n, LIMITS[k][0], LIMITS[k][1]) : DEFAULTS[k];
    }
    s.yearsToRebuild = Math.round(s.yearsToRebuild);
    s.sellInYears = Math.round(s.sellInYears);
    // Selling later has to happen after the rebuild is finished.
    if (s.situation !== "standing") s.sellInYears = Math.max(s.sellInYears, s.yearsToRebuild + 1);
    return s;
  }

  // Carrying costs for t whole years. Insurance grows by premiumGrowthPct each year.
  function carrying(s, t) {
    let total = s.monthlyCarry * 12 * t;
    for (let k = 0; k < t; k++) total += s.monthlyInsurance * 12 * Math.pow(1 + s.premiumGrowthPct / 100, k);
    return total;
  }

  function scenario(s, speedKey) {
    const g = SPEEDS[speedKey].growthPct / 100;
    const sell = 1 - s.sellingCostPct / 100;
    const r = s.returnPct / 100;
    const N = s.sellInYears;
    const codeBoost = s.situation === "standing" ? 1 : 1 + s.newCodePremiumPct / 100;
    const valueAt = (t) => s.homeValue * codeBoost * Math.pow(1 + g, t);

    const cost = s.situation === "standing" ? 0 : s.rebuildCostLeft * (1 + s.overrunPct / 100);
    const outOfPocket = Math.max(0, cost - s.insuranceLeft);
    const surplus = s.situation === "standing" ? 0 : Math.max(0, s.insuranceLeft - cost);

    // Path A: the "sell early" path, and when it happens.
    let a, aYear;
    if (s.situation === "lot") { a = s.lotValue * sell + s.insuranceIfSell; aYear = 0; }
    else if (s.situation === "rebuilding") {
      aYear = s.yearsToRebuild;
      a = valueAt(aYear) * sell - outOfPocket - carrying(s, aYear) + surplus;
    } else { a = s.homeValue * sell; aYear = 0; }
    const aAtN = a * Math.pow(1 + r, N - aYear); // what that money is worth by year N

    // Path B: sell at year N.
    const priceN = valueAt(N);
    const b = priceN * sell - outOfPocket - carrying(s, N) + surplus;

    // Path C: stay. Home value after 10 years, and what it takes to get there.
    const stayYears = 10;
    const c = { homeValue: valueAt(stayYears), putIn: outOfPocket + carrying(s, stayYears) };

    // Break-even: the sale price at year N where B equals A.
    const breakEven = (aAtN + outOfPocket + carrying(s, N) - surplus) / sell;
    const startValue = s.homeValue * codeBoost;
    const breakEvenGrowthPct = (Math.pow(Math.max(breakEven, 0.0001) / startValue, 1 / N) - 1) * 100;

    return { speed: speedKey, sellNow: a, sellNowYear: aYear, sellNowAtN: aAtN, sellLater: b, priceN, stay: c,
             breakEven, breakEvenGrowthPct, outOfPocket, cost, surplus };
  }

  // Rebuild-or-sell-the-lot check: does the insurance money cover the rebuild?
  function lotCheck(s) {
    if (s.situation === "standing") return null;
    const cost = s.rebuildCostLeft * (1 + s.overrunPct / 100);
    const covered = cost > 0 ? Math.min(1, s.insuranceLeft / cost) : 1;
    return { cost, insurance: s.insuranceLeft, gap: Math.max(0, cost - s.insuranceLeft), coveredShare: covered };
  }

  // Family decision mode. Each person rates four priorities from 0 to 5.
  // How well each path fits a priority (0 to 1). Shown on the page so the scoring is open.
  const FIT = {
    lot:        { stay: [0, 0.3, 1],   hassle: [1, 0.2, 0.3], sooner: [1, 0.3, 0] },
    rebuilding: { stay: [0, 0.4, 1],   hassle: [0.6, 0.5, 0.7], sooner: [0.7, 0.4, 0] },
    standing:   { stay: [0, 0.5, 1],   hassle: [0.6, 0.6, 1], sooner: [1, 0.4, 0] },
  };
  const PRIORITIES = [
    { key: "money", label: "Money" },
    { key: "stay", label: "Staying in the neighborhood" },
    { key: "hassle", label: "Less hassle and stress" },
    { key: "sooner", label: "Moving on sooner" },
  ];

  function familyFit(s, sc, people) {
    // Money: each path compared at year N. Staying is valued like selling at N.
    const best = Math.max(sc.sellNowAtN, sc.sellLater, 0.0001);
    const money = [sc.sellNowAtN / best, sc.sellLater / best, sc.sellLater / best].map((v) => clamp(v, 0, 1));
    const fit = FIT[s.situation];
    const scoreFor = (w) => {
      const total = w.money + w.stay + w.hassle + w.sooner;
      if (!total) return [0, 0, 0];
      return [0, 1, 2].map((i) => (w.money * money[i] + w.stay * fit.stay[i] + w.hassle * fit.hassle[i] + w.sooner * fit.sooner[i]) / total);
    };
    const each = (people || []).map((p) => ({ name: p.name, scores: scoreFor(p.weights) }));
    const family = [0, 1, 2].map((i) => each.length ? each.reduce((t, p) => t + p.scores[i], 0) / each.length : 0);
    const top = family.indexOf(Math.max(...family));
    return { each, family, top, money };
  }

  function run(input) {
    const s = normalize(input);
    const scenarios = {};
    for (const k of Object.keys(SPEEDS)) scenarios[k] = scenario(s, k);
    return { inputs: s, chosen: scenarios[s.speed], scenarios, lotCheck: lotCheck(s), paths: SITUATIONS[s.situation].paths };
  }

  // Points for the projection chart: rebuilt home value by year, for each speed.
  function projection(s, speedKey, years) {
    const g = SPEEDS[speedKey].growthPct / 100;
    const codeBoost = s.situation === "standing" ? 1 : 1 + s.newCodePremiumPct / 100;
    return years.map((t) => s.homeValue * codeBoost * Math.pow(1 + g, t));
  }

  // "$2.26M", "$950K"
  function money(v) {
    const sign = v < 0 ? "-" : "";
    const a = Math.abs(v);
    if (a >= 1) return sign + "$" + a.toFixed(2) + "M";
    return sign + "$" + Math.round(a * 1000) + "K";
  }

  // Reads what someone typed in a box. Dollar boxes accept "2,400,000", "$2.4M", "2.4 million",
  // "750K" or "750 thousand". Returns millions for dollar boxes, a plain number otherwise, or null.
  function parseAmount(kind, text) {
    const t = String(text == null ? "" : text).trim().toLowerCase().replace(/[$,%\s]/g, "");
    const m = t.match(/^(\d*\.?\d+)(m|mm|mil|million|k|thousand)?$/);
    if (!m) return null;
    let n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    if (kind === "dollars" || kind === "monthly") {
      if (m[2] && m[2][0] === "m") n *= 1e6;
      else if (m[2]) n *= 1e3;
      return n / 1e6;
    }
    return m[2] ? null : n;
  }

  // Rounded copy for the AI summary: no more detail than it needs.
  function roundedForSummary(result) {
    const s = result.inputs, c = result.chosen;
    const r = (v) => Math.round(v * 20) / 20; // nearest $50K
    return {
      situation: s.situation, speed: s.speed, sellInYears: s.sellInYears,
      sellNow: r(c.sellNow), sellLater: r(c.sellLater), breakEven: r(c.breakEven),
      breakEvenGrowthPct: Math.round(c.breakEvenGrowthPct * 10) / 10,
      homeValue: r(s.homeValue), outOfPocket: r(c.outOfPocket),
      slowSellLater: r(result.scenarios.slow.sellLater), fastSellLater: r(result.scenarios.fast.sellLater),
      overrunPct: s.overrunPct, premiumGrowthPct: s.premiumGrowthPct, returnPct: s.returnPct,
    };
  }

  const api = { SPEEDS, SITUATIONS, DEFAULTS, LIMITS, PRIORITIES, FIT, normalize, carrying, scenario, lotCheck,
                familyFit, run, projection, money, roundedForSummary, parseAmount };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HomewardCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
