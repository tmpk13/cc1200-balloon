# Completed

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
