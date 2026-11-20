// Checks the calculator math against numbers worked out by hand. Free and instant.
// Run it with: npm test
const C = require("../public/calc.js");

let failures = 0;
function near(name, got, want, tol = 0.001) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> got ${got}, want ${want}`}`);
  if (!ok) failures++;
}
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failures++;
}

// 1. Burned lot, example numbers, typical recovery (all in $ millions).
//    Sell lot now: 2.4 x 0.94 = 2.256. Grown at 4% for 3 years: 2.256 x 1.124864 = 2.53769
//    Rebuild cost with 10% overrun: 1.98. Out of pocket after 0.9 insurance: 1.08
//    Carrying 3 years: 0.0055x36 = 0.198, plus insurance 0.048 x (1 + 1.15 + 1.3225) = 0.16668 -> 0.36468
//    Rebuilt value in 3 years at +3%: 4.6 x 1.092727 = 5.026544; net of 6% selling = 4.724951
//    Rebuild then sell: 4.724951 - 1.08 - 0.36468 = 3.280271
//    Break-even price: (2.53769 + 1.08 + 0.36468) / 0.94 = 4.236567
let r = C.run({});
near("lot: sell the lot now", r.chosen.sellNow, 2.256);
near("lot: sell-now money grown to year 3", r.chosen.sellNowAtN, 2.537693);
near("lot: carrying costs for 3 years", C.carrying(r.inputs, 3), 0.36468);
near("lot: out of pocket after insurance", r.chosen.outOfPocket, 1.08);
near("lot: rebuild, then sell in year 3", r.chosen.sellLater, 3.280271);
near("lot: break-even sale price", r.chosen.breakEven, 4.236567);
near("lot: break-even growth per year (%)", r.chosen.breakEvenGrowthPct, -2.707, 0.01);
check("lot: slow < typical < fast for selling later",
  r.scenarios.slow.sellLater < r.scenarios.typical.sellLater && r.scenarios.typical.sellLater < r.scenarios.fast.sellLater);
near("lot check: insurance covers 0.9 / 1.98 of the rebuild", r.lotCheck.coveredShare, 0.454545);
near("lot check: gap", r.lotCheck.gap, 1.08);

// 2. Home survived: worth 3.0 today, typical recovery, sell in 3 years.
//    Sell now: 2.82, grown to year 3: 3.172116. Hold: 3 x 1.092727 x 0.94 - 0.36468 = 2.71681
//    Break-even: (3.172116 + 0.36468) / 0.94 = 3.762549
r = C.run({ situation: "standing", homeValue: 3.0 });
near("standing: sell now", r.chosen.sellNow, 2.82);
near("standing: hold, then sell", r.chosen.sellLater, 2.71681);
near("standing: break-even sale price", r.chosen.breakEven, 3.762549);
check("standing: no rebuild-or-sell check", r.lotCheck === null);

// 3. Rebuilding: finishes in 2 years. Selling later must come after the rebuild.
r = C.run({ situation: "rebuilding", yearsToRebuild: 2, sellInYears: 1 });
check("rebuilding: sell-later year pushed past the rebuild", r.inputs.sellInYears === 3, `got ${r.inputs.sellInYears}`);
check("rebuilding: sell-when-finished happens at year 2", r.chosen.sellNowYear === 2);

// 4. Bad input never breaks the math.
r = C.run({ situation: "castle", speed: "warp", homeValue: "abc", sellingCostPct: 500, lotValue: -3 });
check("garbage situation falls back to burned lot", r.inputs.situation === "lot");
check("garbage speed falls back to typical", r.inputs.speed === "typical");
check("non-number falls back to the example", r.inputs.homeValue === C.DEFAULTS.homeValue);
check("out-of-range percent is capped", r.inputs.sellingCostPct === 15);
check("negative value is raised to 0", r.inputs.lotValue === 0);
check("results are finite numbers", [r.chosen.sellNow, r.chosen.sellLater, r.chosen.breakEven].every(Number.isFinite));

r = C.run(JSON.parse('{"__proto__": {"polluted": true}, "situation": "standing", "evil": 1}'));
check("odd keys in a shared link are ignored", r.inputs.polluted === undefined && r.inputs.evil === undefined && ({}).polluted === undefined && r.inputs.situation === "standing");

// 5. Family decision mode.
r = C.run({});
const onlyStay = C.familyFit(r.inputs, r.chosen, [{ name: "A", weights: { money: 0, stay: 5, hassle: 0, sooner: 0 } }]);
check("someone who only wants to stay -> 'Rebuild and stay' fits best", onlyStay.top === 2);
const onlySooner = C.familyFit(r.inputs, r.chosen, [{ name: "B", weights: { money: 0, stay: 0, hassle: 0, sooner: 5 } }]);
check("someone who only wants to move on -> 'Sell the lot now' fits best", onlySooner.top === 0);
const noWeights = C.familyFit(r.inputs, r.chosen, [{ name: "C", weights: { money: 0, stay: 0, hassle: 0, sooner: 0 } }]);
check("all-zero ratings don't crash", noWeights.family.every(Number.isFinite));

// 6. The AI summary only gets rounded, non-identifying numbers.
const sent = C.roundedForSummary(C.run({}));
const keys = Object.keys(sent).sort().join(",");
check("summary payload has only the expected fields",
  keys === "breakEven,breakEvenGrowthPct,fastSellLater,homeValue,outOfPocket,overrunPct,premiumGrowthPct,returnPct,sellInYears,sellLater,sellNow,situation,slowSellLater,speed", keys);
check("summary payload is rounded to $50K", Math.abs(sent.sellLater * 20 - Math.round(sent.sellLater * 20)) < 1e-9);

console.log(failures ? `\n${failures} calculator check(s) failed.` : "\nAll calculator checks passed.");
process.exit(failures ? 1 : 0);
