"""Estimate when Pacific Palisades rebuilds will be finished, from City of LA permits.

Reads the raw LADBS permit file in private/raw-data/ and writes one public file:
docs/market-data/rebuild-timing.json

Privacy: the output holds only neighborhood totals and fitted curves (each built from
hundreds of permits). Never write addresses, parcel numbers, permit numbers or dates
for a single property.

Method (plain version):
  1. "Finished" means the City issued a certificate of occupancy (COFO_DATE).
  2. For each new single-family permit issued since the fire, we know either how long it
     took to finish, or that it has been open N days so far. Counting both (survival
     analysis) avoids the bias of averaging only the homes that already finished.
  3. We fit a log-normal curve to those times (by home size), the "post-fire pace".
     A second curve from Palisades permits issued 2020-2024 is the "pre-fire pace".
  4. Each open permit is projected from where it is now, and the totals are added up.

Standard library only:  python3 scripts/build_rebuild_timing.py
"""
import csv, glob, json, math, os, statistics, collections, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "private", "raw-data")
OUT = os.path.join(ROOT, "docs", "market-data", "rebuild-timing.json")
FIRE = datetime.date(2025, 1, 7)
ZIP = "90272"
PROJECT_TO = (2028, 12)
SIZES = [("small", "Under 3,000 sq ft", 0, 3000), ("medium", "3,000–4,500 sq ft", 3000, 4500), ("large", "Over 4,500 sq ft", 4500, 10**9)]
MIN_AT_RISK = 30  # don't publish an observed point resting on fewer permits than this

csv.field_size_limit(10**9)


def day(s):
    s = (s or "").strip()[:10]
    if not s: return None
    try:
        if "/" in s:
            m, d, y = s.split()[0].split("/")
            return datetime.date(int(y), int(m), int(d))
        return datetime.date.fromisoformat(s)
    except ValueError:
        return None


def phi(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def loglik(obs, mu, sg):
    total = 0.0
    for t, done in obs:
        t = max(t, 1)
        z = (math.log(t) - mu) / sg
        if done: total += -math.log(t * sg * math.sqrt(2 * math.pi)) - z * z / 2
        else: total += math.log(max(1e-12, 1 - phi(z)))
    return total


def fit(obs):
    """Maximum-likelihood log-normal fit with unfinished permits counted as 'not yet'."""
    best = None
    for med in range(200, 2400, 25):
        for sg in [x / 100 for x in range(10, 120, 4)]:
            v = loglik(obs, math.log(med), sg)
            if best is None or v > best[0]: best = (v, med, sg)
    _, med0, sg0 = best
    for med in range(max(100, med0 - 30), med0 + 31, 2):
        for sg in [x / 1000 for x in range(max(50, int(sg0 * 1000) - 40), int(sg0 * 1000) + 41, 5)]:
            v = loglik(obs, math.log(med), sg)
            if v > best[0]: best = (v, med, sg)
    return {"median_days": best[1], "sigma": round(best[2], 3)}


def surv(t, f):
    return 1 - phi((math.log(max(t, 1)) - math.log(f["median_days"])) / f["sigma"])


def kaplan_meier(obs, months):
    times = sorted({t for t, d in obs if d})
    s, curve = 1.0, []
    for t in times:
        n = sum(1 for u, _ in obs if u >= t)
        d = sum(1 for u, e in obs if u == t and e)
        s *= 1 - d / n
        curve.append((t, s))
    out = []
    for m in months:
        t = m * 30.44
        at_risk = sum(1 for u, _ in obs if u >= t)
        if at_risk < MIN_AT_RISK: break
        s_t = ([v for u, v in curve if u <= t] or [1.0])[-1]
        out.append({"months_after_permit": m, "share_finished": round(1 - s_t, 3), "permits_still_counted": at_risk})
    return out


def month_end(y, m):
    nxt = datetime.date(y + (m == 12), m % 12 + 1, 1)
    return nxt - datetime.timedelta(days=1)


def main():
    path = glob.glob(os.path.join(RAW, "Building_and_Safety_-_Building_Permits_Issued*.csv"))[0]
    homes, refresh = [], collections.Counter()
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            if not r["ZIP_CODE"].startswith(ZIP): continue
            if not (r["PERMIT_TYPE"] == "Bldg-New" and r["USE_DESC"] == "Dwelling - Single Family"): continue
            iss = day(r["ISSUE_DATE"])
            if not iss: continue
            try: sqft = float(r["SQUARE_FOOTAGE"] or 0)
            except ValueError: sqft = 0
            homes.append({"sub": day(r["SUBMITTED_DATE"]), "iss": iss, "cofo": day(r["COFO_DATE"]), "sqft": sqft})
            refresh[(r["REFRESH_TIME"] or "")[:10]] += 1
    data_date = day(refresh.most_common(1)[0][0]) or datetime.date.today()

    def obs(h):
        if h["cofo"] and h["cofo"] >= h["iss"]: return ((h["cofo"] - h["iss"]).days, True)
        return ((data_date - h["iss"]).days, False)

    post = [h for h in homes if h["iss"] >= FIRE]
    pre = [h for h in homes if datetime.date(2020, 1, 1) <= h["iss"] < datetime.date(2025, 1, 1)]
    post_obs = [obs(h) for h in post]

    def size_of(h):
        for key, _, lo, hi in SIZES:
            if lo <= h["sqft"] < hi and h["sqft"] > 0: return key
        return None

    faster = {"basis": "Palisades rebuild permits issued since the fire", "all": dict(fit(post_obs), permits=len(post), finished=sum(1 for _, d in post_obs if d))}
    faster["by_size"] = {}
    for key, label, _, _ in SIZES:
        group = [h for h in post if size_of(h) == key]
        g = [obs(h) for h in group]
        faster["by_size"][key] = dict(fit(g), label=label, permits=len(group), finished=sum(1 for _, d in g if d))
    pre_obs = [obs(h) for h in pre]
    slower = dict(fit(pre_obs), basis="Palisades new homes permitted 2020–2024, before the fire", permits=len(pre), finished=sum(1 for _, d in pre_obs if d))

    # Finished so far, by month (post-fire permits only).
    finished_by_month = collections.Counter(h["cofo"].strftime("%Y-%m") for h in post if h["cofo"])
    months, y, m = [], 2025, 1
    while (y, m) <= PROJECT_TO:
        months.append((y, m)); y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    data_month = data_date.strftime("%Y-%m")
    finished_now = sum(1 for _, d in post_obs if d)
    open_permits = [(h, (data_date - h["iss"]).days) for h in post if not h["cofo"]]

    series, running = [], 0
    for (yy, mm) in months:
        key = f"{yy}-{mm:02d}"
        row = {"month": key}
        if key <= data_month:
            running += finished_by_month[key]
            row["finished"] = running
        if key >= data_month:
            horizon = max(0, (month_end(yy, mm) - data_date).days)
            fast = slow = 0.0
            for h, age in open_permits:
                ff = faster["by_size"].get(size_of(h)) or faster["all"]
                s0 = surv(age, ff); fast += (s0 - surv(age + horizon, ff)) / s0 if s0 > 0 else 1
                s1 = surv(age, slower); slow += (s1 - surv(age + horizon, slower)) / s1 if s1 > 0 else 1
            row["faster"] = round(finished_now + fast)
            row["slower"] = round(finished_now + slow)
        series.append(row)

    wait = [(h["iss"] - h["sub"]).days for h in post if h["sub"] and h["sub"] <= h["iss"]]
    out = {
        "title": "Pacific Palisades: when rebuilt homes are likely to be finished",
        "area": "ZIP 90272 (City of Los Angeles)",
        "data_date": data_date.isoformat(),
        "built_on": datetime.date.today().isoformat(),
        "definition": "New single-family home permits ('Bldg-New', 'Dwelling - Single Family'). Finished = certificate of occupancy issued.",
        "since_fire": {"permits": len(post), "finished": finished_now},
        "plans_to_permit_median_days": round(statistics.median(wait)) if wait else None,
        "faster": faster,
        "slower": slower,
        "observed": kaplan_meier(post_obs, range(3, 37)),
        "months": series,
        "method": [
            "Times from permit to certificate of occupancy, counting permits still open as 'not finished yet' (survival analysis), fitted with a log-normal curve.",
            "Faster case: the pace of rebuild permits issued since the fire, fitted separately by home size.",
            "Slower case: how long Palisades new homes permitted in 2020–2024 took. About a third of those had no certificate after four years.",
            "Each open permit is projected from how long it has been open, then the results are added up.",
        ],
        "caveats": [
            "A permit doesn't mean construction has started, and some permitted homes may never be built.",
            "Only the earliest rebuild permits have had time to finish, so times beyond about a year and a half after the permit are extrapolated.",
            "A certificate of occupancy is the City's sign-off. Moving in can come later.",
        ],
        "privacy": "Neighborhood totals and curves fitted from hundreds of permits. No addresses, parcels, permit numbers or single homes.",
        "sources": ["City of Los Angeles, LADBS building permits (data.lacity.org), provided as is"],
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print("wrote", OUT)
    print("faster", faster["all"], {k: (v["median_days"], v["sigma"], v["permits"]) for k, v in faster["by_size"].items()})
    print("slower", {k: slower[k] for k in ("median_days", "sigma", "permits", "finished")})
    for r in series:
        if r["month"][5:] in ("06", "12") or r["month"] == data_month: print(r)


if __name__ == "__main__":
    main()
