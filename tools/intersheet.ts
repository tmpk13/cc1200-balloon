/** Nets that intentionally span sheets, and the sheet set - shared by
 * assemble.ts (which globalizes these labels) and checkglobals.ts (which
 * rejects any other name appearing as a global label on several sheets). */

export const SHEETS: { file: string; name: string }[] = [
  { file: "power.kicad_sch", name: "Power" },
  { file: "mcu.kicad_sch", name: "MCU" },
  { file: "radio.kicad_sch", name: "CC1200 Radio" },
  { file: "gnss.kicad_sch", name: "GNSS" },
  { file: "sensors.kicad_sch", name: "Sensors" },
];

export const INTERSHEET = [
  "VBATT",
  "VBAT_SENSE",
  "NRST",
  "SPI_SCK", "SPI_MISO", "SPI_MOSI",
  "RADIO_CS", "RADIO_RST", "RADIO_IRQ",
  "SCL", "SDA",
  "LIGHTNING_IRQ",
  "PM_CS", "PM_IRQ",
  "GNSS_TX", "GNSS_RX", "GNSS_PPS", "GNSS_ONOFF",
];
