# CEDARS BOM Import Spec — for building the importer

> Supplied by Anindo on 2026-08-04 and saved here verbatim, because the real CEDARS
> exports are restricted customer files that cannot come onto this machine. That makes
> this document the **only** source of truth for those files' structure — the importer
> (`frontend/src/lib/importCedarsBom.js`) and its synthetic fixtures are both written
> against it. If a real import ever misbehaves in the sanctioned environment, suspect
> this spec has drifted from the files rather than assuming the fixtures were wrong.

---

## 0. TWO FORMAT VARIANTS — handle both

The exports come in two shapes. The importer must detect and handle each:

- **Variant A (Goodman):** ONE combined sheet named **`CostWeights`** holding every BOM part.
- **Variant B (Trane, Carrier, Bosch):** SEPARATE commodity sheets (Steel, Tubing, Evaporator Coil, etc.), one sheet per commodity.

Detect by sheet presence: if a `CostWeights` sheet exists → Variant A; else → Variant B.

---

## 1. UNIVERSAL FILE QUIRKS (apply to every sheet)

1. **Row layout:** Row 0 = column headers. **Row 1 = a UNITS row** (values in parentheses like `(LBs)`, `(In)`, `($)`, `(EA)`). Real data starts at **Row 2**. → Skip the units row.
2. **First two columns are always:** `Id` (numeric), `Component Name` (text). Every data row has a numeric `Id`.
3. **`Component Name` carries the commodity/part label**, e.g.
   `"Steel - Sheetmetal 1"`, `"Tubing - 3/8 Diameter"`, `"BOM Weight - Sheetmetal - 22"`, `"Electrical Components - Blower Motor 1"`.
4. **THOUSANDS of empty/placeholder rows** — especially in `Labor` and `Fasteners` (e.g. `Sub-Assembly 40` with all NA/0). → **SKIP any row where Cost Material AND LBS AND Quantity are all empty/0/NA.** Only import rows with real data.
5. **Numbers may be scientific notation** (e.g. `3.1225739E-2`) → parse as floats.
6. **Values can be `NA`, blank, or `0`** → treat all as null.
7. **⚠️ MISSPELLED SHEET NAMES (match exactly):** `Electrical Componenets` (Trane), `Miscellanious` (some files). Match both correct and misspelled spellings.

---

## 2. SHEET → MODULE + GEOMETRY MAPPING

For each commodity sheet, map to an AHU module and a geometryType:

| Sheet name(s) | → Module | → geometryType | commodity tag |
|---|---|---|---|
| `Steel` / `Sheetmetal` | Cabinet/Enclosure | sheet_metal | Steel |
| `Tubing` | Coil Assembly | circular | Tubing |
| `Evaporator Coil` | Coil Assembly | circular | Coil |
| `Electrical Components` / `Electrical Componenets` | Blower Electrical | custom | Electrical |
| `Wire` | Blower Electrical | custom | Wire |
| `Fasteners` | Cabinet/Enclosure | custom | Fasteners |
| `InsulationTape` / `Insulation/Tape` | Cabinet/Enclosure | custom | Insulation |
| `Packaging` | Packaging | custom | Packaging |
| `LabelsLiterature` / `Labels/Literature` | Packaging | custom | Labels |
| `Miscellanious` / `Miscellaneous` | Cabinet/Enclosure | custom | Misc |
| `Labor` | **NOT a module** — import as a separate Labor cost line, or skip | — | Labor |

**Also store the commodity tag on each part** (so we can pivot by commodity later, not just module).

For **Variant A (Goodman CostWeights)**: the `Component Name` prefix indicates commodity — e.g. `"BOM Weight - Sheetmetal - 3"` → Steel/sheet_metal, `"BOM Weight - Tubing"` → Tubing/circular, `"BOM Weight - Electrical Components"` → Electrical. Parse the prefix to assign module/geometry the same way.

---

## 3. COLUMN MAPPING → your Part model

Map source columns to the Part fields (all nullable). Column names vary slightly per sheet; match case-insensitively and by best-fit:

| Source column(s) | → Part field |
|---|---|
| `Component Name` | name (strip the commodity prefix for a clean part name) |
| `Part Description` | description / partNo note |
| `Cost Material` OR `Cost Per part` | ratePerUnit (unit cost) |
| `Total Cost` | extendedCost |
| `Quantity` | quantity |
| `LBS` | weightG *(NOTE: source is in **LBS** — see §5 units)* |
| `Total Lbs` | extendedWeight |
| `Length` | lengthMm *(source in **inches** — see §5)* |
| `Width` | widthMm |
| `Thickness` / `Thickness Steel` | thicknessMm |
| `Diameter` | diameterOuterMm |
| `Wall Thickness` | (store as diameterInnerMm proxy or a wallThickness field) |
| `Material` | material |
| `Exterior Finish` | surfaceFinish |
| `Interior Finish` | (secondary finish note) |
| `FPI` | (coil fins-per-inch — extra attr) |
| `Wire Gauge` | (AWG — extra attr) |
| `Scrap rate` | (extra attr, sheet-metal only) |
| `Picture` | imageUrl (often a cedars URL) |

---

## 4. PER-SHEET COLUMN HEADERS (exact, from the real files)

### Variant A — Goodman `CostWeights`
```
Id | Component Name | Part Description | Cost Material | Quantity | LBS |
Diameter | Length | Width | Thickness | Lbs/In Aluminum | Exterior Finish |
Interior Finish | FPI | Measured hairpin Length | Top Coat $/Lbs | Thickness Steel |
Totals Fins | Total Cost | Total Lbs | LBs* | Scrap rate | Total Cost*
```

### Variant B commodity sheets:

**Steel**
```
Id | Component Name | Part Description | Exterior Finish | Interior Finish | LBS |
Thickness | Length | Width | Quantity | Picture | Top Coat $/Lbs | Thickness Steel |
Cost Material | Cost Per part | ft-sq Sheet metal | Lbs Steel | Top Coat Cost |
Top Coat Lbs | Total Cost | Total Lbs | Scrap rate | Total Cost*
```

**Tubing**
```
Id | Component Name | Part Description | Cost Material | LBS | Diameter |
Lbs/In Copper | Lbs/In Aluminum | Length | Material | Quantity | Wall Thickness |
Total Lbs | Cost Per part | Total Cost
```

**Evaporator Coil**
```
Id | Component Name | Part Description | Cost Material | Length | Width | Thickness |
LBS | Material | Quantity | Diameter | Lbs/In Aluminum | Lbs/In Copper | Wall Thickness |
Thickness Steel | Total Lbs | Length Hairpin | FPI | Measured hairpin Length |
Cost Per part | Total Cost | Totals Fins | Scrap rate | Total Cost* | LBs*
```

**Electrical Components** (sheet may be misspelled `Electrical Componenets`)
```
Id | Component Name | Part Description | Cost Material | LBS | Quantity |
Cost Per part | Total Lbs | Total Cost
```

**Wire**
```
Id | Component Name | Part Description | Cost Material | LBS | Quantity | Length |
Material | Wire Gauge | Wall Thickness | Total Lbs | Cost Per part | Total Cost
```

**Fasteners**
```
Id | Component Name | Part Description | Cost Material | LBS | Quantity |
Total Lbs | Cost Per part | Total Cost
```

**InsulationTape**
```
Id | Component Name | Part Description | Cost Material | Length | Width | Thickness |
LBS | Quantity | Total Lbs | Cost Per part | Total Cost | Total Sq-Ft Insulation
```

**Packaging**
```
Id | Component Name | Part Description | Cost Material | LBS | Length | Width |
Thickness | Quantity | Wall Thickness | Total Lbs | Cost Per part | Total Cost
```

**Miscellanious** (misspelled) / Miscellaneous
```
Id | Component Name | Part Description | Cost Material | LBS | Quantity | Diameter |
Length | Width | Wall Thickness | Total Lbs | Cost Per part | Total Cost | Refrigerant
```

**LabelsLiterature**
```
Id | Component Name | Part Description | Cost Material | Length | Width | Quantity |
LBS | Total Lbs | Total Cost
```

**Labor** (import as separate cost line, NOT a module)
```
Id | Component Name | Part Description | Special Notes | Time Labor | Time Machine |
Labor Time | Total Main Support
```

### Product-level sheets (one row of unit info each — use for the product record)

**Physical Data**
```
Id | Component Name | Depth | Width | Height | Unit Weight | Shipping Weight |
Cost Per Load | Cost Per Unit | Trailer Size | Units Per Trailer | Model
```

**Key Features** (many cols; grab the useful ones)
```
Brand | Make | Type | Model | Serial | System Tonnage | Coil Type Evaporator |
Fins Per Inch Evaporator | Blower Motor | SEER2 | ... (many more)
```

**Performance**
```
Cooling Capacity (BTUh) | Outdoor Unit | AHRI # | SEER2 | EER2 |
Heating Capacity @47F | HSPF2
```

**Striking Differences** ⭐ (the side-by-side photo/feature comparison)
```
Id | Component Name | Picture 1 | Feature Set 1 | Picture 2 | Feature Set 2 | ...
```
→ Picture/Feature-Set pairs: a photo URL + a text note describing the design choice
(e.g. "Factory installed plastic breaker cover"). This is the data source for the
apple-to-apple design comparison.

---

## 5. UNIT CONVERSION (important)

Source files are **imperial**; your app stores metric-named fields:
- **LBS → grams:** multiply by 453.592 (or keep a `weightLbs` field and display both — Jeff wants BOTH lbs and kg)
- **Inches → mm:** multiply by 25.4 (some coil/tubing values are already in mm — check the units row)
- **Cost is `$` (USD)** → no conversion.

Recommendation: **store the raw imperial value AND a converted metric value**, since Jeff explicitly captures/looks at both inches+mm and lbs+kg.

---

## 6. WHAT TO BUILD

1. An **`importCedarsBom(file)`** function: detect variant → iterate the commodity sheets (or the CostWeights sheet) → skip units row + empty rows → map columns → create a Product with parts assigned to modules + geometryType + commodity tag.
2. An **"Import BOM"** upload button on the products/home page.
3. **Verify against a SYNTHETIC sample file** you generate matching this exact structure (right sheet names incl. the misspellings, right headers, a units row, ~5–8 real-looking parts across Steel/Tubing/Electrical/Coil, plus a few empty placeholder rows to prove the skip-logic works).
4. Confirm: parts land in the right modules, empty rows are skipped, cost/weight totals roll up per module, commodity tag preserved. Then commit.

---

## 7. DEMO NOTE

For a clean demo, cap the import at parts with real cost/weight data (the files have
150+ rows but many are empty). A curated ~20–40 real parts per product reads better
on stage than dumping every placeholder row. Keep the module rollup (cost by
Packaging / Enclosure / Coil / Blower) front and center — that's Jeff's exact analysis view.
