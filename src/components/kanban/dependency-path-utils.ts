/** Build an SVG cubic bezier path string. */
export function buildSvgPath(
  mx: number,
  my: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  ex: number,
  ey: number,
): string {
  return [
    'M', String(mx), String(my),
    'C', String(c1x), String(c1y) + ',',
    String(c2x), String(c2y) + ',',
    String(ex), String(ey),
  ].join(' ')
}
