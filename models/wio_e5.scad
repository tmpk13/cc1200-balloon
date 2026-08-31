// Seeed Wio-E5 / LoRa-E5 module: 12 x 12 x 2.5 mm shielded can.
//
// Perimeter only - the castellated pads, the shield seam and the label are
// not modelled. Authored in KiCad 3D model space: X matches the footprint's
// X, Y is the footprint's Y negated, Z is height above the board.

$fn = 32;

BODY = 12.0;
HEIGHT = 2.5;
STANDOFF = 0.1;   // solder paste under the castellations
CHAMFER = 1.2;    // pin 1 corner, footprint (-x, -y) = model (-x, +y)

module can() {
    difference() {
        translate([-BODY / 2, -BODY / 2, STANDOFF])
            cube([BODY, BODY, HEIGHT]);
        // pin 1 corner chamfer
        translate([-BODY / 2, BODY / 2, STANDOFF - 0.1])
            rotate([0, 0, 45])
                translate([-CHAMFER, -CHAMFER, 0])
                    cube([CHAMFER * 2, CHAMFER * 2, HEIGHT + 0.2]);
    }
}

can();
