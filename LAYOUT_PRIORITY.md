# CC1200 layout: what to keep short, in priority order

Companion to `SCHEMATIC_REVIEW.md`. Measured against the working tree on top of
`d4266bb`, with `U301` at `66.15, 138.95` rotated -90 deg.

**Context.** All 41 radio-block parts are currently staged outside the board
outline (the outline is 50 x 30 mm at x 75..125, y 85..115). The relative
placement inside the block is already largely right — the nine supply caps ring
the package at 1.2-2.0 mm and the match chain's internal hops are 1.0-1.6 mm.
What follows is the order to preserve when the block is brought onto the board.

## The number that sets the ranking

A narrow trace over a plane runs about **0.8 nH/mm**, and a via adds about
0.4 nH. At 434 MHz that is **~2.2 ohm of series reactance per millimetre**.

The same millimetre costs different amounts depending on what it is in series
with, which is the whole basis of the ranking below:

- **In a decoupling path** it lowers the capacitor's self-resonant frequency.
  A 47n 0402 has ~0.7 nH of its own ESL and resonates near 28 MHz. Add 2 mm of
  trace and a via — 2.0 nH — and it resonates near 14 MHz instead. The cap is
  half as effective at exactly the frequencies the chip's internal regulators
  care about, and the schematic looks identical.
- **In the match network** it is an unplanned series element. `C322` is 2.2 pF
  and `L302` is 15 nH; a stray 4 nH between them is a 27 % error in the
  inductor.
- **On the 40 MHz reference** it is mostly stray capacitance pulling frequency,
  and a crosstalk aperture. Reference phase noise multiplies to the carrier by
  20*log10(434/40) = **+20.7 dB**.
- **On SPI at 10 MHz** it costs nothing measurable.

---

## The ranking

| # | Keep short | Target | Now | Status |
| --- | --- | --- | --- | --- |
| 1 | `GND_EP` (33) down to the ground planes | via array in the pad | **0 vias** | **do first** |
| 2 | `C314` 10n to pin 21 `DCPL_VCO` | <=1.0 mm | 1.23 mm | close |
| 3 | `C316` 47n to pin 29 `DCPL_XOSC` | <=1.0 mm | 2.10 mm | tighten |
| 4 | `C315` 47n to pin 26 `DCPL_PFD_CHP` | <=1.0 mm | 3.09 mm | tighten |
| 5 | `C313` 220n to pin 6 `DCPL` | <=1.5 mm | 2.63 mm | tighten |
| 6 | `L301` 56n to pin 17 `PA` | <=1.5 mm | 6.22 mm | **worst in TX** |
| 7 | `C325`/`L306`/`L307`/`C326`/`L308` to pins 19/20, **P and N matched** | <=2.0 mm, legs within 0.3 mm | 1.8-6.0 mm, unbalanced | **worst in RX** |
| 8 | `C323` 5p1 to pin 18 `TRX_SW` | <=1.5 mm | 6.62 mm | tighten |
| 9 | `X301` + `C318`/`C319` to pins 30/31 | xtal <=2.5 mm, caps between | 4.0-5.5 mm | tighten |
| 10 | `R301` 56k to pin 14 `RBIAS` | <=2.0 mm | 3.31 mm | tighten |
| 11 | `C317` 1n8 across pins 23/24 `LPF0`/`LPF1` | <=1.5 mm | 1.4-1.6 mm | ok |
| 12 | Analog rail caps: pins 15, 28, 22, 27, 25, 13 | <=1.5 mm | 1.33-1.81 mm | ok, see note |
| 13 | Digital rail caps: pins 5, 12, 1 | <=2.0 mm | 1.21-1.79 mm | ok |
| 14 | Match chain internal hops, in schematic order | <=2.0 mm each | 1.0-1.6 mm | ok |
| 15 | `C310` 100p, rail | <=3 mm, near pin 15 | 7.64 mm | bring in |
| 16 | `C311` 10n / `C312` 1u, rail bulk | <=8 mm | 6.6 / 5.5 mm | ok |
| 17 | `L304` to `J301`, the only 50-ohm section | impedance, not length | 3.22 mm | see note |
| 18 | SPI (7,8,9,11), `RESET_N` (2), GPIO (3,4,10), test points | no constraint | — | route last |

---

## Why each tier sits where it does

### 1. The exposed pad, before anything else

`GND_EP` is the return path for every current in the chip, so it defines what
"short" even means for the seventeen items below it. Until it is solid,
tightening a decoupling cap buys less than the measurement suggests: the cap's
ground has to travel laterally around the package to find a via, and that path
is in series with the cap.

The pad is set up correctly in the footprint — 3.45 mm, `pad_prop_heatsink`,
`zone_connect 2`, on the `GND` net — and the `GND` zone is poured on all four
layers. But there are **4 vias on the entire board** and none of them are in
the pad, so the pad currently only reaches the `F.Cu` pour. Put a via array in
it (a 3x3 of 0.3 mm drill on ~1.2 mm pitch fits the 3.45 mm pad) and add a ring
of ground vias just outside the pin ring, tightest along the RF edge.

This is also the item with the shortest length that matters: the ~1.5 mm of
via barrel from the pad to `In1.Cu`.

### 2-5. The four `DCPL` pins

These are **not** rail decoupling. They are the outputs of regulators inside
the chip, and their capacitors are those regulators' compensation. Series
inductance here does not just filter worse, it moves a pole in a control loop
that was compensated assuming a low-impedance capacitor.

They rank above the RF path because they sit upstream of it — the VCO
regulator's noise is on the carrier before the carrier ever reaches pin 17.
Within the four:

- **`DCPL_VCO` (21)** — the VCO supply. Straight to phase noise and spurs.
- **`DCPL_XOSC` (29)** — the reference oscillator's supply, and whatever lands
  here gets the +20.7 dB multiplication to 434 MHz.
- **`DCPL_PFD_CHP` (26)** — inside the PLL loop, so in-band.
- **`DCPL` (6)** — digital core. Least sensitive of the four, but still a
  regulator output.

`C314` is already at 1.23 mm; the other three drifted when the block was
rearranged. Note `DCPL_VCO` (21) sits on the bottom edge wedged between the LNA
pins and `AVDD_SYNTH1` — it is the crowded one, so place it before its
neighbours rather than after.

### 6-8. The RF pins

`L301` at pin 17 is the first element of the TX match and carries both the DC
supply and the full RF output. 6.22 mm of trace is ~5 nH against a 56 nH
element — a 9 % error in the value that sets the PA's load impedance, which
comes straight off output power and efficiency. Since the stated job of this
board is a telemetry **downlink**, that is the millimetre that costs the most
link budget, which is why it ranks above the LNA.

The LNA pair at 7 has two separate requirements and the second is easy to miss:

- **Short**, because loss ahead of the LNA adds to noise figure dB for dB.
- **Balanced**, because the LNA is differential. `L306` 56n bridges pins 19 and
  20 and should straddle them symmetrically; `L307`/`C325` on the P leg and
  `L308`/`C326` on the N leg should mirror each other. Right now the P leg
  averages 4.22 mm and the N leg 4.66 mm with individual parts from 1.8 to
  6.0 mm, so the two legs are visibly unequal. Imbalance converts common-mode
  noise into differential signal and degrades image rejection, and no amount of
  tuning the values fixes it.

If uplink or commanding matters as much as the downlink, swap 6 and 7.

`C323` at pin 18 carries full TX power through the switch node in transmit.
`L305` is already fine at 2.05 mm; `C323` is the one at 6.62 mm.

### 9-10. The high-impedance nodes

The 40 MHz crystal group is now the worst-placed sensitive cluster —
`X301` 5.46 mm, `C318` 4.13 mm, `C319` 3.96 mm. Two things go wrong at that
distance: stray capacitance adds to a 12 pF load and pulls the frequency, and
a long high-Q node is both a crosstalk victim and an aggressor. Put the load
caps *between* the crystal and the pins, not beyond the crystal, and return
their grounds into the same via region as the exposed pad. The load caps are
also worth re-checking against the crystal's CL — see section 4 of the review.

`R301` is 56k, which makes `RBIAS` the highest-impedance node on the part and
the best antenna on the board. It sets every internal bias current. Keep it
under 2 mm, and keep it away from the crystal and the match chain rather than
merely short.

### 11-13. Decoupling and the loop filter

`C317` across the loop filter pins is already good. The nine rail caps are the
part of the current placement that is already right: every supply pin has a
47n within 1.21-1.97 mm and they ring all four edges.

One reassignment worth making: **`C308` is currently serving both pin 12
(1.79 mm) and pin 13 (1.81 mm) while `C309` sits redundantly near pin 12
(1.97 mm, and 2.24 mm from pin 13).** Move `C309` onto pin 13 `AVDD_IF` so each
of the nine pins has its own cap, which is what the nine were bought for.
Ground each cap with its own via — never daisy-chain two caps through one.

Analog pins rank above digital ones because `AVDD_RF`, `AVDD_XOSC`,
`AVDD_SYNTH1/2` and `AVDD_PFD_CHP` feed the blocks whose noise ends up on the
carrier, while `DVDD` and `VDD_GUARD` feed logic.

### 14. The chain, not the parts

The match network's internal hops are already 1.0-1.6 mm and in schematic
order. Preserve that as a block when it moves. The failure mode is spreading
the chain out or reordering it — the lumped values assume the elements are
adjacent.

### 17. The one place length is the wrong question

Everything from pin 17 through `L304` runs at match-network impedances that are
not 50 ohm, so "controlled impedance" is meaningless there and short is the
only rule. **`L304` to `J301` is the exception** — that section is at 50 ohm and
should be a proper coplanar microstrip with ground either side and stitching
vias along it. Getting its impedance right matters more than shaving a
millimetre off it.

### 18. Everything else

SPI, reset, the GPIO test points and `EXT_XOSC` have no length constraint worth
naming at these speeds. Route them last and use them as the escape path. The
only rule is negative: keep them out of the crystal area and do not let them
cross the LNA or PA traces.

---

## Suggested order of work

1. Via array in `GND_EP`, plus a ground via ring outside the pin ring.
2. Bring the radio block onto the board as a unit, keeping its internal
   arrangement.
3. Tighten `C315`, `C316`, `C313` onto their pins.
4. Pull `L301`/`C321` and `C323` up to pins 17 and 18.
5. Rebuild the LNA cluster symmetrically about pins 19/20.
6. Bring the crystal group in to <=2.5 mm.
7. `R301` to <2 mm, `C310` to <3 mm.
8. Move `C309` onto pin 13.
9. Route the 50-ohm run to `J301` last, with stitching.
