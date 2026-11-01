# cc1200-balloon

High altitude balloon payload: a CC1200 434 MHz telemetry downlink, an
AT6558R GNSS receiver and an air quality sensor stack, hosted by a Seeed
Wio-E5 module on a four-layer 50 x 30 mm KiCad board. The board is routed
but not cleared for fabrication: read the verdict table in `BOARD_REVIEW.md`
before ordering. The hand-edited `.kicad_sch` files are the source of truth;
`build.sh` and `sheets/*.json` still describe the 2026-09-06 design, so do
not run `build.sh`: it would overwrite all four sheets with it.

- `mise run erc`: full-hierarchy ERC into `build/erc.rpt`
- `mise run drc`: DRC with zones refilled in memory and schematic parity, into `build/drc.rpt`
- `mise run fields-check`: report the part fields `mise run fields` would change
- `mise run fields`: write `Datasheet`, `MPN` and `Manufacturer` from `tools/parts.json` into the sheets and the board
- `mise run bom`: regenerate `digikey_bom.csv`, `BOM.md` and `bom.json` from the schematic
- `mise run power`: battery budget for the as-built, LDO and switched-domain power options
- `mise run test`: tests for the power budget and the label localizer

`mise tasks` lists the rest. Components: ARCHITECTURE.md. Open items: TODO.md.
