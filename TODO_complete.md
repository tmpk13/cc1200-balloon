# Completed

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
