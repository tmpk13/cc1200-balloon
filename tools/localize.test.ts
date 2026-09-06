import { expect, test } from "bun:test";
import { blockEnd, demote, globalLabels, localizeSheet, powerNetsIn } from "./localize";

/** A global label block as kicad-vis and eeschema write them. */
const global = (name: string, angle = 0) => `	(global_label "${name}"
		(shape passive)
		(at 180.34 139.7 ${angle})
		(effects
			(font
				(size 1.27 1.27)
			)
			(justify left)
		)
		(uuid "4785a588-88a7-5d90-8f0b-fd17c5992787")
		(property "Intersheetrefs" "\${INTERSHEET_REFS}"
			(at 180.34 139.7 ${angle})
			(hide yes)
			(show_name no)
			(do_not_autoplace no)
			(effects
				(font
					(size 1.27 1.27)
				)
			)
		)
	)
`;

const sheet = (...blocks: string[]) => `(kicad_sch\n${blocks.join("")}\t(sheet_instances)\n)\n`;

test("blockEnd ignores parens inside strings", () => {
    const s = `(label "A)B(C" (at 0 0 0))`;
    expect(blockEnd(s, 0)).toBe(s.length);
});

test("globalLabels finds name and angle, skips local labels", () => {
    const src = sheet(global("RF_PA", 180), `	(label "RF_TX1"\n		(at 1 2 0)\n	)\n`, global("SWDIO"));
    expect(globalLabels(src).map((l) => [l.name, l.angle])).toEqual([
        ["RF_PA", 180],
        ["SWDIO", 0],
    ]);
});

test("demote drops shape and Intersheetrefs, keeps uuid and position", () => {
    const out = demote(global("RF_PA").trimEnd().slice(1), 0);
    expect(out).not.toContain("global_label");
    expect(out).not.toContain("(shape");
    expect(out).not.toContain("Intersheetrefs");
    expect(out).toContain(`(label "RF_PA"`);
    expect(out).toContain("(at 180.34 139.7 0)");
    expect(out).toContain(`(uuid "4785a588-88a7-5d90-8f0b-fd17c5992787")`);
    // A local label's text sits above its wire, so it takes the vertical token.
    expect(out).toContain("(justify left bottom)");
});

test("demote derives the horizontal side from the rotation", () => {
    for (const [angle, want] of [[0, "left"], [90, "left"], [180, "right"], [270, "right"]] as const) {
        expect(demote(global("N", angle).trimEnd().slice(1), angle)).toContain(`(justify ${want} bottom)`);
    }
});

test("demote adds a justify when the effects block has none", () => {
    const block = `(global_label "N"\n\t\t(shape passive)\n\t\t(at 0 0 0)\n\t\t(effects\n\t\t\t(font\n\t\t\t\t(size 1.27 1.27)\n\t\t\t)\n\t\t)\n\t)`;
    expect(demote(block, 0)).toContain("(justify left bottom)");
});

test("localizeSheet demotes only what the predicate clears", () => {
    const src = sheet(global("RF_PA"), global("SPI_SCK"), global("XOSC_Q1"));
    const keep = new Set(["SPI_SCK"]);
    const { out, demoted } = localizeSheet(src, (n) => keep.has(n));
    expect(demoted).toEqual(["RF_PA", "XOSC_Q1"]);
    expect(out).toContain(`(global_label "SPI_SCK"`);
    expect(out).toContain(`(label "RF_PA"`);
    expect(out).toContain(`(label "XOSC_Q1"`);
});

test("localizeSheet is idempotent", () => {
    const src = sheet(global("RF_PA"), global("XOSC_Q1"));
    const once = localizeSheet(src, () => false);
    const twice = localizeSheet(once.out, () => false);
    expect(twice.demoted).toEqual([]);
    expect(twice.out).toBe(once.out);
});

test("localizeSheet rewrites every label when several share a sheet", () => {
    // Right-to-left rewriting must not shift a span it has not visited yet.
    const src = sheet(...Array.from({ length: 5 }, (_, i) => global(`N${i}`)));
    const { out, demoted } = localizeSheet(src, () => false);
    expect(demoted).toEqual(["N0", "N1", "N2", "N3", "N4"]);
    expect(globalLabels(out)).toEqual([]);
});

test("powerNetsIn collects power symbol names but not PWR_FLAG", () => {
    const src = `(lib_id "power:+BATT")(lib_id "power:GND")(lib_id "power:PWR_FLAG")(lib_id "Device:R")`;
    expect([...powerNetsIn(src)].sort()).toEqual(["+BATT", "GND"]);
});

test("a power symbol name is never demoted", () => {
    // The trap: a local "+BATT" becomes /Sheet/+BATT and splits off the rail
    // with no ERC error, because the power symbols keep the real rail alive.
    const src = sheet(global("+BATT"), global("RF_PA")) + `(lib_id "power:+BATT")`;
    const power = powerNetsIn(src);
    const { out, demoted } = localizeSheet(src, (n) => power.has(n));
    expect(demoted).toEqual(["RF_PA"]);
    expect(out).toContain(`(global_label "+BATT"`);
});
