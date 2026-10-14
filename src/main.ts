import { Cosmos, type Prop } from "./cosmos";
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
const turnButton = $<HTMLButtonElement>("#turn");
const sideNote = $("#side");
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
    turnButton.disabled = false;
    sideNote.textContent = "Off the loom. Drag the cloth to turn it.";
  },
  onSide: (side) => {
    // a damask is reversible: the back shows the same name in swapped colours
    sideNote.textContent =
      side === "back"
        ? "The back: the same name in reversed colours. Damask is reversible."
        : "The front: warp-faced figure on a weft-faced ground.";
  },
});

// ---------- the fibre cosmos behind the page, with one prop per era ----------
const cosmos = new Cosmos($("#cosmos"));
for (const era of document.querySelectorAll<HTMLElement>(".era")) {
  cosmos.anchor(era.querySelector<HTMLElement>(".era-prop")!, era.dataset.prop as Prop);
}
document.fonts?.ready.then(() => cosmos.refresh());

// eras slide in from their side of the thread as they come into view
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const eras = [...document.querySelectorAll<HTMLElement>(".era")];
if (!reducedMotion) {
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("waiting");
        entry.target.classList.add("in");
        reveal.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -25% 0px" },
  );
  for (const era of eras) {
    if (era.getBoundingClientRect().top > window.innerHeight) era.classList.add("waiting");
    reveal.observe(era);
  }
} else {
  for (const era of eras) era.classList.add("in");
}

// the thread fills in brass as far as you have read
const threadLine = $(".thread-line");
const threadFill = $("#thread-fill");
const updateThread = () => {
  const rect = threadLine.getBoundingClientRect();
  const progress = Math.min(1, Math.max(0, (window.innerHeight * 0.6 - rect.top) / rect.height));
  threadFill.style.setProperty("--progress", progress.toFixed(4));
};
window.addEventListener("scroll", updateThread, { passive: true });
window.addEventListener("resize", updateThread);
updateThread();

function showBinary(text: string) {
  const bytes = [...new TextEncoder().encode(text)].map((b) => b.toString(2).padStart(8, "0"));
  binary.textContent = `${text} → ${bytes.slice(0, 6).join(" ")}${bytes.length > 6 ? " …" : ""}`;
}

function weave(text: string) {
  name = text.trim() || FALLBACK_NAME;
  cells = draft(nameToBits(name), ROWS, COLS, BLOCK);
  showBinary(name);
  downloadButton.disabled = true;
  turnButton.disabled = true;
  sideNote.textContent = "";
  loom.weave(cells, palette);
  cosmos.setSwatch(cells, ROWS, COLS, palette.warp, palette.weft);
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
    cosmos.setSwatch(cells, ROWS, COLS, p.warp, p.weft);
  });
  palettesEl.appendChild(button);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  weave(input.value);
});

turnButton.addEventListener("click", () => loom.turnOver());

downloadButton.addEventListener("click", () => {
  const filename = `jacquard-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "cloth"}.png`;
  download(clothImage(cells, ROWS, COLS, palette, name), filename);
});

// a shared link weaves the name it carries
const initial = new URL(location.href).searchParams.get("name") ?? "";
input.value = initial;
weave(initial || "Ada Lovelace");

