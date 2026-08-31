/**
 * Guard against accidental cross-sheet shorts: kicad-vis emits any net
 * that spans groups as a GLOBAL label, and global labels merge across the
 * whole hierarchy. A name that appears as a global label on two or more
 * sheets without being a declared inter-sheet net is a silent short.
 */

import { INTERSHEET, SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;
const allowed = new Set(INTERSHEET);

const seen = new Map<string, string[]>();
for (const s of SHEETS) {
  const src = await Bun.file(`${ROOT}/${s.file}`).text();
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
}
if (bad) {
  console.log(`  ${bad} undeclared cross-sheet global label(s)`);
  process.exit(1);
}
console.log("  no undeclared cross-sheet global labels");
