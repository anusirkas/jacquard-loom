// Turns a name into a woven damask: the name's bits decide, block by block, whether the cloth
// shows the figure or the ground. As in a real damask, the figure is a warp-faced satin (warp on
// top) and the ground the same satin turned over (weft on top), so the name reads in two colours.

export const FALLBACK_NAME = "JACQUARD";

/** UTF-8 bytes of the name, most significant bit first. */
export function nameToBits(name: string): number[] {
  const text = name.trim() || FALLBACK_NAME;
  const bytes = new TextEncoder().encode(text);
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits;
}

/**
 * A five-end warp satin: the warp is on top at four of every five crossings, and the single
 * binding point steps two threads each row so no diagonal line shows.
 */
export const satin = (row: number, col: number) => ((col * 2 + row) % 5 === 0 ? 0 : 1);

/**
 * The weave draft: 1 where the warp (vertical) thread lies on top, 0 where the weft does.
 * Figure cells follow the warp satin; ground cells are its inverse.
 * The pattern is mirrored left to right like a textile repeat, and each bit covers a
 * `block` x `block` square so the motif reads at a distance.
 */
export function draft(bits: number[], rows: number, cols: number, block = 2): Uint8Array {
  const cells = new Uint8Array(rows * cols);
  const half = Math.ceil(cols / 2);
  const stride = Math.ceil(half / block);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mirrored = c < half ? c : cols - 1 - c;
      const index = (Math.floor(mirrored / block) + Math.floor(r / block) * stride) % bits.length;
      const base = satin(r, c);
      cells[r * cols + c] = bits[index] ? base : 1 - base;
    }
  }
  return cells;
}

/** The holes punched for one row of the card: a hole lifts that warp thread. */
export const cardRow = (cells: Uint8Array, row: number, cols: number) => Array.from(cells.subarray(row * cols, (row + 1) * cols));

export type Palette = { name: string; warp: string; weft: string };

export const PALETTES: Palette[] = [
  { name: "Indigo", warp: "#1e2f5c", weft: "#e8e2d2" },
  { name: "Madder", warp: "#8c1f28", weft: "#f0c9a0" },
  { name: "Signal", warp: "#111318", weft: "#ffd23f" },
  { name: "Moss", warp: "#2d4a33", weft: "#cfe3b0" },
];
