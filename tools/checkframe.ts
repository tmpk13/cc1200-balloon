/**
 * Fail the build when a sheet's content runs off its page.
 *
 * kicad-vis reports ok whether or not the placed circuit fits the frame, and
 * kicad-cli plots the overflow away silently, so the only symptom is a
 * schematic that looks complete until you notice half the RX path is
 * missing. This measures the extent of every wire, label, junction and
 * symbol origin against the paper size named in the file.
 */

import { SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;

/** Landscape paper sizes in mm. */
const PAPER: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
};

/** Room for the title block and border. */
const MARGIN = 12;

let bad = 0;
for (const { file } of SHEETS) {
  const src = await Bun.file(`${ROOT}/${file}`).text();
  const paper = src.match(/\(paper "([^"]+)"\)/)?.[1] ?? "A4";
  const size = PAPER[paper];
  if (!size) throw new Error(`${file}: unknown paper ${paper}`);

  // Coordinates inside lib_symbols are library-relative, not sheet
  // positions, so that whole section has to come out first.
  const libStart = src.indexOf("\n\t(lib_symbols");
  let body = src;
  if (libStart >= 0) {
    let depth = 0;
    let end = libStart + 1;
    for (let i = libStart + 1; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    body = src.slice(0, libStart) + src.slice(end);
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const m of body.matchAll(/\(xy ([-\d.]+) ([-\d.]+)\)/g)) {
    xs.push(Number(m[1]));
    ys.push(Number(m[2]));
  }
  for (const m of body.matchAll(/\(at ([-\d.]+) ([-\d.]+)(?: [-\d.]+)?\)/g)) {
    xs.push(Number(m[1]));
    ys.push(Number(m[2]));
  }
  if (!xs.length) continue;

  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const fitsX = x1 <= size[0] - MARGIN && x0 >= 0;
  const fitsY = y1 <= size[1] - MARGIN && y0 >= 0;
  const note = `${file}: ${paper} ${size[0]}x${size[1]}, content ${x0.toFixed(0)}..${x1.toFixed(0)} x ${y0.toFixed(0)}..${y1.toFixed(0)}`;
  if (fitsX && fitsY) {
    console.log(`  ${note} ok`);
  } else {
    console.log(`  ${note} OVERFLOWS`);
    bad++;
  }
}

if (bad) {
  console.log(`  ${bad} sheet(s) overflow the frame - raise "paper" in sheets/*.json`);
  process.exit(1);
}
