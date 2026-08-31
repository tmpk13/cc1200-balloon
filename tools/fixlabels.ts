/**
 * Normalize global label text justification.
 *
 * A global label draws its name inside a flag outline and centers the text
 * vertically in it, so KiCad writes a horizontal justify only. kicad-vis
 * emits a vertical token as well ("left bottom"), which is the convention
 * for a plain local label -- whose text sits above its wire -- and on a
 * global label it shoves the name up against the top of the flag border.
 *
 * The horizontal side is derived from the rotation rather than preserved,
 * so the name still reads outward from the anchor after flow-wire has had
 * a chance to reorient a label.
 *
 * Local labels are left alone: "left bottom" is correct for those.
 * Idempotent.
 */

import { SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;

// 0 and 90 point the flag right/up, so the name starts at the anchor.
const horizontalFor = (angle: number) =>
  angle === 0 || angle === 90 ? "left" : "right";

/** End index of the block opening at `start`, skipping over strings. */
function blockEnd(src: string, start: number): number {
  let depth = 0;
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
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("unterminated block");
}

let total = 0;
for (const { file } of SHEETS) {
  const path = `${ROOT}/${file}`;
  let src = await Bun.file(path).text();
  let changed = 0;

  // Right to left, so a rewrite never shifts an index not yet visited.
  const heads = [
    ...src.matchAll(
      /\(global_label "(?:[^"\\]|\\.)*"\s*\(shape \w+\)\s*\(at [-0-9.]+ [-0-9.]+ ([-0-9.]+)\)/g,
    ),
  ];
  for (const head of heads.reverse()) {
    const want = `(justify ${horizontalFor(parseFloat(head[1]))})`;
    const end = blockEnd(src, head.index!);
    // The label's own effects is the first one in the block; anything later
    // belongs to the nested Intersheetrefs property.
    const eff = src.indexOf("(effects", head.index! + head[0].length);
    if (eff < 0 || eff >= end) throw new Error(`${file}: label has no effects`);
    const effEnd = blockEnd(src, eff);
    const body = src.slice(eff, effEnd);
    const next = body.match(/\(justify [^)]*\)/)
      ? body.replace(/\(justify [^)]*\)/, want)
      : body.replace(/\s*\)$/, `\n\t\t\t${want}\n\t\t)`);
    if (next === body) continue;
    src = src.slice(0, eff) + next + src.slice(effEnd);
    changed++;
  }

  if (changed) await Bun.write(path, src);
  console.log(`  ${file}: ${changed} global label(s) normalized`);
  total += changed;
}
console.log(`  ${total} total`);
