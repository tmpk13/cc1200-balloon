/**
 * Build lib/cc1200_balloon.kicad_sym: the symbols this design needs that
 * either do not exist upstream or need a change.
 *
 * Everything else comes from the stock KiCad libraries. Regenerating is
 * deterministic - the file is written from these declarations only.
 */

const ROOT = `${import.meta.dir}/..`;
const OUT = `${ROOT}/lib/cc1200_balloon.kicad_sym`;

const FOREST_LIB = "/home/tmpk/forest/Forest-Sensor-Platform/buck-wio.kicad_sym";
const KICAD_RF_LIB = "/usr/share/kicad/symbols/RF.kicad_sym";

type ElecType =
  | "input"
  | "output"
  | "bidirectional"
  | "passive"
  | "power_in"
  | "power_out"
  | "no_connect"
  | "unspecified";

interface PinSpec {
  number: string;
  name: string;
  etype: ElecType;
  x: number;
  y: number;
  /** Pin angle: the direction from the tip towards the body. */
  angle: 0 | 90 | 180 | 270;
  length?: number;
}

interface SymbolSpec {
  name: string;
  reference: string;
  value: string;
  footprint: string;
  datasheet: string;
  description: string;
  keywords: string;
  fpFilters: string;
  body: { x0: number; y0: number; x1: number; y1: number };
  pins: PinSpec[];
}

/** Pull one complete (symbol "name" ...) block out of a library file. */
function extractSymbol(src: string, name: string): string {
  const start = src.indexOf(`(symbol "${name}"`);
  if (start < 0) throw new Error(`symbol ${name} not found`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated symbol ${name}`);
}

const font = (indent: string) =>
  `${indent}(effects\n${indent}\t(font\n${indent}\t\t(size 1.27 1.27)\n${indent}\t)\n${indent})`;

function renderPin(p: PinSpec, indent: string): string {
  const len = p.length ?? 2.54;
  return [
    `${indent}(pin ${p.etype} line`,
    `${indent}\t(at ${p.x} ${p.y} ${p.angle})`,
    `${indent}\t(length ${len})`,
    `${indent}\t(name "${p.name}"`,
    font(`${indent}\t\t`),
    `${indent}\t)`,
    `${indent}\t(number "${p.number}"`,
    font(`${indent}\t\t`),
    `${indent}\t)`,
    `${indent})`,
  ].join("\n");
}

function renderSymbol(s: SymbolSpec): string {
  const prop = (name: string, value: string, hide: boolean, y: number) =>
    [
      `\t\t(property "${name}" "${value}"`,
      `\t\t\t(at 0 ${y} 0)`,
      hide ? "\t\t\t(hide yes)" : null,
      font("\t\t\t"),
      "\t\t)",
    ]
      .filter((l) => l !== null)
      .join("\n");
  const b = s.body;
  return [
    `\t(symbol "${s.name}"`,
    "\t\t(exclude_from_sim no)",
    "\t\t(in_bom yes)",
    "\t\t(on_board yes)",
    prop("Reference", s.reference, false, b.y0 + 2.54),
    prop("Value", s.value, false, b.y1 - 2.54),
    prop("Footprint", s.footprint, true, 0),
    prop("Datasheet", s.datasheet, true, 0),
    prop("Description", s.description, true, 0),
    prop("ki_keywords", s.keywords, true, 0),
    prop("ki_fp_filters", s.fpFilters, true, 0),
    `\t\t(symbol "${s.name}_0_1"`,
    "\t\t\t(rectangle",
    `\t\t\t\t(start ${b.x0} ${b.y0})`,
    `\t\t\t\t(end ${b.x1} ${b.y1})`,
    "\t\t\t\t(stroke",
    "\t\t\t\t\t(width 0.254)",
    "\t\t\t\t\t(type solid)",
    "\t\t\t\t)",
    "\t\t\t\t(fill",
    "\t\t\t\t\t(type background)",
    "\t\t\t\t)",
    "\t\t\t)",
    "\t\t)",
    `\t\t(symbol "${s.name}_1_1"`,
    ...s.pins.map((p) => renderPin(p, "\t\t\t")),
    "\t\t)",
    "\t\t(embedded_fonts no)",
    "\t)",
  ].join("\n");
}

/**
 * Evenly spaced pin coordinates, every one a multiple of `step`. An even
 * count cannot be both symmetric about zero and on the grid, so it sits
 * half a step high rather than landing off-grid.
 */
function ladder(count: number, step = 2.54): number[] {
  const start = Math.floor((count - 1) / 2) * step;
  return Array.from({ length: count }, (_, i) =>
    Number((start - i * step).toFixed(2)),
  );
}

// --- AT6558R ------------------------------------------------------------
// QFN-40 5x5 mm, pin names from the AT6558 data sheet section 2.2. Pin 41
// is the exposed pad, which the data sheet names GND.
const at6558Left: [string, string, ElecType][] = [
  ["1", "LNA_IN", "passive"],
  ["40", "LNA_OUT", "passive"],
  ["38", "RFA_IN", "passive"],
  ["2", "ANT_BIAS", "passive"],
  ["3", "VANT_IN", "power_in"],
  ["30", "XREF", "input"],
  ["34", "RTC_XI", "input"],
  ["33", "RTC_XO", "output"],
  ["23", "nRST", "input"],
  ["29", "ON_OFF", "input"],
  ["28", "TEST", "input"],
  ["5", "TST_ANA", "passive"],
  ["7", "TST_DIG", "passive"],
];
const at6558Right: [string, string, ElecType][] = [
  ["19", "GPIO0/TXD1", "bidirectional"],
  ["20", "GPIO1/RXD1", "bidirectional"],
  ["11", "GPIO2/SCL", "bidirectional"],
  ["12", "GPIO3/SDA", "bidirectional"],
  ["15", "GPIO4/TXD2", "bidirectional"],
  ["16", "GPIO5/RXD2", "bidirectional"],
  ["21", "GPIO6/1PPS", "bidirectional"],
  ["9", "GPIO7", "bidirectional"],
  ["8", "GPIO8", "bidirectional"],
  ["10", "GPIO9", "bidirectional"],
  ["17", "TMS", "bidirectional"],
  ["18", "TCK", "input"],
];
const at6558Top: [string, string, ElecType][] = [
  ["27", "DCDC_IN", "power_in"],
  ["25", "VDD_BBLDO", "power_in"],
  ["14", "VDD_IO", "power_in"],
  ["22", "VDD_POR", "power_in"],
  ["31", "VDD_BK", "power_in"],
  ["4", "VDD_RFLDO", "power_in"],
  ["35", "VDD_PLDO", "power_in"],
  ["13", "VDD12_BB", "power_in"],
  ["39", "VDD_RF", "passive"],
];
const at6558Bottom: [string, string, ElecType][] = [
  ["26", "DCDC_OUT", "passive"],
  ["24", "BBLDO_OUT", "power_out"],
  ["6", "AVDD", "power_out"],
  ["32", "VDD12_BK", "passive"],
  ["36", "DVDD", "passive"],
  ["37", "VDD_PLL", "passive"],
  ["41", "GND", "power_in"],
];

const at6558: SymbolSpec = {
  name: "AT6558R",
  reference: "U",
  value: "AT6558R-5N32",
  footprint: "Package_DFN_QFN:QFN-40-1EP_5x5mm_P0.4mm_EP3.6x3.6mm",
  datasheet: "https://www.lcsc.com/datasheet/lcsc_datasheet_2208031800_ZHONGKEWEI-AT6558R-5N32_C500608.pdf",
  description: "BDS/GNSS multi-constellation receiver SoC, QFN-40 5x5mm",
  keywords: "GNSS GPS BeiDou GLONASS receiver",
  fpFilters: "QFN*5x5mm*P0.4mm*",
  body: { x0: -20.32, y0: 20.32, x1: 20.32, y1: -20.32 },
  pins: [
    ...at6558Left.map(([number, name, etype], i) => ({
      number, name, etype, x: -22.86, y: ladder(at6558Left.length)[i], angle: 0 as const,
    })),
    ...at6558Right.map(([number, name, etype], i) => ({
      number, name, etype, x: 22.86, y: ladder(at6558Right.length)[i], angle: 180 as const,
    })),
    ...at6558Top.map(([number, name, etype], i) => ({
      number, name, etype, x: ladder(at6558Top.length)[i], y: 22.86, angle: 270 as const,
    })),
    ...at6558Bottom.map(([number, name, etype], i) => ({
      number, name, etype, x: ladder(at6558Bottom.length)[i], y: -22.86, angle: 90 as const,
    })),
  ],
};

// --- BMV080 -------------------------------------------------------------
// The sensor is a flex-PCB module, so the "symbol" is the 13 contacts of
// its ZIF connector; the footprint is the mating connector on our board.
// Numbering follows the data sheet's own contact numbers (table 11), which
// is also the KYOCERA connector's contact order.
// Supplies point up and grounds point down, the usual IC convention. It is
// not only tidier: with both on one edge the auto-placed power symbols put a
// +3V3 stub and a GND stub on the same vertical line, and the router shorted
// the rails together through the pin escapes.
const bmvTop: [string, string, ElecType][] = [
  ["1", "VDDL", "power_in"],
  ["3", "VDDA", "power_in"],
  ["10", "VDDD", "power_in"],
  ["8", "VDDIO", "power_in"],
];
const bmvBottom: [string, string, ElecType][] = [
  ["2", "VSSA", "power_in"],
  ["9", "VSSD", "power_in"],
  ["7", "PS", "input"],
];
const bmvRight: [string, string, ElecType][] = [
  ["4", "CSB", "input"],
  ["6", "SCK", "input"],
  ["5", "MOSI/SDA", "bidirectional"],
  ["11", "MISO", "bidirectional"],
  ["12", "~{IRQ}", "output"],
  ["13", "DNC", "no_connect"],
];

const bmv080: SymbolSpec = {
  name: "BMV080",
  reference: "U",
  value: "BMV080",
  footprint: "cc1200_balloon:Kyocera_046844713002846_FPC-13_P0.30mm",
  datasheet: "https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmv080-ds000.pdf",
  description: "Ultra-mini particulate matter sensor on flex PCB, 13-pin 0.3mm ZIF",
  keywords: "particulate matter PM2.5 sensor SPI I2C",
  fpFilters: "FPC*13*P0.30mm*",
  body: { x0: -10.16, y0: 10.16, x1: 10.16, y1: -10.16 },
  pins: [
    ...bmvTop.map(([number, name, etype], i) => ({
      number, name, etype, x: ladder(bmvTop.length)[i], y: 12.7, angle: 270 as const,
    })),
    ...bmvBottom.map(([number, name, etype], i) => ({
      number, name, etype, x: ladder(bmvBottom.length)[i], y: -12.7, angle: 90 as const,
    })),
    ...bmvRight.map(([number, name, etype], i) => ({
      number, name, etype, x: 12.7, y: ladder(bmvRight.length)[i], angle: 180 as const,
    })),
  ],
};

// --- CC1200 -------------------------------------------------------------
// RF:CC1200 omits package pin 16 (N.C.). The pin exists on the QFN and the
// PCB has to land a pad on it, so add it. It is drawn `passive` rather than
// `no_connect` because KiCad drops no_connect pins from the netlist, which
// would leave the pad unreachable from the board.
function cc1200WithNc(src: string): string {
  const block = extractSymbol(src, "CC1200");
  const pin16 = renderPin(
    { number: "16", name: "N.C.", etype: "passive", x: -17.78, y: -22.86, angle: 0, length: 3.81 },
    "\t\t\t",
  );
  const marker = '\t\t(symbol "CC1200_1_1"\n';
  const at = block.indexOf(marker);
  if (at < 0) throw new Error("CC1200_1_1 unit not found");
  const insertAt = at + marker.length;
  return block.slice(0, insertAt) + pin16 + "\n" + block.slice(insertAt);
}

// --- Wio-E5 -------------------------------------------------------------
// Reused verbatim from the Forest sensor platform, which already has the
// 28-pin module drawn and pin-checked. Only the empty metadata fields are
// filled in, so the graphics and pin numbering stay bit-identical.
function withFields(block: string, fields: Record<string, string>): string {
  let out = block;
  for (const [name, value] of Object.entries(fields)) {
    const re = new RegExp(`\\(property "${name}" "[^"]*"`);
    if (!re.test(out)) throw new Error(`property ${name} not present`);
    out = out.replace(re, `(property "${name}" "${value}"`);
  }
  return out;
}

// --- assemble -----------------------------------------------------------
const forest = await Bun.file(FOREST_LIB).text();
const rf = await Bun.file(KICAD_RF_LIB).text();

const blocks = [
  withFields(extractSymbol(forest, "Wio-E5"), {
    Value: "Wio-E5",
    Footprint: "cc1200_balloon:WIO-E5",
    Datasheet: "https://files.seeedstudio.com/products/317990687/res/LoRa-E5%20module%20datasheet_V1.0.pdf",
    Description: "Seeed Wio-E5 LoRa module, STM32WLE5JC, 28-pin SMD",
  }),
  cc1200WithNc(rf),
  renderSymbol(at6558),
  renderSymbol(bmv080),
];

const out = [
  "(kicad_symbol_lib",
  "\t(version 20251024)",
  '\t(generator "gen_symbols")',
  '\t(generator_version "1.0")',
  ...blocks.map((b) => "\t" + b.trimStart()),
  ")",
  "",
].join("\n");

await Bun.write(OUT, out);
console.log(`  lib/cc1200_balloon.kicad_sym: ${blocks.length} symbols`);
