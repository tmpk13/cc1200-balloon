/**
 * Patch connectivity that sheet generation cannot express:
 *  - Inter-sheet nets that are 2-pin single-group nets on their home sheet
 *    get wired directly with no label; add the global label at a pin anchor.
 *    Detected generically: for every sheet JSON, any declared inter-sheet
 *    net with pins on that sheet must appear as a global label in the
 *    generated file (assemble.ts has already globalized local labels).
 *  - Any label-styled rail listed in FLAG_RAILS gets a PWR_FLAG on the Power
 *    sheet. Empty here: kicad-vis already flags every undriven rail in this
 *    design, and a second flag on one net is itself an ERC error.
 * Idempotent: skips anything already present.
 */

import { absolutePins, parseSexpr, readSheet } from "./schlib";
import { INTERSHEET, SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;
const FLAG_RAILS: string[] = [];

function uuidv5ish(seed: string): string {
  const h = new Bun.CryptoHasher("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const intersheet = new Set(INTERSHEET);

for (const s of SHEETS) {
  const jsonPath = `${ROOT}/sheets/${s.file.replace(".kicad_sch", ".json")}`;
  const desc = await Bun.file(jsonPath).json();
  const path = `${ROOT}/${s.file}`;
  let src = await Bun.file(path).text();
  const sheet = readSheet(parseSexpr(src));
  const pins = absolutePins(sheet);
  let added = 0;
  for (const net of desc.nets as { name: string; pins: string[] }[]) {
    if (!intersheet.has(net.name)) continue;
    if (src.includes(`(global_label "${net.name}"`)) continue;
    // anchor on the first resolvable pin of the net
    let anchor: { x: number; y: number } | undefined;
    for (const ep of net.pins) {
      const [ref, pinNum] = ep.split(".");
      const p = pins.find((q) => q.inst.ref === ref && q.pin.number === pinNum);
      if (p) {
        anchor = p;
        break;
      }
    }
    if (!anchor) {
      console.log(`${s.file}: no anchor for ${net.name}`);
      continue;
    }
    const block = `	(global_label "${net.name}"
		(shape passive)
		(at ${anchor.x} ${anchor.y} 0)
		(effects
			(font (size 1.27 1.27))
			(justify left)
		)
		(uuid "${uuidv5ish(`patch-${s.file}-${net.name}`)}")
	)
`;
    src = src.replace(/\n\t\(sheet_instances/, `\n${block}\t(sheet_instances`);
    added++;
  }
  if (added) await Bun.write(path, src);
  console.log(`${s.file}: added ${added} global labels`);
}

// PWR_FLAG for each label-styled rail, on the Power sheet, placed on the
// first label point of that rail.
{
  const path = `${ROOT}/power.kicad_sch`;
  let src = await Bun.file(path).text();
  let added = 0;
  for (let i = 0; i < FLAG_RAILS.length; i++) {
    const rail = FLAG_RAILS[i];
    const flagRef = `#FLG9${String(i + 1).padStart(3, "0")}`;
    if (src.includes(`"${flagRef}"`)) continue;
    const sheet = readSheet(parseSexpr(src));
    const lbl = sheet.labels.find((l) => l.name === rail);
    if (!lbl) throw new Error(`no ${rail} label on power sheet`);
    const sheetUuid = `${uuidv5ish("cc1200_balloon-root")}/${uuidv5ish("sheet-power.kicad_sch")}`;
    const uid = uuidv5ish(`patch-flag-${rail}`);
    const block = `	(symbol
		(lib_id "power:PWR_FLAG")
		(at ${lbl.x} ${lbl.y} 0)
		(unit 1)
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(dnp no)
		(uuid "${uid}")
		(property "Reference" "${flagRef}"
			(at ${lbl.x} ${lbl.y + 6} 0)
			(hide yes)
			(effects
				(font (size 1.27 1.27))
			)
		)
		(property "Value" "${rail}"
			(at ${lbl.x} ${lbl.y - 4} 0)
			(effects
				(font (size 1.27 1.27))
				(hide yes)
			)
		)
		(property "Footprint" ""
			(at ${lbl.x} ${lbl.y} 0)
			(hide yes)
			(effects
				(font (size 1.27 1.27))
			)
		)
		(pin "1"
			(uuid "${uuidv5ish(`patch-flag-${rail}-pin`)}")
		)
		(instances
			(project "cc1200_balloon"
				(path "/${sheetUuid}"
					(reference "${flagRef}")
					(unit 1)
				)
			)
		)
	)
`;
    src = src.replace(/\n\t\(sheet_instances/, `\n${block}\t(sheet_instances`);
    added++;
  }
  if (added) await Bun.write(path, src);
  console.log(`power.kicad_sch: added ${added} PWR_FLAG`);
}
