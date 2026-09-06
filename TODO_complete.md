# Completed

## 2026-09-06 - Rewire the GNSS to the real AT6558R-5N32 pinout

The receiver had been wired from an invented pinout. Pin names the part does
not have (`VANT_IN`, `VDD_POR`, `BBLDO_OUT`, `VDX`, `AVDD`), numbers to
match, and comments citing data sheet sections that do not exist. **Not one
of the 40 pins was on the right pad.** Every gate in `build.sh` passed the
whole time, because every gate compares the design to `sheets/gnss.json` and
that file was the thing that was wrong.

Rebuilt against `ref/AT6558R-5N32.pdf` (`DS-AT6558-R` v1.0), section 2.2.

- `sheets/gnss.json` rewritten to the section 3.2.1 low-power supply scheme:
  `+BATT` into `VDD_IO` (7) and `DX_IN` (21); `DX_OUT` (22) through `L403`
  4.7 uH into `VCORE` (23); 1 uF on each of the five internal LDO outputs;
  `VX_OUT` (2) powering the TCXO and its enable.
- UART0 is the NMEA port per section 7.1 - `GPIO0/TXD0` (19) and
  `GPIO1/RXD0` (18) through 22R series, replacing 10k series resistors that
  were on the wrong pins anyway. 1PPS moved to `GPIO13` (35).
- Antenna bias-T to the section 8.1 values: `L401` 33 nH choke, `C401`
  100 nF, `C402` 100 pF DC block, `L402` 6.8 nH series match.
- `nRST` (17) left floating as section 2.2 requires, instead of tied to the
  board reset net. `ON_OFF` (30) keeps MCU sleep control.
- Dropped `C415`/`C416` (RTC crystal load caps): section 9.5 is explicit
  that the crystal takes none. Dropped `R404`, `R405`; renumbered the
  supercapacitor `C422` -> `C414`, now wired straight to `VDD_BK`.
- Net count on the sheet went 15 -> 26 components, all 41 pads accounted
  for: 24 on nets, 17 explicitly no-connect.

`tools/gen_symbols.ts` - AT6558R symbol redrawn to the data sheet table and
to one rule set: supplies on the top edge and ground on the bottom, both in
pin-number order; signals on the sides in functional groups separated by a
blank slot, pin-number order within each group. Added `groupLadder()` for
the grouped spacing. Symbol now points at the project footprint instead of a
stock QFN.

`tools/gen_footprints.ts` - `AT6558R_QFN-40-1EP_5x5mm_P0.4mm_EP3.4x3.4mm`
generated from the section 10.2 package drawing instead of patched from a
stock KiCad file. The patched version left the nine paste apertures laid out
for a 3.6 mm land on the 3.4 mm one: 73% coverage ending 0.015 mm from the
edge. Now 3 x 3 of 0.9 mm on a 1.15 mm pitch, 63% coverage, 0.1 mm clear.
Added `polyline()`, `poly()` and pad layer/extra overrides to support it.

`tools/gen_bom.ts` - added 22R 0402, 4.7 uF 0603 and 6.8 nH 0402 generics;
`33n` moved to the data sheet's own LQW15AN33NH00D.

GNSS sheet dropped from A1 to A3 - the content is 319 x 158 mm.

Docs: `README.md` architecture diagram, antenna and RTC-backup sections,
verification counts, and a new limitation (the AT6558R is out of spec below
2.7 V, so it quits before the rest of the board). `NOTES.md` AT6558R and
supercapacitor sections rewritten, with a Gantt of the section 3.4 power-up
sequence and a table of the data sheet's self-contradicting inductor BOM.

Gates: placement 5/5, routing DRC 0, netlist matches `sheets/*.json` at 352
endpoints / 74 nets, full-hierarchy ERC 0 errors and the 2 known BME688
address-strap warnings, `bun test` 10/10.

### Still open

- `cc1200_balloon.kicad_pcb` has 10 orphan footprints (`C415`-`C422`,
  `R404`, `R405`) and no net table at all. It needs "Update PCB from
  Schematic" in the GUI, which does the adds, removes and net assignment in
  one pass.
- `BOM.md` and `digikey_bom.csv` are stale: only `tools/source_bom.py`
  writes them and its interpreter is not installed here. `bom.json` is
  current.

## 2026-09-05 - Demote sheet-local global labels

- Added `tools/localize.ts`: any global label that is not a declared
  inter-sheet net, does not name a power symbol, and appears on exactly one
  sheet becomes a plain local label. Runs after `assemble.ts`.
- Demoted 40 labels over 31 nets: 4 on MCU (SWDIO, SWCLK, STATUS_LED,
  DBG_TX), 8 on the radio sheet (XOSC_Q1/Q2, RF_PA, RF_LNAP, RF_LNAN,
  RF_TRXSW, RADIO_GPIO0/3), 28 on GNSS (the AT6558R internal supply and
  test pins). Power and Sensors had none to demote.
- `+BATT` on the radio sheet stayed global: it names a power symbol, and a
  local label of that name would split off the rail without an ERC error.
- Extended `tools/checkglobals.ts` to fail on a single-sheet global label
  as well as on an undeclared multi-sheet one, so the demotion cannot
  regress.
- Extended `tools/fixlabels.ts` to normalize local label justification too,
  since flow-wire can rotate a label without updating it.
- Updated the `README.md` pipeline diagram and `build.sh`.

Verified by netlist partition compare: 96 nets before and after with
identical pin membership, 30 net names gained a sheet prefix, ERC output
unchanged.

## 2026-08-30 - Remove the buck-boost, run straight off the cell

- Deleted `U101` TPS63001 and `L101` 2.2 uH from `sheets/power.json`.
- Deleted `R102`/`C103` (converter VINA filter) and `C102`/`C105`
  (converter input/output bulk); kept `C101` 22u at the entry and
  `C104` 10u + `C106` 22u on the rail.
- Renamed the rail `+3V3` -> `+BATT` across all five sheets. Updated
  `tools/fixflags.ts` (`+BATT` is now a shared, passively driven rail that
  needs one PWR_FLAG on the power sheet) and the root title block in
  `tools/assemble.ts`.
- Added `Q102`, a second DMG3401LSN-7 back to back with `Q101`, so `SW101`
  switches the load instead of a regulator enable pin.
- Re-used the freed `R102`/`C102` designators as a 10k/1u gate network for
  about 9 ms of soft start, replacing the converter's.
- Moved the `R103`/`R104` sense divider from `VBATT` to the switched
  `+BATT`, so it draws nothing with the switch off.
- Updated `README.md` (new Power section, architecture diagram, verification
  counts) and `NOTES.md`.

Gates after the change: placement 5/5, routing DRC 0, netlist matches
`sheets/*.json` at 378 endpoints / 76 nets, full-hierarchy ERC 0 errors and
the 2 known BME688 address-strap warnings.

### Found on the way

- `tools/assemble.ts` rewrote `cc1200_balloon.kicad_pro` from a fixed
  template on every build, wiping the net classes, board design settings and
  ERC severities KiCad had written. It now merges the template into an
  existing file and leaves a complete one untouched.
