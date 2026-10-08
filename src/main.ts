import { clothImage, download } from "./export";
import { Loom } from "./loom";
import { cardRow, draft, FALLBACK_NAME, nameToBits, PALETTES, type Palette } from "./weave";
import "./style.css";

const ROWS = 64;
const COLS = 64;
// each bit of the name covers a 4 x 4 block of crossings, so the figure reads from across the room
const BLOCK = 4;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const form = $<HTMLFormElement>("#form");
const input = $<HTMLInputElement>("#name");
const binary = $("#binary");
const palettesEl = $("#palettes");
const downloadButton = $<HTMLButtonElement>("#download");
const cardHoles = $("#card-holes");
const cardCount = $("#card-count");

let palette: Palette = PALETTES[0];
let cells: Uint8Array = new Uint8Array();
let name = FALLBACK_NAME;

// one punch position per warp thread
const holes = Array.from({ length: COLS }, () => {
  const hole = document.createElement("span");
  cardHoles.appendChild(hole);
  return hole;
});

const loom = new Loom($("#loom"), {
  rows: ROWS,
  cols: COLS,
  onRow: (row) => {
    const punched = cardRow(cells, row, COLS);
    holes.forEach((hole, i) => hole.classList.toggle("punched", punched[i] === 1));
    cardCount.textContent = `${String(row + 1).padStart(2, "0")} / ${ROWS}`;
  },
  onDone: () => {
    downloadButton.disabled = false;
  },
});

function showBinary(text: string) {
  const bytes = [...new TextEncoder().encode(text)].map((b) => b.toString(2).padStart(8, "0"));
  binary.textContent = `${text} → ${bytes.slice(0, 6).join(" ")}${bytes.length > 6 ? " …" : ""}`;
}

function weave(text: string) {
  name = text.trim() || FALLBACK_NAME;
  cells = draft(nameToBits(name), ROWS, COLS, BLOCK);
  showBinary(name);
  downloadButton.disabled = true;
  loom.weave(cells, palette);
  const url = new URL(location.href);
  url.searchParams.set("name", name);
  history.replaceState(null, "", url);
}

for (const p of PALETTES) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "swatch";
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", String(p === palette));
  button.setAttribute("aria-label", p.name);
  button.title = p.name;
  button.style.setProperty("--warp", p.warp);
  button.style.setProperty("--weft", p.weft);
  button.addEventListener("click", () => {
    palette = p;
    for (const b of palettesEl.children) b.setAttribute("aria-checked", String(b === button));
    loom.setPalette(p);
  });
  palettesEl.appendChild(button);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  weave(input.value);
});

downloadButton.addEventListener("click", () => {
  const filename = `jacquard-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "cloth"}.png`;
  download(clothImage(cells, ROWS, COLS, palette, name), filename);
});

// a shared link weaves the name it carries
const initial = new URL(location.href).searchParams.get("name") ?? "";
input.value = initial;
weave(initial || "Ada Lovelace");
