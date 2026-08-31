/**
 * flow-wire bridge: re-route the wires of a generated .kicad_sch with the
 * flow-wire river router, preserving connectivity exactly.
 *
 * The sheet is read into flow-wire's Design: symbol bodies become blocked
 * rectangles, pins become anchors with outward directions, and each
 * wire-connected cluster becomes one net. Labels that sit mid-wire become
 * fixed zero-size pseudo-pins, so label-based connectivity is untouched.
 * If any net fails to route or the flow-wire DRC objects, the sheet keeps
 * its original wiring and the failure is reported.
 */

import { runDrc } from "/home/tmpk/flow-wire/src/core/drc";
import { DEFAULT_PARAMS, type Params } from "/home/tmpk/flow-wire/src/core/params";
import { FlowRouter } from "/home/tmpk/flow-wire/src/core/router";
import type { Component, Design, Net, Pin } from "/home/tmpk/flow-wire/src/core/model";
import type { Dir } from "/home/tmpk/flow-wire/src/core/geom";
import { toKicad, toSExpr } from "/home/tmpk/flow-wire/src/io/kicad";
import {
  absolutePins,
  key,
  parseSexpr,
  readSheet,
  traceConnectivity,
  transformPoint,
  type AbsPin,
} from "./schlib";

const GRID = 1.27;
const ROOT = `${import.meta.dir}/..`;

/**
 * Nets joined only by label name get merged into real routed wires when
 * they have at most this many pin terminals. Bigger nets are distribution
 * rails where labels read better than a wire tree.
 */
const WIRE_MAX_PINS = 9;

function toGu(mm: number): number {
  return mm / GRID;
}

function isInt(v: number): boolean {
  return Math.abs(v - Math.round(v)) < 0.02;
}

function dirOf(dx: number, dy: number): Dir {
  if (dx > 0.5) return 0; // E
  if (dy > 0.5) return 1; // S
  if (dx < -0.5) return 2; // W
  return 3; // N
}

/**
 * Replace flow-wire's random wire and junction uuids with ones derived from
 * the element's own coordinates.
 *
 * flow-wire emits crypto.randomUUID() per element, so an otherwise identical
 * regeneration rewrites every uuid in the file. That turns a no-op rebuild
 * into a 200-line diff and, worse, makes KiCad treat the wires as new
 * objects when the schematic is re-synchronised to a board.
 */
function stableUuids(sexpr: string): string {
  return sexpr.replace(
    /\(wire\s*\(pts ([^)]*\)[^)]*\))\)([\s\S]*?)\(uuid "[^"]+"\)/g,
    (m, pts: string, mid: string) =>
      m.replace(/\(uuid "[^"]+"\)/, `(uuid "${seedUuid(`wire ${pts}`)}")`),
  ).replace(
    /\(junction \(at ([-\d.]+) ([-\d.]+)\)([\s\S]*?)\(uuid "[^"]+"\)/g,
    (m, x: string, y: string) =>
      m.replace(/\(uuid "[^"]+"\)/, `(uuid "${seedUuid(`junction ${x} ${y}`)}")`),
  );
}

function seedUuid(seed: string): string {
  const h = new Bun.CryptoHasher("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function bridgeSheet(src: string): { out: string; report: string; ok: boolean } {
  const sheet = readSheet(parseSexpr(src));
  const pins = absolutePins(sheet);
  const groupOf = traceConnectivity(sheet, pins);

  // --- anchors ---------------------------------------------------------
  interface Anchor {
    kind: "pin" | "label";
    x: number;
    y: number;
    dir: Dir;
    id: string;
  }
  const anchors = new Map<string, Anchor[]>(); // by point key
  const push = (a: Anchor) => {
    const k = key(a.x, a.y);
    if (!anchors.has(k)) anchors.set(k, []);
    anchors.get(k)!.push(a);
  };
  // Two pins stacked on the same point (a power symbol sitting directly on
  // a component pin) collapse to one flow-wire pin; the real symbol's pin
  // wins and the stacked one connects by coincidence, as drawn.
  const claim = new Map<string, string>();
  const sortedPins = [...pins].sort((a, b) => {
    const ap = a.inst.libId.startsWith("power:") ? 1 : 0;
    const bp = b.inst.libId.startsWith("power:") ? 1 : 0;
    return ap - bp;
  });
  for (const p of sortedPins) {
    const k = key(p.x, p.y);
    if (!claim.has(k)) claim.set(k, `${p.inst.uuid}.${p.pin.number}`);
  }
  for (const p of pins) {
    const id = `${p.inst.uuid}.${p.pin.number}`;
    if (claim.get(key(p.x, p.y)) !== id) continue;
    push({
      kind: "pin",
      x: p.x,
      y: p.y,
      dir: dirOf(p.dx, p.dy),
      id,
    });
  }
  // Labels are re-anchored onto the nearest pin of their connectivity
  // group: connectivity by name then rides the pin point, and the router
  // never has to reach a mid-air label. Only a label in a group without
  // any pin keeps a pseudo-pin at its original spot.
  const wireDirAt = (x: number, y: number): Dir | null => {
    for (const w of sheet.wires) {
      const k1 = key(w.x1, w.y1) === key(x, y);
      const k2 = key(w.x2, w.y2) === key(x, y);
      if (!k1 && !k2) continue;
      const dx = k1 ? w.x2 - w.x1 : w.x1 - w.x2;
      const dy = k1 ? w.y2 - w.y1 : w.y1 - w.y2;
      return dirOf(Math.sign(dx), Math.sign(dy));
    }
    return null;
  };
  // --- merge label-joined clusters into routable nets -------------------
  // kicad-vis connects most of a sheet by repeating a label at every pin.
  // Where a name joins several clusters and the net is small enough to
  // read as wires, union the clusters so flow-wire routes the whole net,
  // keep one label to carry the name (and inter-sheet reach for globals),
  // and delete the rest.
  const rawPinsByGroup = new Map<number, AbsPin[]>();
  for (const p of pins) {
    const id = `${p.inst.uuid}.${p.pin.number}`;
    if (claim.get(key(p.x, p.y)) !== id) continue;
    const g = groupOf.get(key(p.x, p.y));
    if (g === undefined) continue;
    if (!rawPinsByGroup.has(g)) rawPinsByGroup.set(g, []);
    rawPinsByGroup.get(g)!.push(p);
  }
  const powerGroups = new Set<number>();
  for (const p of pins) {
    if (!p.inst.libId.startsWith("power:")) continue;
    const g = groupOf.get(key(p.x, p.y));
    if (g !== undefined) powerGroups.add(g);
  }
  const byName = new Map<string, { labels: (typeof sheet.labels)[number][]; groups: Set<number> }>();
  for (const l of sheet.labels) {
    const g = groupOf.get(key(l.x, l.y));
    if (g === undefined) continue;
    if (!byName.has(l.name)) byName.set(l.name, { labels: [], groups: new Set() });
    const e = byName.get(l.name)!;
    e.labels.push(l);
    e.groups.add(g);
  }
  const mergeParent = new Map<number, number>();
  const mg = (g: number): number => {
    let r = g;
    while (mergeParent.has(r) && mergeParent.get(r) !== r) r = mergeParent.get(r)!;
    mergeParent.set(g, r);
    return r;
  };
  const dropLabels = new Set<(typeof sheet.labels)[number]>();
  let mergedNames = 0;
  for (const [, e] of byName) {
    if (e.groups.size < 2) continue;
    if ([...e.groups].some((g) => powerGroups.has(g))) continue;
    const pinCount = [...e.groups].reduce((n, g) => n + (rawPinsByGroup.get(g)?.length ?? 0), 0);
    if (pinCount < 2 || pinCount > WIRE_MAX_PINS) continue;
    const groups = [...e.groups];
    for (let i = 1; i < groups.length; i++) mergeParent.set(mg(groups[i]), mg(groups[0]));
    // keep the first label as the net's name tag, drop the duplicates
    for (const l of e.labels.slice(1)) dropLabels.add(l);
    mergedNames++;
  }
  const pinsByGroup = new Map<number, AbsPin[]>();
  for (const [g, list] of rawPinsByGroup) {
    const m = mg(g);
    if (!pinsByGroup.has(m)) pinsByGroup.set(m, []);
    pinsByGroup.get(m)!.push(...list);
  }
  interface LabelMove {
    label: (typeof sheet.labels)[number];
    x: number;
    y: number;
    angle: number;
  }
  const moves: LabelMove[] = [];
  const takenPins = new Set<string>();
  const dbg = process.env.FW_DEBUG;
  let li = 0;
  for (const l of sheet.labels) {
    if (dbg && l.name === dbg)
      console.log(
        `[dbg] ${l.name}@${l.x},${l.y} dropped=${dropLabels.has(l)} group=${groupOf.get(key(l.x, l.y))} gp=${(pinsByGroup.get(mg(groupOf.get(key(l.x, l.y)) ?? -1)) ?? []).length}`,
      );
    if (dropLabels.has(l)) continue;
    const k = key(l.x, l.y);
    const onPin = (anchors.get(k) ?? []).some((a) => a.kind === "pin");
    if (onPin) continue;
    const g = groupOf.get(k);
    const gp = (g !== undefined && pinsByGroup.get(mg(g))) || [];
    if (gp.length > 0) {
      const free = gp.filter((p) => !takenPins.has(key(p.x, p.y)));
      const cand = free.length ? free : gp;
      cand.sort(
        (a, b) =>
          Math.abs(a.x - l.x) + Math.abs(a.y - l.y) - (Math.abs(b.x - l.x) + Math.abs(b.y - l.y)),
      );
      const p = cand[0];
      takenPins.add(key(p.x, p.y));
      const d = dirOf(p.dx, p.dy);
      const angle = d === 0 ? 0 : d === 3 ? 90 : d === 2 ? 180 : 270;
      moves.push({ label: l, x: p.x, y: p.y, angle });
      continue;
    }
    const d = wireDirAt(l.x, l.y);
    if (d === null) continue; // isolated label; nothing to wire
    push({ kind: "label", x: l.x, y: l.y, dir: d, id: `label:${l.name}:${li++}` });
  }

  // --- flow-wire components -------------------------------------------
  const comps: Component[] = [];
  const gux = (mm: number) => Math.round(toGu(mm));
  let offgrid = 0;

  for (const inst of sheet.instances) {
    const lib = sheet.libSymbols.get(inst.libId);
    if (!lib) continue;
    const instPins = pins.filter((p) => p.inst === inst);
    // body bbox in schematic mm: transform lib body corners
    let minx = Infinity;
    let miny = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    const extend = (x: number, y: number) => {
      minx = Math.min(minx, x);
      miny = Math.min(miny, y);
      maxx = Math.max(maxx, x);
      maxy = Math.max(maxy, y);
    };
    if (lib.body) {
      for (const [cx, cy] of [
        [lib.body.minx, lib.body.miny],
        [lib.body.minx, lib.body.maxy],
        [lib.body.maxx, lib.body.miny],
        [lib.body.maxx, lib.body.maxy],
      ]) {
        const p = transformPoint(inst, cx, cy);
        extend(p.x, p.y);
      }
    } else {
      extend(inst.x, inst.y);
    }
    // body must not cover pin attachment points; shrink to just inside pins
    let bx = Math.floor(toGu(minx) + 0.501);
    let by = Math.floor(toGu(miny) + 0.501);
    let bx2 = Math.ceil(toGu(maxx) - 0.501);
    let by2 = Math.ceil(toGu(maxy) - 0.501);
    for (const p of instPins) {
      const ax = Math.round(toGu(p.x));
      const ay = Math.round(toGu(p.y));
      if (ax < bx || ax > bx2 || ay < by || ay > by2) continue;
      // pull the nearest body edge inward past this attachment
      const dl = ax - bx;
      const dr = bx2 - ax;
      const dt = ay - by;
      const db = by2 - ay;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) bx = ax + 1;
      else if (m === dr) bx2 = ax - 1;
      else if (m === dt) by = ay + 1;
      else by2 = ay - 1;
    }
    const cpins: Pin[] = [];
    for (const p of instPins) {
      if (claim.get(key(p.x, p.y)) !== `${inst.uuid}.${p.pin.number}`) continue;
      const px = toGu(p.x);
      const py = toGu(p.y);
      if (!isInt(px) || !isInt(py)) {
        offgrid++;
        continue;
      }
      cpins.push({
        id: `${inst.uuid}.${p.pin.number}`,
        name: p.pin.number,
        owner: inst.uuid,
        dx: Math.round(px) - bx,
        dy: Math.round(py) - by,
        dir: dirOf(p.dx, p.dy),
        lead: 0,
      });
    }
    // A pin drawn with zero length or an odd angle can face into its own
    // body (the DM3AT shield pin does); point it away instead.
    const DX = [1, 0, -1, 0];
    const DY = [0, 1, 0, -1];
    for (const p of cpins) {
      const ax = p.dx + bx;
      const ay = p.dy + by;
      const sx = ax + DX[p.dir];
      const sy = ay + DY[p.dir];
      const inside = sx >= bx && sx <= bx2 && sy >= by && sy <= by2;
      if (inside) {
        const cx2 = (bx + bx2) / 2;
        const cy2 = (by + by2) / 2;
        const vx = ax - cx2;
        const vy = ay - cy2;
        p.dir =
          Math.abs(vx) >= Math.abs(vy) ? (vx >= 0 ? 0 : 2) : vy >= 0 ? 1 : 3;
      }
    }
    // Single-pin symbols (power symbols, flags, test points, wire pads)
    // have glyphs that crowd their own pin; they block nothing.
    const single = cpins.length <= 1;
    comps.push({
      id: inst.uuid,
      ref: inst.ref || inst.uuid.slice(0, 6),
      x: bx,
      y: by,
      w: single ? 0 : Math.max(0, bx2 - bx),
      h: single ? 0 : Math.max(0, by2 - by),
      pins: cpins,
    });
  }
  // label pseudo-components
  for (const list of anchors.values()) {
    for (const a of list) {
      if (a.kind !== "label") continue;
      const px = toGu(a.x);
      const py = toGu(a.y);
      if (!isInt(px) || !isInt(py)) {
        offgrid++;
        continue;
      }
      comps.push({
        id: a.id,
        ref: a.id,
        x: Math.round(px),
        y: Math.round(py),
        w: 0,
        h: 0,
        pins: [
          {
            id: a.id,
            name: "1",
            owner: a.id,
            dx: 0,
            dy: 0,
            dir: a.dir,
            lead: 0,
          },
        ],
      });
    }
  }

  if (offgrid > 0) {
    return { out: src, report: `SKIP: ${offgrid} off-grid anchors`, ok: false };
  }

  // --- nets from existing connectivity plus name merges ----------------
  const byGroup = new Map<number, string[]>();
  for (const [k, list] of anchors) {
    const g = groupOf.get(k);
    if (g === undefined) continue;
    const m = mg(g);
    if (!byGroup.has(m)) byGroup.set(m, []);
    // one anchor per point: prefer a pin
    const pick = list.find((a) => a.kind === "pin") ?? list[0];
    byGroup.get(m)!.push(pick.id);
  }
  const nets: Net[] = [];
  let nid = 0;
  for (const ids of byGroup.values()) {
    if (ids.length < 2) continue;
    nets.push({ id: nid, name: `n${nid}`, pins: ids });
    nid++;
  }

  // --- design bounds ---------------------------------------------------
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const c of comps) {
    minx = Math.min(minx, c.x);
    miny = Math.min(miny, c.y);
    maxx = Math.max(maxx, c.x + c.w);
    maxy = Math.max(maxy, c.y + c.h);
    for (const p of c.pins) {
      minx = Math.min(minx, c.x + p.dx);
      miny = Math.min(miny, c.y + p.dy);
      maxx = Math.max(maxx, c.x + p.dx);
      maxy = Math.max(maxy, c.y + p.dy);
    }
  }
  const MARGIN = 6;
  const ox = minx - MARGIN;
  const oy = miny - MARGIN;
  for (const c of comps) {
    c.x -= ox;
    c.y -= oy;
  }
  const design: Design = {
    name: "sheet",
    w: maxx - minx + 2 * MARGIN,
    h: maxy - miny + 2 * MARGIN,
    components: comps,
    nets,
  };

  // A pin one grid unit from its neighbor cannot reserve an escape stub;
  // retry without the escape requirement before giving up on the sheet.
  let params: Params = { ...DEFAULT_PARAMS, escape: 1, relaxPasses: 2 };
  let router = new FlowRouter(design, params);
  router.routeAll();
  let stats = router.relax(params.relaxPasses);
  let failed: string[] = [];
  for (const r of router.routes.values()) failed.push(...r.failed);
  let violations = runDrc({
    design,
    index: router.index,
    grid: router.grid,
    params,
    routes: router.routes,
    anchors: router.anchors,
  });
  if (failed.length || router.blockedPins.length || violations.length) {
    params = { ...DEFAULT_PARAMS, escape: 1, clearance: 0, relaxPasses: 2 };
    const retry = new FlowRouter(design, params);
    retry.routeAll();
    const rstats = retry.relax(params.relaxPasses);
    const rfailed: string[] = [];
    for (const r of retry.routes.values()) rfailed.push(...r.failed);
    const rviol = runDrc({
      design,
      index: retry.index,
      grid: retry.grid,
      params,
      routes: retry.routes,
      anchors: retry.anchors,
    });
    if (rfailed.length + retry.blockedPins.length + rviol.length <
        failed.length + router.blockedPins.length + violations.length) {
      router = retry;
      stats = rstats;
      failed = rfailed;
      violations = rviol;
    }
  }

  const report =
    `nets ${stats.connected}/${stats.nets} (merged ${mergedNames} names) seg ${stats.segments} ` +
    `len ${stats.length} bends ${stats.bends} cross ${stats.crossings} drc ${violations.length}` +
    (failed.length ? ` FAILED ${failed.length}` : "") +
    (router.blockedPins.length ? ` NOESCAPE ${router.blockedPins.length}` : "");

  if (failed.length || router.blockedPins.length || violations.length) {
    const refOf = (pid: string) => {
      const c = comps.find((cc) => cc.pins.some((p) => p.id === pid));
      const inst = sheet.instances.find((ii) => ii.uuid === c?.id);
      return `${inst?.ref ?? c?.ref ?? "?"}(${inst?.libId ?? ""}):${pid.split(".").pop()}`;
    };
    const detail =
      (router.blockedPins.length
        ? ` blocked=[${router.blockedPins.map(refOf).join(", ")}]`
        : "") +
      (failed.length ? ` failedPins=[${failed.map(refOf).join(", ")}]` : "") +
      (violations.length
        ? ` drc=[${violations.slice(0, 6).map((v) => `${v.kind}@${v.x},${v.y} ${v.message}`).join(" | ")}]`
        : "");
    return { out: src, report: `KEEP ORIGINAL: ${report}${detail}`, ok: false };
  }

  const k = toKicad(design, router.grid, router.routes, router.junctions(), {
    originX: ox * GRID,
    originY: oy * GRID,
    gridMm: GRID,
  });

  // splice: drop original wires and junctions, insert the routed ones
  let out = src.replace(/\n\t\(wire\b[\s\S]*?\n\t\)/g, "");
  out = out.replace(/\n\t\(junction\b[\s\S]*?\n\t\)/g, "");

  // Locate one specific label block by tag, name, and numeric coordinates.
  // The (at ...) must follow the label header directly (with only the shape
  // line in between for globals), so a match can never run through a
  // neighboring block of the same name.
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const findLabel = (
    text: string,
    l: (typeof sheet.labels)[number],
  ): { start: number; end: number; atStart: number; atEnd: number } | null => {
    const tag = l.global ? "global_label" : "label";
    const esc = l.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `\\(${tag} "${esc}"\\s*(?:\\(shape \\w+\\)\\s*)?(\\(at ([-0-9.]+) ([-0-9.]+) ([-0-9.]+)\\))`,
      "g",
    );
    for (const m of text.matchAll(re)) {
      if (
        Math.abs(parseFloat(m[2]) - l.x) > 0.05 ||
        Math.abs(parseFloat(m[3]) - l.y) > 0.05 ||
        Math.abs(parseFloat(m[4]) - l.angle) > 0.5
      )
        continue;
      const start = m.index!;
      const atStart = start + m[0].length - m[1].length;
      // balanced scan for the block end
      let depth = 0;
      let end = start;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
          i++;
          while (text[i] !== '"') {
            if (text[i] === "\\") i++;
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
      return { start, end, atStart, atEnd: atStart + m[1].length };
    }
    return null;
  };

  // remove duplicate labels of merged nets; the routed wires now join them
  let dropMisses = 0;
  for (const l of dropLabels) {
    const hit = findLabel(out, l);
    if (!hit) {
      dropMisses++;
      continue;
    }
    let start = out.lastIndexOf("\n", hit.start);
    if (start < 0) start = hit.start;
    out = out.slice(0, start) + out.slice(hit.end);
  }
  // re-anchor moved labels onto their pins
  let moveMisses = 0;
  for (const m of moves) {
    const hit = findLabel(out, m.label);
    if (!hit) {
      moveMisses++;
      continue;
    }
    out =
      out.slice(0, hit.atStart) +
      `(at ${round2(m.x)} ${round2(m.y)} ${m.angle})` +
      out.slice(hit.atEnd);
  }
  if (dropMisses || moveMisses) {
    return {
      out: src,
      report: `KEEP ORIGINAL: label bookkeeping missed ${dropMisses} drops, ${moveMisses} moves`,
      ok: false,
    };
  }
  const sexpr = stableUuids(
    toSExpr(k)
      .split("\n")
      .map((l) => "\t" + l.replace(/^ {2}/, ""))
      .join("\n"),
  );
  out = out.replace(/\n\t\(sheet_instances/, `\n${sexpr}\n\t(sheet_instances`);
  return { out, report, ok: true };
}

if (import.meta.main) {
  const files = Bun.argv.slice(2);
  for (const f of files) {
    const path = f.includes("/") ? f : `${ROOT}/${f}`;
    const src = await Bun.file(path).text();
    const { out, report, ok } = bridgeSheet(src);
    if (ok) await Bun.write(path, out);
    console.log(`${f}: ${report}`);
  }
}
