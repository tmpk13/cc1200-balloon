/**
 * Build lib/cc1200_balloon.3dshapes from models/*.scad.
 *
 * OpenSCAD renders each part to an STL in millimetres; that is then
 * rewritten as VRML97, which is what KiCad's own model library uses and
 * what the generated footprints reference. KiCad reads .wrl in units of
 * 0.1 inch, so every coordinate is divided by 2.54 on the way out.
 *
 * The .stl files are kept alongside: they are the millimetre-accurate
 * source a mechanical CAD tool can import directly.
 */

const ROOT = `${import.meta.dir}/..`;
const SRC = `${ROOT}/models`;
const OUT = `${ROOT}/lib/cc1200_balloon.3dshapes`;

const WRL_UNIT = 2.54; // mm per KiCad VRML unit

interface Part {
  scad: string;
  wrl: string;
  /** VRML diffuse colour, 0..1 per channel. */
  color: [number, number, number];
}

const PARTS: Part[] = [
  { scad: "wio_e5.scad", wrl: "WIO-E5.wrl", color: [0.75, 0.76, 0.78] },
  { scad: "at6558r_qfn40.scad", wrl: "AT6558R_QFN-40_5x5mm.wrl", color: [0.15, 0.15, 0.16] },
  { scad: "kyocera_6844_fpc13.scad", wrl: "Kyocera_6844_FPC-13.wrl", color: [0.9, 0.87, 0.78] },
  { scad: "l_axial_d2p8_l7p2.scad", wrl: "L_Axial_D2.8mm_L7.2mm.wrl", color: [0.22, 0.19, 0.17] },
  { scad: "supercap_kemet_fcs.scad", wrl: "SuperCap_KEMET_FCS_D10.7mm.wrl", color: [0.2, 0.2, 0.22] },
];

/**
 * Triangles of an STL, in the file's own units (mm here). OpenSCAD 2021.01
 * writes ASCII by default; binary is accepted too so a newer OpenSCAD or a
 * hand-supplied mesh still works.
 */
function readStl(buf: ArrayBuffer): number[][] {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, 5));
  const tris: number[][] = [];
  if (head === "solid") {
    const text = new TextDecoder().decode(buf);
    let current: number[] = [];
    for (const m of text.matchAll(
      /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g,
    )) {
      current.push(Number(m[1]), Number(m[2]), Number(m[3]));
      if (current.length === 9) {
        tris.push(current);
        current = [];
      }
    }
    if (current.length) throw new Error("STL ended mid-triangle");
    return tris;
  }
  const view = new DataView(buf);
  const count = view.getUint32(80, true);
  for (let i = 0; i < count; i++) {
    const base = 84 + i * 50 + 12; // skip the per-facet normal
    const t: number[] = [];
    for (let v = 0; v < 9; v++) t.push(view.getFloat32(base + v * 4, true));
    tris.push(t);
  }
  return tris;
}

function toVrml(tris: number[][], color: [number, number, number], source: string): string {
  // OpenSCAD does not promise a stable facet order between runs, so sort the
  // triangles before indexing: an unchanged .scad then produces an unchanged
  // .wrl instead of the same mesh with the vertices shuffled.
  const ordered = [...tris].sort((a, b) => {
    for (let i = 0; i < 9; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  // Weld identical vertices so the mesh shades as a solid rather than as
  // loose facets, and so the file stays small.
  const index = new Map<string, number>();
  const points: string[] = [];
  const faces: string[] = [];
  const q = (v: number) => (v / WRL_UNIT).toFixed(6);
  for (const t of ordered) {
    const idx: number[] = [];
    for (let v = 0; v < 3; v++) {
      const key = `${q(t[v * 3])} ${q(t[v * 3 + 1])} ${q(t[v * 3 + 2])}`;
      let i = index.get(key);
      if (i === undefined) {
        i = points.length;
        index.set(key, i);
        points.push(key);
      }
      idx.push(i);
    }
    faces.push(`${idx[0]} ${idx[1]} ${idx[2]} -1`);
  }
  const [r, g, b] = color;
  return `#VRML V2.0 utf8
# Generated from models/${source} by tools/gen_3d.ts (OpenSCAD -> STL -> VRML).
# Coordinates are millimetres divided by 2.54, the unit KiCad expects.

Shape {
  appearance Appearance {
    material Material {
      diffuseColor ${r} ${g} ${b}
      specularColor 0.1 0.1 0.1
      ambientIntensity 0.3
      shininess 0.2
    }
  }
  geometry IndexedFaceSet {
    solid TRUE
    creaseAngle 0.7
    coord Coordinate {
      point [
${points.map((p) => `        ${p}`).join(",\n")}
      ]
    }
    coordIndex [
${faces.map((f) => `        ${f}`).join(",\n")}
    ]
  }
}
`;
}

let built = 0;
for (const part of PARTS) {
  const stl = `${OUT}/${part.wrl.replace(/\.wrl$/, ".stl")}`;
  const render = Bun.spawnSync(["openscad", "-o", stl, `${SRC}/${part.scad}`], {
    stderr: "pipe",
  });
  if (render.exitCode !== 0) {
    console.error(`  ${part.scad}: openscad failed\n${render.stderr.toString()}`);
    process.exit(1);
  }
  const tris = readStl(await Bun.file(stl).arrayBuffer());
  await Bun.write(`${OUT}/${part.wrl}`, toVrml(tris, part.color, part.scad));
  console.log(`  ${part.wrl}: ${tris.length} triangles`);
  built++;
}
console.log(`  lib/cc1200_balloon.3dshapes: ${built} models`);
