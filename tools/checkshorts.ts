/**
 * Guard against rails shorted together by geometry.
 *
 * kicad-vis places one power symbol per power pin and the flow-wire bridge
 * then re-lays the wires; a supply pin and a ground pin on the same symbol
 * edge can end up with their stubs on one line, which joins the two rails
 * silently - the netlist still exports, ERC only calls it a "multiple net
 * names" warning, and the board is dead. This walks the wire graph of every
 * sheet and fails if one electrical group carries two different power
 * symbols.
 */

import { absolutePins, key, parseSexpr, readSheet, traceConnectivity } from "./schlib";
import { SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;

let bad = 0;
for (const { file } of SHEETS) {
  const src = await Bun.file(`${ROOT}/${file}`).text();
  const sheet = readSheet(parseSexpr(src));
  const pins = absolutePins(sheet);
  const groupOf = traceConnectivity(sheet, pins);

  // rail name -> members, per electrical group
  const rails = new Map<number, Map<string, string[]>>();
  for (const p of pins) {
    const lid = p.inst.libId;
    if (!lid.startsWith("power:") || lid === "power:PWR_FLAG") continue;
    const g = groupOf.get(key(p.x, p.y));
    if (g === undefined) continue;
    if (!rails.has(g)) rails.set(g, new Map());
    const byName = rails.get(g)!;
    const name = lid.slice("power:".length);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(`${p.inst.ref}@${p.x},${p.y}`);
  }

  // Labels naming a group count too: a label and a power symbol disagreeing
  // is the same short seen from the other side.
  for (const [g, byName] of rails) {
    if (byName.size < 2) continue;
    bad++;
    console.log(`  SHORT: ${file} group ${g} carries ${[...byName.keys()].join(" + ")}`);
    for (const [name, refs] of byName) console.log(`    ${name}: ${refs.join(" ")}`);
    // Show what else sits on the group, which is where the crossing is.
    const others = pins
      .filter((p) => groupOf.get(key(p.x, p.y)) === g && !p.inst.libId.startsWith("power:"))
      .map((p) => `${p.inst.ref}.${p.pin.number}@${p.x},${p.y}`);
    if (others.length) console.log(`    also on this group: ${others.join(" ")}`);
  }
}

if (bad) {
  console.log(`  ${bad} shorted rail group(s)`);
  process.exit(1);
}
console.log("  no rails shorted by geometry");
