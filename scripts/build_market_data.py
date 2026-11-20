"""Builds Homeward's Pacific Palisades market data from the raw public files.

Reads:  private/raw-data/  (git-ignored; see docs/market-data/SOURCES.md for where each file comes from)
Writes: docs/market-data/*.json  (neighborhood totals only)

Privacy rules (see AGENTS.md):
  - Never write addresses, parcel numbers, permit numbers or single-property coordinates.
  - Grid cells with fewer than MIN_CELL residential structures are dropped.
Needs Python 3 and openpyxl (pip install openpyxl).
Run: python3 scripts/build_market_data.py
"""
import csv, glob, json, os, statistics, collections, datetime
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "private", "raw-data")
OUT = os.path.join(ROOT, "docs", "market-data")
ZIP = "90272"
FIRE_DATE = "2025-01-07"
MIN_CELL = 10
CELL_LAT, CELL_LON = 0.003, 0.0036   # about 330 m x 330 m
# The 7 residential census tracts of Pacific Palisades (from the permit file's CT column).
# 9800.19 is parkland and is left out.
TRACTS = ["2624.00", "2625.01", "2626.01", "2626.04", "2627.04", "2627.06", "2628.02"]
HMDA_TRACTS = {"06037" + t.replace(".", "") for t in TRACTS}
csv.field_size_limit(10**9)
TODAY = datetime.date.today().isoformat()

def raw(pattern):
    hits = sorted(glob.glob(os.path.join(RAW, pattern)))
    if not hits: raise SystemExit(f"Missing raw file: {pattern}")
    return hits

def write(name, obj):
    obj.setdefault("built_on", TODAY)
    with open(os.path.join(OUT, name), "w") as f: json.dump(obj, f, indent=1)
    print("wrote", name)

def mdy(s):  # "11/12/2025 ..." or "2025-11-12..." -> date
    s = (s or "").strip()[:10]
    if not s: return None
    try:
        if "/" in s: m, d, y = s.split()[0].split("/"); return datetime.date(int(y), int(m), int(d))
        return datetime.date.fromisoformat(s)
    except ValueError: return None

def cell(lat, lon):
    try: lat, lon = float(lat), float(lon)
    except (TypeError, ValueError): return None
    if not (33.9 < lat < 34.2 and -118.7 < lon < -118.4): return None
    return (int(lat // CELL_LAT), int(lon // CELL_LON))

# ---------- 1. Permits: new single-family homes and completions ----------
issued, completed = collections.Counter(), collections.Counter()
permit_cells = collections.Counter()
with open(raw("Building_and_Safety_-_Building_Permits_Issued*.csv")[0], newline="") as f:
    for r in csv.DictReader(f):
        if not r["ZIP_CODE"].startswith(ZIP): continue
        if not (r["PERMIT_TYPE"] == "Bldg-New" and r["USE_DESC"] == "Dwelling - Single Family"): continue
        d = mdy(r["ISSUE_DATE"])
        if d: issued[d.strftime("%Y-%m")] += 1
        c = mdy(r["COFO_DATE"])
        if c: completed[c.strftime("%Y-%m")] += 1
        if d and d.isoformat() >= FIRE_DATE:
            k = cell(r["LAT"], r["LON"])
            if k: permit_cells[k] += 1
months = sorted(set(issued) | set(completed))
series = [{"month": m, "new_home_permits": issued[m], "completions": completed[m]} for m in months]
pre = [issued[m] for m in months if "2020-01" <= m <= "2024-12"]
write("permits.json", {
    "title": "Pacific Palisades: new single-family home permits and completions by month",
    "area": "ZIP 90272 (City of Los Angeles)",
    "definition": "Permits of type 'Bldg-New' for 'Dwelling - Single Family'. Completions = certificate of occupancy issued.",
    "pre_fire_monthly_average_2020_2024": round(sum(pre) / len(pre), 1) if pre else None,
    "since_fire": {"new_home_permits": sum(issued[m] for m in months if m >= "2025-01"),
                   "completions": sum(completed[m] for m in months if m >= "2025-01")},
    "months": series,
    "source": "City of Los Angeles, Department of Building and Safety, 'Building Permits Issued from 2020 to Present' (data.lacity.org). Provided as is; may contain errors.",
})

# ---------- 2. Damage (CAL FIRE DINS), totals + block grid ----------
RES = {"Single Residence", "Multiple Residence"}
dmg_all, dmg_res = collections.Counter(), collections.Counter()
cells = collections.defaultdict(lambda: {"res": 0, "destroyed": 0})
with open(raw("POSTFIRE_MASTER_DATA_SHARE*.csv")[0], newline="", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        if r["* Incident Name"].strip() != "Palisades" or not r["Zip Code"].startswith(ZIP): continue
        dmg = r["* Damage"].strip(); dmg_all[dmg] += 1
        if r["Structure Category"] in RES:
            dmg_res[dmg] += 1
            k = cell(r["Latitude"], r["Longitude"])
            if k:
                cells[k]["res"] += 1
                if dmg.startswith("Destroyed"): cells[k]["destroyed"] += 1
res_total = sum(dmg_res.values())
write("damage.json", {
    "title": "Pacific Palisades: structures inspected after the January 2025 Palisades fire",
    "area": "ZIP 90272",
    "residential": {"total": res_total, "by_damage": dict(dmg_res.most_common()),
                    "share_destroyed": round(dmg_res["Destroyed (>50%)"] / res_total, 3) if res_total else None},
    "all_structures": {"total": sum(dmg_all.values()), "by_damage": dict(dmg_all.most_common())},
    "note": "Residential = single and multiple residences. Inspections cover structures inside or near the fire perimeter, not every home in the ZIP code.",
    "source": "CAL FIRE Damage Inspection (DINS) data, licensed CC BY. Credit: CAL FIRE.",
})
grid = []
for (i, j), v in sorted(cells.items()):
    if v["res"] < MIN_CELL: continue
    grid.append({
        "south": round(i * CELL_LAT, 4), "west": round(j * CELL_LON, 4),
        "north": round((i + 1) * CELL_LAT, 4), "east": round((j + 1) * CELL_LON, 4),
        "homes_inspected": v["res"],
        "share_destroyed": round(v["destroyed"] / v["res"], 2),
        "new_home_permits_since_fire": permit_cells.get((i, j), 0),
    })
write("grid.json", {
    "title": "Pacific Palisades recovery by block (about 330 m squares)",
    "privacy": f"Totals per square only. Squares with fewer than {MIN_CELL} inspected homes are left out. No addresses or single properties.",
    "cell_size_degrees": {"lat": CELL_LAT, "lon": CELL_LON},
    "cells": grid,
    "sources": ["CAL FIRE DINS (CC BY)", "City of Los Angeles, LADBS building permits (data.lacity.org)"],
})

# ---------- 3. HMDA: home purchase mortgages and property values ----------
by_year = {}
for fn in raw("actions_taken_1_county_06037_loan_purposes_1*.csv"):
    with open(fn, newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["census_tract"] in HMDA_TRACTS]
    if not rows: continue
    y = rows[0]["activity_year"]
    if y in by_year: continue  # skip duplicate downloads of the same year
    vals = sorted(float(r["property_value"]) for r in rows
                  if r["derived_dwelling_category"].startswith("Single Family")
                  and r["property_value"] not in ("", "NA", "Exempt"))
    q = statistics.quantiles(vals, n=4) if len(vals) >= 4 else [None, None, None]
    by_year[y] = {"year": int(y), "purchase_mortgages": len(rows), "single_family_with_value": len(vals),
                  "median_value": round(statistics.median(vals)) if vals else None,
                  "p25_value": round(q[0]) if q[0] else None, "p75_value": round(q[2]) if q[2] else None}
write("hmda.json", {
    "title": "Pacific Palisades: home purchases with a mortgage, and their property values",
    "area": "7 residential census tracts of Pacific Palisades: " + ", ".join(TRACTS),
    "years": [by_year[y] for y in sorted(by_year)],
    "caveats": ["Cash purchases are not included.",
                "Property values are reported rounded.",
                "The median moves when the mix of homes sold changes; treat it as context, not a price index.",
                "2025 includes sales before the fire on January 7 and sales of homes that survived."],
    "source": "Home Mortgage Disclosure Act (HMDA) public data, FFIEC / CFPB.",
})

# ---------- 4. Insurance (CA Department of Insurance) ----------
ins = {}
# Newest file first, so its numbers win for overlapping years.
for fn in sorted(raw("Residential-*-by-ZIP-*.xlsx"), key=lambda f: f.rsplit("-", 1)[-1], reverse=True):
    ws = openpyxl.load_workbook(fn, read_only=True).active; ws.reset_dimensions()
    hdr = None
    for r in ws.iter_rows(values_only=True):
        if r and r[0] == "County": hdr = [str(h).strip() if h else "" for h in r]; continue
        if hdr and r and str(r[1]).strip() == ZIP:
            rec = dict(zip(hdr, r))
            y = int(rec["Year"])
            nonren = sum(v or 0 for k, v in rec.items() if "Non" in k and "enew" in k)
            ins.setdefault(y, None) or ins.__setitem__(y, {"year": y, "new": rec["New"], "renewed": rec["Renewed"], "non_renewed": nonren})
write("insurance.json", {
    "title": "Pacific Palisades: homeowner insurance policies (voluntary market)",
    "area": "ZIP 90272",
    "years": [ins[y] for y in sorted(ins)],
    "note": "Pre-fire years only (latest published year is 2023). Non-renewed counts both insurer- and policyholder-initiated where reported separately. Excludes the FAIR Plan.",
    "source": "California Department of Insurance, residential policies by ZIP code.",
})

# ---------- 5. LA metro price index (FHFA, quarterly) ----------
ws = openpyxl.load_workbook(raw("hpi_po_metro.xlsx")[0], read_only=True).active; ws.reset_dimensions()
q = [{"year": r[2], "quarter": r[3], "index_sa": r[5]} for r in ws.iter_rows(values_only=True)
     if r and r[0] == 31084 and isinstance(r[2], int) and r[2] >= 2015]
write("la-metro-hpi.json", {
    "title": "Los Angeles area home prices, quarterly (purchase-only index, seasonally adjusted)",
    "area": "Los Angeles-Long Beach-Glendale, CA (metro division 31084)",
    "quarters": q,
    "note": "Mostly homes bought with standard (conforming) mortgages, so it reflects the wider LA market, not the Palisades.",
    "source": "Source: FHFA HPI® (Purchase-Only, seasonally adjusted, nominal).",
})
