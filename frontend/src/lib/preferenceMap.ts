export const MAP_W = 540;
export const MAP_H = 420;

export interface MapNode { id: string; classNumber: number; x: number; y: number }
export interface MapLayout { nodes: MapNode[]; nodeRadius: number; clusters: { classNumber: number; x: number; y: number; radius: number }[] }

/** Offsets (relative to cluster centre) for m nodes: one ring when small, concentric rings when crowded. */
function clusterOffsets(m: number, nodeR: number): { offsets: [number, number][]; extent: number } {
  const gap = 2 * nodeR + 5; // centre-to-centre spacing so circles never touch
  if (m === 1) return { offsets: [[0, 0]], extent: nodeR };
  const single = Math.max(gap * m / (2 * Math.PI), nodeR + 6);
  if (single <= 62) {
    return {
      offsets: Array.from({ length: m }, (_, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / m;
        return [single * Math.cos(a), single * Math.sin(a)] as [number, number];
      }),
      extent: single + nodeR,
    };
  }
  // Rings from the inside out, each holding as many nodes as fit its circumference.
  const rings: number[] = [];
  let left = m;
  for (let k = 1; left > 0; k++) {
    const radius = k * gap * 1.02 + (k === 1 ? 4 : 0);
    const cap = Math.min(left, Math.max(1, Math.floor((2 * Math.PI * radius) / gap)));
    rings.push(cap);
    left -= cap;
  }
  const offsets: [number, number][] = [];
  rings.forEach((count, idx) => {
    const k = idx + 1;
    const radius = k * gap * 1.02 + (k === 1 ? 4 : 0);
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / count + (idx % 2 ? Math.PI / count : 0);
      offsets.push([radius * Math.cos(a), radius * Math.sin(a)]);
    }
  });
  const last = rings.length;
  return { offsets, extent: last * gap * 1.02 + (last === 1 ? 4 : 0) + nodeR };
}

/** Cluster centres sit on a polygon sized to the class count (2 opposed, 3 triangle, 4 quad). */
export function layoutMap(classes: { classNumber: number; ids: string[] }[]): MapLayout {
  const n = classes.length;
  const cx = MAP_W / 2, cy = MAP_H / 2;
  const margin = 8;
  // Shrink nodes until the clusters fit the canvas without touching each other.
  let nodeR = 14, packed = classes.map((c) => clusterOffsets(c.ids.length, nodeR)), ext = 0, poly = 0;
  for (const r of [14, 11, 9, 7, 5]) {
    nodeR = r;
    packed = classes.map((c) => clusterOffsets(c.ids.length, nodeR));
    ext = Math.max(...packed.map((p) => p.extent), nodeR);
    const rx = cx - ext - margin, ry = cy - ext - margin;
    // Polygon circumradius, bounded by whichever canvas axis is tighter.
    poly = n <= 1 ? 0 : n === 2 ? Math.min(rx, 150) : Math.max(0, Math.min(rx, ry, 150));
    const centreDist = n <= 1 ? Infinity : 2 * poly * Math.sin(Math.PI / n);
    if (centreDist >= 2 * ext + 4) break;
  }
  const nodes: MapNode[] = [];
  const clusters: MapLayout['clusters'] = [];
  classes.forEach((c, i) => {
    const angle = n === 2 ? Math.PI * i : -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x0 = cx + poly * Math.cos(angle), y0 = cy + poly * Math.sin(angle);
    clusters.push({ classNumber: c.classNumber, x: x0, y: y0, radius: packed[i].extent });
    c.ids.forEach((id, j) => {
      const [dx, dy] = packed[i].offsets[j];
      nodes.push({ id, classNumber: c.classNumber, x: x0 + dx, y: y0 + dy });
    });
  });
  return { nodes, nodeRadius: nodeR, clusters };
}
