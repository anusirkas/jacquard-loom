import * as THREE from "three";

// A fixed canvas behind the whole page. The camera moves down exactly as fast as the page
// scrolls (at depth 0), so loose threads, yarn and cards further back drift slower and those
// closer drift faster, and props anchored to page elements stay beside them.

const FOV = 40;
const CAMERA_Z = 10;
const COLORS = [0xd6a85c, 0xefe6cf, 0x2b4a8c, 0x8c1f28, 0x9fb38a];

export type Prop = "cards" | "gear" | "stack" | "swatch";

type Anchor = { el: HTMLElement; object: THREE.Object3D; spin: number };

function cardTexture(seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 112;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#efe6cf";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(236, 0);
  ctx.lineTo(256, 20);
  ctx.lineTo(256, 112);
  ctx.lineTo(0, 112);
  ctx.fill();
  ctx.fillStyle = "#1a140b";
  let s = seed;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 28; col++) {
      if (rand() < 0.35) ctx.fillRect(12 + col * 8.4, 14 + row * 15, 4.5, 9);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A small brass gear, the kind that filled Babbage's engines. */
function gear(radius: number, teeth: number) {
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? radius : radius * 0.82;
    if (i === 0) shape.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
    else shape.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    shape.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, radius * 0.3, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth: radius * 0.18, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
}

export class Cosmos {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);
  private drifters: { object: THREE.Object3D; spin: THREE.Vector3; bob: number }[] = [];
  private anchors: Anchor[] = [];
  private unitsPerPixel = 1;
  private frame = 0;
  private clock = new THREE.Clock();
  private swatchTexture: THREE.CanvasTexture | null = null;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private canvasHost: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvasHost.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog(0x0e0e10, 8, 30);
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x101420, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-3, 4, 6);
    this.scene.add(key);

    window.addEventListener("resize", this.fit);
    this.fit();
    this.populate();
    this.loop();
  }

  /** One loose thread, yarn ball or stray card. */
  private drifter(i: number): THREE.Object3D {
    const color = COLORS[i % COLORS.length];
    const kind = i % 3;
    if (kind === 0) {
      // a loose thread: a soft curve through four random points
      const points = Array.from({ length: 4 }, () => new THREE.Vector3((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 1.2));
      return new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.012 + Math.random() * 0.02, 6),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
      );
    }
    if (kind === 1) {
      // a yarn ball: a sphere wound with a knot of the same yarn
      const r = 0.15 + Math.random() * 0.25;
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
      const ball = new THREE.Group();
      ball.add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.92, 20, 14), material));
      ball.add(new THREE.Mesh(new THREE.TorusKnotGeometry(r * 0.7, r * 0.09, 96, 6, 3, 7), material));
      return ball;
    }
    return new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.39),
      new THREE.MeshStandardMaterial({ map: cardTexture(i * 31 + 7), roughness: 0.9, side: THREE.DoubleSide }),
    );
  }

  private addDrifter(object: THREE.Object3D, x: number, y: number, z: number) {
    object.position.set(x, y, z);
    object.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(object);
    this.drifters.push({ object, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.25), bob: Math.random() * 6 });
  }

  /** Loose threads, yarn balls and stray cards, spread down the whole page and through depth. */
  private populate() {
    const pageHeight = document.documentElement.scrollHeight * this.unitsPerPixel;
    const screenHeight = window.innerHeight * this.unitsPerPixel;
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMERA_Z * this.camera.aspect;
    // how much wider and taller the view is at depth z than at the page plane
    const depthScale = (z: number) => (CAMERA_Z - z) / CAMERA_Z;

    // the first screen: drifters in the open lanes between the text column and the loom,
    // and along both edges, so they surround the hero without crossing the text or the cloth
    if (this.camera.aspect > 1.25) {
      const w = window.innerWidth;
      const edge = Math.max(Math.min(Math.max(16, w * 0.04), 48), (w - 1200) / 2);
      const lanes: [number, number][] = [
        [0, Math.max(0.02, (edge - 20) / w)],
        [(edge + 480) / w, 0.5],
        [0.9, 1],
      ];
      for (let i = 0; i < 30; i++) {
        const [from, to] = lanes[i % lanes.length];
        const z = -11 + Math.random() * 8; // mid-depth: close enough to read as 3D, small enough to stay in its lane
        const fx = from + Math.random() * (to - from);
        const fy = Math.random() * 1.05;
        const x = (fx - 0.5) * 2 * halfWidth * depthScale(z);
        const y = (0.5 - fy) * screenHeight * depthScale(z);
        this.addDrifter(this.drifter(i), x, y, z);
      }
    }

    // the rest of the page, below the first screen
    const count = Math.round(THREE.MathUtils.clamp(pageHeight * 5, 40, 90));
    for (let i = 0; i < count; i++) {
      const y = -(screenHeight * 0.9 + Math.random() * (pageHeight - screenHeight * 0.9));
      const z = -16 + Math.random() * 19; // from far behind to just in front of the page plane
      const spread = halfWidth * (1 + (-z + CAMERA_Z) / CAMERA_Z) * 0.6;
      this.addDrifter(this.drifter(i), (Math.random() - 0.5) * 2 * spread, y, z);
    }
    // and a few far back across the whole first screen, for depth behind the loom
    for (let i = 0; i < 10; i++) {
      const z = -16 + Math.random() * 5;
      this.addDrifter(this.drifter(i), (Math.random() - 0.5) * 2 * halfWidth * depthScale(z), (0.5 - Math.random()) * screenHeight * depthScale(z), z);
    }
  }

  /** Places a prop beside a page element and keeps it there as the page scrolls. */
  anchor(el: HTMLElement, prop: Prop) {
    let object: THREE.Object3D;
    const brass = new THREE.MeshStandardMaterial({ color: 0xd6a85c, metalness: 0.75, roughness: 0.3 });
    if (prop === "cards") {
      // a short chain of laced cards, as on Jacquard's loom
      object = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const card = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.78), new THREE.MeshStandardMaterial({ map: cardTexture(101 + k), roughness: 0.9, side: THREE.DoubleSide }));
        card.position.set(0, k * 0.62 - 0.9, -k * 0.25);
        card.rotation.x = -0.5 + k * 0.28;
        object.add(card);
      }
    } else if (prop === "gear") {
      object = new THREE.Group();
      const big = new THREE.Mesh(gear(0.85, 18), brass);
      const small = new THREE.Mesh(gear(0.5, 11), brass);
      small.position.set(1.18, 0.55, 0.05);
      big.userData.spin = 1;
      small.userData.spin = -18 / 11; // meshing gears turn in step
      object.add(big, small);
    } else if (prop === "stack") {
      // a fanned stack of tabulator cards
      object = new THREE.Group();
      for (let k = 0; k < 7; k++) {
        const card = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.74), new THREE.MeshStandardMaterial({ map: cardTexture(301 + k), roughness: 0.9, side: THREE.DoubleSide }));
        card.rotation.z = (k - 3) * 0.12;
        card.position.z = k * 0.03;
        object.add(card);
      }
    } else {
      // the visitor's own cloth, as a small swatch
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      this.swatchTexture = new THREE.CanvasTexture(canvas);
      this.swatchTexture.colorSpace = THREE.SRGBColorSpace;
      object = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7, 16, 16), new THREE.MeshStandardMaterial({ map: this.swatchTexture, roughness: 0.7, side: THREE.DoubleSide }));
    }
    this.scene.add(object);
    this.anchors.push({ el, object, spin: Math.random() * 2 });
    this.place();
  }

  /** Redraws the cloth swatch prop from the woven draft. */
  setSwatch(cells: Uint8Array, rows: number, cols: number, warp: string, weft: string) {
    if (!this.swatchTexture) return;
    const canvas = this.swatchTexture.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const cell = canvas.width / cols;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = cells[r * cols + c] ? warp : weft;
        ctx.fillRect(c * cell, (rows - 1 - r) * cell, cell + 0.5, cell + 0.5);
      }
    }
    this.swatchTexture.needsUpdate = true;
  }

  private fit = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.unitsPerPixel = (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMERA_Z) / h;
    this.place();
  };

  /** Converts each anchor element's page position into world space at depth 0. */
  private place() {
    const scrollY = window.scrollY;
    for (const a of this.anchors) {
      const rect = a.el.getBoundingClientRect();
      const visible = rect.width > 0;
      a.object.visible = visible;
      if (!visible) continue;
      const pageX = rect.left + rect.width / 2 - window.innerWidth / 2;
      const pageY = rect.top + scrollY + rect.height / 2 - window.innerHeight / 2;
      a.object.position.set(pageX * this.unitsPerPixel, -pageY * this.unitsPerPixel, 0);
    }
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const t = this.clock.getElapsedTime();
    this.camera.position.set(0, -window.scrollY * this.unitsPerPixel, CAMERA_Z);

    if (!this.reducedMotion) {
      for (const d of this.drifters) {
        d.object.rotation.x += d.spin.x * 0.01;
        d.object.rotation.y += d.spin.y * 0.01;
        d.object.position.y += Math.sin(t * 0.5 + d.bob) * 0.0015;
      }
      for (const a of this.anchors) {
        a.object.rotation.y = Math.sin(t * 0.4 + a.spin) * 0.5;
        a.object.rotation.x = Math.sin(t * 0.3 + a.spin) * 0.15;
        for (const child of a.object.children) {
          if (child.userData.spin) child.rotation.z = t * 0.4 * child.userData.spin;
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** Re-measures anchors after layout changes (fonts loading, images, resize). */
  refresh() {
    this.place();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.fit);
    this.renderer.dispose();
    this.canvasHost.removeChild(this.renderer.domElement);
  }
}
