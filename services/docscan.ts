/**
 * docscan.ts — CamScanner-style receipt capture, dependency-free.
 *
 * Pipeline:
 *   1. detectReceiptQuad() — finds the receipt's 4 corners in a photo:
 *      downscale → grayscale → blur → bright-paper mask → largest connected
 *      component → convex hull → polygon approximation to a quadrilateral.
 *   2. perspectiveCrop() — warps the quadrilateral into a straight rectangle
 *      (homography + bilinear sampling), removing background + skew.
 *   3. enhanceReceipt() — grayscale + auto-contrast so text pops for OCR/AI.
 *
 * All functions work on plain canvas/ImageData: no OpenCV, no WASM, no deps.
 * Detection runs on a ≤400px preview (<100ms); the warp runs full-resolution.
 */

export interface Point { x: number; y: number }
export interface Quad { tl: Point; tr: Point; br: Point; bl: Point }

/** Draw any image source into a canvas capped at maxDim on the long side. */
export function toPreviewCanvas(img: HTMLImageElement, maxDim = 400): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c;
}

function grayscale(data: Uint8ClampedArray): Float32Array {
  const g = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return g;
}

function blur5(g: Float32Array, w: number, h: number): Float32Array {
  const k = [1, 4, 6, 4, 1];
  const kn = 16;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dx = -2; dx <= 2; dx++) s += g[y * w + Math.min(w - 1, Math.max(0, x + dx))] * k[dx + 2];
      tmp[y * w + x] = s / kn;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) s += tmp[Math.min(h - 1, Math.max(0, y + dy)) * w + x] * k[dy + 2];
      out[y * w + x] = s / kn;
    }
  }
  return out;
}

/** Generic 4-connected-component labeling of a binary mask. */
function labelComponents(mask: Uint8Array, w: number, h: number): Array<{ pixels: number[]; touchesBorder: boolean }> {
  const seen = new Uint8Array(w * h);
  const comps: Array<{ pixels: number[]; touchesBorder: boolean }> = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const pixels: number[] = [];
    let touchesBorder = false;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    comps.push({ pixels, touchesBorder });
  }
  comps.sort((a, b) => b.pixels.length - a.pixels.length);
  return comps;
}

/** Largest 4-connected bright region; returns its pixel indices.
 *  Border-touching regions are ignored: the receipt sits inside the frame,
 *  while the table/background always touches the image edge. */
function largestBrightComponent(g: Float32Array, w: number, h: number): number[] | null {
  // Paper is bright: threshold relative to image median for robustness.
  const sorted = Float32Array.from(g).sort();
  const median = sorted[Math.floor(sorted.length / 2)];
  const thresh = Math.min(235, Math.max(150, median + 45));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) mask[i] = g[i] > thresh ? 1 : 0;
  const comps = labelComponents(mask, w, h);
  const interior = comps.find((c) => !c.touchesBorder);
  const best = interior || comps[0];
  return best ? best.pixels : null;
}

function sobelMagnitude(g: Float32Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return mag;
}

function dilate3(mask: Uint8Array, w: number, h: number, iters = 1): Uint8Array {
  let cur = mask;
  for (let n = 0; n < iters; n++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && !v; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && cur[yy * w + xx]) { v = 1; break; }
          }
        }
        out[y * w + x] = v;
      }
    }
    cur = out;
  }
  return cur;
}

/** Bright-paper mask (same relative threshold as the brightness method). */
function brightMask(g: Float32Array, w: number, h: number): Uint8Array {
  const sorted = Float32Array.from(g).sort();
  const median = sorted[Math.floor(sorted.length / 2)];
  const thresh = Math.min(235, Math.max(150, median + 45));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) mask[i] = g[i] > thresh ? 1 : 0;
  return mask;
}

/**
 * Method 1 — Hough line detection. The receipt's four edges are the longest
 * straight edge structures in the photo: near-vertical lines cluster at the
 * paper's left/right x-positions, near-horizontal at its top/bottom. Short
 * stray edges (shadows, texture) never accumulate enough votes to win, which
 * makes this robust where hull-based fitting gets fooled by outlier spikes.
 */
interface HoughLine { theta: number; rho: number; votes: number }

function houghLines(
  ex: number[], ey: number[], w: number, h: number,
  thetaDegMin: number, thetaDegMax: number, minSep: number,
): HoughLine[] {
  const thetas: number[] = [];
  for (let d = thetaDegMin; d <= thetaDegMax; d++) thetas.push((d * Math.PI) / 180);
  const cosT = thetas.map(Math.cos), sinT = thetas.map(Math.sin);
  const D = Math.ceil(Math.sqrt(w * w + h * h));
  const rhoBins = Math.ceil(D / 2);
  const acc = new Int32Array(thetas.length * rhoBins * 2);
  const n = ex.length;
  for (let i = 0; i < n; i++) {
    const x = ex[i], y = ey[i];
    for (let ti = 0; ti < thetas.length; ti++) {
      const rho = x * cosT[ti] + y * sinT[ti];
      const rb = Math.round(rho / 2) + rhoBins;
      if (rb >= 0 && rb < rhoBins * 2) acc[ti * rhoBins * 2 + rb]++;
    }
  }
  // Collect local-maximum peaks
  const peaks: HoughLine[] = [];
  const T = thetas.length, R = rhoBins * 2;
  for (let ti = 0; ti < T; ti++) {
    for (let rb = 0; rb < R; rb++) {
      const v = acc[ti * R + rb];
      if (v < 8) continue;
      let isMax = true;
      for (let dt = -2; dt <= 2 && isMax; dt++) {
        for (let dr = -4; dr <= 4; dr++) {
          const t2 = ti + dt, r2 = rb + dr;
          if (t2 < 0 || r2 < 0 || t2 >= T || r2 >= R || (dt === 0 && dr === 0)) continue;
          if (acc[t2 * R + r2] > v) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ theta: thetas[ti], rho: (rb - rhoBins) * 2, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  if (!peaks.length) return [];
  // Strongest line + strongest well-separated line at a similar angle
  const l1 = peaks[0];
  const l2 = peaks.find(
    (p) => Math.abs(p.theta - l1.theta) < (15 * Math.PI) / 180 && Math.abs(p.rho - l1.rho) > minSep,
  );
  if (!l2 || l2.votes < l1.votes * 0.35) return [];
  return [l1, l2];
}

function intersectLines(a: HoughLine, b: HoughLine): Point | null {
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.cos(b.theta) * Math.sin(a.theta);
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det,
    y: (Math.cos(a.theta) * b.rho - Math.cos(b.theta) * a.rho) / det,
  };
}

function detectViaHough(g: Float32Array, w: number, h: number): Quad | null {
  const mag = sobelMagnitude(g, w, h);
  const sorted = Float32Array.from(mag).sort();
  const t = sorted[Math.floor(sorted.length * 0.9)] || 1;
  const ex: number[] = [], ey: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mag[y * w + x] > t) { ex.push(x); ey.push(y); }
    }
  }
  if (ex.length < 100) return null;
  // Near-vertical (normal ≈ 0°) and near-horizontal (normal ≈ 90°)
  const verticals = houghLines(ex, ey, w, h, -25, 25, w * 0.2);
  const horizontals = houghLines(ex, ey, w, h, 65, 115, h * 0.2);
  if (verticals.length < 2 || horizontals.length < 2) return null;
  const pts: Point[] = [];
  for (const v of verticals) {
    for (const hz of horizontals) {
      const p = intersectLines(v, hz);
      if (!p) return null;
      pts.push(p);
    }
  }
  // Intersections must lie near the image (allow 5% margin)
  const m = 0.05;
  if (pts.some((p) => p.x < -w * m || p.x > w * (1 + m) || p.y < -h * m || p.y > h * (1 + m))) return null;
  const quad = orderCorners(pts);
  const area = polyArea([quad.tl, quad.tr, quad.br, quad.bl]);
  if (area < w * h * 0.05 || area > w * h * 0.97) return null;
  return quad;
}

function erode3(mask: Uint8Array, w: number, h: number, iters = 1): Uint8Array {
  let cur = mask;
  for (let n = 0; n < iters; n++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 1;
        for (let dy = -1; dy <= 1 && v; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !cur[yy * w + xx]) { v = 0; break; }
          }
        }
        out[y * w + x] = v;
      }
    }
    cur = out;
  }
  return cur;
}

/**
 * Method 2 — bright interior region: erode the bright mask to sever thin
 * connections between the receipt and bright background blobs (specular
 * highlights), discard everything touching the image border (background),
 * then keep the TALLEST remaining region — receipts are tall and narrow —
 * dilate it back and fit a quad to its hull.
 */
function detectViaBrightInterior(g: Float32Array, w: number, h: number): Quad | null {
  // Close text holes first (receipt paper is mostly dark text), then erode to
  // sever thin connections between the receipt and bright background blobs.
  let m = brightMask(g, w, h);
  m = dilate3(m, w, h, 6);
  m = erode3(m, w, h, 6);
  m = erode3(m, w, h, 10);
  const comps = labelComponents(m, w, h).filter((c) => !c.touchesBorder);
  if (!comps.length) return null;
  const extent = (px: number[]) => {
    let mn = Infinity, mx = -Infinity;
    for (const p of px) { const y = (p / w) | 0; if (y < mn) mn = y; if (y > mx) mx = y; }
    return mx - mn;
  };
  comps.sort((a, b) => extent(b.pixels) - extent(a.pixels) || b.pixels.length - a.pixels.length);
  const best = comps[0];
  if (extent(best.pixels) < h * 0.25 || best.pixels.length < w * h * 0.01) return null;
  // Restore pre-erosion shape, then fit the quad to its hull.
  const restored = new Uint8Array(w * h);
  for (const p of best.pixels) restored[p] = 1;
  const back = dilate3(restored, w, h, 10);
  const px: number[] = [];
  for (let i = 0; i < back.length; i++) if (back[i]) px.push(i);
  const quad = quadFromHull(px, w);
  if (!quad) return null;
  const area = polyArea([quad.tl, quad.tr, quad.br, quad.bl]);
  if (area < w * h * 0.05 || area > w * h * 0.97) return null;
  return quad;
}

/** Method 3 — bright-paper region → hull → quadrilateral. */
function detectViaBrightness(g: Float32Array, w: number, h: number): Quad | null {
  const comp = largestBrightComponent(g, w, h);
  if (!comp || comp.length < w * h * 0.06) return null;
  const quad = quadFromHull(comp, w);
  if (!quad) return null;
  const area = polyArea([quad.tl, quad.tr, quad.br, quad.bl]);
  if (area < w * h * 0.08 || area > w * h * 0.97) return null;
  return quad;
}

/**
 * Visvalingam–Whyatt polygon simplification: repeatedly removes the vertex
 * with the smallest effective area (triangle formed with its neighbors).
 * Unlike RDP, this gracefully drops thin outlier spikes (e.g. from shadow
 * edges) while preserving true corners, converging to a clean quadrilateral.
 */
function visvalingam(pts: Point[], target: number): Point[] {
  const n = pts.length;
  if (n <= target) return pts.slice();
  const prev = new Int32Array(n), next = new Int32Array(n);
  for (let i = 0; i < n; i++) { prev[i] = (i - 1 + n) % n; next[i] = (i + 1) % n; }
  const alive = new Array<boolean>(n).fill(true);
  const effArea = (i: number): number => {
    const a = pts[prev[i]], b = pts[i], c = pts[next[i]];
    return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  };
  let count = n;
  while (count > target) {
    let minA = Infinity, minI = -1;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const a = effArea(i);
      if (a < minA) { minA = a; minI = i; }
    }
    alive[minI] = false;
    next[prev[minI]] = next[minI];
    prev[next[minI]] = prev[minI];
    count--;
  }
  return pts.filter((_, i) => alive[i]);
}

/** Convex hull → Visvalingam simplification → ordered quadrilateral. */
function quadFromHull(pixels: number[], w: number): Quad | null {
  const hull = convexHull(pixels, w);
  if (hull.length < 4) return null;
  const approx = visvalingam(hull, 4);
  if (approx.length !== 4) return null;
  return orderCorners(approx);
}

/** Monotone-chain convex hull of pixel indices. */
function convexHull(comp: number[], w: number): Point[] {
  const pts: Point[] = comp.map((p) => ({ x: p % w, y: Math.floor(p / w) }));
  pts.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function rdp(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  const distToSeg = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let dmax = 0, idx = s;
    for (let i = s + 1; i < e; i++) {
      const d = distToSeg(pts[i], pts[s], pts[e]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function polyArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

/** Order 4 points as tl, tr, br, bl (image coords, y down). */
export function orderCorners(pts: Point[]): Quad {
  const tl = pts.reduce((a, b) => (a.x + a.y <= b.x + b.y ? a : b));
  const br = pts.reduce((a, b) => (a.x + a.y >= b.x + b.y ? a : b));
  const tr = pts.reduce((a, b) => (a.x - a.y >= b.x - b.y ? a : b));
  const bl = pts.reduce((a, b) => (a.x - a.y <= b.x - b.y ? a : b));
  return { tl, tr, br, bl };
}

/**
 * Detect the receipt quadrilateral in a preview canvas.
 * Tries Hough line detection first (robust against bright/reflective
 * backgrounds and stray shadow edges), then bright-region fallbacks.
 * Returns corners in preview-canvas pixel coords, or null if not found.
 */
export function detectReceiptQuad(preview: HTMLCanvasElement): Quad | null {
  const w = preview.width, h = preview.height;
  const ctx = preview.getContext('2d')!;
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = blur5(grayscale(data), w, h);
  return detectViaHough(gray, w, h) || detectViaBrightInterior(gray, w, h) || detectViaBrightness(gray, w, h);
}

/** Default quad: full image with a small inset (used when detection fails). */
export function fullImageQuad(w: number, h: number, inset = 0.04): Quad {
  const ix = w * inset, iy = h * inset;
  return {
    tl: { x: ix, y: iy }, tr: { x: w - ix, y: iy },
    br: { x: w - ix, y: h - iy }, bl: { x: ix, y: h - iy },
  };
}

function solveHomography(src: Point[], dst: Point[]): number[] {
  // Solves for 3x3 H mapping src -> dst (h33 = 1), 8 unknowns.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivot
  const n = 8;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / (A[i][i] || 1e-12));
}

function invert3(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Warp the quad region of src into a straight-on rectangle.
 * Returns a new canvas (grayscale not applied — see enhanceReceipt).
 */
export function perspectiveCrop(src: HTMLCanvasElement, quad: Quad): HTMLCanvasElement {
  const W = Math.round(Math.max(dist(quad.tl, quad.tr), dist(quad.bl, quad.br)));
  const H = Math.round(Math.max(dist(quad.tl, quad.bl), dist(quad.tr, quad.br)));
  const dst = document.createElement('canvas');
  dst.width = Math.max(1, W); dst.height = Math.max(1, H);

  const Hm = solveHomography(
    [quad.tl, quad.tr, quad.br, quad.bl],
    [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
  );
  const Hfull = [...Hm.slice(0, 6), Hm[6], Hm[7], 1];
  const inv = invert3(Hfull);

  const sctx = src.getContext('2d')!;
  const sdata = sctx.getImageData(0, 0, src.width, src.height);
  const sp = sdata.data, sw = src.width, sh = src.height;
  const dctx = dst.getContext('2d')!;
  const dimg = dctx.createImageData(W, H);
  const dp = dimg.data;

  const sample = (x: number, y: number, ch: number): number => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
    const xc = Math.max(0, Math.min(sw - 1, x0)), yc = Math.max(0, Math.min(sh - 1, y0));
    const i00 = (yc * sw + xc) * 4 + ch, i10 = (yc * sw + x1) * 4 + ch;
    const i01 = (y1 * sw + xc) * 4 + ch, i11 = (y1 * sw + x1) * 4 + ch;
    return sp[i00] * (1 - fx) * (1 - fy) + sp[i10] * fx * (1 - fy) +
           sp[i01] * (1 - fx) * fy + sp[i11] * fx * fy;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wv = inv[6] * x + inv[7] * y + inv[8];
      const sx = (inv[0] * x + inv[1] * y + inv[2]) / wv;
      const sy = (inv[3] * x + inv[4] * y + inv[5]) / wv;
      const o = (y * W + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) {
        dp[o] = dp[o + 1] = dp[o + 2] = 255; dp[o + 3] = 255;
      } else {
        dp[o] = sample(sx, sy, 0); dp[o + 1] = sample(sx, sy, 1);
        dp[o + 2] = sample(sx, sy, 2); dp[o + 3] = 255;
      }
    }
  }
  dctx.putImageData(dimg, 0, 0);
  return dst;
}

/**
 * Grayscale + auto-contrast (2nd/98th percentile stretch): makes faded
 * thermal-printer text far more readable for the AI extraction step.
 */
export function enhanceReceipt(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d')!;
  const sdata = sctx.getImageData(0, 0, w, h);
  const sp = sdata.data;
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < sp.length; i += 4, j++) {
    gray[j] = 0.299 * sp[i] + 0.587 * sp[i + 1] + 0.114 * sp[i + 2];
  }
  const sorted = Float32Array.from(gray).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.98)];
  const span = Math.max(1, hi - lo);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d')!;
  const oimg = octx.createImageData(w, h);
  const op = oimg.data;
  for (let i = 0, j = 0; i < op.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, ((gray[j] - lo) / span) * 255));
    op[i] = op[i + 1] = op[i + 2] = v; op[i + 3] = 255;
  }
  octx.putImageData(oimg, 0, 0);
  return out;
}

/** Convenience: full pipeline from an <img> + quad to an enhanced JPEG dataURL. */
export function scanToDataURL(
  img: HTMLImageElement, quad: Quad, enhance = true, quality = 0.92,
): string {
  const full = document.createElement('canvas');
  full.width = img.naturalWidth; full.height = img.naturalHeight;
  full.getContext('2d')!.drawImage(img, 0, 0);
  let out = perspectiveCrop(full, quad);
  if (enhance) out = enhanceReceipt(out);
  // Cap long side at 1600px to keep upload + AI latency sane
  const maxSide = 1600;
  const s = Math.min(1, maxSide / Math.max(out.width, out.height));
  if (s < 1) {
    const c = document.createElement('canvas');
    c.width = Math.round(out.width * s); c.height = Math.round(out.height * s);
    c.getContext('2d')!.drawImage(out, 0, 0, c.width, c.height);
    out = c;
  }
  return out.toDataURL('image/jpeg', quality);
}
