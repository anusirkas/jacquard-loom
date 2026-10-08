import * as THREE from "three";
import type { Palette } from "./weave";

const SPACING = 0.1; // distance between threads, in scene units
const ROWS_PER_SECOND = 9;

type Options = {
  rows: number;
  cols: number;
  /** Called whenever a new row starts weaving, for the punch card readout. */
  onRow?: (row: number) => void;
  onDone?: () => void;
};

/**
 * A small loom: warp threads run from the back beam down to the cloth, a shuttle carries the
 * weft across, and the cloth grows row by row. Each crossing in the cloth is one instance,
 * standing up in the warp colour where the warp lies on top, or lying across in the weft
 * colour where the weft does.
 */
export class Loom {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  private cloth: THREE.InstancedMesh;
  private backing: THREE.Mesh;
  private warp: THREE.LineSegments;
  private shuttle: THREE.Mesh;
  private reed: THREE.Mesh;
  private resize: ResizeObserver;
  private frame = 0;
  private clock = new THREE.Clock();
  private pointer = new THREE.Vector2();
  private cells: Uint8Array = new Uint8Array();
  private progress = 0; // rows woven, fractional
  private lastRow = -1;
  private weaving = false;
  private readonly rows: number;
  private readonly cols: number;
  private readonly width: number;
  private readonly bottom: number;
  private readonly top: number;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private container: HTMLElement, private options: Options) {
    this.rows = options.rows;
    this.cols = options.cols;
    this.width = this.cols * SPACING;
    this.bottom = -(this.rows * SPACING) / 2 - 0.4;
    this.top = this.bottom + this.rows * SPACING + 1.6;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 0.1, 10.5);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-4, 6, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd9a8, 0.8);
    rim.position.set(5, -2, 3);
    this.scene.add(rim);

    // the cloth: one capsule per crossing
    const thread = new THREE.CapsuleGeometry(SPACING * 0.36, SPACING * 0.62, 3, 8);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.02 });
    this.cloth = new THREE.InstancedMesh(thread, material, this.rows * this.cols);
    this.cloth.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.cloth);

    // a darker layer behind the cloth, so gaps between threads don't show the background
    this.backing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 1 }));
    this.backing.position.z = -0.03;
    this.scene.add(this.backing);

    // warp threads from the cloth up to the back beam
    const warpGeometry = new THREE.BufferGeometry();
    warpGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.cols * 6), 3));
    this.warp = new THREE.LineSegments(warpGeometry, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.75 }));
    this.scene.add(this.warp);

    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1f, roughness: 0.6 });
    const beam = new THREE.CylinderGeometry(0.09, 0.09, this.width + 0.8, 24);
    const backBeam = new THREE.Mesh(beam, wood);
    backBeam.rotation.z = Math.PI / 2;
    backBeam.position.y = this.top;
    const breastBeam = backBeam.clone();
    breastBeam.position.y = this.bottom - 0.12;
    this.scene.add(backBeam, breastBeam);

    // the reed beats each new row into place
    this.reed = new THREE.Mesh(new THREE.BoxGeometry(this.width + 0.5, 0.05, 0.16), new THREE.MeshStandardMaterial({ color: 0x9a9da4, metalness: 0.7, roughness: 0.35 }));
    this.scene.add(this.reed);

    this.shuttle = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 4, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.45 }));
    this.shuttle.rotation.z = Math.PI / 2;
    this.scene.add(this.shuttle);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.fit();
    container.addEventListener("pointermove", this.onPointer);
    this.loop();
  }

  /** Starts weaving a new cloth from the beginning. */
  weave(cells: Uint8Array, palette: Palette) {
    this.cells = cells;
    this.setPalette(palette);
    this.progress = this.reducedMotion ? this.rows : 0;
    this.lastRow = -1;
    this.weaving = true;
    this.layout();
  }

  /** Recolours the cloth in place, without re-weaving. */
  setPalette(palette: Palette) {
    const warp = new THREE.Color(palette.warp);
    const weft = new THREE.Color(palette.weft);
    for (let i = 0; i < this.cells.length; i++) this.cloth.setColorAt(i, this.cells[i] ? warp : weft);
    if (this.cloth.instanceColor) this.cloth.instanceColor.needsUpdate = true;
    (this.warp.material as THREE.LineBasicMaterial).color.copy(warp);
    (this.backing.material as THREE.MeshStandardMaterial).color.copy(warp.clone().lerp(weft, 0.5).multiplyScalar(0.45));
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.container.removeEventListener("pointermove", this.onPointer);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private onPointer = (event: PointerEvent) => {
    const rect = this.container.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
  };

  private fit() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the whole loom, beams included, in frame
    this.camera.position.z = Math.max(13.5, 11 / this.camera.aspect + 4);
    // on wide screens the text sits on the left, so frame the loom in the right half
    if (this.camera.aspect > 1.25) this.camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private x = (col: number) => (col - (this.cols - 1) / 2) * SPACING;
  private y = (row: number) => this.bottom + row * SPACING;

  /** Places every crossing; rows not woven yet are scaled to nothing. */
  private layout() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const across = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let r = 0; r < this.rows; r++) {
      // the newest row grows in as the reed beats it
      const grown = THREE.MathUtils.clamp(this.progress - r, 0, 1);
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        const warpOnTop = this.cells[i] === 1;
        q.copy(warpOnTop ? new THREE.Quaternion() : across);
        pos.set(this.x(c), this.y(r), warpOnTop ? 0.012 : 0);
        scale.setScalar(grown);
        m.compose(pos, q, scale);
        this.cloth.setMatrixAt(i, m);
      }
    }
    this.cloth.instanceMatrix.needsUpdate = true;

    const woven = Math.min(this.progress, this.rows);
    const fell = this.y(woven) - SPACING / 2;
    this.backing.scale.set(this.width, Math.max(0.001, woven * SPACING), 1);
    this.backing.position.y = this.bottom - SPACING / 2 + (woven * SPACING) / 2;

    // warp threads run from the fell of the cloth up to the back beam
    const position = this.warp.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let c = 0; c < this.cols; c++) {
      position.setXYZ(c * 2, this.x(c), fell, 0);
      position.setXYZ(c * 2 + 1, this.x(c), this.top, 0);
    }
    position.needsUpdate = true;

    this.reed.position.set(0, fell + 0.05 + (this.weaving ? 0.12 * (1 - ((this.progress % 1) ** 0.35)) : 0.12), 0.05);
    const row = Math.floor(this.progress);
    const across01 = this.progress % 1;
    const direction = row % 2 === 0 ? 1 : -1;
    this.shuttle.visible = this.weaving && row < this.rows;
    this.shuttle.position.set(direction * (across01 - 0.5) * (this.width + 0.6), fell + 0.08, 0.12);
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (this.weaving) {
      this.progress = Math.min(this.rows, this.progress + dt * ROWS_PER_SECOND);
      const row = Math.min(this.rows - 1, Math.floor(this.progress));
      if (row !== this.lastRow) {
        this.lastRow = row;
        this.options.onRow?.(row);
      }
      if (this.progress >= this.rows) {
        this.weaving = false;
        this.options.onDone?.();
      }
      this.layout();
    }

    // gentle parallax towards the pointer
    if (!this.reducedMotion) {
      const t = this.clock.elapsedTime;
      this.camera.position.x += (this.pointer.x * 1.4 + Math.sin(t * 0.2) * 0.3 - this.camera.position.x) * 0.04;
      this.camera.position.y += (-this.pointer.y * 0.9 + 0.1 - this.camera.position.y) * 0.04;
    }
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  };
}
