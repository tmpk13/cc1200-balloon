/**
 * Demote sheet-local global labels to plain local labels.
 *
 * kicad-vis emits a GLOBAL label for every net that spans two placement
 * groups, whether or not the net leaves the sheet. Most of those nets are
 * private to one sheet (a crystal pair, an RF node, an internal supply
 * pin), so the global flag buys nothing and costs plenty: the label draws
 * as a hierarchy-spanning flag, it carries an inter-sheet reference
 * property, and any future sheet that reuses the name silently shorts to
 * it. A local label says what is true - this net stays here.
 *
 * A name is demoted only when it cannot reach past its own sheet:
 *   - not a declared inter-sheet net, which assemble.ts globalizes on
 *     purpose;
 *   - not the name of a power symbol anywhere in the design, since power
 *     symbols form one net across the hierarchy and a local label of the
 *     same name would quietly split off from it with no ERC complaint;
 *   - present as a global label on exactly one sheet. A name global on two
 *     sheets without being declared is the short checkglobals.ts exists to
 *     catch, so it is left alone rather than hidden by demotion.
 *
 * Idempotent.
 */

import { INTERSHEET, SHEETS } from "./intersheet";

// 0 and 90 point the text right/up, so the name starts at the anchor.
export const horizontalFor = (angle: number) =>
    angle === 0 || angle === 90 ? "left" : "right";

/** End index of the block opening at `start`, skipping over strings. */
export function blockEnd(src: string, start: number): number {
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

export interface LabelSpan {
    start: number;
    end: number;
    name: string;
    angle: number;
}

/** Spans of every top-level global label block, in file order. */
export function globalLabels(src: string): LabelSpan[] {
    const out: LabelSpan[] = [];
    const re =
        /\(global_label "((?:[^"\\]|\\.)*)"\s*(?:\(shape \w+\)\s*)?\(at [-0-9.]+ [-0-9.]+ ([-0-9.]+)\)/g;
    for (const m of src.matchAll(re)) {
        out.push({
            start: m.index!,
            end: blockEnd(src, m.index!),
            name: JSON.parse(`"${m[1]}"`),
            angle: parseFloat(m[2]),
        });
    }
    return out;
}

/** Names of power symbols, which merge by name across the hierarchy. */
export function powerNetsIn(src: string): Set<string> {
    const out = new Set<string>();
    for (const m of src.matchAll(/\(lib_id "power:([^"]+)"\)/g)) {
        if (m[1] !== "PWR_FLAG") out.add(m[1]);
    }
    return out;
}

/** One global label block rewritten as a local label block. */
export function demote(block: string, angle: number): string {
    let out = block.replace(/^\(global_label /, "(label ");
    out = out.replace(/\s*\(shape \w+\)/, "");
    // Inter-sheet references have no meaning on a local label.
    const refs = out.indexOf('(property "Intersheetrefs"');
    if (refs >= 0) {
        const refsEnd = blockEnd(out, refs);
        const lineStart = out.lastIndexOf("\n", refs);
        out = out.slice(0, lineStart < 0 ? refs : lineStart) + out.slice(refsEnd);
    }
    // A global label centers its name in the flag outline; a local one sits
    // above its wire, which is what the vertical token is for.
    const want = `(justify ${horizontalFor(angle)} bottom)`;
    const eff = out.indexOf("(effects");
    if (eff < 0) throw new Error("label has no effects block");
    const effEnd = blockEnd(out, eff);
    const e = out.slice(eff, effEnd);
    return (
        out.slice(0, eff) +
        (e.match(/\(justify [^)]*\)/)
            ? e.replace(/\(justify [^)]*\)/, want)
            : e.replace(/\s*\)$/, `\n\t\t\t${want}\n\t\t)`)) +
        out.slice(effEnd)
    );
}

/** Rewrite one sheet, demoting every label the predicate clears. */
export function localizeSheet(src: string, staysGlobal: (name: string) => boolean): {
    out: string;
    demoted: string[];
} {
    let out = src;
    const demoted: string[] = [];
    // Right to left, so a rewrite never shifts a span not yet visited.
    for (const l of globalLabels(src).reverse()) {
        if (staysGlobal(l.name)) continue;
        out = out.slice(0, l.start) + demote(out.slice(l.start, l.end), l.angle) + out.slice(l.end);
        demoted.push(l.name);
    }
    return { out, demoted: demoted.reverse() };
}

if (import.meta.main) {
    const ROOT = `${import.meta.dir}/..`;
    const sources = new Map<string, string>();
    for (const { file } of SHEETS) {
        sources.set(file, await Bun.file(`${ROOT}/${file}`).text());
    }

    const powerNets = new Set<string>();
    const sheetsWithName = new Map<string, number>();
    for (const src of sources.values()) {
        for (const n of powerNetsIn(src)) powerNets.add(n);
        for (const n of new Set(globalLabels(src).map((l) => l.name))) {
            sheetsWithName.set(n, (sheetsWithName.get(n) ?? 0) + 1);
        }
    }
    const intersheet = new Set(INTERSHEET);
    const staysGlobal = (name: string) =>
        intersheet.has(name) || powerNets.has(name) || (sheetsWithName.get(name) ?? 0) > 1;

    let total = 0;
    const names = new Set<string>();
    for (const { file } of SHEETS) {
        const { out, demoted } = localizeSheet(sources.get(file)!, staysGlobal);
        if (demoted.length) await Bun.write(`${ROOT}/${file}`, out);
        for (const n of demoted) names.add(n);
        total += demoted.length;
        console.log(`  ${file}: ${demoted.length} label(s) demoted to local`);
    }
    console.log(`  ${total} total, ${names.size} distinct net(s): ${[...names].sort().join(" ")}`);
}
