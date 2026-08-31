/**
 * Check that every footprint the schematic names actually exists.
 *
 * A footprint field is just a string until someone opens the board editor,
 * so a typo or a renamed upstream land pattern survives placement, routing,
 * ERC and netlist export, and only surfaces when the design is imported to
 * PCB - after the schematic has been signed off.
 *
 * Project libraries come from fp-lib-table; stock ones from the KiCad
 * footprint directory.
 */

import { readdirSync, existsSync, statSync } from "node:fs";

const ROOT = `${import.meta.dir}/..`;
const STOCK = process.env.KICAD_FOOTPRINT_DIR ?? "/usr/share/kicad/footprints";

/** library nickname -> .pretty directory */
const libs = new Map<string, string>();
for (const entry of readdirSync(STOCK)) {
  if (entry.endsWith(".pretty")) libs.set(entry.slice(0, -".pretty".length), `${STOCK}/${entry}`);
}
const table = await Bun.file(`${ROOT}/fp-lib-table`).text();
for (const m of table.matchAll(/\(name "([^"]+)"\)\s*\(type "KiCad"\)\s*\(uri "([^"]+)"\)/g)) {
  libs.set(m[1], m[2].replace("${KIPRJMOD}", ROOT));
}

const missing: string[] = [];
const seen = new Set<string>();
for (const file of readdirSync(`${ROOT}/sheets`)) {
  if (!file.endsWith(".json")) continue;
  const desc: { components: { ref: string; footprint?: string }[] } =
    await Bun.file(`${ROOT}/sheets/${file}`).json();
  for (const c of desc.components) {
    const fp = c.footprint;
    if (!fp) continue;
    const [lib, name] = fp.split(":");
    const dir = libs.get(lib);
    if (!dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      missing.push(`${c.ref}: library "${lib}" not found (${fp})`);
      continue;
    }
    if (!existsSync(`${dir}/${name}.kicad_mod`)) {
      missing.push(`${c.ref}: ${fp} not in ${dir}`);
      continue;
    }
    seen.add(fp);
  }
}

if (missing.length) {
  for (const m of missing) console.log(`  ${m}`);
  console.log(`  ${missing.length} unresolved footprint(s)`);
  process.exit(1);
}
console.log(`  ${seen.size} distinct footprints all resolve`);
