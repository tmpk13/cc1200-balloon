/**
 * Minimal .kicad_sch reader: s-expression parser plus the extraction the
 * flow-wire bridge needs - symbol bodies, absolute pin anchors with outward
 * directions, wires, junctions, labels, and point-level connectivity.
 *
 * This is the "reader" half of flow-wire's KiCad seam, scoped to the
 * kicad-vis output it consumes (single sheet, 1.27 mm grid).
 */

export type SExpr = string | SExpr[];

export function parseSexpr(src: string): SExpr {
  let i = 0;
  function skipWs() {
    while (i < src.length && /\s/.test(src[i])) i++;
  }
  function node(): SExpr {
    skipWs();
    if (src[i] === "(") {
      i++;
      const list: SExpr[] = [];
      for (;;) {
        skipWs();
        if (src[i] === ")") {
          i++;
          return list;
        }
        list.push(node());
      }
    }
    if (src[i] === '"') {
      i++;
      let out = "";
      while (src[i] !== '"') {
        if (src[i] === "\\") {
          i++;
        }
        out += src[i++];
      }
      i++;
      return JSON.parse(`"${out.replace(/"/g, '\\"')}"`) as string;
    }
    let out = "";
    while (i < src.length && !/[\s()]/.test(src[i])) out += src[i++];
    return out;
  }
  return node();
}

export function children(e: SExpr, tag: string): SExpr[][] {
  if (!Array.isArray(e)) return [];
  return e.filter((c): c is SExpr[] => Array.isArray(c) && c[0] === tag);
}

export function child(e: SExpr, tag: string): SExpr[] | undefined {
  return children(e, tag)[0];
}

export function atom(e: SExpr | undefined, idx: number): string {
  if (!e || !Array.isArray(e)) return "";
  const v = e[idx];
  return typeof v === "string" ? v : "";
}

export interface LibPin {
  number: string;
  name: string;
  type: string;
  x: number;
  y: number;
  angle: number; // 0 right, 90 up, 180 left, 270 down (symbol space, +y up)
  length: number;
}

export interface LibSymbol {
  id: string;
  pins: LibPin[];
  /** Body bbox in symbol space from graphic items (excludes pins). */
  body: { minx: number; miny: number; maxx: number; maxy: number } | null;
}

export interface Instance {
  ref: string;
  libId: string;
  x: number;
  y: number;
  rot: number;
  mirror: "" | "x" | "y";
  uuid: string;
}

export interface SchLabel {
  name: string;
  x: number;
  y: number;
  angle: number;
  global: boolean;
}

export interface Sheet {
  libSymbols: Map<string, LibSymbol>;
  instances: Instance[];
  wires: { x1: number; y1: number; x2: number; y2: number }[];
  junctions: { x: number; y: number }[];
  labels: SchLabel[];
  noConnects: { x: number; y: number }[];
}

function num(s: string): number {
  return parseFloat(s);
}

export function readSheet(root: SExpr): Sheet {
  const libSymbols = new Map<string, LibSymbol>();
  const libs = child(root, "lib_symbols");
  if (libs) {
    for (const sym of children(libs, "symbol")) {
      const id = atom(sym, 1);
      const pins: LibPin[] = [];
      let body: LibSymbol["body"] = null;
      const extend = (x: number, y: number) => {
        if (!body) body = { minx: x, miny: y, maxx: x, maxy: y };
        else {
          body.minx = Math.min(body.minx, x);
          body.miny = Math.min(body.miny, y);
          body.maxx = Math.max(body.maxx, x);
          body.maxy = Math.max(body.maxy, y);
        }
      };
      for (const unit of children(sym, "symbol")) {
        for (const pin of children(unit, "pin")) {
          const at = child(pin, "at");
          pins.push({
            number: atom(child(pin, "number"), 1),
            name: atom(child(pin, "name"), 1),
            type: atom(pin, 1),
            x: num(atom(at, 1)),
            y: num(atom(at, 2)),
            angle: num(atom(at, 3) || "0"),
            length: num(atom(child(pin, "length"), 1) || "0"),
          });
        }
        for (const r of children(unit, "rectangle")) {
          const s = child(r, "start");
          const e = child(r, "end");
          extend(num(atom(s, 1)), num(atom(s, 2)));
          extend(num(atom(e, 1)), num(atom(e, 2)));
        }
        for (const p of children(unit, "polyline")) {
          const pts = child(p, "pts");
          for (const xy of children(pts ?? [], "xy")) extend(num(atom(xy, 1)), num(atom(xy, 2)));
        }
        for (const c of children(unit, "circle")) {
          const ce = child(c, "center");
          const rr = num(atom(child(c, "radius"), 1) || "0");
          extend(num(atom(ce, 1)) - rr, num(atom(ce, 2)) - rr);
          extend(num(atom(ce, 1)) + rr, num(atom(ce, 2)) + rr);
        }
        for (const a of children(unit, "arc")) {
          for (const tag of ["start", "mid", "end"]) {
            const p = child(a, tag);
            if (p) extend(num(atom(p, 1)), num(atom(p, 2)));
          }
        }
      }
      libSymbols.set(id, { id, pins, body });
    }
  }

  const instances: Instance[] = [];
  for (const s of children(root, "symbol")) {
    const at = child(s, "at");
    let ref = "";
    for (const p of children(s, "property")) {
      if (atom(p, 1) === "Reference") ref = atom(p, 2);
    }
    const mirror = atom(child(s, "mirror"), 1) as "" | "x" | "y";
    instances.push({
      ref,
      libId: atom(child(s, "lib_id"), 1),
      x: num(atom(at, 1)),
      y: num(atom(at, 2)),
      rot: num(atom(at, 3) || "0"),
      mirror: mirror || "",
      uuid: atom(child(s, "uuid"), 1),
    });
  }

  const wires = children(root, "wire").map((w) => {
    const pts = children(child(w, "pts") ?? [], "xy");
    return {
      x1: num(atom(pts[0], 1)),
      y1: num(atom(pts[0], 2)),
      x2: num(atom(pts[1], 1)),
      y2: num(atom(pts[1], 2)),
    };
  });
  const junctions = children(root, "junction").map((j) => {
    const at = child(j, "at");
    return { x: num(atom(at, 1)), y: num(atom(at, 2)) };
  });
  const labels: SchLabel[] = [];
  for (const [tag, global] of [
    ["label", false],
    ["global_label", true],
  ] as const) {
    for (const l of children(root, tag)) {
      const at = child(l, "at");
      labels.push({
        name: atom(l, 1),
        x: num(atom(at, 1)),
        y: num(atom(at, 2)),
        angle: num(atom(at, 3) || "0"),
        global,
      });
    }
  }
  const noConnects = children(root, "no_connect").map((n) => {
    const at = child(n, "at");
    return { x: num(atom(at, 1)), y: num(atom(at, 2)) };
  });

  return { libSymbols, instances, wires, junctions, labels, noConnects };
}

export interface AbsPin {
  inst: Instance;
  pin: LibPin;
  /** Absolute attachment point on the schematic. */
  x: number;
  y: number;
  /** Direction a wire leaves the pin, schematic space (E/S/W/N as dx,dy). */
  dx: number;
  dy: number;
}

/**
 * Symbol-space to schematic-space: mirror, then rotate CCW by rot, then
 * flip y (symbol +y is up, schematic +y is down), then translate.
 */
export function transformPoint(
  inst: Instance,
  px: number,
  py: number,
): { x: number; y: number } {
  let x = px;
  let y = py;
  if (inst.mirror === "x") y = -y;
  if (inst.mirror === "y") x = -x;
  const r = ((inst.rot % 360) + 360) % 360;
  let rx = x;
  let ry = y;
  if (r === 90) {
    rx = -y;
    ry = x;
  } else if (r === 180) {
    rx = -x;
    ry = -y;
  } else if (r === 270) {
    rx = y;
    ry = -x;
  }
  return { x: inst.x + rx, y: inst.y - ry };
}

/** Direction (unit vector, schematic space) a wire travels leaving the pin. */
export function pinOutDir(inst: Instance, pin: LibPin): { dx: number; dy: number } {
  // Pin angle points from attachment toward the body; the wire leaves the
  // opposite way, i.e. along the pin angle direction reversed... In KiCad,
  // pin (at x y angle) has the attachment at (x,y) and the pin line drawn
  // toward the body at `angle`; a wire leaves opposite to `angle`.
  const a = ((pin.angle % 360) + 360) % 360;
  let dx = -1;
  let dy = 0;
  if (a === 0) {
    dx = -1;
    dy = 0;
  } // pin points right into body, wire leaves left
  else if (a === 90) {
    dx = 0;
    dy = -1;
  } // pin points up into body (symbol), wire leaves down (symbol) = up? handled below
  else if (a === 180) {
    dx = 1;
    dy = 0;
  } else if (a === 270) {
    dx = 0;
    dy = 1;
  }
  // dx,dy currently in symbol space with +y up; apply mirror/rot, then flip y.
  let x = dx;
  let y = dy;
  if (inst.mirror === "x") y = -y;
  if (inst.mirror === "y") x = -x;
  const r = ((inst.rot % 360) + 360) % 360;
  let rx = x;
  let ry = y;
  if (r === 90) {
    rx = -y;
    ry = x;
  } else if (r === 180) {
    rx = -x;
    ry = -y;
  } else if (r === 270) {
    rx = y;
    ry = -x;
  }
  return { dx: rx, dy: -ry };
}

export function absolutePins(sheet: Sheet): AbsPin[] {
  const out: AbsPin[] = [];
  for (const inst of sheet.instances) {
    const lib = sheet.libSymbols.get(inst.libId);
    if (!lib) continue;
    for (const pin of lib.pins) {
      const p = transformPoint(inst, pin.x, pin.y);
      const d = pinOutDir(inst, pin);
      out.push({ inst, pin, x: p.x, y: p.y, dx: d.dx, dy: d.dy });
    }
  }
  return out;
}

const K = 100; // snap to 0.01 mm

export function key(x: number, y: number): string {
  return `${Math.round(x * K)},${Math.round(y * K)}`;
}

/**
 * Point-level connectivity: wires split at every node point that lies on
 * them, endpoints unioned, pins/labels attached at their points.
 * Returns a map from point key to group id plus the union-find.
 */
export function traceConnectivity(sheet: Sheet, pins: AbsPin[]): Map<string, number> {
  const points = new Set<string>();
  const addPt = (x: number, y: number) => points.add(key(x, y));
  for (const w of sheet.wires) {
    addPt(w.x1, w.y1);
    addPt(w.x2, w.y2);
  }
  for (const j of sheet.junctions) addPt(j.x, j.y);
  for (const l of sheet.labels) addPt(l.x, l.y);
  for (const p of pins) addPt(p.x, p.y);

  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(a, r);
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const ptList = [...points].map((k) => {
    const [xs, ys] = k.split(",");
    return { k, x: parseInt(xs), y: parseInt(ys) };
  });

  for (const w of sheet.wires) {
    const x1 = Math.round(w.x1 * K);
    const y1 = Math.round(w.y1 * K);
    const x2 = Math.round(w.x2 * K);
    const y2 = Math.round(w.y2 * K);
    // collect node points on this segment (inclusive of endpoints), sorted
    const on = ptList.filter((p) => {
      if (x1 === x2) {
        return p.x === x1 && p.y >= Math.min(y1, y2) && p.y <= Math.max(y1, y2);
      }
      if (y1 === y2) {
        return p.y === y1 && p.x >= Math.min(x1, x2) && p.x <= Math.max(x1, x2);
      }
      return false;
    });
    on.sort((a, b) => (x1 === x2 ? a.y - b.y : a.x - b.x));
    for (let i = 1; i < on.length; i++) union(on[i - 1].k, on[i].k);
  }

  // KiCad connects wire crossings only at junctions; the split above unions
  // through mid-segment points, which matches kicad-vis output because it
  // only places node points at genuine connections plus junction dots.

  const groupOf = new Map<string, number>();
  let next = 0;
  const ids = new Map<string, number>();
  for (const p of points) {
    const r = parent.has(p) ? find(p) : p;
    if (!ids.has(r)) ids.set(r, next++);
    groupOf.set(p, ids.get(r)!);
  }
  return groupOf;
}
