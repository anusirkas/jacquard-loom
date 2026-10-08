import type { Palette } from "./weave";

/** Draws the woven cloth flat, thread by thread, with the name woven into the selvedge label. */
export function clothImage(cells: Uint8Array, rows: number, cols: number, palette: Palette, name: string): HTMLCanvasElement {
  const cell = 12;
  const margin = 48;
  const label = 72;
  const canvas = document.createElement("canvas");
  canvas.width = cols * cell + margin * 2;
  canvas.height = rows * cell + margin * 2 + label;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#121212";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const warpOnTop = cells[r * cols + c] === 1;
      // rows are woven bottom-up, so row 0 sits at the bottom of the image
      const x = margin + c * cell;
      const y = margin + (rows - 1 - r) * cell;
      ctx.fillStyle = warpOnTop ? palette.weft : palette.warp;
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = warpOnTop ? palette.warp : palette.weft;
      ctx.beginPath();
      if (warpOnTop) ctx.roundRect(x + 2, y, cell - 4, cell, 4);
      else ctx.roundRect(x, y + 2, cell, cell - 4, 4);
      ctx.fill();
    }
  }

  ctx.fillStyle = "#f4f1ea";
  ctx.font = "600 22px 'Space Grotesk', system-ui, sans-serif";
  ctx.fillText(name, margin, canvas.height - label / 2 - 4);
  ctx.fillStyle = "rgba(244, 241, 234, 0.55)";
  ctx.font = "14px 'JetBrains Mono', monospace";
  ctx.fillText(`Jacquard damask · ${palette.name} · ${rows} picks`, margin, canvas.height - label / 2 + 20);
  return canvas;
}

export function download(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
