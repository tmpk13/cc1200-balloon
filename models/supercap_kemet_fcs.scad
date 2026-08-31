// KEMET FC/FCS series supercapacitor, 10.7 mm diameter SMD can, 5.5 mm high.
// Optional part on this board - fitted only when GNSS hot start is wanted.
//
// Perimeter only: the can and its two gull-wing terminals as plain solids.
// Authored in KiCad 3D model space (Y is the footprint's Y negated, Z is
// height above the board).

$fn = 48;

CAN_D = 10.7;
CAN_H = 5.5;
STANDOFF = 0.3;   // terminal thickness under the can
TERM_W = 4.9;     // land width
TERM_L = 2.5;
TERM_X = 4.95;    // land centre, matches the footprint

module can() {
    translate([0, 0, STANDOFF])
        cylinder(d = CAN_D, h = CAN_H - STANDOFF);
}

module terminal(sign) {
    translate([sign * TERM_X - TERM_W / 2, -TERM_L / 2, 0])
        cube([TERM_W, TERM_L, STANDOFF]);
}

can();
terminal(1);
terminal(-1);
