/**
 * Compare the netlist KiCad exports from the generated hierarchy against
 * the connectivity declared in sheets/*.json.
 *
 * This is the check that actually matters. Everything upstream is geometry:
 * kicad-vis chooses positions and orientations, flow-wire re-lays the wires,
 * and a wire that lands one grid step off - or a symbol the placer rotated
 * 180 degrees - can join two rails or swap them without any of the other
 * checks noticing. ERC calls a rail collision a warning, not an error.
 *
 * Two directions are checked, and both matter:
 *   missing - two pins declared on one net that the schematic separates
 *   extra   - two pins the schematic joins that the JSON never declared
 *
 * A net name is global if it is a power rail (GND, or a leading "+"), or is
 * listed in INTERSHEET. Every other name is local to its sheet.
 */

import { INTERSHEET, SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;
const PROJECT = "cc1200_balloon";

interface SheetDesc {
  nets: { name: string; pins: string[] }[];
  no_connect?: string[];
}

const globalNames = new Set(INTERSHEET);
const isGlobal = (name: string) => name === "GND" || name.startsWith("+") || globalNames.has(name);

// --- expected ------------------------------------------------------------
class Union {
  parent = new Map<string, string>();
  find(a: string): string {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    while (this.parent.get(a) !== r) {
      const next = this.parent.get(a)!;
      this.parent.set(a, r);
      a = next;
    }
    return r;
  }
  join(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const expected = new Union();
const declaredNet = new Map<string, string>(); // endpoint -> readable net name
const noConnect = new Set<string>();

for (const s of SHEETS) {
  const file = `${ROOT}/sheets/${s.file.replace(".kicad_sch", ".json")}`;
  const desc: SheetDesc = await Bun.file(file).json();
  for (const nc of desc.no_connect ?? []) noConnect.add(nc);
  for (const net of desc.nets) {
    const anchor = isGlobal(net.name) ? `net:${net.name}` : `net:${s.file}:${net.name}`;
    for (const pin of net.pins) {
      expected.join(pin, anchor);
      declaredNet.set(pin, net.name);
    }
  }
}

// --- actual --------------------------------------------------------------
const netlistPath = `/tmp/${PROJECT}_verify.net`;
const exported = Bun.spawnSync([
  "kicad-cli", "sch", "export", "netlist",
  "--format", "kicadsexpr", "-o", netlistPath,
  `${ROOT}/${PROJECT}.kicad_sch`,
], { stderr: "pipe" });
if (exported.exitCode !== 0) {
  console.error(exported.stderr.toString());
  process.exit(2);
}

type Sx = string | Sx[];
function parseSexpr(text: string): Sx {
  const tokens = text.match(/\(|\)|"(?:[^"\\]|\\.)*"|[^\s()]+/g) ?? [];
  let i = 0;
  const walk = (): Sx => {
    const t = tokens[i++];
    if (t === "(") {
      const out: Sx[] = [];
      while (tokens[i] !== ")") out.push(walk());
      i++;
      return out;
    }
    return t.startsWith('"') ? JSON.parse(t) : t;
  };
  return walk();
}
const kids = (node: Sx, tag: string): Sx[][] =>
  Array.isArray(node) ? (node.filter((c) => Array.isArray(c) && c[0] === tag) as Sx[][]) : [];

const tree = parseSexpr(await Bun.file(netlistPath).text());
const actual = new Map<string, string>(); // endpoint -> actual net name
for (const net of kids(kids(tree, "nets")[0] ?? [], "net")) {
  const nameNode = kids(net, "name")[0];
  const name = (nameNode?.[1] as string) ?? "";
  for (const node of kids(net, "node")) {
    const ref = kids(node, "ref")[0]![1] as string;
    const pin = kids(node, "pin")[0]![1] as string;
    actual.set(`${ref}.${pin}`, name);
  }
}

// --- compare -------------------------------------------------------------
// Group declared endpoints by expected root and by actual net, then report
// any endpoint pair that the two groupings disagree about.
const byExpected = new Map<string, string[]>();
for (const ep of declaredNet.keys()) {
  const r = expected.find(ep);
  if (!byExpected.has(r)) byExpected.set(r, []);
  byExpected.get(r)!.push(ep);
}

const problems: string[] = [];

for (const [, eps] of byExpected) {
  const present = eps.filter((e) => actual.has(e));
  const absent = eps.filter((e) => !actual.has(e));
  for (const e of absent) {
    problems.push(`missing: ${e} (declared on ${declaredNet.get(e)}) is not in the netlist at all`);
  }
  const nets = new Set(present.map((e) => actual.get(e)!));
  if (nets.size > 1) {
    const bySet = new Map<string, string[]>();
    for (const e of present) {
      const n = actual.get(e)!;
      if (!bySet.has(n)) bySet.set(n, []);
      bySet.get(n)!.push(e);
    }
    problems.push(
      `split: ${declaredNet.get(present[0])} is ${nets.size} nets in the schematic -> ` +
        [...bySet].map(([n, e]) => `${n}[${e.join(" ")}]`).join(" | "),
    );
  }
}

const byActual = new Map<string, string[]>();
for (const [ep, net] of actual) {
  if (!byActual.has(net)) byActual.set(net, []);
  byActual.get(net)!.push(ep);
}
for (const [net, eps] of byActual) {
  const declared = eps.filter((e) => declaredNet.has(e));
  const roots = new Set(declared.map((e) => expected.find(e)));
  if (roots.size > 1) {
    const byRoot = new Map<string, string[]>();
    for (const e of declared) {
      const r = expected.find(e);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r)!.push(e);
    }
    problems.push(
      `shorted: schematic net ${net} joins ${roots.size} declared nets -> ` +
        [...byRoot].map(([r, e]) => `${r.replace("net:", "")}[${e.join(" ")}]`).join(" | "),
    );
  }
  // A pin declared no-connect must not have picked up company.
  for (const e of eps) {
    if (noConnect.has(e) && eps.length > 1) {
      problems.push(`no-connect violated: ${e} is on net ${net} with ${eps.filter((x) => x !== e).join(" ")}`);
    }
  }
}

if (problems.length) {
  for (const p of problems.sort()) console.log(`  ${p}`);
  console.log(`  ${problems.length} netlist mismatch(es)`);
  process.exit(1);
}
console.log(`  netlist matches sheets/*.json: ${declaredNet.size} endpoints, ${byExpected.size} nets`);
