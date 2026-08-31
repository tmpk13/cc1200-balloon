// KYOCERA AVX 046844713002846+: 0.3 mm pitch, 13 position, right-angle
// bottom-contact FPC/ZIF connector. Mates the Bosch BMV080 flex.
//
// Perimeter only - the housing block plus the flip-lock actuator as one
// slab each; contacts, latch detail and the FPC itself are not modelled.
// Authored in KiCad 3D model space (Y is the footprint's Y negated, Z is
// height above the board).

$fn = 24;

WIDTH = 5.5;      // B column of the series drawing at 13 positions
DEPTH = 4.0;
HEIGHT = 0.95;    // mated height
ACT_DEPTH = 1.2;  // flip-lock actuator, shown closed

module housing() {
    translate([-WIDTH / 2, -DEPTH / 2, 0])
        cube([WIDTH, DEPTH - ACT_DEPTH, HEIGHT]);
}

module actuator() {
    translate([-WIDTH / 2, DEPTH / 2 - ACT_DEPTH, HEIGHT - 0.35])
        cube([WIDTH, ACT_DEPTH, 0.35]);
}

housing();
actuator();
