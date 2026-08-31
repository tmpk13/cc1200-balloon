/**
 * Prune duplicate PWR_FLAG symbols across the hierarchy. kicad-vis adds a
 * flag per sheet for any undriven power net; once sheets merge through
 * global labels those flags collide (a flag is a power-output pin, and two
 * of them on one net is itself an ERC error). Policy: the Power sheet owns
 * the shared rails' flags.
 */

import { absolutePins, key, parseSexpr, readSheet, traceConnectivity } from "./schlib";
import { SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;

const POWER_SHEET = "power.kicad_sch";
const SHARED_RAILS = new Set(["GND", "VBATT", "VBAT_IN", "+BATT"]);
// Rails an active pin already drives, which must not carry a flag at all.
// Empty since the buck-boost came out: the board runs straight off the cell,
// so every rail on it is passive and wants exactly one flag.
const DRIVEN_RAILS = new Set<string>();

function removeSymbolBlock(src: string, uuid: string): string {
  const uuidIdx = src.indexOf(`(uuid "${uuid}")`);
  if (uuidIdx < 0) throw new Error(`uuid ${uuid} not found`);
  // walk back to the enclosing top-level "(symbol" start
  let start = src.lastIndexOf("\n\t(symbol", uuidIdx);
  if (start < 0) throw new Error("no enclosing symbol block");
  start += 1; // keep the newline
  let depth = 0;
  let end = start;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (src[i] !== '"') {
        if (src[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  while (src[end] === "\n") end++;
  return src.slice(0, start) + src.slice(end);
}

for (const { file } of SHEETS) {
  const path = `${ROOT}/${file}`;
  let src = await Bun.file(path).text();
  const sheet = readSheet(parseSexpr(src));
  const pins = absolutePins(sheet);
  const groupOf = traceConnectivity(sheet, pins);

  // net names per group from labels and power symbols
  const namesOf = new Map<number, Set<string>>();
  const nameAt = (k: string, name: string) => {
    const g = groupOf.get(k);
    if (g === undefined) return;
    if (!namesOf.has(g)) namesOf.set(g, new Set());
    namesOf.get(g)!.add(name);
  };
  for (const l of sheet.labels) nameAt(key(l.x, l.y), l.name);
  for (const p of pins) {
    const lid = p.inst.libId;
    if (lid.startsWith("power:") && lid !== "power:PWR_FLAG") {
      nameAt(key(p.x, p.y), lid.slice("power:".length));
    }
  }

  const removals: string[] = [];
  for (const p of pins) {
    if (p.inst.libId !== "power:PWR_FLAG") continue;
    const g = groupOf.get(key(p.x, p.y));
    const names = (g !== undefined && namesOf.get(g)) || new Set<string>();
    const isDriven = [...names].some((n) => DRIVEN_RAILS.has(n));
    const isShared = [...names].some((n) => SHARED_RAILS.has(n));
    if (isDriven || (isShared && file !== POWER_SHEET)) {
      removals.push(p.inst.uuid);
    }
  }
  for (const uuid of new Set(removals)) src = removeSymbolBlock(src, uuid);
  if (removals.length) await Bun.write(path, src);
  console.log(`  ${file}: removed ${new Set(removals).size} PWR_FLAG`);
}
