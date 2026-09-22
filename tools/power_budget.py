#!/usr/bin/env python3
"""Battery budget for the three power architectures of the balloon board.

A: as built. Everything on +BATT, no regulator, no switch.
B: one always-on 3.3 V LDO in front of everything.
C: +BATT stays for the MCU, radio and GNSS; SCD40 becomes SCD41 (it has a
   power_down command); the BMV080 and the I2C pull-ups move to a 3.3 V LDO
   whose EN is a GPIO; the battery divider goes to 1M/1M.
C+GNSS: C, plus a load switch on the GNSS supply with VDD_BK moved to +BATT.

Currents are data sheet typicals unless marked. All currents in uA, charges in
mC (mA * s). The model assumes a linear regulator: battery current equals load
current plus the regulator's own ground current.

Run: python3 tools/power_budget.py
"""

from dataclasses import dataclass

CELL_V = 3.6

# Divider R103 + R104 across the rail.
DIV_AS_BUILT_UA = CELL_V / 200e3 * 1e6  # 100k + 100k
DIV_1M_UA = CELL_V / 2e6 * 1e6  # 1M + 1M

# Sleep floor per architecture, uA. Each entry: (load, uA, source).
FLOOR = {
    "A": [
        ("Wio-E5 sleep", 2.1, "Seeed Wio-E5 DS table 4"),
        ("CC1200 SLEEP", 0.12, "SWRS123D 4.7"),
        ("AT6558R ON_OFF=0", 20.0, "AT6558R DS, sleep mode current"),
        ("SCD40 idle (no power_down on SCD40)", 200.0, "SCD4x low power AN 3.2, 3.3 V"),
        ("AS3935 power-down", 1.0, "AS3935 DS fig 10"),
        ("BME688 sleep", 0.15, "BME688 DS table 1"),
        ("BMV080 sleep (upper bound)", 30.0, "BMV080 DS table 3, < 30 uA"),
        ("R103/R104 100k/100k", DIV_AS_BUILT_UA, "3.6 V / 200 k"),
    ],
}
FLOOR["B"] = FLOOR["A"] + [
    # TPS7A02 cannot carry the SCD40's 205 mA peak on top of a transmit, so
    # the always-on single LDO has to be a 300 mA part.
    ("TPS7A20 Iq", 6.5, "SBVS338H 5.5"),
]
FLOOR["C"] = [
    ("Wio-E5 sleep", 2.1, "Seeed Wio-E5 DS table 4"),
    ("CC1200 SLEEP", 0.12, "SWRS123D 4.7"),
    ("AT6558R ON_OFF=0", 20.0, "AT6558R DS, sleep mode current"),
    ("SCD41 power_down (not specified, budgeted)", 1.0, "no figure in SCD4x DS"),
    ("AS3935 power-down", 1.0, "AS3935 DS fig 10"),
    ("BME688 sleep", 0.15, "BME688 DS table 1"),
    ("BMV080 unpowered", 0.0, "rail off"),
    ("TPS7A20 shutdown", 0.07, "SBVS338H 5.5"),
    ("R103/R104 1M/1M", DIV_1M_UA, "3.6 V / 2 M"),
]
FLOOR["C+GNSS"] = [
    e for e in FLOOR["C"] if not e[0].startswith("AT6558R")
] + [
    ("AT6558R backup, VDD_BK on +BATT", 8.0, "AT6558R DS, battery backup current"),
    ("TPS22917 off", 0.01, "SLVSDW8B 7.5"),
]


@dataclass
class Burst:
    name: str
    ma: float
    s: float

    @property
    def mc(self) -> float:
        return self.ma * self.s


# One telemetry cycle: wake, hot GNSS fix, read the sensors, transmit once.
# The MCU run current is an assumption, not a data sheet figure.
MCU_RUN_MA = 4.0
GNSS_HOT_S = 5.0  # hot TTFF <= 1 s, plus margin to settle the solution
GNSS_COLD_S = 32.0  # cold TTFF <= 32 s
BMV080_S = 10.0 + 1.17  # default integration time plus first-data latency
TX_S = 0.25  # airtime of one short packet, assumption

GNSS = Burst("AT6558R hot fix, 23 mA", 23.0, GNSS_HOT_S)
SCD4X = Burst("SCD4x one reading, 77 mC", 77.0 / 5.0, 5.0)
BME688 = Burst("BME688 T/P/H + gas heater", 13.0, 0.2)
BMV080 = Burst("BMV080 one duty cycle, < 68 mA", 68.0, BMV080_S)
TX = Burst("CC1200 TX +14 dBm, 46 mA", 46.0, TX_S)


def cycle(with_bmv080: bool, cold_gnss: bool = False) -> list[Burst]:
    gnss = Burst("AT6558R cold fix, 23 mA", 23.0, GNSS_COLD_S) if cold_gnss else GNSS
    parts = [gnss, SCD4X, BME688, TX]
    if with_bmv080:
        parts.append(BMV080)
    awake_s = max(b.s for b in parts if b is not TX) + TX_S
    parts.append(Burst("MCU awake (assumed 4 mA)", MCU_RUN_MA, awake_s))
    return parts


def floor_ua(arch: str) -> float:
    return sum(ua for _, ua, _ in FLOOR[arch])


def cycle_mc(parts: list[Burst]) -> float:
    return sum(b.mc for b in parts)


def average_ua(arch: str, period_s: float, bmv_every: int = 1) -> float:
    """Average battery current with one cycle per period and the BMV080 on
    every `bmv_every`-th cycle (0 means never)."""
    base = cycle_mc(cycle(False))
    bmv = BMV080.mc / bmv_every if bmv_every else 0.0
    # The MCU stays awake for the BMV080 window on the cycles that run it.
    if bmv_every:
        extra_awake = (cycle(True)[-1].s - cycle(False)[-1].s) * MCU_RUN_MA
        bmv += extra_awake / bmv_every
    active_ua = (base + bmv) / period_s * 1e3
    # Floor applies for the time not spent awake; the difference is well
    # under 1 % at these periods, so it is charged for the whole period.
    return floor_ua(arch) + active_ua


def mah_per_day(avg_ua: float) -> float:
    return avg_ua * 24 / 1000


SCENARIOS = [
    ("every 10 min, BMV080 every cycle", 600, 1),
    ("every 10 min, BMV080 once an hour", 600, 6),
    ("every 60 min, BMV080 every cycle", 3600, 1),
    ("every 60 min, no BMV080", 3600, 0),
]


def main() -> None:
    for arch in FLOOR:
        print(f"\n### Sleep floor, {arch}: {floor_ua(arch):.1f} uA\n")
        print("| Load | uA | Source |\n| --- | ---: | --- |")
        for name, ua, src in FLOOR[arch]:
            print(f"| {name} | {ua:.2f} | {src} |")

    print("\n### One cycle\n")
    print("| Burst | mA | s | mC |\n| --- | ---: | ---: | ---: |")
    for b in cycle(True):
        print(f"| {b.name} | {b.ma:.1f} | {b.s:.2f} | {b.mc:.1f} |")
    print(f"| total without BMV080 | | | {cycle_mc(cycle(False)):.0f} |")
    print(f"| total with BMV080 | | | {cycle_mc(cycle(True)):.0f} |")

    print("\n### Average current and charge per day\n")
    head = " | ".join(f"{a} uA | {a} mAh/d" for a in FLOOR)
    print(f"| Scenario | {head} |")
    print("| --- |" + " ---: |" * (2 * len(FLOOR)))
    for label, period, every in SCENARIOS:
        cells = []
        for arch in FLOOR:
            avg = average_ua(arch, period, every)
            cells.append(f"{avg:.0f} | {mah_per_day(avg):.2f}")
        print(f"| {label} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main()
