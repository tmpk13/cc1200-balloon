/**
 * Collect the BOM from sheets/*.json into bom.json.
 *
 * Named parts carry their MPN in the sheet JSON. Generic passives carry only
 * a value and a land pattern, so they get a preferred MPN and a fallback
 * DigiKey search here; tools/source_bom.py resolves both against live stock,
 * because a preferred part that is out of stock is worse than no preference.
 */

import { SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;

interface Component {
  ref: string;
  value?: string;
  footprint?: string;
  dnp?: boolean;
  fields?: Record<string, string>;
}

/** Preferred MPN and a stock-filtered fallback query, per value + package. */
interface Generic {
  mpn: string;
  query: string;
  note?: string;
}

/**
 * What a substitute has to be, in SI base units. DigiKey keyword search is a
 * text match, so "0402 1uF 10V X5R capacitor" happily returns 0.1 uF parts;
 * without this the sourcing step silently swaps a decade.
 */
interface Expect {
  param: "Capacitance" | "Resistance" | "Inductance";
  value: number;
  pkg: string;
}

const SUFFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, R: 1, k: 1e3, M: 1e6 };

/** "1u" -> 1e-6, "4k7" -> 4700, "1n8" -> 1.8e-9, "18R" -> 18, "2.2u" -> 2.2e-6. */
function parseValue(value: string): number | null {
  const m = value.match(/^(\d*\.?\d*)([pnumRkM])(\d*)$/);
  if (!m) return null;
  const mult = SUFFIX[m[2]];
  if (mult === undefined) return null;
  const whole = m[1] === "" ? "0" : m[1];
  const frac = m[3] === "" ? "" : `.${m[3]}`;
  return Number(`${whole}${frac}`) * mult;
}

const CAP_0402_C0G: Record<string, Generic> = {
  "2p2": { mpn: "GRM1555C1H2R2CA01D", query: "0402 2.2pF 50V C0G capacitor" },
  "5p1": { mpn: "GRM1555C1H5R1CA01D", query: "0402 5.1pF 50V C0G capacitor" },
  "6p2": { mpn: "GRM1555C1H6R2CA01D", query: "0402 6.2pF 50V C0G capacitor" },
  "10p": { mpn: "GRM1555C1H100JA01D", query: "0402 10pF 50V C0G capacitor" },
  "12p": { mpn: "CL05C120JB5NNNC", query: "0402 12pF 50V C0G capacitor" },
  "39p": { mpn: "GRM1555C1H390JA01D", query: "0402 39pF 50V C0G capacitor" },
  "47p": { mpn: "GRM1555C1H470JA01D", query: "0402 47pF 50V C0G capacitor" },
  "56p": { mpn: "GRM1555C1H560JA01D", query: "0402 56pF 50V C0G capacitor" },
  "100p": { mpn: "GRM1555C1H101JA01D", query: "0402 100pF 50V C0G capacitor" },
  "470p": { mpn: "GRM1555C1H471JA01D", query: "0402 470pF 50V C0G capacitor" },
  "910p": { mpn: "GRM1555C1H911JA01D", query: "0402 910pF 50V C0G capacitor" },
  "1n8": { mpn: "GRM1555C1H182JA01D", query: "0402 1800pF 50V C0G capacitor" },
};

const CAP_0402_X7R: Record<string, Generic> = {
  "10n": { mpn: "GRM155R71H103KA88D", query: "0402 10000pF 50V X7R capacitor" },
  "47n": { mpn: "GRM155R71H473KE14D", query: "0402 0.047uF 50V X7R capacitor" },
  "100n": { mpn: "GRM155R71C104KA88D", query: "0402 0.1uF 16V X7R capacitor" },
  "220n": { mpn: "CL05A224KA5NNNC", query: "0402 0.22uF 16V X5R capacitor" },
  "1u": { mpn: "GRM155R61A105KE15D", query: "0402 1uF 10V X5R capacitor" },
};

const RES_0402: Record<string, Generic> = {
  "0R": { mpn: "RC0402JR-070RL", query: "0402 0 ohm jumper resistor" },
  "18R": { mpn: "RC0402FR-0718RL", query: "0402 18 ohm 1% resistor" },
  "22R": { mpn: "RC0402FR-0722RL", query: "0402 22 ohm 1% resistor" },
  "100R": { mpn: "RC0402FR-07100RL", query: "0402 100 ohm 1% resistor" },
  "1k": { mpn: "RC0402FR-071KL", query: "0402 1 kohm 1% resistor" },
  "4k7": { mpn: "RC0402FR-074K7L", query: "0402 4.7 kohm 1% resistor" },
  "10k": { mpn: "RC0402FR-0710KL", query: "0402 10 kohm 1% resistor" },
  "56k": { mpn: "RC0402FR-0756KL", query: "0402 56 kohm 1% resistor" },
  "100k": { mpn: "RC0402FR-07100KL", query: "0402 100 kohm 1% resistor" },
};

// Wire-wound 0402 parts: the CC1200 match and the GNSS bias-T both need the
// Q that a multilayer chip inductor does not have at these frequencies.
const IND_0402: Record<string, Generic> = {
  "4n3": { mpn: "LQW15AN4N3C00D", query: "0402 4.3nH wirewound RF inductor" },
  "6n8": { mpn: "LQW15AN6N8H00D", query: "0402 6.8nH wirewound RF inductor" },
  "15n": { mpn: "LQW15AN15NJ00D", query: "0402 15nH wirewound RF inductor" },
  "22n": { mpn: "LQW15AN22NG00D", query: "0402 22nH wirewound RF inductor" },
  "27n": { mpn: "LQW15AN27NG00D", query: "0402 27nH wirewound RF inductor" },
  "33n": { mpn: "LQW15AN33NH00D", query: "0402 33nH wirewound RF inductor" },
  "43n": { mpn: "LQW15AN43NG00D", query: "0402 43nH wirewound RF inductor" },
  "56n": { mpn: "LQW15AN56NG00D", query: "0402 56nH wirewound RF inductor" },
};

// A blank query means "no automatic substitute": nothing about an LED
// reduces to one parameter the sourcing step could check.
const OTHER: Record<string, Generic> = {
  "4u7|C_0603_1608Metric": { mpn: "GRM188R61A475KE15D", query: "0603 4.7uF 10V X5R capacitor" },
  "10u|C_0603_1608Metric": { mpn: "GRM188R60J106ME84D", query: "0603 10uF 6.3V X5R capacitor" },
  "22u|C_0805_2012Metric": { mpn: "GRM21BR61A226ME51L", query: "0805 22uF 10V X5R capacitor" },
  "STATUS|LED_0603_1608Metric": { mpn: "LTST-C191KGKT", query: "" },
};

/**
 * Placements that are copper on our own board, not a purchased part. The
 * solder pads are here because this build has no connectors at all - the
 * battery leads, both antenna pigtails and the debug harness solder
 * straight down, which took about 5 g off the payload.
 */
const NOT_PURCHASED = /^(TestPoint:|MountingHole:|cc1200_balloon:SolderPad_)/;

/**
 * Bought, but not placed. The BMV080 in particular is easy to lose - the
 * schematic only carries its mating ZIF connector, so without this line the
 * board arrives with nowhere to get a particulate reading from.
 */
const OFF_BOARD: { mpn: string; value: string; mates: string; note: string }[] = [
  {
    mpn: "828-BMV080-10PC-ND",
    value: "BMV080",
    mates: "J501",
    note: "Bosch particulate sensor on flex; sold in boxes of 10",
  },
  {
    mpn: "AANI-AP-0158-1",
    value: "GNSS antenna",
    mates: "J401",
    note: "active 27x27 mm L1 patch, 28 dB LNA (AT6558R wants 18-35 dB), 100 mm u.FL pigtail - cut the plug off and solder to J401",
  },
];

function generic(value: string, footprint: string): Generic | null {
  const pkg = footprint.split(":")[1] ?? "";
  const both = OTHER[`${value}|${pkg}`];
  if (both) return both;
  if (pkg.startsWith("C_0402")) return CAP_0402_C0G[value] ?? CAP_0402_X7R[value] ?? null;
  if (pkg.startsWith("R_0402")) return RES_0402[value] ?? null;
  if (pkg.startsWith("L_0402")) return IND_0402[value] ?? null;
  return null;
}

/** Imperial size code a substitute's "Package / Case" has to name. */
function imperial(footprint: string): string | null {
  const m = footprint.match(/_(\d{4})_\d{4}Metric/);
  return m ? m[1] : null;
}

function expectation(value: string, footprint: string): Expect | null {
  const pkg = imperial(footprint);
  if (!pkg) return null;
  const magnitude = parseValue(value);
  if (magnitude === null) return null;
  const kind = footprint.startsWith("Capacitor_SMD:")
    ? "Capacitance"
    : footprint.startsWith("Resistor_SMD:")
      ? "Resistance"
      : footprint.startsWith("Inductor_SMD:")
        ? "Inductance"
        : null;
  if (!kind) return null;
  return { param: kind, value: magnitude, pkg };
}

interface Line {
  key: string;
  value: string;
  footprint: string;
  mpn: string;
  query: string;
  expect: Expect | null;
  alt: string;
  refs: string[];
  dnp: boolean;
  offboard?: string;
}

const lines = new Map<string, Line>();
const unresolved: string[] = [];

for (const s of SHEETS) {
  const file = `${ROOT}/sheets/${s.file.replace(".kicad_sch", ".json")}`;
  const desc: { components: Component[] } = await Bun.file(file).json();
  for (const c of desc.components) {
    const footprint = c.footprint ?? "";
    if (NOT_PURCHASED.test(footprint)) continue;
    const value = c.value ?? "";
    let mpn = c.fields?.MPN ?? "";
    let query = "";
    if (!mpn) {
      const g = generic(value, footprint);
      if (!g) {
        unresolved.push(`${c.ref} ${value} ${footprint}`);
        continue;
      }
      mpn = g.mpn;
      query = g.query;
    }
    const key = `${mpn}|${c.dnp ? "dnp" : ""}`;
    if (!lines.has(key)) {
      const expect = query ? expectation(value, footprint) : null;
      if (query && !expect) {
        unresolved.push(`${c.ref} ${value} ${footprint}: substitute rules cannot be derived`);
        continue;
      }
      const alt = c.fields?.["Alt source"] ?? "";
      lines.set(key, { key, value, footprint, mpn, query, expect, alt, refs: [], dnp: !!c.dnp });
    }
    lines.get(key)!.refs.push(c.ref);
  }
}

if (unresolved.length) {
  console.error("  no MPN for:");
  for (const u of unresolved) console.error(`    ${u}`);
  process.exit(1);
}

for (const e of OFF_BOARD) {
  lines.set(`offboard:${e.mpn}`, {
    key: `offboard:${e.mpn}`,
    value: e.value,
    footprint: `mates ${e.mates}`,
    mpn: e.mpn,
    query: "",
    expect: null,
    alt: "",
    refs: [e.mates],
    dnp: false,
    offboard: e.note,
  });
}

const out = [...lines.values()].sort((a, b) => a.refs[0].localeCompare(b.refs[0]));
for (const l of out) l.refs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
await Bun.write(`${ROOT}/bom.json`, JSON.stringify(out, null, 2) + "\n");

const placements = out.reduce((n, l) => n + l.refs.length, 0);
console.log(`  bom.json: ${out.length} lines, ${placements} placements`);
