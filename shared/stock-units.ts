/** Equivalent unit labels only; quantities are never converted. */
export function sameUnit(a: string, b: string) {
  const norm = (u: string) => {
    const x = u.trim().toLowerCase().replace(/\.$/, "");
    if (["m", "mtr", "mtrs", "meter", "meters", "metre", "metres", "rm"].includes(x)) return "m";
    if (["no", "nos", "pc", "pcs", "piece", "pieces", "unit", "units", "each"].includes(x)) return "no";
    return x;
  };
  return norm(a) === norm(b);
}
