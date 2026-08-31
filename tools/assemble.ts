/**
 * Assemble the hierarchical project:
 *  1. Convert local labels of inter-sheet nets into global labels in every
 *     generated sheet (kicad-vis globalizes only nets that span groups
 *     within one sheet; nets that live in one group but span sheets stay
 *     local and would not connect across the hierarchy).
 *  2. Write the root sheet cc1200_balloon.kicad_sch with one sheet block per
 *     sub-sheet, plus the project file and project library tables.
 */

import { INTERSHEET, SHEETS } from "./intersheet";

const ROOT = `${import.meta.dir}/..`;
const PROJECT = "cc1200_balloon";

function globalize(src: string): { out: string; converted: number } {
  let converted = 0;
  const names = new Set(INTERSHEET);
  const out = src.replace(
    /\(label ("(?:[^"\\]|\\.)*")\n(\s*)\(at /g,
    (m, name: string, indent: string) => {
      const bare = JSON.parse(name);
      if (!names.has(bare)) return m;
      converted++;
      return `(global_label ${name}\n${indent}(shape passive)\n${indent}(at `;
    },
  );
  return { out, converted };
}

function uuidv5ish(seed: string): string {
  // Deterministic uuid-shaped string from a seed, so reruns are stable.
  const h = new Bun.CryptoHasher("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const rootUuid = uuidv5ish(`${PROJECT}-root`);

let totalConverted = 0;
for (const s of SHEETS) {
  const path = `${ROOT}/${s.file}`;
  const src = await Bun.file(path).text();
  let { out, converted } = globalize(src);
  // Point symbol instance paths at this sheet's position in the hierarchy
  // so annotation is consistent when the file loads as a sub-sheet.
  const ownUuid = out.match(/\(uuid "([^"]+)"\)/)?.[1];
  const blockUuid = uuidv5ish(`sheet-${s.file}`);
  if (ownUuid) {
    out = out
      .replaceAll(`(project ""`, `(project "${PROJECT}"`)
      .replaceAll(`(path "/${ownUuid}"`, `(path "/${rootUuid}/${blockUuid}"`);
  }
  // Power symbol references restart at 1 on every generated sheet; offset
  // them per sheet so the hierarchy annotates cleanly.
  const sheetNo = SHEETS.indexOf(s) + 1;
  out = out.replace(/"#(PWR|FLG)0*(\d+)"/g, (m, kind: string, n: string) => {
    const v = parseInt(n);
    if (v >= 1000) return m; // already offset
    return `"#${kind}${sheetNo * 1000 + v}"`;
  });
  await Bun.write(path, out);
  totalConverted += converted;
  console.log(`  ${s.file}: ${converted} labels globalized`);
}

const cols = 3;
const bw = 60;
const bh = 20;
const gapX = 20;
const gapY = 18;

const sheetBlocks = SHEETS.map((s, i) => {
  const x = 30 + (i % cols) * (bw + gapX);
  const y = 40 + Math.floor(i / cols) * (bh + gapY);
  const uid = uuidv5ish(`sheet-${s.file}`);
  return `	(sheet
		(at ${x} ${y})
		(size ${bw} ${bh})
		(fields_autoplaced yes)
		(stroke (width 0.1524) (type solid))
		(fill (color 0 0 0 0.0000))
		(uuid "${uid}")
		(property "Sheetname" "${s.name}"
			(at ${x} ${y - 0.8} 0)
			(effects (font (size 1.27 1.27)) (justify left bottom))
		)
		(property "Sheetfile" "${s.file}"
			(at ${x} ${y + bh + 0.8} 0)
			(effects (font (size 1.27 1.27)) (justify left top) (hide yes))
		)
		(instances
			(project "${PROJECT}"
				(path "/${rootUuid}"
					(page "${i + 2}")
				)
			)
		)
	)`;
}).join("\n");

const rootSch = `(kicad_sch
	(version 20260306)
	(generator "assemble")
	(generator_version "1.0")
	(uuid "${rootUuid}")
	(paper "A4")
	(title_block
		(title "cc1200-balloon: high altitude balloon telemetry and air quality payload")
		(comment 1 "Wio-E5 (STM32WLE5JC) host, CC1200 sub-GHz telemetry downlink,")
		(comment 2 "AT6558R GNSS, SCD40 CO2, AS3935 lightning, 2x BME688, BMV080 PM")
		(comment 3 "Unregulated 3.6 V max battery, P-FET reverse block and load switch")
	)
	(lib_symbols)
${sheetBlocks}
	(sheet_instances
		(path "/"
			(page "1")
		)
	)
)
`;

await Bun.write(`${ROOT}/${PROJECT}.kicad_sch`, rootSch);

const pro = {
  board: { design_settings: {}, layer_presets: [], viewports: [] },
  libraries: { pinned_footprint_libs: [], pinned_symbol_libs: [] },
  meta: { filename: `${PROJECT}.kicad_pro`, version: 3 },
  net_settings: { classes: [], meta: { version: 4 } },
  schematic: {
    annotate_start_num: 0,
    drawing: { default_line_thickness: 6, default_text_size: 50 },
    legacy_lib_dir: "",
    legacy_lib_list: [],
    meta: { version: 1 },
    net_format_name: "",
    page_layout_descr_file: "",
    plot_directory: "",
    spice_current_sheet_as_root: false,
    spice_external_command: "",
    spice_model_current_sheet_as_root: true,
    spice_save_all_currents: false,
    spice_save_all_dissipations: false,
    spice_save_all_voltages: false,
    subpart_first_id: 65,
    subpart_id_separator: 0,
  },
  sheets: [],
  text_variables: {},
};
/**
 * The template above is only a bootstrap for a fresh checkout. Everything
 * KiCad adds the first time the project is opened - board design settings,
 * net classes, ERC severities and exclusions, BOM presets - belongs to the
 * project, not to the generator, and rewriting the file from the template
 * every build silently reset all of it. So an existing file wins key by
 * key, and the template only fills in what is missing.
 */
function fillMissing(into: Record<string, unknown>, from: Record<string, unknown>) {
  for (const [k, v] of Object.entries(from)) {
    if (!(k in into)) into[k] = v;
    else if (isPlainObject(into[k]) && isPlainObject(v))
      fillMissing(into[k] as Record<string, unknown>, v as Record<string, unknown>);
  }
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const proPath = `${ROOT}/${PROJECT}.kicad_pro`;
const existing: Record<string, unknown> | null = await Bun.file(proPath)
  .json()
  .catch(() => null);
const project = existing ?? (pro as unknown as Record<string, unknown>);
if (existing) {
  const before = JSON.stringify(project);
  fillMissing(project, pro as unknown as Record<string, unknown>);
  // Nothing to add: leave the file alone rather than round-tripping it
  // through JSON.stringify, which would rewrite every "1.0" as "1".
  if (JSON.stringify(project) === before) {
    console.log("  project file already complete, left as is");
  } else {
    await Bun.write(proPath, JSON.stringify(project, null, 2) + "\n");
  }
} else {
  await Bun.write(proPath, JSON.stringify(project, null, 2) + "\n");
}

await Bun.write(
  `${ROOT}/sym-lib-table`,
  `(sym_lib_table
  (version 7)
  (lib (name "${PROJECT}") (type "KiCad") (uri "\${KIPRJMOD}/lib/${PROJECT}.kicad_sym") (options "") (descr "Symbols with no stock KiCad equivalent"))
)
`,
);
await Bun.write(
  `${ROOT}/fp-lib-table`,
  `(fp_lib_table
  (version 7)
  (lib (name "${PROJECT}") (type "KiCad") (uri "\${KIPRJMOD}/lib/${PROJECT}.pretty") (options "") (descr "Land patterns with no stock KiCad equivalent"))
)
`,
);

console.log(`  root sheet + project written, ${totalConverted} labels globalized total`);
