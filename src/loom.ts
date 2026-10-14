import * as THREE from "three";
import type { Palette } from "./weave";

const SPACING = 0.1; // distance between threads, in scene units
const ROWS_PER_SECOND = 8;
const CARD_SLOTS = 4; // punch cards visible on the chain above the loom
const SHED = 0.16; // how far a lifted warp thread is pulled forward to open the shed

type Options = {
  rows: number;
  cols: number;
  /** Called whenever a new row starts weaving, for the punch card readout. */
  onRow?: (row: number) => void;
  onDone?: () => void;
  /** Called when the finished cloth shows its front or back. */
  onSide?: (side: "front" | "back") => void;
};

type Phase = "weaving" | "releasing" | "free";

/**
 * A small Jacquard loom. A chain of punch cards runs through the head at the top; harness cords
 * run from the head to every warp thread and lift the ones the current card has holes for,
 * opening the shed; the shuttle carries the weft through and the reed beats it in. The cloth is
 * two layers of instances, front and back, because a damask is reversible: wherever the warp
 * shows on the front, the weft shows on the back. When the cloth is finished it comes off the
 * loom, moves in the air and turns to show its other side.
 */
export class Loom {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  private fabric = new THREE.Group();
  private front: THREE.InstancedMesh;
  private back: THREE.InstancedMesh;
  private backing: THREE.Mesh;
  private warp: THREE.LineSegments;
  private cords: THREE.LineSegments;
  private shuttle: THREE.Mesh;
  private reed: THREE.Mesh;
  private cards: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; row: number }[] = [];
  private uniforms = { uTime: { value: 0 }, uWave: { value: 0 }, uTop: { value: 0 }, uHeight: { value: 1 } };
  private resize: ResizeObserver;
  private frame = 0;
  private clock = new THREE.Clock();
  private pointer = new THREE.Vector2();
  private cells: Uint8Array = new Uint8Array();
  private progress = 0; // rows woven, fractional
  private lastRow = -1;
  private phase: Phase = "weaving";
  private released = 0; // 0 on the loom, 1 fully off
  private turn = 0; // current rotation of the free cloth, radians
  private turnTarget = 0;
  private drag: { x: number; turn: number } | null = null;
  private side: "front" | "back" = "front";
  private readonly rows: number;
  private readonly cols: number;
  private readonly width: number;
  private readonly bottom: number;
  private readonly top: number;
  private readonly head: number;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private container: HTMLElement, private options: Options) {
    this.rows = options.rows;
    this.cols = options.cols;
    this.width = this.cols * SPACING;
    this.bottom = -4.2;
    this.top = this.bottom + this.rows * SPACING + 1.9; // back beam
    this.head = this.top + 1.25; // Jacquard head

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x1a2230, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-4, 6, 7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc98a, 1.1);
    rim.position.set(5, -1, -4); // from behind, so the back of the cloth is lit when it turns
    this.scene.add(rim);

    // ---------- the cloth: front and back layers ----------
    const thread = new THREE.CapsuleGeometry(SPACING * 0.36, SPACING * 0.62, 3, 8);
    const frontMaterial = this.flutter(new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.02 }));
    const backMaterial = this.flutter(new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.02 }));
    this.front = new THREE.InstancedMesh(thread, frontMaterial, this.rows * this.cols);
    this.back = new THREE.InstancedMesh(thread, backMaterial, this.rows * this.cols);
    for (const layer of [this.front, this.back]) {
      layer.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      layer.frustumCulled = false;
      this.fabric.add(layer);
    }

    // a dark layer between the two faces, so the gaps between threads read as cloth
    this.backing = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, 24, 48),
      this.flutter(new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide })),
    );
    this.backing.frustumCulled = false;
    this.fabric.add(this.backing);
    this.scene.add(this.fabric);

    // ---------- warp threads, with the shed opening at the heddles ----------
    const warpGeometry = new THREE.BufferGeometry();
    warpGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.cols * 4 * 3), 3));
    this.warp = new THREE.LineSegments(warpGeometry, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8 }));
    this.scene.add(this.warp);

    // harness cords from the head down to every heddle; lifted ones glow brass
    const cordGeometry = new THREE.BufferGeometry();
    cordGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.cols * 2 * 3), 3));
    cordGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.cols * 2 * 3), 3));
    this.cords = new THREE.LineSegments(cordGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    this.scene.add(this.cords);

    // ---------- the frame ----------
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1f, roughness: 0.55 });
    const beam = new THREE.CylinderGeometry(0.09, 0.09, this.width + 0.8, 24);
    const backBeam = new THREE.Mesh(beam, wood);
    backBeam.rotation.z = Math.PI / 2;
    backBeam.position.y = this.top;
    const breastBeam = backBeam.clone();
    breastBeam.position.y = this.bottom - 0.14;
    const headBox = new THREE.Mesh(new THREE.BoxGeometry(this.width * 0.62, 0.34, 0.5), new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.5, metalness: 0.2 }));
    headBox.position.set(0, this.head, -0.1);
    this.scene.add(backBeam, breastBeam, headBox);

    this.reed = new THREE.Mesh(new THREE.BoxGeometry(this.width + 0.5, 0.05, 0.16), new THREE.MeshStandardMaterial({ color: 0x9a9da4, metalness: 0.75, roughness: 0.3 }));
    this.scene.add(this.reed);

    this.shuttle = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 4, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.4 }));
    this.shuttle.rotation.z = Math.PI / 2;
    this.scene.add(this.shuttle);

    // ---------- the card chain ----------
    for (let k = 0; k < CARD_SLOTS; k++) {
      const canvas = document.createElement("canvas");
      canvas.width = this.cols * 8 + 32;
      canvas.height = 64;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(this.width * 0.62, (this.width * 0.62 * canvas.height) / canvas.width),
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, transparent: true, side: THREE.DoubleSide }),
      );
      this.scene.add(mesh);
      this.cards.push({ mesh, canvas, texture, row: -1 });
    }

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.fit();
    container.addEventListener("pointermove", this.onPointer);
    container.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    this.loop();
  }

  /** Starts weaving a new cloth from the beginning. */
  weave(cells: Uint8Array, palette: Palette) {
    this.cells = cells;
    this.progress = this.reducedMotion ? this.rows : 0;
    this.lastRow = -1;
    this.phase = "weaving";
    this.released = 0;
    this.turn = this.turnTarget = 0;
    this.setSide("front");
    for (const card of this.cards) card.row = -1;
    this.setPalette(palette);
    this.layout(true);
  }

  /** Recolours the cloth in place, without re-weaving. */
  setPalette(palette: Palette) {
    const warp = new THREE.Color(palette.warp);
    const weft = new THREE.Color(palette.weft);
    for (let i = 0; i < this.cells.length; i++) {
      // the back shows whichever thread is hidden on the front
      this.front.setColorAt(i, this.cells[i] ? warp : weft);
      this.back.setColorAt(i, this.cells[i] ? weft : warp);
    }
    for (const layer of [this.front, this.back]) if (layer.instanceColor) layer.instanceColor.needsUpdate = true;
    (this.warp.material as THREE.LineBasicMaterial).color.copy(warp);
    (this.backing.material as THREE.MeshStandardMaterial).color.copy(warp.clone().lerp(weft, 0.5).multiplyScalar(0.4));
  }

  /** Turns the finished cloth to show its other face. */
  turnOver() {
    if (this.phase === "weaving") return;
    this.turnTarget = Math.round(this.turnTarget / Math.PI) * Math.PI + Math.PI;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.container.removeEventListener("pointermove", this.onPointer);
    this.container.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Adds a gentle wind to a material: the cloth ripples more the further it hangs from its top edge. */
  private flutter<T extends THREE.Material>(material: T): T {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWave;\nuniform float uTop;\nuniform float uHeight;")
        .replace(
          "#include <project_vertex>",
          `vec4 mvPosition = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          vec4 world = modelMatrix * mvPosition;
          float hang = clamp( ( uTop - world.y ) / uHeight, 0.0, 1.0 );
          world.z += uWave * hang * ( sin( world.y * 1.7 - uTime * 1.6 ) * 0.22 + sin( world.x * 1.2 + uTime * 0.9 ) * 0.12 );
          world.x += uWave * hang * sin( world.y * 1.1 - uTime * 1.1 ) * 0.08;
          mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    return material;
  }

  private onPointer = (event: PointerEvent) => {
    const rect = this.container.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
    if (this.drag) this.turnTarget = this.drag.turn + (event.clientX - this.drag.x) * 0.012;
  };

  private onDown = (event: PointerEvent) => {
    if (this.phase === "weaving") return;
    this.drag = { x: event.clientX, turn: this.turnTarget };
    this.container.style.cursor = "grabbing";
  };

  private onUp = () => {
    if (!this.drag) return;
    this.drag = null;
    this.container.style.cursor = "";
    // settle on whichever face is nearer
    this.turnTarget = Math.round(this.turnTarget / Math.PI) * Math.PI;
  };

  private setSide(side: "front" | "back") {
    if (side === this.side) return;
    this.side = side;
    this.options.onSide?.(side);
  }

  private fit() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the whole loom, head and beams included, in frame
    this.camera.position.z = Math.max(21, 15 / this.camera.aspect + 7);
    // on wide screens the text sits on the left, so frame the loom in the right half
    if (this.camera.aspect > 1.25) this.camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private x = (col: number) => (col - (this.cols - 1) / 2) * SPACING;
  private y = (row: number) => this.bottom + row * SPACING;

  /** Draws one punch card: a hole wherever the warp is lifted for that row. */
  private drawCard(card: (typeof this.cards)[number], row: number) {
    card.row = row;
    const ctx = card.canvas.getContext("2d")!;
    const { width, height } = card.canvas;
    ctx.clearRect(0, 0, width, height);
    if (row < 0 || row >= this.rows) return;
    ctx.fillStyle = "#efe6cf";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(width - 14, 0);
    ctx.lineTo(width, 14); // the clipped corner
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fill();
    ctx.fillStyle = "#1a140b";
    for (let c = 0; c < this.cols; c++) {
      if (this.cells[row * this.cols + c] !== 1) continue;
      ctx.fillRect(16 + c * 8 + 1, 18, 6, 28);
    }
    ctx.fillStyle = "rgba(59, 47, 30, 0.55)";
    ctx.font = "12px monospace";
    ctx.fillText(String(row + 1).padStart(2, "0"), 4, 12);
    card.texture.needsUpdate = true;
  }

  // reused for every instance placement, to avoid allocating per thread
  private m = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private upright = new THREE.Quaternion();
  private across = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  private placedUpTo = 0; // rows below this are fully grown and don't change

  /** Places the threads of rows [from, to), front and back, and uploads only those rows. */
  private placeRows(from: number, to: number) {
    from = Math.max(0, from);
    to = Math.min(this.rows, to);
    if (to <= from) return;
    const { m, pos, scale, upright, across } = this;
    for (let r = from; r < to; r++) {
      // the newest row grows in as the reed beats it
      scale.setScalar(THREE.MathUtils.clamp(this.progress - r, 0, 1));
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        const warpOnTop = this.cells[i] === 1;
        pos.set(this.x(c), this.y(r), warpOnTop ? 0.012 : 0);
        m.compose(pos, warpOnTop ? upright : across, scale);
        this.front.setMatrixAt(i, m);
        // on the back the hidden thread shows, lying the other way
        pos.set(this.x(c), this.y(r), warpOnTop ? -0.05 : -0.062);
        m.compose(pos, warpOnTop ? across : upright, scale);
        this.back.setMatrixAt(i, m);
      }
    }
    for (const layer of [this.front, this.back]) {
      layer.instanceMatrix.clearUpdateRanges();
      layer.instanceMatrix.addUpdateRange(from * this.cols * 16, (to - from) * this.cols * 16);
      layer.instanceMatrix.needsUpdate = true;
    }
  }

  /** Places every thread, card and cord for the current moment. */
  private layout(all = false) {
    if (all) {
      this.placedUpTo = 0;
      this.placeRows(0, this.rows);
    } else {
      // only the row being woven (and the one just finished) change
      const current = Math.floor(this.progress);
      this.placeRows(Math.min(this.placedUpTo, current - 1), current + 1);
      this.placedUpTo = Math.max(this.placedUpTo, current - 1);
    }

    const woven = Math.min(this.progress, this.rows);
    const fell = this.y(woven) - SPACING / 2;
    this.backing.scale.set(this.width, Math.max(0.001, woven * SPACING), 1);
    this.backing.position.set(0, this.bottom - SPACING / 2 + (woven * SPACING) / 2, -0.025);

    // the shed: lifted warps are pulled forward at the heddles, the rest pushed back
    const row = Math.min(this.rows - 1, Math.floor(this.progress));
    const heddle = fell + 0.85;
    const open = this.phase === "weaving" ? Math.sin(Math.min(1, (this.progress % 1) * 1.6) * Math.PI) : 0;
    const warp = this.warp.geometry.getAttribute("position") as THREE.BufferAttribute;
    const cords = this.cords.geometry.getAttribute("position") as THREE.BufferAttribute;
    const cordColors = this.cords.geometry.getAttribute("color") as THREE.BufferAttribute;
    const brass = new THREE.Color("#e2b462");
    const dim = new THREE.Color("#4a4440");
    for (let c = 0; c < this.cols; c++) {
      const lifted = this.phase === "weaving" && this.cells[row * this.cols + c] === 1;
      const z = (lifted ? SHED : -SHED * 0.6) * open;
      warp.setXYZ(c * 4, this.x(c), fell, 0);
      warp.setXYZ(c * 4 + 1, this.x(c), heddle, z);
      warp.setXYZ(c * 4 + 2, this.x(c), heddle, z);
      warp.setXYZ(c * 4 + 3, this.x(c), this.top, 0);
      // cords fan in from the head to the heddles
      cords.setXYZ(c * 2, this.x(c) * 0.55, this.head - 0.17, -0.1);
      cords.setXYZ(c * 2 + 1, this.x(c), heddle, z);
      const color = lifted ? brass : dim;
      cordColors.setXYZ(c * 2, color.r, color.g, color.b);
      cordColors.setXYZ(c * 2 + 1, color.r, color.g, color.b);
    }
    warp.needsUpdate = true;
    cords.needsUpdate = true;
    cordColors.needsUpdate = true;

    this.reed.position.set(0, fell + 0.05 + (this.phase === "weaving" ? 0.12 * (1 - (this.progress % 1) ** 0.35) : 0.12), 0.05);
    const pass = this.progress % 1;
    const direction = row % 2 === 0 ? 1 : -1;
    this.shuttle.visible = this.phase === "weaving";
    this.shuttle.position.set(direction * (pass - 0.5) * (this.width + 0.6), fell + 0.08, 0.12);

    // the card chain steps down one card per row; the lowest one is being read
    const cardHeight = (this.cards[0].mesh.geometry as THREE.PlaneGeometry).parameters.height * 1.12;
    const step = this.phase === "weaving" ? Math.min(1, (this.progress % 1) * 3) : 0;
    this.cards.forEach((card, k) => {
      const cardRow = row + k;
      if (card.row !== cardRow) this.drawCard(card, cardRow);
      card.mesh.position.set(0, this.head + 0.3 + (k - step) * cardHeight, 0.2 - k * 0.05);
      card.mesh.rotation.x = -0.12 * k;
      const material = card.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = this.phase === "weaving" ? 1 - k * 0.22 : 0.25;
    });
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.uniforms.uTime.value = t;

    if (this.phase === "weaving") {
      this.progress = Math.min(this.rows, this.progress + dt * ROWS_PER_SECOND);
      const row = Math.min(this.rows - 1, Math.floor(this.progress));
      if (row !== this.lastRow) {
        this.lastRow = row;
        this.options.onRow?.(row);
      }
      if (this.progress >= this.rows) {
        this.phase = this.reducedMotion ? "free" : "releasing";
        this.released = this.reducedMotion ? 1 : 0;
        this.options.onDone?.();
      }
      this.layout();
    } else {
      if (this.phase === "releasing") {
        this.released = Math.min(1, this.released + dt * 0.45);
        if (this.released >= 1) {
          this.phase = "free";
          this.turnTarget = Math.PI; // show the back once, then let the visitor turn it
        }
        this.layout();
      }
      this.turn += (this.turnTarget - this.turn) * Math.min(1, dt * 2.2);
      const facingBack = Math.cos(this.turn) < 0;
      this.setSide(facingBack ? "back" : "front");
    }

    // off the loom: the cloth comes forward, rises a little and starts to move in the air
    const ease = this.released * this.released * (3 - 2 * this.released);
    const clothHeight = this.rows * SPACING;
    this.fabric.position.set(0, ease * 0.9, ease * 1.3);
    this.fabric.rotation.y = this.turn;
    this.uniforms.uWave.value = this.reducedMotion ? 0 : ease;
    this.uniforms.uTop.value = this.bottom + clothHeight + ease * 0.9;
    this.uniforms.uHeight.value = clothHeight;
    const loomOpacity = 1 - ease * 0.75;
    (this.warp.material as THREE.LineBasicMaterial).opacity = 0.8 * loomOpacity;
    (this.cords.material as THREE.LineBasicMaterial).opacity = 0.9 * loomOpacity;

    // gentle parallax towards the pointer
    if (!this.reducedMotion) {
      this.camera.position.x += (this.pointer.x * 1.6 + Math.sin(t * 0.2) * 0.3 - this.camera.position.x) * 0.04;
      this.camera.position.y += (-this.pointer.y * 1.0 + 1.3 - this.camera.position.y) * 0.04;
    }
    this.camera.lookAt(0, 1.3, 0);
    this.renderer.render(this.scene, this.camera);
  };
}
