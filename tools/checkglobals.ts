/**
 * Guard the global label population on both sides.
 *
 * Too wide: kicad-vis emits any net that spans groups as a GLOBAL label,
 * and global labels merge across the whole hierarchy. A name that appears
 * as a global label on two or more sheets without being a declared
 * inter-sheet net is a silent short.
 *
 * Too narrow is the other half, and it is what localize.ts fixes: a global
 * label that appears on exactly one sheet and names no power symbol reaches
 * nothing outside that sheet, so it should be a local label. Left global it
 * is a short waiting for the next sheet to reuse the name.
 */

import { INTERSHEET, SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;
const allowed = new Set(INTERSHEET);

const seen = new Map<string, string[]>();
const powerNets = new Set<string>();
for (const s of SHEETS) {
  const src = await Bun.file(`${ROOT}/${s.file}`).text();
  for (const m of src.matchAll(/\(lib_id "power:([^"]+)"\)/g)) {
    if (m[1] !== "PWR_FLAG") powerNets.add(m[1]);
  }
  const names = new Set<string>();
  for (const m of src.matchAll(/\(global_label "((?:[^"\\]|\\.)*)"/g)) {
    names.add(JSON.parse(`"${m[1].replace(/"/g, '\\"')}"`));
  }
  for (const n of names) {
    if (!seen.has(n)) seen.set(n, []);
    seen.get(n)!.push(s.file);
  }
}

let bad = 0;
for (const [name, files] of [...seen].sort()) {
  if (files.length >= 2 && !allowed.has(name)) {
    console.log(`  SHORT RISK: global label "${name}" on ${files.join(", ")}`);
    bad++;
  }
  if (files.length === 1 && !allowed.has(name) && !powerNets.has(name)) {
    console.log(`  NOT GLOBAL: "${name}" reaches nothing outside ${files[0]}`);
    bad++;
  }
}
if (bad) {
  console.log(`  ${bad} misscoped global label(s)`);
  process.exit(1);
}
console.log("  global labels all cross a sheet boundary, none undeclared");
