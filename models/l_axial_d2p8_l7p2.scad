// Bourns 78F101J-RC, 100 uH axial drum-core choke used as the AS3935
// 500 kHz antenna. Body 2.79 mm diameter x 7.11 mm long, 0.5 mm leads,
// lying flat on a 10.16 mm lead pitch.
//
// Perimeter only - the winding, the end caps and the lead bends are a
// single cylinder plus straight wires. Authored in KiCad 3D model space.

$fn = 32;

BODY_D = 2.8;
BODY_L = 7.2;
LEAD_D = 0.5;
PITCH = 10.16;
AXIS_Z = BODY_D / 2 + 0.2;   // 0.2 mm standoff off the board

module body() {
    translate([-BODY_L / 2, 0, AXIS_Z])
        rotate([0, 90, 0])
            cylinder(d = BODY_D, h = BODY_L);
}

module lead(sign) {
    // horizontal run from the body end out to the lead hole
    translate([sign * BODY_L / 2, 0, AXIS_Z])
        rotate([0, sign * 90, 0])
            cylinder(d = LEAD_D, h = PITCH / 2 - BODY_L / 2);
    // vertical drop into the board
    translate([sign * PITCH / 2, 0, -1.6])
        cylinder(d = LEAD_D, h = AXIS_Z + 1.6);
}

body();
lead(1);
lead(-1);
