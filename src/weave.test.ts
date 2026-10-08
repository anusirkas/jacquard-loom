import { describe, expect, it } from "vitest";
import { cardRow, draft, FALLBACK_NAME, nameToBits, satin } from "./weave";

describe("nameToBits", () => {
  it("spells each character as eight bits", () => {
    expect(nameToBits("A")).toEqual([0, 1, 0, 0, 0, 0, 0, 1]); // 65
  });

  it("handles letters outside ASCII, like õ, as UTF-8", () => {
    expect(nameToBits("õ")).toHaveLength(16);
  });

  it("falls back to a default name when empty", () => {
    expect(nameToBits("  ")).toEqual(nameToBits(FALLBACK_NAME));
  });
});

describe("draft", () => {
  const rows = 32;
  const cols = 32;

  it("is the same every time for the same name", () => {
    expect(draft(nameToBits("Anu"), rows, cols)).toEqual(draft(nameToBits("Anu"), rows, cols));
  });

  it("gives different names different cloth", () => {
    expect(draft(nameToBits("Anu"), rows, cols)).not.toEqual(draft(nameToBits("Ada"), rows, cols));
  });

  it("mirrors the figure left to right, like a textile repeat", () => {
    const cells = draft(nameToBits("Lovelace"), rows, cols);
    // a cell is figure when it follows the satin, ground when it is the opposite
    const isFigure = (r: number, c: number) => cells[r * cols + c] === satin(r, c);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols / 2; c++) expect(isFigure(r, c)).toBe(isFigure(r, cols - 1 - c));
    }
  });

  it("weaves the figure warp-faced and the ground weft-faced, so the name shows in two colours", () => {
    const figure = draft([1], 10, 10, 1);
    const ground = draft([0], 10, 10, 1);
    const warpShare = (cells: Uint8Array) => cells.reduce((sum, v) => sum + v, 0) / cells.length;
    expect(warpShare(figure)).toBeCloseTo(0.8);
    expect(warpShare(ground)).toBeCloseTo(0.2);
  });

  it("binds every thread at least once in five, so nothing floats loose", () => {
    const cells = draft([1], 10, 10, 1);
    for (let r = 0; r < 10; r++) expect(cardRow(cells, r, 10).join("")).not.toMatch(/1{5}/);
  });
});
