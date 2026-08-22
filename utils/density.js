// Corrects an observed petroleum density/temperature reading to the
// standard reference density at 15°C, per ASTM D1250 / API MPMS Chapter
// 11.1, "Generalized Products" correlation (Table 53B) — applicable to
// MS (petrol), HSD (diesel), and MSP (power petrol). Density values are
// expected in kg/m³.
//
// The thermal expansion coefficient (alpha) is not a clean two-constant
// function of density in the reference calculator this is calibrated
// against (energy1.ru's ASTM D1250 Table 53B tool) — it's read from
// density_table.json, a table of (density-at-15°C -> alpha) sampled
// directly from that calculator across its full supported range
// (653–1074 kg/m³) and smoothed to remove its 0.1 kg/m³ display
// rounding noise. Alpha is looked up by the *base* density (density at
// 15°C), so recovering it from an observed reading is a short fixed-point
// iteration: guess the base density, look up alpha, apply the correction,
// repeat. This mirrors how the underlying tables are actually indexed and
// reproduces the reference calculator's output to within ~0.1-0.3 kg/m³
// (its own rounding tolerance) across the density and temperature ranges
// tested.
const TABLE = require('./density_table.json'); // sorted [rho15, alpha] pairs

const R_MIN = TABLE[0][0];
const R_MAX = TABLE[TABLE.length - 1][0];

function alphaAt(rho15) {
  const r = Math.max(R_MIN, Math.min(R_MAX, rho15));
  let lo = 0;
  let hi = TABLE.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (TABLE[mid][0] <= r) lo = mid;
    else hi = mid;
  }
  const [r0, a0] = TABLE[lo];
  const [r1, a1] = TABLE[hi];
  const frac = r1 > r0 ? (r - r0) / (r1 - r0) : 0;
  return a0 + (a1 - a0) * frac;
}

function densityAt15(observedDensity, observedTemp) {
  if (typeof observedDensity !== 'number' || typeof observedTemp !== 'number') return null;
  if (observedDensity <= 0) return null;

  const deltaT = observedTemp - 15;
  let rho15 = observedDensity;
  for (let i = 0; i < 4; i++) {
    const alpha = alphaAt(rho15);
    const ctl = Math.exp(-alpha * deltaT * (1 + 0.8 * alpha * deltaT));
    rho15 = observedDensity / ctl;
  }
  return rho15;
}

module.exports = { densityAt15 };
