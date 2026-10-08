# Jacquard

Type your name and watch a 3D loom weave it into damask, bit by bit. A small tribute to the punch-card loom that taught machines to follow a program, built by a textile designer who became a software engineer.

![The loom weaving “Ada Lovelace” in indigo and cream, with the punch card for the current row](docs/loom.webp)

## How a name becomes cloth

1. **Name to bits.** The name is encoded as UTF-8, so `A` is `01000001` and letters like `õ` take two bytes.
2. **Bits to a draft.** Each bit covers a 4 × 4 block of thread crossings and decides whether that block is *figure* or *ground*. The motif is mirrored left to right, like a textile repeat.
3. **Draft to weave.** As in a real damask, the figure is a five-end warp satin (warp on top at four of every five crossings) and the ground is the same satin turned over, so the name shows in two colours from a single pair of threads.
4. **Weave to card.** Each row of the draft is one punch card: a hole lifts that warp thread. The card under the loom shows the row being woven.

The logic lives in [`src/weave.ts`](src/weave.ts) and is unit-tested, including that the figure really is warp-faced, the ground weft-faced, and no thread floats loose for more than four crossings.

## The loom

[`src/loom.ts`](src/loom.ts) is plain Three.js:

- the cloth is one `InstancedMesh` of 4,096 capsules, one per crossing: standing up in the warp colour where the warp is on top, lying across in the weft colour where the weft is;
- warp threads are line segments from the fell of the cloth up to the back beam, and get shorter as the cloth grows;
- a shuttle carries the weft across and the reed beats each row in;
- the camera drifts towards the pointer, and everything stops for reduced-motion users.

The finished cloth can be downloaded as a PNG, drawn flat thread by thread in [`src/export.ts`](src/export.ts). A link with `?name=` weaves that name.

## Stack

Three.js · TypeScript · Vite · Vitest · no framework

## Run it

```bash
npm install
npm run dev
npm test
npm run build
```
