// Small pure functions used by the "Méthodes de calcul" page to let the reader try the formulas.
// They mirror the C++ core (core/src/aero.cpp, bounce.cpp, simulate.cpp) and are checked against it
// (see docs/modeles-physiques.md): if the core changes, change them too.

export const BALL = { r: 0.02, m: 0.0027, f: 2 / 3 };            // radius (m), mass (kg), I = f m r^2 (thin shell)
export const AIR = { rho: null, g: 9.81, mu: 1.81e-5 };
export const CD = 0.40;                                           // placeholder, not measured

// C_L(S) table of the core: Watts-Ferrer form 1/(2 + 1/S), piecewise-linear between these points.
const CL_S = [0.0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5, 3.0];
const CL_Y = CL_S.map((s) => (s > 0 ? 1 / (2 + 1 / s) : 0));

export function interp(xs, ys, q) {
  if (q <= xs[0]) return ys[0];
  if (q >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1;
  while (xs[i] < q) i++;
  const t = (q - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}
export const liftCoefficient = (S) => interp(CL_S, CL_Y, S);

// Density of humid air (ideal gas, Magnus-Tetens saturation pressure).
export function airDensity(tempC = 20, pressurePa = 101325, relHumidity = 0.5) {
  const T = tempC + 273.15;
  const pSat = 610.94 * Math.exp((17.625 * tempC) / (tempC + 243.04));
  const pv = relHumidity * pSat, pd = pressurePa - pv;
  return pd / (287.058 * T) + pv / (461.495 * T);
}
AIR.rho = airDensity();

// Forces on a ball moving at `v` (m/s) with a spin of `spinRps` (rev/s) perpendicular to its velocity.
export function forces({ v, spinRps, rho = AIR.rho }) {
  const { r, m } = BALL, A = Math.PI * r * r, w = 2 * Math.PI * spinRps;
  const S = v > 0 ? (r * Math.abs(w)) / v : 0;
  const CL = liftCoefficient(S);
  const q = 0.5 * rho * A * v * v;
  return { S, CL, magnus: q * CL, drag: q * CD, weight: m * AIR.g, accelMagnus: (q * CL) / m, accelDrag: (q * CD) / m, terminal: Math.sqrt((2 * m * AIR.g) / (rho * A * CD)) };
}

// Bounce of the ball on the table (impulse model of core/src/bounce.cpp), in the vertical plane x-z.
// vx: horizontal speed (m/s, along +x), vz: vertical speed towards the table (m/s, positive number),
// spinRps: spin about the horizontal axis y in rev/s (+ = topspin for a ball moving along +x).
export function tableBounce({ vx, vz, spinRps, mu = 0.25, e = 0.87, et = 0.0 }) {
  const { r, m, f } = BALL, I = f * m * r * r, wy = 2 * Math.PI * spinRps;
  const Jn = m * (1 + e) * vz;                       // normal impulse
  const slip = vx - r * wy;                          // tangential speed of the contact point (v + w x r_c, r_c = -r z)
  const k = 1 / m + (r * r) / I;                     // contact-point velocity change per unit tangential impulse
  let Jt = 0, sticking = true;
  if (Math.abs(slip) > 1e-12) {
    const Jstick = ((1 + et) * Math.abs(slip)) / k;  // would cancel the slip
    const Jmax = mu * Jn;                            // Coulomb limit
    sticking = Jstick <= Jmax;
    Jt = -Math.sign(slip) * Math.min(Jstick, Jmax);
  }
  return {
    vx: vx + Jt / m,
    vz: -vz + Jn / m,                                // positive = upwards after the bounce
    spinRps: (wy - (r * Jt) / I) / (2 * Math.PI),
    sticking, Jn, Jt,
    rolling: Math.abs(slip) > 0 ? sticking : true,
  };
}
