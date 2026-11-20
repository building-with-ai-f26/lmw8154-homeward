// Landing page: draws the contour-line decoration and fills in the live neighborhood numbers.
(function () {
  "use strict";
  const SVG = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("contours");
  for (let i = 0; i < 16; i++) {
    let d = "";
    const base = 60 + i * 38, ph = i * 0.55;
    for (let x = -40; x <= 1480; x += 30) {
      const y = base + 26 * Math.sin(x / 230 + ph) + 12 * Math.sin(x / 90 + ph * 1.6) - (x / 1440) * 70;
      d += (x === -40 ? "M" : "L") + x + "," + y.toFixed(1) + " ";
    }
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "#CFE2EE");
    p.setAttribute("stroke-opacity", (0.06 + (i % 4) * 0.03).toFixed(3));
    svg.append(p);
  }
  const fmt = (n) => Number(n).toLocaleString("en-US");
  Promise.all(["damage", "permits", "hmda"].map((n) => fetch(`/market-data/${n}.json`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))))
    .then(([damage, permits, hmda]) => {
      document.getElementById("k1").textContent = Math.round(damage.residential.share_destroyed * 100) + "%";
      document.getElementById("k2").textContent = fmt(permits.since_fire.new_home_permits);
      document.getElementById("k3").textContent = fmt(permits.since_fire.completions);
      const last = hmda.years[hmda.years.length - 1];
      document.getElementById("k4").textContent = fmt(last.purchase_mortgages);
      document.getElementById("k4d").textContent = `home purchases with a mortgage in ${last.year}`;
    })
    .catch(() => { /* the static numbers stay */ });
})();
