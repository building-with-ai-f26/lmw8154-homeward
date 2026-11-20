# Market data sources (Pacific Palisades only)

Built by `scripts/build_market_data.py` from raw files kept in `private/raw-data/` (git-ignored).
Only neighborhood totals are published here: no addresses, parcel numbers, permit numbers or single-property locations.
Grid squares with fewer than 10 inspected homes are left out.

| File | Source | Terms |
|---|---|---|
| permits.json, grid.json | City of Los Angeles, Department of Building and Safety, "Building Permits Issued from 2020 to Present" (data.lacity.org) | Public open data, provided "as is" (disclaimer.lacity.gov). |
| damage.json, grid.json | CAL FIRE Damage Inspection (DINS) data | CC BY. Credit: CAL FIRE. |
| hmda.json | Home Mortgage Disclosure Act public data, FFIEC / CFPB (ffiec.cfpb.gov/data-browser) | Public data. |
| insurance.json | California Department of Insurance, residential policies by ZIP code (insurance.ca.gov) | State website content is public domain unless noted. |
| la-metro-hpi.json | FHFA House Price Index, purchase-only, metro division 31084 | Free to use. Cite "Source: FHFA HPI®". |

Not used: FHFA ZIP-level index (no Pacific Palisades values after 2021), Zillow and Redfin (reuse terms unclear).
