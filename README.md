# cc1200-balloon

High altitude balloon payload: a CC1200 sub-GHz telemetry downlink and an air
quality sensor stack, hosted by a Seeed Wio-E5 module. Four-layer 50 x 30 mm
board, routed. The last full review is in `BOARD_REVIEW.md`; read its verdict
table before ordering boards.

The CC1200 radio and its 434 MHz matching network are carried over from the
v1 design (an import of the Altus Metrum TeleMini netlist). Everything else
is new: the Wio-E5 host, an AT6558R GNSS receiver and the sensor set from
`Forest-Balloon.csv`.

## Architecture

```mermaid
classDiagram
    direction LR

    class WioE5["U201 Wio-E5"] {
        STM32WLE5JC + SX126x
        SPI1 PB3 PB4 PB5
        I2C1 PB6 PB7
        USART2 PA2 PA3
        LPUART1 PC1
        ADC_IN0 PB13
        RFIO to J201 SMA
    }
    class Power["Power"] {
        J101 battery pads 3.6 V max
        Q101 reverse block
        +BATT unregulated
        R103 R104 sense divider
    }
    class Radio["U301 CC1200"] {
        40 MHz X301
        PA and LNA match
        J301 SMA
        SPI + CS + RESET + GPIO2
    }
    class GNSS["U401 AT6558R-5N32"] {
        26 MHz TCXO X401
        32.768 kHz X402
        internal DCDC L403
        active antenna bias-T
        J401 SMA
        UART0 + 1PPS + ON_OFF
    }
    class I2CBus["I2C1 at 100 kHz"] {
        U501 SCD40 CO2 0x62
        U502 AS3935 lightning 0x03
        U503 BME688 0x76
        U504 BME688 0x77
        J501 BMV080 0x54..0x57 by JP1 JP2
    }
    class Antenna["L501 100 uH loop"] {
        C505 910p + C506 47p
        R501 10k damping
        500 kHz resonant
    }

    Power --> WioE5 : +BATT
    Power --> Radio : +BATT
    Power --> GNSS : +BATT
    Power --> I2CBus : +BATT
    Power --> WioE5 : VBAT_SENSE
    WioE5 --> Radio : SPI_SCK MISO MOSI RADIO_CS RST IRQ
    WioE5 --> I2CBus : SCL SDA
    WioE5 --> GNSS : GNSS_TX RX PPS ONOFF
    I2CBus --> WioE5 : LIGHTNING_IRQ PM_IRQ
    Antenna --> I2CBus : INP/INN
```

## Sheets

| Sheet | Contents |
| --- | --- |
| `mcu.kicad_sch` | battery pads, reverse-block P-FET, sense divider, Wio-E5 and decoupling, reset, SWD and console pads, status LED, I2C pull-ups, LoRa SMA, mounting hole |
| `radio.kicad_sch` | CC1200, 40 MHz crystal, per-pin decoupling, loop filter, the v1 TX/RX matching network, SMA |
| `gnss.kicad_sch` | AT6558R-5N32, 26 MHz TCXO, 32.768 kHz RTC crystal, internal DCDC/LDO passives, active-antenna bias-T, SMA |
| `sensors.kicad_sch` | SCD40, AS3935 with its 500 kHz loop antenna, two BME688 at different addresses, BMV080 ZIF connector on I2C with address jumpers |

## Power

There is no regulator and no switch. The cell drives the whole board through
one P-channel FET:

```
J101 -- VBATT_IN -- Q101 (reverse block) -- +BATT -- everything
```

`Q101` blocks a reversed cell: its source is on the load side, so the body
diode conducts battery to load and the channel shorts it out. The rail is
the cell minus one Rds(on) and follows the cell from full charge to cutoff.
`R103`/`R104` (100k/100k) put half of it on `PB13` for the ADC.

| | |
| --- | --- |
| Rail | `+BATT`, unregulated, 3.6 V maximum |
| Bulk on the rail | `C202` 4.7 uF, `C404` 4.7 uF, 1 uF at each IC |
| Off-state drain | none possible: the board is live whenever the cell is connected |

The load switch, soft start, input TVS and 22 uF bulk capacitors that the
earlier design carried were removed in the GUI; `BOARD_REVIEW.md` items 3
and 4 cover what that costs. Every supply window on this rail is tabulated
in section 4 of the review; the BMV080 and the TCXO are the tight ones.

## Wio-E5 pin map

| Pin | Net | Function |
| --- | --- | --- |
| 8 PB3 | `SPI_SCK` | SPI1 clock to the CC1200 |
| 7 PB4 | `SPI_MISO` | SPI1 MISO |
| 11 PB5 | `SPI_MOSI` | SPI1 MOSI |
| 26 PB14 | `RADIO_CS` | CC1200 chip select |
| 5 PB15 | `RADIO_RST` | CC1200 reset |
| 20 PB10 | `RADIO_IRQ` | CC1200 GPIO2 |
| 6 PA15 | `PM_CS` | unused (BMV080 moved to I2C); label is dangling |
| 25 PB9 | `PM_IRQ` | BMV080 interrupt, open drain active low |
| 10 PB6 | `SCL` | I2C1 clock |
| 9 PB7 | `SDA` | I2C1 data |
| 23 PA0 | `LIGHTNING_IRQ` | AS3935 interrupt (wake-capable) |
| 19 PA2 | `GNSS_RX` | USART2 TX to the receiver, through 22R |
| 18 PA3 | `GNSS_TX` | USART2 RX from the receiver, through 22R |
| 27 PA10 | `GNSS_PPS` | 1PPS |
| 13 PC0 | `GNSS_ONOFF` | receiver sleep control |
| 12 PC1 | `DBG_TX` | LPUART1 console out, on the debug pads |
| 24 PB13 | `BATT_VSENSE` | ADC_IN0, 1:2 divider off `+BATT`; also the module's boot pin |
| 21 PA9 | `STATUS_LED` | green LED through 1 k |
| 15 RFIO | `LORA_RF` | `J201`, the module's own sub-GHz radio |

CC1200 GPIO0 and GPIO3 go to test pads `TP301`/`TP302`. GNSS SWD is on
`TP401`/`TP402`.

## Interfaces

| Ref | Part | Carries |
| --- | --- | --- |
| `J101` | two 2 x 4 mm solder pads, 3 mm pitch, back side | battery leads |
| `J202` | six 1.27 mm solder pads, back side | `+BATT` GND SWDIO SWCLK NRST DBG_TX |
| `J201` `J301` `J401` | Samtec SMA-J-P-H-ST-EM1 edge launch | LoRa, CC1200 and GNSS antennas |
| `J501` | Kyocera 6844 0.30 mm 13-way ZIF | BMV080 flex; the sensor lies along the bottom edge |
| `JP1` `JP2` | 3-pad solder jumpers | BMV080 I2C address bits; open by default, which the sensor does not allow |

The GNSS port expects an active antenna (18 to 35 dB): `L401`/`C401` bias
it from `ANT_BIAS`, `C402` blocks the DC, `L402` is the series match. The
BOM names an Abracon AANI-AP-0158-1 patch with a 100 mm pigtail.

## Parts, data sheets and BOM

Every bought symbol carries `Datasheet`, `MPN` and `Manufacturer` fields,
mirrored onto the board's footprints. The sourcing table is
`tools/parts.json`; it maps each MPN to its manufacturer, data sheet,
DigiKey cut-tape number, price and stock as last read.

```sh
python3 tools/set_part_fields.py --check   # report what would change
python3 tools/set_part_fields.py           # write fields into *.kicad_sch and the .kicad_pcb
python3 tools/gen_digikey_bom.py           # digikey_bom.csv, BOM.md, bom.json
```

Generic passives resolve by value and land pattern; named parts by their
MPN field. A part missing from the table stops the tool with its
reference.

## The generator is stale

`sheets/*.json`, `build.sh` and the TypeScript tools describe the design as
it stood on 2026-09-06 (separate power sheet with a load switch, BMV080 on
SPI, solder-pad antennas). The schematics were hand-edited after that and
the board was routed against them. **Do not run `build.sh`**: it would
overwrite all four sheets with the old design. The `.kicad_sch` files are
the source of truth.

## Verification

| Check | Result on 2026-09-15 |
| --- | --- |
| full-hierarchy ERC | 0 errors, 3 warnings (dangling `PM_CS`, two jumper symbols differ from the library) |
| DRC with zones refilled | 6 errors: 4 starved thermals on radio GND pads, 2 courtyard overlaps at `J401` |
| schematic parity | 3 extra footprints: `H102`-`H104` |
| pinouts vs data sheets | Wio-E5, CC1200, AT6558R, AS3935, BME688, SCD40, BMV080: all match |
| netlist after the field patch | identical to before |

## Ordering

`digikey_bom.csv` holds one board's worth: 48 lines, three columns, every
line cut tape, bulk or box. Upload it to DigiKey's BOM Manager and set the
multiplier there. The AT6558R is not stocked at DigiKey (LCSC C500608).
Board total is about $124, of which $45 is the BMV080 module and the GNSS
antenna. Substitutions and stock risks are listed in `BOM.md`.

## Known limitations

- **The rail is unregulated and can touch 3.6 V**, the absolute maximum
  operating supply of the Wio-E5 and the CC1200. Confirm the cell's
  open-circuit voltage before connecting it.
- **No brownout floor.** RF output power, the ADC reference and sensor
  readings drift with the cell. `BATT_VSENSE` makes the drift observable.
- **The GNSS stops first.** `VDD_IO` and `DX_IN` are specified from 2.7 V;
  the TCXO from 3.1 V. Budget the flight on that, not on the cell's cutoff.
- **The BMV080 wants 3.3 V +-5 % on its laser supply.** On this rail it is
  in window only between 3.135 and 3.465 V.
- **GNSS altitude limit.** The AT6558R data sheet says nothing about COCOM
  limits; confirm behaviour above 18 km before flying.
- **SCD40 in a balloon.** Specified from -10 C and pressure dependent;
  compensate from the BME688 pressure channel.
- **No thermal design, no antenna measurements.** The match values are
  TeleMini's; sweep them on this board.
