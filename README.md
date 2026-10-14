# Jacquard

**Live:** https://jacquard-loom.vercel.app

Type your name and watch a 3D loom weave it into damask, bit by bit. A small tribute to the punch-card loom that taught machines to follow a program, built by a textile designer who became a software engineer.

![The loom weaving “Ada Lovelace” in indigo and cream, with the punch card for the current row](docs/loom.webp)

## How a name becomes cloth

1. **Name to bits.** The name is encoded as UTF-8, so `A` is `01000001` and letters like `õ` take two bytes.
2. **Bits to a draft.** Each bit covers a 4 × 4 block of thread crossings and decides whether that block is *figure* or *ground*. The motif is mirrored left to right, like a textile repeat.
3. **Draft to weave.** As in a real damask, the figure is a five-end warp satin (warp on top at four of every five crossings) and the ground is the same satin turned over, so the name shows in two colours from a single pair of threads.
4. **Weave to card.** Each row of the draft is one punch card: a hole lifts that warp thread. The card under the loom shows the row being woven.

The logic lives in [`src/weave.ts`](src/weave.ts) and is unit-tested, including that the figure really is warp-faced, the ground weft-faced, and no thread floats loose for more than four crossings.

## The loom

[`src/loom.ts`](src/loom.ts) is plain Three.js, built to show cause and effect:

- **Card → cord → thread.** A chain of punch cards steps through the Jacquard head, one card per row. Harness cords run from the head to every warp thread; the ones the current card has holes for light up brass and pull their threads forward, opening the shed the shuttle passes through.
- **The cloth** is two `InstancedMesh` layers of 4,096 capsules each, front and back. A damask is reversible: wherever the warp shows on the front, the weft shows on the back, so the back carries the same name in reversed colours.
- **Off the loom.** When the last row is beaten in, the cloth comes off, ripples in the air (a vertex shader adds a wave that grows away from the top edge) and turns to show its back. Drag it, or press *Turn the cloth*, to turn it again.
- Only the row being woven is re-placed and uploaded to the GPU each frame; everything else stays put.
- Motion stops for visitors who prefer reduced motion: the cloth appears finished and stays still.

![The finished cloth off the loom, turned to show its back in reversed colours](docs/back.webp)

The finished cloth can be downloaded as a PNG, drawn flat thread by thread in [`src/export.ts`](src/export.ts). A link with `?name=` weaves that name.

## The page around it

- **A fibre cosmos.** [`src/cosmos.ts`](src/cosmos.ts) is a second, fixed Three.js layer behind the whole page: loose threads, yarn balls and stray punch cards at different depths. The camera moves down exactly as fast as the page scrolls, so things further back drift slower and closer ones faster. Near the loom they keep to the open lanes beside the text, so nothing crosses the cloth.
- **A timeline hung on a thread.** The history below the loom hangs on a single warp thread that fills in brass as you read. Each era slides in from its side, and a 3D prop is pinned beside it by measuring the page element's position: a chain of laced cards (1804), two meshing brass gears turning at the right ratio (1843), a fanned stack of tabulator cards (1890) and a swatch of the cloth you just wove (now).

![The timeline: the 1804 card sits on the brass thread, with a chain of punch cards beside it](docs/timeline.webp)

Type is IBM Plex, a nod to the punch-card lineage, with Big Shoulders Display for the machine.

## Tests

- **Unit** (Vitest, `npm test`): the bits, the draft, the satin, mirroring and binding.
- **End to end** (Playwright, `npm run test:e2e`, desktop and mobile): weaving from a shared link, a new name updating the link, the empty-name fallback, turning the cloth over and back, the PNG download and its filename, the colour picker, and each era of the timeline coming in as you scroll. They run with reduced motion, so the loom finishes at once.

Both run in CI on every push.

## Stack

Three.js · TypeScript · Vite · Vitest · no framework

## Run it

```bash
npm install
npm run dev
npm test
npm run test:e2e
npm run build
```
