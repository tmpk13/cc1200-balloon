// ZHONGKEWEI AT6558R-5N32: QFN-40, 5 x 5 x 0.8 mm.
//
// Perimeter only - the 40 side terminals and the exposed pad are not
// modelled. Authored in KiCad 3D model space (Y is the footprint's Y
// negated, Z is height above the board).

$fn = 32;

BODY = 5.0;
HEIGHT = 0.8;
STANDOFF = 0.05;
PIN1_R = 0.6;   // dimple over pin 1, footprint (-2.44, -1.8)

module qfn40() {
    difference() {
        translate([-BODY / 2, -BODY / 2, STANDOFF])
            cube([BODY, BODY, HEIGHT]);
        translate([-1.7, 1.7, STANDOFF + HEIGHT - 0.15])
            cylinder(r = PIN1_R, h = 0.3);
    }
}

qfn40();
