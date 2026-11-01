# TODO

## Known limitations to resolve before flight

- **The rail is unregulated and can touch 3.6 V**, the absolute maximum
  operating supply of the Wio-E5 and the CC1200. Confirm the cell's
  open-circuit voltage before connecting it.
- **No brownout floor.** RF output power, the ADC reference and sensor
  readings drift with the cell. `BATT_VSENSE` makes the drift observable.
- **The GNSS stops first.** `VDD_IO` and `DX_IN` are specified from 2.7 V;
  the TCXO is rated to 3.3 V and is fed from a pin that can reach 3.6 V.
  Budget the flight on that, not on the cell's cutoff.
- **GNSS altitude limit.** The AT6558R data sheet says nothing about COCOM
  limits; confirm behavior above 18 km before flying.
- **SCD40 in a balloon.** Specified from -10 C and pressure dependent;
  compensate from the BME688 pressure channel.
- **No thermal design, no antenna measurements.** The CC1200 match values
  are TeleMini's; sweep them on this board.
