import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ================= Dimensions (1 unit ≈ 1 Roblox stud) =================
const SEAT_Y = 1.75;          // top of the seat
const TABLE_Y = 3.0;          // top of the desk
const STUDENT_X = 2.5;        // students' distance from the middle of the desk
const STUDENT_Z = -2.7;       // students sit behind the desk, facing the camera
// Camera angles: straight from the front in the game, from the right on the home screen.
// "subject" is what must always fit in view (students + the text above them).
const VIEWS = {
  game: { dir: new THREE.Vector3(0, 0.36, 1).normalize(), focus: new THREE.Vector3(0, 4.7, -1.4), subject: { w: 12.5, h: 8.6 } },
  menu: { dir: new THREE.Vector3(0.36, 0.44, 1).normalize(), focus: new THREE.Vector3(0, 4.3, -1.5), subject: { w: 12, h: 8.6 } },
  // Close-ups on whoever is guessing (like the Roblox game), seen a little from their side
  focusPlayer: { dir: new THREE.Vector3(-0.22, 0.3, 1).normalize(), focus: new THREE.Vector3(-STUDENT_X, 4.75, STUDENT_Z + 0.5), subject: { w: 6.6, h: 6 } },
  focusBot: { dir: new THREE.Vector3(0.22, 0.3, 1).normalize(), focus: new THREE.Vector3(STUDENT_X, 4.75, STUDENT_Z + 0.5), subject: { w: 6.6, h: 6 } },
};
const DOWN = new THREE.Vector3(0, -1, 0);
const FONT = '"Fredoka", "Trebuchet MS", sans-serif';

// Arm direction (from the shoulder) and head tilt for each pose
const POSES = {
  idle:  { L: [0.12, 0.02, 1], R: [-0.12, 0.02, 1], head: [0, 0, 0] },
  think: { L: [0.12, 0.02, 1], R: [-0.6, 0.6, 0.53], head: [-0.16, 0, 0.14] },
  raise: { L: [0.12, 0.02, 1], R: [0.1, 1, 0.12], head: [-0.1, 0, -0.06] },
  win:   { L: [-0.55, 1, 0.15], R: [0.55, 1, 0.15], head: [-0.22, 0, 0] },
  lose:  { L: [0.25, -0.35, 1], R: [-0.25, -0.35, 1], head: [0.45, 0, 0] },
};
const FACE_FOR_POSE = { idle: 'smile', think: 'think', raise: 'smile', win: 'happy', lose: 'sad' };

// ================= Helpers =================
const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, ...extra });

function block(w, h, d, material, radius = 0) {
  const geo = radius > 0 ? new RoundedBoxGeometry(w, h, d, 3, radius) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Critically damped spring: moves towards the target starting and stopping gently, and a new
// target halfway through just bends the move. Small fixed steps keep it stable. Returns [value, velocity].
function springTo(x, v, target, omega, dt) {
  const steps = Math.max(1, Math.ceil(dt * 120));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    v += (omega * omega * (target - x) - 2 * omega * v) * h;
    x += v * h;
  }
  return [x, v];
}

// ---------- One feel for every move ----------
// The camera's moves (like zooming in on Sam) are springs with this stiffness. The numbers panel
// slides with exactly the same curve and speed, and the camera makes room for it in step with it.
const MOVE_SPRING = 4.2;
export const PANEL_SLIDE_MS = 1300;   // by then the spring has (almost) settled
const springStep = t => 1 - (1 + MOVE_SPRING * t) * Math.exp(-MOVE_SPRING * t);
const springEnd = springStep(PANEL_SLIDE_MS / 1000);
// Progress 0..1 of a panel slide for a time 0..1 of PANEL_SLIDE_MS
export function panelEase(q) {
  if (q <= 0) return 0;
  if (q >= 1) return 1;
  return springStep((q * PANEL_SLIDE_MS) / 1000) / springEnd;
}
// The same curve as a CSS easing function, for the panel's transition
export function panelEaseCss(points = 32) {
  return `linear(${Array.from({ length: points + 1 }, (_, i) => panelEase(i / points).toFixed(4)).join(', ')})`;
}

function add(parent, obj, x = 0, y = 0, z = 0) {
  obj.position.set(x, y, z);
  parent.add(obj);
  return obj;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texFrom(canvas, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

// ================= Textures (drawn with canvas) =================
function plankTexture(colors, repeat, seed) {
  const rand = seeded(seed);
  const c = makeCanvas(512, 512);
  const g = c.getContext('2d');
  const rows = 8;
  const rh = 512 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rand() * 256;
    while (x < 512) {
      const len = 170 + rand() * 210;
      g.fillStyle = colors[Math.floor(rand() * colors.length)];
      g.fillRect(x, r * rh, len, rh);
      g.strokeStyle = 'rgba(90, 50, 20, .12)';
      g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const y = r * rh + 8 + rand() * (rh - 16);
        g.beginPath();
        g.moveTo(x + 4, y);
        g.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 6, x + len * 0.6, y + (rand() - 0.5) * 6, x + len - 4, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(60, 35, 15, .45)';
      g.fillRect(x, r * rh, 2, rh);
      x += len;
    }
    g.fillStyle = 'rgba(60, 35, 15, .5)';
    g.fillRect(0, r * rh, 512, 2);
  }
  return texFrom(c, repeat);
}

function skyTexture() {
  const c = makeCanvas(256, 320);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, '#3fa9ff');
  grad.addColorStop(1, '#c4ecff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 320);
  g.fillStyle = 'rgba(255, 255, 255, .95)';
  const puff = (x, y, s) => {
    for (const [dx, dy, r] of [[0, 0, 22], [24, -8, 26], [50, 0, 20], [25, 8, 20]]) {
      g.beginPath();
      g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
      g.fill();
    }
  };
  puff(30, 80, 1);
  puff(150, 140, 0.8);
  g.fillStyle = '#5cc95a';
  g.beginPath();
  g.moveTo(0, 320);
  g.lineTo(0, 250);
  g.quadraticCurveTo(80, 215, 140, 252);
  g.quadraticCurveTo(200, 228, 256, 246);
  g.lineTo(256, 320);
  g.fill();
  // blocky trees
  for (const [x, y] of [[40, 238], [200, 232]]) {
    g.fillStyle = '#7a4a22';
    g.fillRect(x - 4, y, 8, 22);
    g.fillStyle = '#2f9e44';
    g.fillRect(x - 18, y - 26, 36, 30);
  }
  return texFrom(c);
}

function drawChalkboard(c, rangeText) {
  const g = c.getContext('2d');
  g.fillStyle = '#2e5a4b';
  g.fillRect(0, 0, 1024, 444);
  const rand = seeded(5);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(255,255,255,${0.015 + rand() * 0.03})`;
    g.beginPath();
    g.ellipse(rand() * 1024, rand() * 444, 40 + rand() * 120, 14 + rand() * 40, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const chalk = (text, x, y, size, alpha = 0.9) => {
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      g.fillStyle = `rgba(250, 248, 240, ${alpha / 2.2})`;
      g.fillText(text, x + (rand() - 0.5) * 3, y + (rand() - 0.5) * 3, 960);
    }
  };
  chalk('GUESS THE NUMBER!', 512, 150, 112);
  chalk(rangeText, 512, 285, 92, 0.8);
  chalk('? > 50', 150, 380, 44, 0.45);
  chalk('25 < ?', 874, 380, 44, 0.45);
  chalk('7 × 8 = 56', 140, 70, 34, 0.35);
}

function clockTexture() {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#222';
  g.font = `700 40px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [['12', 128, 40], ['3', 216, 128], ['6', 128, 216], ['9', 40, 128]].forEach(([t, x, y]) => g.fillText(t, x, y));
  const now = new Date();
  const hand = (angle, len, width) => {
    g.lineWidth = width;
    g.lineCap = 'round';
    g.strokeStyle = '#222';
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + Math.sin(angle) * len, 128 - Math.cos(angle) * len);
    g.stroke();
  };
  const m = now.getMinutes();
  hand(((now.getHours() % 12) + m / 60) * (Math.PI / 6), 55, 12);
  hand(m * (Math.PI / 30), 85, 8);
  g.fillStyle = '#e63946';
  g.beginPath();
  g.arc(128, 128, 10, 0, Math.PI * 2);
  g.fill();
  return texFrom(c);
}

function letterTexture(ch, color) {
  const c = makeCanvas(128, 160);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 160);
  g.fillStyle = '#fff';
  g.font = `700 100px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, 64, 86);
  return texFrom(c);
}

function globeTexture() {
  const c = makeCanvas(256, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#3f8fd8';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#5cc95a';
  for (const [x, y, w, h] of [[20, 30, 50, 40], [90, 20, 40, 70], [150, 40, 70, 35], [200, 85, 30, 20]]) {
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0.4, 0, Math.PI * 2);
    g.fill();
  }
  return texFrom(c);
}

// Classic Roblox faces
function faceTexture(kind) {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#141414';
  g.strokeStyle = '#141414';
  g.lineCap = 'round';
  const eye = (x, y, rx = 12, ry = 23) => {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  };
  const line = (x1, y1, x2, y2, w) => {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  const arc = (x, y, r, a, b, w) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(x, y, r, a * Math.PI, b * Math.PI);
    g.stroke();
  };
  switch (kind) {
    case 'smile':
      eye(92, 102); eye(164, 102);
      arc(128, 124, 52, 0.2, 0.8, 10);
      break;
    case 'blink':
      line(80, 104, 104, 104, 8); line(152, 104, 176, 104, 8);
      arc(128, 124, 52, 0.2, 0.8, 10);
      break;
    case 'think':
      eye(100, 94, 11, 21); eye(170, 94, 11, 21);
      line(148, 58, 188, 48, 8);
      line(104, 178, 152, 170, 9);
      break;
    case 'talk':
      eye(92, 102); eye(164, 102);
      g.beginPath();
      g.ellipse(128, 168, 26, 20, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case 'happy':
      arc(92, 112, 18, 1.12, 1.88, 9); arc(164, 112, 18, 1.12, 1.88, 9);
      g.beginPath();
      g.moveTo(74, 138);
      g.quadraticCurveTo(128, 236, 182, 138);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillRect(88, 140, 80, 13);
      break;
    case 'sad':
      eye(92, 108); eye(164, 108);
      line(70, 70, 108, 80, 7); line(148, 80, 186, 70, 7);
      arc(128, 210, 44, 1.2, 1.8, 10);
      g.fillStyle = '#6ec6ff';
      g.beginPath();
      g.ellipse(176, 150, 8, 12, 0, 0, Math.PI * 2);
      g.fill();
      break;
  }
  return texFrom(c);
}

function starDecal() {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 62 : 26;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(128 + Math.cos(a) * r, 112 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  g.fillRect(0, 214, 256, 16);
  return texFrom(c);
}

function jacketDecal() {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#1fb5c9';
  g.beginPath();
  g.moveTo(84, 0); g.lineTo(172, 0); g.lineTo(172, 256); g.lineTo(84, 256);
  g.fill();
  g.fillStyle = '#3a3a44';
  g.beginPath();
  g.moveTo(84, 0); g.lineTo(128, 70); g.lineTo(84, 120);
  g.moveTo(172, 0); g.lineTo(128, 70); g.lineTo(172, 120);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(134, 120); g.lineTo(112, 168); g.lineTo(128, 168); g.lineTo(120, 206); g.lineTo(146, 152); g.lineTo(130, 152);
  g.closePath();
  g.fill();
  g.fillStyle = '#4a4a55';
  g.fillRect(80, 0, 6, 256);
  g.fillRect(170, 0, 6, 256);
  return texFrom(c);
}

function drawPaper(canvas, text) {
  const g = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#fdfdf9';
  g.fillRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,.06)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,.05)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w * 0.1, h * 0.35); g.lineTo(w * 0.55, h * 0.5); g.lineTo(w * 0.95, h * 0.3);
  g.stroke();
  if (text !== '') {
    g.save();
    g.translate(w / 2, h / 2 + 6);
    g.rotate(-0.05);
    g.fillStyle = '#1d1d24';
    g.font = `600 ${text.length > 3 ? 84 : text.length > 2 ? 104 : 128}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
  }
}

// ================= The classroom =================
function buildRoom(scene) {
  const g = new THREE.Group();
  scene.add(g);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 80),
    mat('#ffffff', { map: plankTexture(['#dcae78', '#d4a46c', '#e2b580', '#cf9d63', '#d9aa72'], [8, 13], 11), roughness: 0.85 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  add(g, floor, 0, 0, 30);

  // Walls
  const wallM = mat('#f6e9cc', { roughness: 0.95 });
  add(g, block(48, 18, 0.6, wallM), 0, 9, -9.3);
  for (const sx of [-16.3, 16.3]) add(g, block(0.6, 18, 60, wallM), sx, 9, 20.7);
  const panelM = mat('#c08850');
  const railM = mat('#8e5c2f');
  add(g, block(48, 3.2, 0.3, panelM), 0, 1.6, -8.9);
  add(g, block(48, 0.35, 0.5, railM), 0, 3.3, -8.85);
  for (const sx of [-15.85, 15.85]) {
    add(g, block(0.3, 3.2, 60, panelM), sx, 1.6, 20.7);
    add(g, block(0.5, 0.35, 60, railM), sx, 3.3, 20.7);
  }

  // Chalkboard (redrawn when the number range changes)
  add(g, block(12.6, 5.8, 0.35, mat('#8b5a2b')), 0, 8, -8.95);
  const boardCanvas = makeCanvas(1024, 444);
  drawChalkboard(boardCanvas, '1 – 100');
  const boardTex = texFrom(boardCanvas);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 5.2), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.95 }));
  add(g, board, 0, 8, -8.76);
  add(g, block(11.4, 0.2, 0.55, mat('#7a4c22')), 0, 5.2, -8.6);
  add(g, block(0.6, 0.14, 0.14, mat('#ffffff')), -3, 5.37, -8.55);
  add(g, block(0.45, 0.14, 0.14, mat('#ffb3c6')), -2.2, 5.37, -8.5);
  add(g, block(1, 0.25, 0.4, mat('#3c64a8'), 0.05), 3.5, 5.42, -8.55);

  // Alphabet cards above the board
  const colors = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'];
  'ABCDEFGHIJ'.split('').forEach((ch, i) => {
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.15), new THREE.MeshStandardMaterial({ map: letterTexture(ch, colors[i % 5]) }));
    card.rotation.z = (i % 2 ? 1 : -1) * 0.05;
    add(g, card, -5.4 + i * 1.2, 11.9, -8.98);
  });

  // Windows with sky
  const sky = skyTexture();
  for (const wx of [-11, 11]) {
    add(g, block(5.2, 6.6, 0.35, mat('#ffffff')), wx, 7.6, -8.95);
    add(g, new THREE.Mesh(new THREE.PlaneGeometry(4.5, 5.9), new THREE.MeshBasicMaterial({ map: sky })), wx, 7.6, -8.76);
    add(g, block(0.22, 5.9, 0.2, mat('#ffffff')), wx, 7.6, -8.68);
    add(g, block(4.5, 0.22, 0.2, mat('#ffffff')), wx, 7.6, -8.68);
    add(g, block(5.8, 0.3, 0.9, mat('#ffffff')), wx, 4.2, -8.6);
  }

  // Clock
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.2, 40), mat('#333a46'));
  rim.rotation.x = Math.PI / 2;
  add(g, rim, 7.6, 11.7, -8.9);
  add(g, new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), new THREE.MeshStandardMaterial({ map: clockTexture() })), 7.6, 11.7, -8.78);

  // Teacher's desk
  const tdM = mat('#9c6a3a');
  add(g, block(5, 0.3, 2.4, tdM, 0.04), -8, 3.05, -6.4);
  add(g, block(4.8, 2.9, 0.2, mat('#8a5a2e')), -8, 1.45, -5.3);
  add(g, block(0.25, 2.9, 2.3, tdM), -10.35, 1.45, -6.4);
  add(g, block(0.25, 2.9, 2.3, tdM), -5.65, 1.45, -6.4);
  const apple = add(g, new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 16), mat('#e63946', { roughness: 0.4 })), -6.5, 3.52, -6.1);
  apple.castShadow = true;
  add(g, block(0.06, 0.22, 0.06, mat('#5a3a1a')), -6.5, 3.9, -6.1);
  ['#3a86ff', '#ff006e', '#ffbe0b'].forEach((col, i) => {
    add(g, block(1.3, 0.28, 1, mat(col), 0.03), -9.2, 3.35 + i * 0.29, -6.5).rotation.y = (i - 1) * 0.15;
  });
  add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 0.4, 16), mat('#6b4a2b')), -7.7, 3.4, -6.8);
  const globe = add(g, new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 18), mat('#ffffff', { map: globeTexture(), roughness: 0.5 })), -7.7, 4.2, -6.8);
  globe.rotation.z = 0.4;
  globe.castShadow = true;

  // Colourful shelf with bins under the right window
  add(g, block(5.6, 2.4, 1.3, mat('#4f9ee8'), 0.06), 11, 1.2, -8.3);
  ['#ff595e', '#ffca3a', '#8ac926'].forEach((col, i) => add(g, block(1.5, 0.9, 0.2, mat(col), 0.05), 9.3 + i * 1.7, 1.2, -7.6));

  // Plant
  add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.5, 1.2, 20), mat('#d9774b')), 14, 0.6, -7.2).castShadow = true;
  const leafM = mat('#3fae49');
  [[0, 1.9, 0, 0], [-0.4, 1.6, 0.2, 0.5], [0.45, 1.7, -0.1, -0.5], [0.1, 2.4, 0.1, 0.2]].forEach(([x, y, z, r]) => {
    add(g, block(0.6, 1.2, 0.6, leafM, 0.1), 14 + x, y, -7.2 + z).rotation.z = r;
  });

  // Extra school desks at the sides
  for (const sx of [-10.5, 10.5]) {
    const deskM = mat('#c58a50');
    add(g, block(3.6, 0.26, 2.4, deskM, 0.04), sx, TABLE_Y - 0.13, -0.6);
    for (const lx of [-1.5, 1.5]) for (const lz of [-1.4, 0.2]) add(g, block(0.3, TABLE_Y - 0.26, 0.3, mat('#8d5528')), sx + lx, (TABLE_Y - 0.26) / 2, lz);
    buildChair(g, sx, STUDENT_Z);
    add(g, block(1.1, 0.2, 0.8, mat(sx < 0 ? '#06d6a0' : '#ef476f'), 0.03), sx + 0.6, TABLE_Y + 0.1, -0.4).rotation.y = 0.3;
  }

  // Backpack next to the player's chair
  add(g, block(1.2, 1.5, 0.8, mat('#e63946'), 0.2), -4.9, 0.75, -2.2);
  add(g, block(0.8, 0.6, 0.2, mat('#c1121f'), 0.08), -4.9, 0.6, -1.75);

  return { boardCanvas, boardTex };
}

function buildChair(parent, x, z) {
  const m = mat('#a8693a');
  const d = mat('#8a5228');
  const c = add(parent, new THREE.Group(), x, 0, z);
  add(c, block(2.4, 0.28, 2.3, m, 0.05), 0, SEAT_Y - 0.14, 0.15);
  for (const lx of [-1, 1]) for (const lz of [-0.85, 1.1]) add(c, block(0.26, SEAT_Y - 0.28, 0.26, d), lx, (SEAT_Y - 0.28) / 2, lz);
  for (const lx of [-1, 1]) add(c, block(0.28, 3.4, 0.28, d), lx, SEAT_Y + 1.5, -0.95);
  for (const y of [1.3, 2.1, 2.9]) add(c, block(2.3, 0.36, 0.2, m), 0, SEAT_Y + y, -0.95);
  return c;
}

// The big desk the students share
function buildMainDesk(scene) {
  const g = add(scene, new THREE.Group());
  const topTex = plankTexture(['#b8743c', '#ae6b35', '#c27d44', '#a9672f'], [2.5, 1], 3);
  add(g, block(9.4, 0.26, 3.3, mat('#ffffff', { map: topTex }), 0.06), 0, TABLE_Y - 0.13, -0.1);
  const legM = mat('#8d5528');
  for (const x of [-4.3, 4.3]) for (const z of [-1.4, 1.2]) add(g, block(0.45, TABLE_Y - 0.26, 0.45, legM), x, (TABLE_Y - 0.26) / 2, z);
  // Divider so nobody can peek at the other's paper
  add(g, block(0.16, 2.2, 2.4, mat('#dfe4ec', { roughness: 0.4 }), 0.05), 0, TABLE_Y + 1.1, -0.9);
}

// ================= The students (blocky Roblox avatars) =================
function buildStudent(scene, x, look, faces, { withPaper = true } = {}) {
  const root = add(scene, new THREE.Group(), x, SEAT_Y, STUDENT_Z);
  const body = add(root, new THREE.Group());
  const skinM = mat(look.skin);
  const shirtM = mat(look.shirt);
  const pantsM = mat(look.pants);
  const shoeM = mat(look.shoes);
  const hairM = mat(look.hair, { roughness: 0.9 });

  add(body, block(2, 2, 1, shirtM, 0.1), 0, 1, 0);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshStandardMaterial({ map: look.decal, transparent: true, roughness: 0.8 }));
  add(body, decal, 0, 1, 0.505);

  // Legs (sitting: pointing forward). They hang on the root, not the body,
  // so they stay under the desk when the student jumps for joy.
  const hips = [];
  for (const sx of [-0.5, 0.5]) {
    const hip = add(root, new THREE.Group(), sx, 0.5, 0);
    add(hip, block(0.98, 2, 0.98, pantsM, 0.1), 0, -1, 0);
    add(hip, block(1.02, 0.45, 1.04, shoeM, 0.12), 0, -1.8, 0);
    hip.rotation.x = -Math.PI / 2;
    hips.push(hip);
  }

  // Arms (rotate around the shoulder)
  const arms = {};
  for (const [side, sx] of [['L', -1.5], ['R', 1.5]]) {
    const shoulder = add(body, new THREE.Group(), sx, 1.75, 0);
    add(shoulder, block(1, 1.15, 1, shirtM, 0.1), 0, -0.3, 0);
    add(shoulder, block(0.96, 0.95, 0.96, skinM, 0.12), 0, -1.3, 0);
    arms[side] = shoulder;
  }

  // Head + face + hair
  const neck = add(body, new THREE.Group(), 0, 2, 0);
  add(neck, block(1.3, 1.25, 1.25, skinM, 0.3), 0, 0.66, 0);
  const faceMat = new THREE.MeshStandardMaterial({ map: faces.smile, transparent: true, alphaTest: 0.05, roughness: 0.9 });
  add(neck, new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), faceMat), 0, 0.62, 0.629);
  addHair(neck, look.hairStyle, hairM);

  // Paper on the desk in front of the student
  let paperCanvas = null;
  let paperTex = null;
  if (withPaper) {
    paperCanvas = makeCanvas(256, 192);
    drawPaper(paperCanvas, '');
    paperTex = texFrom(paperCanvas);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.95 }));
    paper.rotation.set(-Math.PI / 2, 0, (x < 0 ? 1 : -1) * 0.08);
    paper.receiveShadow = true;
    add(scene, paper, x, TABLE_Y + 0.012, 0.35);
  }

  return {
    root, body, neck, arms, hips, faceMat,
    paperCanvas, paperTex, paperText: '',
    pose: 'idle', look: false,
    lookYaw: x < 0 ? 0.45 : -0.45,
    phase: Math.random() * 6,
    armTarget: { L: new THREE.Quaternion(), R: new THREE.Quaternion() },
    nodStart: -10, talkUntil: 0, blinkUntil: 0, nextBlink: 2 + Math.random() * 2,
    currentFace: 'smile',
    emote: null,        // a short gesture on top of the pose: { kind, face, start, dur }
    dance: 'hop',       // the victory dance used by the 'win' pose (see DANCES)
    winStart: 0,
    stand: 0,           // 0 = sitting, 1 = standing on the chair (for the dances)
  };
}

// Short gestures used by the online emotes (seconds)
const EMOTE_DURATION = { wave: 1.6, cheer: 1.4, bounce: 1.1, nod: 0.8, think: 1.6, slump: 1.6 };

// ================= Victory dances (bought in the shop) =================
// Each dance is a function of the time since the win started. It returns arm
// directions (from the shoulder), head tilt and body movement. All dances except
// "hop" are done standing on the chair.
const easeInOut = q => (q < 0.5 ? 2 * q * q : 1 - (-2 * q + 2) ** 2 / 2);
const ROBOT_STEPS = [
  { L: [0, 0, 1], R: [0, 0, 1], head: [0, 0.45, 0], bodyRotY: 0.25 },
  { L: [0, 0, 1], R: [0.15, 1, 0], head: [0, 0, 0], bodyRotY: 0 },
  { L: [-1, 0, 0], R: [1, 0, 0], head: [0, -0.45, 0], bodyRotY: -0.25 },
  { L: [-0.1, 1, 0.1], R: [0, -1, 0.35], head: [0, 0, 0.2], bodyRotY: 0 },
];
// Macarena: one arm moves per beat, then the hips sway and a jump turn
const MACARENA = [
  { R: [0.1, 0, 1] }, { L: [-0.1, 0, 1] },
  { R: [-0.8, 0.5, 0.45] }, { L: [0.8, 0.5, 0.45] },
  { R: [-0.25, 1, -0.35] }, { L: [0.25, 1, -0.35] },
  { R: [0.35, -1, -0.15] }, { L: [-0.35, -1, -0.15] },
  { sway: 1 }, { sway: -1 }, { sway: 1 }, { jump: true },
];
const DANCES = {
  disco: tau => {
    const s = Math.sin(tau * 4.2);
    return {
      L: [-0.55, -s, 0.35], R: [0.55, s, 0.35], head: [-0.1, 0, s * 0.18],
      bodyY: Math.abs(Math.sin(tau * 8.4)) * 0.15, bodyRotZ: s * 0.12,
    };
  },
  floss: tau => {
    // Both arms swing side to side, one passing in front of the body and one behind
    const s = Math.sin(tau * 7);
    const c = Math.cos(tau * 7);
    return {
      L: [s * 0.95, -0.55, 0.5 * c], R: [s * 0.95, -0.55, -0.5 * c], head: [0, -s * 0.15, 0],
      bodyX: -s * 0.18, bodyRotZ: -s * 0.1,
    };
  },
  dab: tau => {
    const side = Math.floor(tau / 0.9) % 2 === 0 ? 1 : -1;
    const out = [0.8 * side, 0.6, 0.2];        // arm stretched up and out
    const across = [0.85 * side, 0.45, 0.6];   // the other arm across the face
    return side > 0
      ? { R: out, L: across, head: [0.4, -0.3, 0], bodyRotZ: -0.08, snappy: true, face: 'smile' }
      : { L: out, R: across, head: [0.4, 0.3, 0], bodyRotZ: 0.08, snappy: true, face: 'smile' };
  },
  robot: tau => ({ ...ROBOT_STEPS[Math.floor(tau / 0.45) % ROBOT_STEPS.length], snappy: true, face: 'smile' }),
  macarena: tau => {
    const beat = 0.4;
    const n = Math.floor(tau / beat) % MACARENA.length;
    const step = MACARENA[n];
    if (step.jump) {
      const q = (tau % beat) / beat;
      return { L: [-0.5, 1, 0.2], R: [0.5, 1, 0.2], head: [-0.2, 0, 0], rootY: Math.sin(q * Math.PI) * 1.1, rootRotY: easeInOut(q) * Math.PI * 2 };
    }
    // The arms keep where the earlier beats put them
    let L = [-0.12, -1, 0.1];
    let R = [0.12, -1, 0.1];
    for (let i = 0; i <= n; i++) {
      L = MACARENA[i].L || L;
      R = MACARENA[i].R || R;
    }
    const sway = step.sway || 0;
    const pulse = Math.sin((tau * Math.PI) / beat);
    return {
      L, R, head: [0, 0, pulse * 0.1], bodyX: sway * 0.25, bodyRotZ: -sway * 0.12,
      bodyY: Math.abs(pulse) * 0.08, snappy: true, face: 'smile',
    };
  },
  spin: tau => ({
    L: [-1, 0.15, 0], R: [1, 0.15, 0], head: [-0.1, 0, 0],
    rootRotY: tau * 7, bodyY: Math.abs(Math.sin(tau * 3.5)) * 0.1,
  }),
  flip: tau => {
    const p = (tau % 1.8) / 1.8;
    if (p < 0.22) {   // crouch
      const c = Math.sin((p / 0.22) * Math.PI);
      return { L: [-0.2, -0.7, -0.7], R: [0.2, -0.7, -0.7], head: [0.15, 0, 0], bodyY: -0.35 * c };
    }
    if (p < 0.78) {   // jump and flip backwards
      const q = (p - 0.22) / 0.56;
      return { L: [-0.2, 1, 0.1], R: [0.2, 1, 0.1], head: [-0.2, 0, 0], rootY: Math.sin(q * Math.PI) * 2.4, flip: -2 * Math.PI * easeInOut(q) };
    }
    const q = (p - 0.78) / 0.22;   // land
    return { L: [-0.6, 0.6, 0.3], R: [0.6, 0.6, 0.3], head: [0, 0, 0], bodyY: -0.15 * Math.sin(q * Math.PI) };
  },
  headspin: tau => {
    const up = 0.6;
    if (tau < up) {   // jump and flip over onto the head
      const q = easeInOut(tau / up);
      return { L: [-0.5, 1, 0.2], R: [0.5, 1, 0.2], head: [0, 0, 0], flip: Math.PI * q, rootY: 2.3 * q + Math.sin(q * Math.PI) * 1.2 };
    }
    // Spinning on the head on the seat, arms out for balance (legs point up)
    return { L: [-1, -0.2, 0.1], R: [1, -0.2, 0.1], head: [0, 0, 0], flip: Math.PI, rootY: 2.3, rootRotY: (tau - up) * 9 };
  },
};
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// ================= Finishers (bought in the shop) =================
// Something happens to the LOSER when you win. Each one is a short timeline that
// moves the student, their chair and an effect "rig" (anvil, rockets, meteor...).
// Everything is a function of the time since it started, so the shop can loop it.
export const FINISHER_LENGTH = {
  anvil: 2.6, trapdoor: 2.2, balloon: 3.9, freeze: 3.3, lightning: 3.2,
  rocket: 3.6, ufo: 4.0, blackhole: 3.3, meteor: 4.0,
};
const clamp01 = q => Math.min(1, Math.max(0, q));
const easeOut = q => 1 - (1 - clamp01(q)) ** 3;
const easeIn = q => clamp01(q) ** 2.2;
const easeOutBack = q => {
  const x = clamp01(q);
  return 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;
};
// 0 → 1 with a springy overshoot (the balloon puffs)
const springIn = q => (q <= 0 ? 0 : 1 - Math.cos(q * 9) * Math.exp(-q * 6));
const UP = new THREE.Vector3(0, 1, 0);
const fxA = new THREE.Vector3();
const fxB = new THREE.Vector3();
const TINT = { ice: new THREE.Color('#8fdcff'), char: new THREE.Color('#2a2420'), zap: new THREE.Color('#fff7b0') };

// The effect textures are drawn once and shared by every rig
const fxTextures = {};
const cachedTex = (key, draw) => fxTextures[key] || (fxTextures[key] = draw());

function glowTexture(color, hole = 0) {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, hole ? 'rgba(0,0,0,0)' : color);
  if (hole) {
    grad.addColorStop(hole, 'rgba(0,0,0,0)');
    grad.addColorStop(hole + 0.06, color);
  }
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return texFrom(c);
}

// Glowing spiral for the black hole's disk
function swirlTexture() {
  const c = makeCanvas(512, 512);
  const g = c.getContext('2d');
  const colors = ['#fff4c8', '#ffb13b', '#ff4f8b', '#9b4dff', '#4b2bff'];
  for (let arm = 0; arm < 4; arm++) {
    for (let i = 0; i <= 160; i++) {
      const q = i / 160;
      const angle = arm * (Math.PI / 2) + q * Math.PI * 3.2;
      const r = 70 + q * 180;
      const col = colors[Math.min(colors.length - 1, Math.floor(q * colors.length))];
      g.globalAlpha = 0.5 * (1 - q * 0.8);
      g.fillStyle = col;
      g.beginPath();
      g.arc(256 + Math.cos(angle) * r, 256 + Math.sin(angle) * r, 26 * (1 - q * 0.6), 0, Math.PI * 2);
      g.fill();
    }
  }
  return texFrom(c);
}

// Soft round puff for smoke, mist and sparks (white, coloured by the sprite)
function puffTexture() {
  return cachedTex('puff', () => {
    const c = makeCanvas(64, 64);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return texFrom(c);
  });
}

// Four-pointed twinkle (on the ice)
function starTexture() {
  return cachedTex('star', () => {
    const c = makeCanvas(64, 64);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(32, 0);
    g.quadraticCurveTo(36, 28, 64, 32);
    g.quadraticCurveTo(36, 36, 32, 64);
    g.quadraticCurveTo(28, 36, 0, 32);
    g.quadraticCurveTo(28, 28, 32, 0);
    g.fill();
    return texFrom(c);
  });
}

// Burnt spot on the floor where the meteor hit
function scorchTexture() {
  return cachedTex('scorch', () => {
    const c = makeCanvas(128, 128);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(15,10,8,.95)');
    grad.addColorStop(0.55, 'rgba(45,28,18,.75)');
    grad.addColorStop(1, 'rgba(45,28,18,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return texFrom(c);
  });
}

// A comic-book word like "POP!" or "BOOM!"
function comicTexture(text, fill) {
  return cachedTex(`comic:${text}`, () => {
    const c = makeCanvas(512, 256);
    const g = c.getContext('2d');
    g.font = `700 150px ${FONT}`;
    const fit = Math.min(150, Math.floor((150 * 440) / g.measureText(text).width));   // long words get smaller
    g.font = `700 ${fit}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 28;
    g.strokeStyle = '#1b1b2f';
    g.strokeText(text, 256, 134);
    g.fillStyle = fill;
    g.fillText(text, 256, 134);
    return texFrom(c);
  });
}

// A cone that glows at its base and fades out towards the tip (rocket flames, meteor tail).
// The base is at the origin and the tip points down.
function flameGeometry(radius, length, hot, cool) {
  const geo = new THREE.ConeGeometry(radius, length, 18, 6, true);
  geo.rotateX(Math.PI);
  geo.translate(0, -length / 2, 0);
  const p = geo.attributes.position;
  const a = new THREE.Color(hot);
  const b = new THREE.Color(cool);
  const c = new THREE.Color();
  const colors = [];
  for (let i = 0; i < p.count; i++) {
    const q = -p.getY(i) / length;   // 0 at the base, 1 at the tip
    c.copy(a).lerp(b, Math.min(1, q * 1.5)).multiplyScalar((1 - q) ** 1.6);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}
const glowMat = color => new THREE.MeshBasicMaterial({
  color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const flameMat = () => new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

// A lumpy space rock (the lumps depend on the position, so the faces stay closed)
function rockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1.1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    fxA.fromBufferAttribute(p, i);
    const k = 1 + 0.17 * Math.sin(fxA.x * 5.1 + fxA.y * 3.7) * Math.cos(fxA.z * 4.3 - fxA.x * 2.1);
    p.setXYZ(i, fxA.x * k, fxA.y * k, fxA.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

const cylinder = (rTop, rBottom, h, material, segments = 16) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
  m.castShadow = true;
  return m;
};

function makeSprites(parent, n, color, { additive = false, map = puffTexture() } = {}) {
  return Array.from({ length: n }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map, color, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    sp.visible = false;
    parent.add(sp);
    return sp;
  });
}

// Shows a particle of a certain age (hidden before it's born and after its life)
function puff(sp, age, life, x, y, z, size, opacity = 1) {
  sp.visible = age >= 0 && age < life && size > 0;
  if (!sp.visible) return;
  sp.position.set(x, y, z);
  sp.scale.set(size, size, 1);
  sp.material.opacity = opacity;
}

// Age of particle i in an endless stream (one every `every` s, each living n * every s)
function streamAge(tau, i, n, every) {
  const a = tau - i * every;
  return a < 0 ? -1 : a % (n * every);
}

function comicSprite(parent, text, fill) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: comicTexture(text, fill), transparent: true, depthTest: false, depthWrite: false,
  }));
  sp.material.rotation = -0.12;
  sp.renderOrder = 10;
  sp.visible = false;
  parent.add(sp);
  return sp;
}

// Pops a comic word in, holds it and fades it out
function comic(sp, age, x, y, z, size) {
  sp.visible = age >= 0 && age < 1;
  if (!sp.visible) return;
  const k = Math.max(0.001, easeOutBack(age / 0.22)) * size;
  sp.position.set(x, y, z);
  sp.scale.set(k * 2, k, 1);
  sp.material.opacity = 1 - clamp01((age - 0.7) / 0.3);
}

// Stretches a unit box between two points (the lightning bolt)
function stretch(mesh, a, b, thick) {
  fxA.subVectors(b, a);
  const len = fxA.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, fxA.normalize());
  mesh.scale.set(thick, len, thick);
}

// Colours the whole student (blue when frozen, black after the lightning)
function tint(s, color, amount) {
  if (!s.tintList) {
    s.tintList = [];
    s.root.traverse(o => {
      if (o.isMesh && !o.userData.fx && o.material.color) s.tintList.push({ m: o.material, c: o.material.color.clone() });
    });
  }
  for (const { m, c } of s.tintList) m.color.copy(c).lerp(color, amount);
}
const untint = s => s.tintList?.forEach(({ m, c }) => m.color.copy(c));

function createFinisher(scene, s, chair, { stage = false } = {}) {
  const home = { x: s.root.position.x, z: s.root.position.z };
  const side = home.x < 0 ? -1 : 1;     // the outer side (away from the other student)
  // The shop cards show less room above the student than the classroom does
  const ufoY = stage ? 6.9 : 10.5;
  const skyY = stage ? 7.1 : 10;
  const cloudSize = stage ? 0.7 : 1;
  const balloonRise = stage ? 0.9 : 3.4;
  // Where the comic words ("POP!", "BOOM!") show up
  const word = (sp, age) => comic(sp, age, stage ? home.x + 1.9 : home.x - side * 1.5, SEAT_Y + (stage ? 5.2 : 5.6), home.z + 1.5, stage ? 1.3 : 1.6);
  const rigs = {};
  let active = null;

  // ---------- The props for each finisher (built the first time it's used) ----------
  const build = {
    trapdoor(r, g) {
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ color: '#05050a' }));
      hole.rotation.x = -Math.PI / 2;
      add(g, hole, 0, 0.02, 0);
      const frameM = mat('#6b4a2b');
      add(g, block(3.9, 0.12, 0.25, frameM), 0, 0.06, -1.82);
      add(g, block(3.9, 0.12, 0.25, frameM), 0, 0.06, 1.82);
      add(g, block(0.25, 0.12, 3.9, frameM), -1.82, 0.06, 0);
      add(g, block(0.25, 0.12, 3.9, frameM), 1.82, 0.06, 0);
      const doorM = mat('#b07a45');
      r.hingeL = add(g, new THREE.Group(), -1.7, 0.05, 0);
      add(r.hingeL, block(1.7, 0.1, 3.4, doorM), 0.85, 0, 0);
      r.hingeR = add(g, new THREE.Group(), 1.7, 0.05, 0);
      add(r.hingeR, block(1.7, 0.1, 3.4, doorM), -0.85, 0, 0);
    },
    anvil(r, g) {
      const iron = mat('#3b4048', { roughness: 0.45, metalness: 0.6 });
      add(g, block(2.2, 0.5, 1.4, iron, 0.06), 0, 0.25, 0);
      add(g, block(1.0, 0.6, 0.9, iron, 0.05), 0, 0.8, 0);
      add(g, block(2.6, 0.55, 1.2, iron, 0.06), 0.2, 1.37, 0);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.3, 16), iron);
      horn.rotation.z = -Math.PI / 2;
      horn.castShadow = true;
      add(g, horn, 2.15, 1.37, 0);
    },
    balloon(r, g) {
      r.string = add(g, cylinder(0.03, 0.03, 2.4, mat('#ffffff'), 6));
      r.flash = makeSprites(g, 1, '#ffffff', { additive: true })[0];
      r.word = comicSprite(g, 'POP!', '#ffd43b');
      // Confetti when it pops
      const colors = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff70a6'];
      const rand = seeded(77);
      const bit = new THREE.PlaneGeometry(0.34, 0.2);
      r.bits = Array.from({ length: 40 }, (_, i) => {
        const m = add(g, new THREE.Mesh(bit, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true })));
        const a = rand() * Math.PI * 2;
        const speed = 3.5 + rand() * 5;
        m.userData.v = [Math.cos(a) * speed, (rand() * 1.6 - 0.5) * speed, Math.sin(a) * speed * 0.7];
        m.userData.spin = [rand() * 14 - 7, rand() * 14 - 7];
        m.visible = false;
        return m;
      });
    },
    freeze(r, g) {
      r.block = add(g, new THREE.Group());   // origin at the bottom centre of the ice
      const ice = new THREE.MeshStandardMaterial({
        color: '#c4f0ff', transparent: true, opacity: 0.5, roughness: 0.08, metalness: 0.1,
        emissive: '#2b8fc4', emissiveIntensity: 0.3, depthWrite: false,
      });
      add(r.block, new THREE.Mesh(new RoundedBoxGeometry(4.7, 4.9, 2.4, 3, 0.3), ice), 0, 2.45, 0);
      // Shiny streaks on the front and ice crystals on top
      const shine = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false });
      for (const [x, y, w, h] of [[-1.5, 3.6, 0.22, 1.5], [-1.1, 3.9, 0.14, 0.8], [1.6, 1.2, 0.18, 1.0]]) {
        add(r.block, new THREE.Mesh(new THREE.PlaneGeometry(w, h), shine), x, y, 1.21).rotation.z = -0.5;
      }
      const crystal = mat('#e6fbff', { roughness: 0.15, emissive: '#5cc8ff', emissiveIntensity: 0.25 });
      for (const [x, z, h, rz] of [[-1.7, 0.4, 1.3, 0.35], [-0.9, -0.5, 0.9, 0.1], [1.2, 0.3, 1.1, -0.25], [1.9, -0.4, 0.8, -0.5]]) {
        add(r.block, new THREE.Mesh(new THREE.ConeGeometry(0.3, h, 6), crystal), x, 4.6 + h / 2, z).rotation.z = rz;
      }
      r.mist = makeSprites(g, 14, '#e4f7ff');
      r.sparkles = makeSprites(g, 4, '#ffffff', { additive: true, map: starTexture() });
      const chipM = mat('#dff7ff', { roughness: 0.2 });
      const rand = seeded(31);
      r.chips = Array.from({ length: 10 }, () => {
        const m = add(g, block(0.32, 0.32, 0.32, chipM));
        m.userData.v = [(rand() - 0.5) * 6, 2.5 + rand() * 4, rand() * 4 - 1];
        m.visible = false;
        return m;
      });
      r.word = comicSprite(g, 'BRRR!', '#8fe3ff');
    },
    lightning(r, g) {
      r.cloud = add(g, new THREE.Group());
      r.cloudM = mat('#5b6270', { roughness: 1, emissive: '#a8d2ff', emissiveIntensity: 0 });
      for (const [x, y, z, rad] of [[0, 0, 0, 1.25], [-1.2, -0.2, 0.1, 0.95], [1.25, -0.15, 0, 1.0], [-0.55, 0.55, -0.1, 0.9], [0.65, 0.5, 0.05, 0.95], [-2.0, -0.4, 0, 0.6], [2.0, -0.35, 0.05, 0.65]]) {
        add(r.cloud, new THREE.Mesh(new THREE.SphereGeometry(rad, 18, 12), r.cloudM), x, y, z);
      }
      // The bolt: a zigzag of stretched boxes, a white core inside a blue glow
      const unit = new THREE.BoxGeometry(1, 1, 1);
      const coreM = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const haloM = new THREE.MeshBasicMaterial({ color: '#7cc4ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      r.bolt = Array.from({ length: 9 }, () => ({ core: add(g, new THREE.Mesh(unit, coreM)), halo: add(g, new THREE.Mesh(unit, haloM)) }));
      r.points = Array.from({ length: 10 }, () => new THREE.Vector3());
      r.flash = makeSprites(g, 1, '#cfe8ff', { additive: true })[0];
      r.sparks = makeSprites(g, 12, '#ffe66b', { additive: true });
      const rand = seeded(19);
      r.sparkV = r.sparks.map(() => [(rand() - 0.5) * 9, rand() * 6, (rand() - 0.2) * 6]);
      r.smoke = makeSprites(g, 14, '#4b4b52');
      r.word = comicSprite(g, 'ZAP!', '#ffe14d');
      // Hair standing straight up afterwards
      r.spikes = add(s.neck, new THREE.Group(), 0, 1.45, 0);
      r.spikes.visible = false;
      r.extras.push(r.spikes);
      const spikeM = mat('#2a2522');
      for (const x of [-0.45, 0, 0.45]) {
        for (const z of [-0.3, 0.25]) {
          const spike = add(r.spikes, new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.85, 6), spikeM), x, 0.3, z);
          spike.rotation.set(z * 0.8, 0, -x * 0.7);
          spike.userData.fx = true;   // not coloured by tint()
        }
      }
    },
    rocket(r, g) {
      // Two rockets strapped to the chair, so they fly away with it
      r.rockets = add(chair, new THREE.Group());
      r.rockets.visible = false;
      r.extras.push(r.rockets);
      const red = mat('#e63946', { roughness: 0.45 });
      const white = mat('#f4f4f4', { roughness: 0.45 });
      const dark = mat('#3a3f4a', { roughness: 0.6 });
      r.flames = [];
      for (const x of [-1.42, 1.42]) {
        const rk = add(r.rockets, new THREE.Group(), x, 0.45, 0.2);
        add(rk, cylinder(0.32, 0.32, 1.5, red), 0, 0.75, 0);
        add(rk, cylinder(0.33, 0.33, 0.28, white), 0, 1.1, 0);
        add(rk, new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.65, 16), white), 0, 1.82, 0);
        add(rk, cylinder(0.22, 0.3, 0.26, dark), 0, -0.12, 0);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          add(rk, block(0.45, 0.55, 0.06, red), Math.cos(a) * 0.5, 0.25, Math.sin(a) * 0.5).rotation.y = -a;
        }
        const flame = add(rk, new THREE.Mesh(flameGeometry(0.3, 1.7, '#fff6c0', '#ff5a00'), flameMat()), 0, -0.25, 0);
        flame.visible = false;
        r.flames.push(flame);
      }
      r.sparks = makeSprites(g, 6, '#ffd23b', { additive: true });
      r.trail = makeSprites(g, 34, '#eeeef2');
      r.ground = makeSprites(g, 12, '#dcdce2');
      r.word = comicSprite(g, 'WHOOSH!', '#ffb13b');
    },
    ufo(r, g) {
      const hull = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 16), mat('#c3ccd6', { metalness: 0.6, roughness: 0.3 }));
      hull.scale.set(1, 0.32, 1);
      hull.castShadow = true;
      g.add(hull);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: '#7fe3ff', transparent: true, opacity: 0.8, roughness: 0.1 }),
      );
      add(g, dome, 0, 0.45, 0);
      r.lights = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffd43b' }));
        add(g, light, Math.cos(a) * 1.95, -0.08, Math.sin(a) * 1.95);
        r.lights.push(light);
      }
      r.beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 2.4, 1, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: '#7dff9a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      r.beam.visible = false;
      scene.add(r.beam);
      r.extras.push(r.beam);
    },
    blackhole(r, g) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: '#000000' }));
      g.add(core);
      const tilt = add(g, new THREE.Group());
      tilt.rotation.x = -1.15;
      r.disk = new THREE.Mesh(
        new THREE.RingGeometry(1.0, 3.4, 64, 1),
        new THREE.MeshBasicMaterial({ map: swirlTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      tilt.add(r.disk);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(150,80,255,.85)', 0.14), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(8, 8, 1);
      g.add(glow);
      // The flash lives outside the group so it doesn't shrink when the hole collapses
      r.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      r.flash.scale.set(14, 14, 1);
      r.flash.visible = false;
      scene.add(r.flash);
      r.extras.push(r.flash);
    },
    meteor(r, g) {
      // Red target on the floor and a "!" over the head
      r.targetM = new THREE.MeshBasicMaterial({ color: '#ff2d2d', transparent: true, depthWrite: false });
      r.target = add(g, new THREE.Mesh(new THREE.RingGeometry(2.0, 2.45, 48), r.targetM));
      r.target.rotation.x = -Math.PI / 2;
      r.warn = comicSprite(g, '!', '#ff3b3b');
      // The meteor with its glow and fiery tail
      r.rockM = new THREE.MeshStandardMaterial({ color: '#4a3b35', roughness: 0.9, flatShading: true, emissive: '#ff4d1a', emissiveIntensity: 0.5 });
      r.rock = add(g, new THREE.Mesh(rockGeometry(), r.rockM));
      r.rock.castShadow = true;
      r.aura = makeSprites(g, 1, '#ff8a2a', { additive: true })[0];
      r.tail = add(g, new THREE.Mesh(flameGeometry(1.0, 7, '#ffe27a', '#ff3d00'), flameMat()));
      r.embers = makeSprites(g, 16, '#ffb347', { additive: true });
      // The impact: flash, fireball, shock wave, crater, rubble and smoke
      r.flash = makeSprites(g, 1, '#ffffff', { additive: true })[0];
      r.fire = add(g, new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glowMat('#ff7a1a')));
      r.core = add(g, new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glowMat('#ffe08a')));
      r.wave = add(g, new THREE.Mesh(new THREE.RingGeometry(0.85, 1.25, 48), glowMat('#ffc27a')));
      r.wave.rotation.x = -Math.PI / 2;
      r.crater = add(g, new THREE.Mesh(new THREE.CircleGeometry(2.8, 40), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false })));
      r.crater.rotation.x = -Math.PI / 2;
      const rubbleM = mat('#3d3330', { flatShading: true });
      const rand = seeded(13);
      r.debris = Array.from({ length: 10 }, () => {
        const m = add(g, new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + rand() * 0.18), rubbleM));
        m.castShadow = true;
        const a = rand() * Math.PI * 2;
        const speed = 3 + rand() * 4;
        m.userData.v = [Math.cos(a) * speed, 5 + rand() * 6, Math.abs(Math.sin(a)) * speed * 0.8 + 0.5];   // mostly towards the camera
        return m;
      });
      r.smoke = makeSprites(g, 16, '#55555c');
      r.word = comicSprite(g, 'BOOM!', '#ff9f1a');
    },
  };

  function rig(kind) {
    if (rigs[kind]) return rigs[kind];
    const g = new THREE.Group();
    g.visible = false;
    scene.add(g);
    const r = { g, extras: [] };   // extras: parts that live outside the group (hidden on reset)
    build[kind](r, g);
    rigs[kind] = r;
    return r;
  }

  function reset() {
    active = null;
    s.root.visible = true;
    s.root.position.x = home.x;
    s.root.position.z = home.z;
    s.root.scale.set(1, 1, 1);
    s.root.rotation.set(0, 0, 0);
    untint(s);
    chair.visible = true;
    chair.position.set(home.x, 0, home.z);
    chair.rotation.set(0, 0, 0);
    chair.scale.set(1, 1, 1);
    for (const r of Object.values(rigs)) {
      r.g.visible = false;
      for (const part of r.extras) part.visible = false;
    }
  }

  function start(kind, t) {
    reset();
    if (!FINISHER_LENGTH[kind]) return;
    active = { kind, start: t };
    const r = rig(kind);
    r.g.visible = true;
    play[kind](r, 0);   // move the effects into place right away (they're built at the middle of the scene)
  }

  // Arms and face of the victim while it happens (null = their normal pose)
  const PANIC = { L: [-0.55, 1, 0.25], R: [0.55, 1, 0.25], head: [-0.25, 0, 0], face: 'sad' };
  function pose(t) {
    if (!active) return null;
    const tau = t - active.start;
    switch (active.kind) {
      case 'anvil':
        return tau >= 0.5 ? { L: [-1, -0.25, 0.2], R: [1, -0.25, 0.2], head: [0, 0, 0], face: 'sad' } : PANIC;
      case 'balloon':   // puffed up, stiff arms
        return { L: [-0.15, 0.1, 1], R: [0.15, 0.1, 1], head: [-0.1, 0, 0], face: 'sad' };
      case 'freeze':    // frozen with the hands up
        return tau > 0.25 ? { L: [-0.18, 1, 0.12], R: [0.18, 1, 0.12], head: [-0.12, 0, 0], face: 'sad' } : PANIC;
      case 'lightning':
        if (tau < 0.75) return { ...PANIC, head: [-0.5, 0, 0] };                                         // looking up at the cloud
        if (tau < 1.15) return { L: [-1, 0.45, 0.1], R: [1, 0.45, 0.1], head: [-0.2, 0, 0], face: 'sad' };  // ZAP
        return { L: [0.2, -1, 0.35], R: [-0.2, -1, 0.35], head: [0.25, 0, 0.3], face: 'sad' };            // dazed
      case 'meteor': {
        if (tau < 1.25) return { ...PANIC, head: [-0.55, 0, 0] };
        const w = Math.sin(tau * 22);   // flailing while flying away
        return { L: [-1, w, 0.2], R: [1, -w, 0.2], head: [0, 0, 0], face: 'sad' };
      }
      default:
        return PANIC;
    }
  }

  // ---------- The timelines. Each moves everything for this frame and returns camera shake ----------
  const play = {
    trapdoor(r, tau) {
      r.g.position.set(home.x, 0, home.z + 0.15);
      const open = easeOut((tau - 0.15) / 0.2) * (1 - easeOut((tau - 1.35) / 0.3));
      r.hingeL.rotation.z = (-Math.PI / 2) * open;
      r.hingeR.rotation.z = (Math.PI / 2) * open;
      const fall = Math.max(0, tau - 0.35);
      const dy = -16 * fall * fall;
      s.root.position.y += dy;
      chair.position.y = dy;
      if (s.root.position.y < -2.5) s.root.visible = false;
      if (dy < -4.5) chair.visible = false;
      if (tau > 1.9) r.g.visible = false;
      return tau > 0.15 && tau < 0.45 ? 0.5 : 0;
    },

    anvil(r, tau) {
      const impact = 0.5;
      const squash = 0.32;
      let y;
      if (tau < impact) {
        const q = tau / impact;
        y = 16 - (16 - (SEAT_Y + 3.35)) * q * q;
      } else {
        const b = tau - impact;
        y = SEAT_Y + 3.35 * squash + Math.abs(Math.sin(b * 11)) * 0.5 * Math.exp(-b * 5);
        s.root.scale.set(1.35, squash, 1.35);
      }
      r.g.position.set(home.x, y, home.z);
      r.g.rotation.y = 0.35;
      return tau >= impact && tau < impact + 0.35 ? 1.2 : 0;
    },

    balloon(r, tau) {
      const popAt = 2.6;
      const top = { x: home.x + (stage ? 0 : side * 0.6), y: SEAT_Y + balloonRise + 1.8, z: home.z + 0.3 };   // where it pops
      if (tau < popAt) {
        // Pumped up in three puffs, then it floats up
        const fat = 0.2 * (springIn((tau - 0.15) / 0.3) + springIn((tau - 0.55) / 0.3) + springIn((tau - 0.95) / 0.3));
        const q = clamp01((tau - 1.3) / (popAt - 1.3));
        const rise = easeInOut(q) * balloonRise;
        s.root.scale.set(1 + fat, 1 + fat * 0.45, 1 + fat);
        // In the classroom it also moves outwards a little, so the fat student stays on their own side
        s.root.position.x = home.x + side * ((stage ? 0 : fat) + Math.sin(q * Math.PI) * 0.4);
        s.root.position.y += rise;
        s.root.rotation.z = Math.sin(tau * 3) * 0.12 * q;
        r.string.visible = rise > 0.5;
        r.string.position.set(s.root.position.x, s.root.position.y - 1.5, s.root.position.z + 0.2);
        r.string.rotation.z = Math.sin(tau * 2.2) * 0.15;
      } else {
        // POP! What's left zips around like a balloon letting its air out, until it's gone
        const z = tau - popAt;
        const k = z / 1.1;
        s.root.scale.setScalar(0.3);
        s.root.position.set(
          top.x + side * (k * k * 13 + Math.sin(z * 17) * 0.9 * (1 - k)),
          top.y - 1 + Math.sin(z * 11) * 1.1 + k * 2.5,
          top.z + Math.cos(z * 13) * 0.9,
        );
        s.root.rotation.set(Math.sin(z * 9) * 1.2, 0, z * 25);
        s.root.visible = k < 1;
        r.string.visible = false;
      }
      const z = tau - popAt;
      puff(r.flash, z, 0.3, top.x, top.y, top.z + 0.5, 7 * easeOut(z / 0.12), 1 - z / 0.3);
      for (const b of r.bits) {
        b.visible = z >= 0 && z < 1.4;
        if (!b.visible) continue;
        const [vx, vy, vz] = b.userData.v;
        b.position.set(top.x + vx * z, top.y + vy * z - 4.5 * z * z, top.z + vz * z);
        b.rotation.set(b.userData.spin[0] * z, b.userData.spin[1] * z, 0);
        b.material.opacity = 1 - clamp01((z - 1.0) / 0.4);
      }
      word(r.word, z);
      return z >= 0 && z < 0.3 ? 0.7 : 0;
    },

    freeze(r, tau) {
      const form = clamp01((tau - 0.15) / 0.55);
      tint(s, TINT.ice, 0.7 * easeOut((tau - 0.1) / 0.6));
      const hop = 2.0;
      const land = 2.35;
      const baseY = SEAT_Y - 0.35;
      let bx = home.x;
      let by = baseY;
      let spin = 0;
      const wobble = tau > 1.55 && tau < hop ? Math.sin(tau * 45) * 0.035 : 0;
      if (tau > hop) {   // hops off the chair...
        const q = clamp01((tau - hop) / (land - hop));
        bx += side * 2.8 * q;
        by = baseY * (1 - easeIn(q)) + Math.sin(q * Math.PI) * 0.6;
      }
      if (tau > land) {  // ...and slides away over the floor like a curling stone
        const z = tau - land;
        bx = home.x + side * (2.8 + z * z * 5 + z * 2.5);
        by = 0;
        spin = z * z * 2.5 * side;
      }
      const gone = Math.abs(bx - home.x) > 7.5;
      r.block.visible = !gone;
      r.block.position.set(bx, by, home.z - 0.15);
      const w = 0.5 + 0.5 * easeOut(form);
      r.block.scale.set(w, Math.max(0.001, easeOutBack(form)), w);
      r.block.rotation.set(0, spin, wobble);
      // Stuck inside, so the student moves with the ice
      s.root.position.x = bx;
      s.root.position.y += by - baseY;
      s.root.rotation.y = spin;
      s.root.rotation.z = wobble;
      s.root.visible = !gone;
      // Icy mist when it freezes, twinkles on the ice and chips when it lands
      const mistAge = tau - 0.1;
      r.mist.forEach((m, i) => {
        const a = (i / r.mist.length) * Math.PI * 2;
        const d = 1.4 + easeOut(mistAge / 0.9) * 2.2;
        puff(m, mistAge, 0.9, home.x + Math.cos(a) * d, SEAT_Y + 2 + Math.sin(a * 2) * 0.8 + mistAge * 0.6, home.z + 0.8 + Math.sin(a) * d * 0.5, 1.4 + mistAge * 2, 0.8 * (1 - mistAge / 0.9));
      });
      r.sparkles.forEach((sp, i) => {
        const [x, y] = [[-1.8, 4.4], [1.9, 3.2], [-0.6, 1.2], [1.2, 4.7]][i];
        const age = tau - 0.8 - i * 0.22;
        const k = age < 0 ? 0 : Math.sin(((age % 1.1) / 1.1) * Math.PI);
        puff(sp, gone ? -1 : age, 99, bx + x, by + y, home.z + 1.15, 0.9 * k);
      });
      const zl = tau - land;
      for (const c of r.chips) {
        const [vx, vy, vz] = c.userData.v;
        const y = 0.3 + vy * zl - 9 * zl * zl;
        c.visible = zl >= 0 && y > 0;
        if (!c.visible) continue;
        c.position.set(home.x + side * 2.8 + vx * zl, y, home.z + vz * zl);
        c.rotation.set(zl * 8, zl * 6, 0);
      }
      word(r.word, tau - 0.7);
      if (zl >= 0 && zl < 0.25) return 0.6;
      return tau > 0.6 && tau < 0.75 ? 0.3 : 0;
    },

    lightning(r, tau) {
      const strike = 0.75;
      const z = tau - strike;
      // A storm cloud gathers over the head...
      const cx = home.x + 0.3 * side;
      const grow = easeOutBack(tau / 0.45) * (1 - easeIn((tau - 2.3) / 0.5));
      r.cloud.visible = grow > 0.001;
      r.cloud.position.set(cx + Math.sin(tau * 2) * 0.12, skyY + Math.max(0, tau - 2.3) * 2, home.z + 0.3);
      r.cloud.scale.setScalar(Math.max(0.001, grow * cloudSize));
      const glow = (tau > 0.35 && tau < 0.43) || (tau > 0.55 && tau < 0.6) || (z >= 0 && z < 0.35 && Math.floor(tau * 30) % 2 === 0);
      r.cloudM.emissiveIntensity = glow ? 1.5 : 0;
      // ...and the bolt flickers, changing shape a few times
      const head = fxB.set(home.x, SEAT_Y + 3.7, home.z);
      const boltOn = z >= 0 && z < 0.35 && Math.floor(tau * 28) % 3 !== 2;
      if (boltOn) {
        const rand = seeded(1 + Math.floor(tau / 0.06));
        const n = r.points.length - 1;
        r.points.forEach((p, i) => {
          const q = i / n;
          const inner = i > 0 && i < n;
          p.set(
            cx + (head.x - cx) * q + (inner ? (rand() - 0.5) * 1.3 : 0),
            skyY - 0.7 + (head.y - skyY + 0.7) * q,
            home.z + 0.3 - 0.3 * q + (inner ? (rand() - 0.5) * 0.5 : 0),
          );
        });
        r.bolt.forEach((seg, i) => {
          stretch(seg.core, r.points[i], r.points[i + 1], 0.14);
          stretch(seg.halo, r.points[i], r.points[i + 1], 0.45);
        });
      }
      for (const seg of r.bolt) seg.core.visible = seg.halo.visible = boltOn;
      puff(r.flash, z, 0.35, home.x, SEAT_Y + 3, home.z + 1, 16, 1 - z / 0.35);
      // Buzzing while the bolt hits, then burnt black with the hair standing up
      if (z >= 0 && z < 0.4) {
        s.root.position.x = home.x + Math.sin(tau * 97) * 0.12;
        s.root.position.z = home.z + Math.cos(tau * 83) * 0.08;
        tint(s, Math.floor(tau * 20) % 2 ? TINT.zap : TINT.char, 0.85);
      } else if (z >= 0.4) {
        tint(s, TINT.char, 0.82);
      }
      r.spikes.visible = z >= 0.3;
      r.spikes.scale.setScalar(Math.max(0.001, easeOutBack((z - 0.3) / 0.2)));
      r.sparks.forEach((sp, i) => {
        const [vx, vy, vz] = r.sparkV[i];
        puff(sp, z, 0.5, head.x + vx * z, head.y + vy * z - 6 * z * z, head.z + vz * z, 0.6 * (1 - z / 0.5));
      });
      const life = r.smoke.length * 0.14;
      r.smoke.forEach((sp, i) => {
        const age = streamAge(z - 0.4, i, r.smoke.length, 0.14);
        puff(sp, age, life, home.x + Math.sin(i * 2.3) * 0.35 + age * 0.25, SEAT_Y + 3.4 + age * 1.5, home.z + Math.cos(i * 1.7) * 0.3, 0.6 + age * 0.8, 0.55 * (1 - age / life));
      });
      word(r.word, z);
      return z >= 0 && z < 0.35 ? 0.9 : 0;
    },

    rocket(r, tau) {
      const ignite = 0.9;
      const lift = 1.45;
      const riseAt = q => (q > 0 ? 11 * q * q + 2 * q : 0);
      const rise = riseAt(tau - lift);
      const away = rise > 26;
      const rattle = tau > ignite ? Math.sin(tau * 80) * (tau < lift ? 0.07 : 0.03) : 0;
      r.rockets.visible = !away;
      r.rockets.scale.setScalar(Math.max(0.001, easeOutBack(tau / 0.35)));
      chair.position.set(home.x + rattle, rise, home.z);
      chair.rotation.z = tau > lift ? Math.sin(tau * 9) * 0.05 : 0;
      chair.visible = !away;
      s.root.position.x = home.x + rattle;
      s.root.position.y += rise;
      s.root.rotation.z = chair.rotation.z;
      s.root.visible = !away;
      const fire = easeOut((tau - ignite) / 0.15);
      r.flames.forEach((f, i) => {
        f.visible = tau > ignite;
        f.scale.set(1, Math.max(0.001, fire * (1 + Math.sin(tau * 60 + i * 2) * 0.25) * (tau > lift ? 1.7 : 1)), 1);
      });
      // The fuses sparkle, then smoke: a cloud on the floor and a trail behind the rockets
      r.sparks.forEach((sp, i) => {
        const on = tau > 0.35 && tau < ignite && Math.floor(tau * 24 + i) % 2 === 0;
        puff(sp, on ? 0 : -1, 1, home.x + (i % 2 ? 1.42 : -1.42) + Math.sin(tau * 40 + i) * 0.15, 0.3, home.z + 0.2 + Math.cos(tau * 33 + i) * 0.15, 0.45);
      });
      r.trail.forEach((sp, i) => {
        const born = ignite + i * 0.05;
        const age = tau - born;
        const x = home.x + (i % 2 ? 1.42 : -1.42) + Math.sin(i * 3.1) * age * 0.9;
        puff(sp, age, 1.5, x, riseAt(born - lift) - 0.2 - age * 0.4, home.z + 0.2 + Math.cos(i * 2.3) * age * 0.9, 0.7 + age * 1.1, 0.75 * (1 - age / 1.5));
      });
      const groundAge = tau - lift;
      r.ground.forEach((sp, i) => {
        const a = (i / r.ground.length) * Math.PI * 2;
        const d = 0.8 + easeOut(groundAge / 1.2) * 3.8;
        puff(sp, groundAge, 1.7, home.x + Math.cos(a) * d, 0.5 + groundAge * 0.3, home.z + 0.4 + Math.sin(a) * d * 0.6, 1.3 + groundAge * 1.4, 0.8 * (1 - groundAge / 1.7));
      });
      word(r.word, tau - lift - 0.15);
      return tau > ignite && tau < lift + 0.5 ? 0.4 : 0;
    },

    ufo(r, tau) {
      let yU = ufoY + 8 * (1 - easeOut(tau / 0.9));
      let xU = home.x;
      if (tau > 3.0) {
        const q = tau - 3.0;
        xU += q * q * 40 * side;
        yU += q * 10;
      }
      r.g.position.set(xU, yU + Math.sin(tau * 3) * 0.15, home.z);
      r.g.rotation.y = tau * 2;
      r.lights.forEach((light, i) => light.material.color.set((Math.floor(tau * 8) + i) % 2 ? '#ffd43b' : '#ff5d5d'));
      const beamOn = easeOut((tau - 0.9) / 0.3) * (1 - easeOut((tau - 2.8) / 0.2));
      const h = Math.max(0.1, yU - 0.5);
      r.beam.position.set(home.x, h / 2, home.z);
      r.beam.scale.set(1, h, 1);
      r.beam.material.opacity = 0.42 * beamOn;
      r.beam.visible = beamOn > 0.01;
      if (tau > 1.2) {
        const lift = easeIn((tau - 1.2) / 1.6);
        s.root.position.y += lift * (yU - 1.4 - SEAT_Y);
        s.root.rotation.y = tau * 5 * lift;
        s.root.rotation.z = Math.sin(tau * 5) * 0.4 * lift;
        const k = 1 - 0.7 * lift;
        s.root.scale.set(k, k, k);
      }
      if (tau > 2.8) s.root.visible = false;
      if (tau > 3.9) r.g.visible = false;
      return 0;
    },

    blackhole(r, tau) {
      const c = { x: home.x + 1.5 * side, y: 7.2, z: home.z - 2 };
      const grow = easeOutBack(tau / 0.8) * (1 - easeIn((tau - 2.55) / 0.35));
      r.g.position.set(c.x, c.y, c.z);
      r.g.scale.setScalar(Math.max(0.001, grow * (1 + Math.sin(tau * 9) * 0.04)));
      r.disk.rotation.z = -tau * 4;
      r.flash.position.set(c.x, c.y, c.z);
      r.flash.material.opacity = clamp01(1 - Math.abs(tau - 2.85) / 0.22);
      r.flash.visible = r.flash.material.opacity > 0.01;
      const p = easeIn((tau - 0.6) / 1.8);
      if (p > 0) {
        s.root.position.x = home.x + (c.x - home.x) * p;
        s.root.position.y += (c.y - 1.5 - s.root.position.y) * p;
        s.root.position.z = home.z + (c.z - home.z) * p;
        s.root.rotation.z = tau * 6 * p;
        const sc = Math.max(0.02, 1 - p);
        s.root.scale.set(sc * (1 - 0.3 * p), sc * (1 + 1.2 * p), sc * (1 - 0.3 * p));
      }
      const pc = easeIn((tau - 1.0) / 1.6);
      if (pc > 0) {
        chair.position.set(home.x + (c.x - home.x) * pc, (c.y - 1) * pc, home.z + (c.z - home.z) * pc);
        chair.rotation.z = -tau * 5 * pc;
        chair.scale.setScalar(Math.max(0.02, 1 - pc));
      }
      if (p >= 1) s.root.visible = false;
      if (pc >= 1) chair.visible = false;
      if (tau > 3.1) r.g.visible = false;
      if (p > 0 && p < 1) return 0.35;
      return tau > 2.6 && tau < 3.0 ? 0.9 : 0;
    },

    meteor(r, tau) {
      const impact = 1.25;
      const z = tau - impact;
      const before = z < 0;
      r.target.visible = before;
      r.target.position.set(home.x, 0.04, home.z + 0.15);
      r.targetM.opacity = 0.35 + 0.65 * (Math.floor(tau * 8) % 2);
      comic(r.warn, before ? tau - 0.05 : -1, home.x, SEAT_Y + 5.3, home.z + 0.5, stage ? 1.5 : 1.8);
      // From the sky (high up on the outer side) straight onto the student
      const S = { x: home.x + side * 10, y: 24, z: home.z - 6 };
      const E = { x: home.x, y: SEAT_Y + 1.6, z: home.z + 0.1 };
      const along = born => clamp01((born - 0.25) / (impact - 0.25)) ** 1.5;
      if (before) {
        const q = along(tau);
        r.rock.visible = tau > 0.25;
        r.rock.position.set(S.x + (E.x - S.x) * q, S.y + (E.y - S.y) * q, S.z + (E.z - S.z) * q);
        r.rock.rotation.set(tau * 5, tau * 3, 0);
        r.rockM.emissiveIntensity = 0.9;
        r.tail.visible = r.rock.visible;
        r.tail.position.copy(r.rock.position);
        r.tail.quaternion.setFromUnitVectors(DOWN, fxB.set(S.x - E.x, S.y - E.y, S.z - E.z).normalize());
        r.tail.scale.set(1, 1 + Math.sin(tau * 40) * 0.08, 1);
        puff(r.aura, r.rock.visible ? 0 : -1, 1, r.rock.position.x, r.rock.position.y, r.rock.position.z, 4.2, 0.9);
      } else {
        // What's left of it glows in the crater
        r.rock.visible = true;
        r.rock.position.set(home.x, 0.45, home.z + 0.1);
        r.rock.rotation.set(0.4, 0.8, 0.2);
        r.rockM.emissiveIntensity = 0.55 + Math.sin(tau * 6) * 0.25;
        r.tail.visible = false;
        puff(r.aura, 0, 1, home.x, 0.8, home.z + 0.1, 2.6, 0.5 + Math.sin(tau * 6) * 0.15);
      }
      r.embers.forEach((sp, i) => {
        const born = 0.25 + i * 0.055;
        const q = along(born);
        const age = tau - born;
        puff(sp, age, 0.45, S.x + (E.x - S.x) * q + Math.sin(i * 5) * 0.5, S.y + (E.y - S.y) * q + age * 1.5, S.z + (E.z - S.z) * q, 0.9 * (1 - age / 0.45));
      });
      // The impact
      puff(r.flash, z, 0.35, E.x, E.y + 0.5, E.z + 1.5, 20, 1 - z / 0.35);
      r.fire.visible = z >= 0 && z < 0.8;
      r.fire.position.set(E.x, 1.4, E.z);
      r.fire.scale.setScalar(0.5 + 5 * easeOut(z / 0.5));
      r.fire.material.opacity = 0.9 * (1 - clamp01(z / 0.8));
      r.core.visible = z >= 0 && z < 0.5;
      r.core.position.copy(r.fire.position);
      r.core.scale.setScalar(0.4 + 3.4 * easeOut(z / 0.35));
      r.core.material.opacity = 1 - clamp01(z / 0.5);
      r.wave.visible = z >= 0 && z < 0.7;
      r.wave.position.set(E.x, 0.07, E.z);
      r.wave.scale.setScalar(1 + 10 * easeOut(z / 0.7));
      r.wave.material.opacity = 0.9 * (1 - clamp01(z / 0.7));
      r.crater.visible = z >= 0;
      r.crater.position.set(E.x, 0.03, E.z);
      r.crater.material.opacity = easeOut(z / 0.2);
      for (const d of r.debris) {
        const [vx, vy, vz] = d.userData.v;
        const gravity = 18;
        const y0 = 1.2;
        const landAt = (vy + Math.sqrt(vy * vy + 2 * gravity * (y0 - 0.2))) / gravity;
        const a = Math.min(Math.max(z, 0), landAt);   // the rubble stays where it lands
        d.visible = z >= 0;
        d.position.set(E.x + vx * a, y0 + vy * a - 0.5 * gravity * a * a, E.z + vz * a);
        d.rotation.set(a * 9, a * 7, 0);
      }
      const life = r.smoke.length * 0.12;
      r.smoke.forEach((sp, i) => {
        const age = streamAge(z - 0.15, i, r.smoke.length, 0.12);
        puff(sp, age, life, E.x + Math.sin(i * 2.1) * 0.7 + age * 0.4, 0.8 + age * 2.4, E.z + Math.cos(i * 1.7) * 0.5, 1 + age * 1.5, 0.6 * (1 - age / life));
      });
      word(r.word, z);
      // The student and the chair are blasted sky high
      if (!before) {
        s.root.position.set(home.x + side * z * 5, SEAT_Y + z * 20, home.z - z * 2);
        s.root.rotation.set(z * 9, 0, z * 14 * side);
        s.root.visible = z < 0.9;
        chair.position.set(home.x + side * z * 10, z * 13 - 4 * z * z, home.z + z * 1.5);
        chair.rotation.set(z * 8, 0, -side * z * 10);
        chair.visible = z < 1.2;
        return 1.6 * (1 - clamp01(z / 0.9));
      }
      return tau > 0.9 ? 0.25 : 0;
    },
  };

  // Moves everything for this frame (after the normal animation). Returns camera shake.
  function apply(t) {
    if (!active) return 0;
    return play[active.kind](rigs[active.kind], t - active.start);
  }

  return {
    start,
    reset,
    pose,
    apply,
    get kind() {
      return active ? active.kind : null;
    },
    elapsed(t) {
      return active ? t - active.start : 0;
    },
  };
}

function addHair(neck, style, hairM) {
  const top = 1.285;
  const piece = (w, h, d, x, y, z, rz = 0, r = 0.08) => {
    const m = add(neck, block(w, h, d, hairM, r), x, y, z);
    m.rotation.z = rz;
    return m;
  };
  if (style === 'swoop') {
    piece(1.42, 0.42, 1.4, 0, top + 0.06, -0.02);
    piece(1.42, 0.32, 0.34, 0, top - 0.2, 0.55);
    piece(0.28, 0.75, 1.3, -0.66, top - 0.32, -0.05);
    piece(0.28, 0.75, 1.3, 0.66, top - 0.32, -0.05);
    piece(1.42, 0.95, 0.3, 0, top - 0.4, -0.58);
    piece(0.42, 0.42, 0.5, -0.35, top + 0.3, 0.15, 0.35);
    piece(0.42, 0.45, 0.5, 0.08, top + 0.36, 0.05, -0.2);
    piece(0.4, 0.4, 0.5, 0.45, top + 0.28, -0.1, -0.45);
  } else {
    // "bacon hair" style
    piece(1.5, 0.5, 1.44, 0, top + 0.1, -0.02, 0, 0.14);
    piece(0.95, 0.42, 0.42, -0.25, top - 0.12, 0.56, 0.28, 0.12);
    piece(0.6, 0.36, 0.4, 0.38, top - 0.08, 0.56, -0.2, 0.1);
    piece(0.34, 1.05, 1.05, -0.68, top - 0.45, -0.1, 0.06, 0.12);
    piece(0.34, 1.05, 1.05, 0.68, top - 0.45, -0.1, -0.06, 0.12);
    piece(1.5, 1.15, 0.36, 0, top - 0.5, -0.58, 0, 0.12);
    piece(0.3, 0.6, 0.3, 0.66, top - 1.1, 0.3, -0.1, 0.1);
    piece(0.3, 0.55, 0.3, -0.66, top - 1.08, 0.25, 0.1, 0.1);
  }
}

// ================= The scene =================
export function createScene(canvas, labelEls) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);   // lowered further if frames are slow
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9fd8ff');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);

  scene.add(new THREE.HemisphereLight('#eef7ff', '#b08a5a', 1.6));
  const sun = new THREE.DirectionalLight('#fff3dd', 2.4);
  sun.position.set(-9, 18, 14);
  sun.target.position.set(0, 2, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 16, bottom: -12, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const room = buildRoom(scene);
  buildMainDesk(scene);
  const chairs = {
    player: buildChair(scene, -STUDENT_X, STUDENT_Z),
    bot: buildChair(scene, STUDENT_X, STUDENT_Z),
  };

  const faces = Object.fromEntries(['smile', 'blink', 'think', 'talk', 'happy', 'sad'].map(k => [k, faceTexture(k)]));
  const looks = {
    player: {
      skin: '#f2c9a1', shirt: '#2f7de1', pants: '#26375f', shoes: '#22222a',
      hair: '#5a3418', hairStyle: 'swoop', decal: starDecal(),
    },
    bot: {
      skin: '#f7efe6', shirt: '#26262c', pants: '#3a3f4a', shoes: '#f2f2f2',
      hair: '#d9741f', hairStyle: 'bacon', decal: jacketDecal(),
    },
  };
  const students = {
    player: buildStudent(scene, -STUDENT_X, looks.player, faces),
    bot: buildStudent(scene, STUDENT_X, looks.bot, faces),
  };
  for (const who of ['player', 'bot']) students[who].fx = createFinisher(scene, students[who], chairs[who]);
  let paused = false;   // true while a full-screen window (the shop) covers the classroom
  let shake = 0;        // camera shake from finishers

  // ---------- Camera: always frames the students in the area the panels leave free ----------
  const insetTarget = { left: 0, right: 0, bottom: 0, top: 64 };
  const inset = { ...insetTarget };
  let size = { w: 1, h: 1 };
  let viewMode = 'game';
  const viewDir = VIEWS.game.dir.clone();
  const focus = VIEWS.game.focus.clone();
  const subject = { ...VIEWS.game.subject };
  const targetDir = new THREE.Vector3();
  // Camera moves are springs (see springTo): the old "move a fixed part of the way each frame"
  // jumped to full speed on the very first frame, which looked like a stutter when a match started
  const VIEW_SPRING = MOVE_SPRING;   // angle and zoom settle in about a second
  // The panels slide in and out with panelEase (see above). The camera makes room for them with the
  // same curve and time, so the classroom and the panel move as one calm motion, like on Sam's turn
  const insetFrom = { ...inset };
  let insetStart = -Infinity;
  const dirVel = new THREE.Vector3();
  const focusVel = new THREE.Vector3();
  const subjectVel = { w: 0, h: 0 };

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w === size.w && h === size.h) return;
    size = { w, h };
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
  }

  function frameCamera(dt, t) {
    const q = panelEase((performance.now() - insetStart) / PANEL_SLIDE_MS);
    for (const key of Object.keys(inset)) inset[key] = insetFrom[key] + (insetTarget[key] - insetFrom[key]) * q;

    // Smooth transition between the home screen and game camera angles
    const view = VIEWS[viewMode];
    targetDir.copy(view.dir);
    if (viewMode === 'menu') targetDir.x += Math.sin(t * 0.22) * 0.12; // slow sway
    targetDir.normalize();
    for (const axis of ['x', 'y', 'z']) {
      [viewDir[axis], dirVel[axis]] = springTo(viewDir[axis], dirVel[axis], targetDir[axis], VIEW_SPRING, dt);
      [focus[axis], focusVel[axis]] = springTo(focus[axis], focusVel[axis], view.focus[axis], VIEW_SPRING, dt);
    }
    viewDir.normalize();
    for (const key of ['w', 'h']) {
      [subject[key], subjectVel[key]] = springTo(subject[key], subjectVel[key], view.subject[key], VIEW_SPRING, dt);
    }

    const { w, h } = size;
    const visW = Math.max(160, w - inset.left - inset.right);
    const visH = Math.max(160, h - inset.bottom - inset.top);
    const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const subjectW = visW < visH ? subject.w * 0.8 : subject.w; // portrait phone: zoom in a little
    const dist = Math.max((subject.h * h) / visH, (subjectW * h) / visW) / (2 * halfTan);
    camera.position.copy(focus).addScaledVector(viewDir, dist);
    camera.lookAt(focus);
    if (shake > 0.01) {
      // Finishers (anvil impact, black hole) shake the camera a little
      camera.position.x += (Math.random() - 0.5) * shake * 0.35;
      camera.position.y += (Math.random() - 0.5) * shake * 0.35;
    }
    camera.setViewOffset(w, h, (inset.right - inset.left) / 2, (inset.bottom - inset.top) / 2, w, h);
  }

  // ---------- Animation ----------
  const tmpV = new THREE.Vector3();
  function animateStudent(s, dt, t) {
    let pose = POSES[s.pose];
    let face = FACE_FOR_POSE[s.pose];
    const emote = s.emote && t - s.emote.start < s.emote.dur ? s.emote : null;
    if (emote) {
      if (emote.kind === 'wave') pose = { ...pose, R: [0.55 + Math.sin(t * 14) * 0.35, 1, 0.2], head: [-0.05, 0, 0.08] };
      else if (emote.kind === 'cheer') pose = POSES.win;
      else if (emote.kind === 'think') pose = POSES.think;
      else if (emote.kind === 'slump') pose = POSES.lose;
      if (emote.face) face = emote.face;
    }
    // A victory dance (everything except the seated "hop") takes over the whole body
    const move = s.pose === 'win' && DANCES[s.dance] ? DANCES[s.dance](t - s.winStart) : null;
    if (move) {
      pose = { L: move.L, R: move.R, head: move.head };
      face = move.face || 'happy';
    }
    // A finisher happening to this student (they lost) overrides arms and face
    const fin = s.fx ? s.fx.pose(t) : null;
    if (fin) {
      pose = fin;
      face = fin.face;
    }
    const k = 1 - Math.exp(-dt * 9);
    const armK = move?.snappy ? 1 - Math.exp(-dt * 24) : k;
    for (const side of ['L', 'R']) {
      s.armTarget[side].setFromUnitVectors(DOWN, tmpV.set(...pose[side]).normalize());
      s.arms[side].quaternion.slerp(s.armTarget[side], armK);
    }

    // Stand up on the chair for the dances: legs straight down, whole student lifted
    s.stand += ((move ? 1 : 0) - s.stand) * (1 - Math.exp(-dt * 6));
    for (const hip of s.hips) hip.rotation.x = -Math.PI / 2 * (1 - s.stand);
    s.root.position.y = SEAT_Y + 1.5 * s.stand + (move?.rootY ?? 0);
    if (move?.rootRotY != null) s.root.rotation.y = move.rootRotY;
    else s.root.rotation.y = wrapAngle(s.root.rotation.y) * (1 - k);
    if (move?.flip != null) s.root.rotation.x = move.flip;
    else s.root.rotation.x = wrapAngle(s.root.rotation.x) * (1 - k);

    let hx = pose.head[0];
    let hy = pose.head[1] + (s.look ? s.lookYaw : 0) + Math.sin(t * 0.7 + s.phase) * 0.05;
    const hz = pose.head[2];
    const nodP = (t - s.nodStart) / 0.7;
    if (nodP >= 0 && nodP < 1) hx += Math.sin(nodP * Math.PI * 3) * 0.22 * (1 - nodP);
    s.neck.rotation.x += (hx - s.neck.rotation.x) * k;
    s.neck.rotation.y += (hy - s.neck.rotation.y) * k;
    s.neck.rotation.z += (hz - s.neck.rotation.z) * k;

    if (move) {
      s.body.position.y = move.bodyY ?? 0;
    } else if (s.pose === 'win' || emote?.kind === 'cheer') {
      s.body.position.y = Math.abs(Math.sin(t * 6.5 + s.phase)) * 0.7;
    } else if (emote?.kind === 'bounce') {
      s.body.position.y = Math.abs(Math.sin(t * 9 + s.phase)) * 0.35;
    } else {
      const by = Math.sin(t * 2.2 + s.phase) * 0.03;
      s.body.position.y += (by - s.body.position.y) * k;
    }
    s.body.position.x += ((move?.bodyX ?? 0) - s.body.position.x) * k;
    s.body.rotation.z += ((move?.bodyRotZ ?? 0) - s.body.rotation.z) * k;
    s.body.rotation.y += ((move?.bodyRotY ?? 0) - s.body.rotation.y) * armK;

    if (t > s.nextBlink) {
      s.blinkUntil = t + 0.13;
      s.nextBlink = t + 2.5 + Math.random() * 3;
    }
    if (face === 'smile' && t < s.blinkUntil) face = 'blink';
    if (t < s.talkUntil && face !== 'happy' && Math.floor(t * 9) % 2 === 0) face = 'talk';
    if (face !== s.currentFace) {
      s.faceMat.map = faces[face];
      s.currentFace = face;
    }
    // Finishers move the student / chair on top of everything above. Returns camera shake.
    return s.fx ? s.fx.apply(t) : 0;
  }

  // ---------- The text above the heads follows the heads ----------
  function placeLabels() {
    const entries = Object.entries(students).filter(([who]) => labelEls[who]);
    // Read all widths first, then write, so the browser only does layout once
    const halfWidths = entries.map(([who]) => labelEls[who].firstElementChild.offsetWidth / 2);
    const minX = inset.left;
    const maxX = size.w - inset.right;
    const clampX = (x, half) => Math.min(Math.max(x, minX + half + 6), maxX - half - 6);
    const points = entries.map(([, s], i) => {
      // Anchor above the head, ignoring spins and flips so the text doesn't whirl around
      tmpV.set(s.root.position.x, s.root.position.y + s.body.position.y + 2 + 1.95, s.root.position.z);
      tmpV.project(camera);
      const rawX = (tmpV.x * 0.5 + 0.5) * size.w;
      // When the camera zooms in on one student the other one can be out of view:
      // hide that student's text instead of pinning it to the edge of the screen
      // ...and hide it while a finisher is getting rid of the student
      const visible = rawX > minX - 30 && rawX < maxX + 30 && !(s.fx && s.fx.kind && s.fx.elapsed(clock.elapsedTime) > 0.3);
      // Keep the text inside the visible area even when a student sits near the edge
      return {
        x: clampX(rawX, halfWidths[i]),
        y: (-tmpV.y * 0.5 + 0.5) * size.h,
        half: halfWidths[i],
        visible,
      };
    });
    // Two labels that collide (narrow screen) are pushed apart in opposite directions
    if (points.length === 2 && points[0].visible && points[1].visible) {
      const [a, b] = points[0].x <= points[1].x ? points : [points[1], points[0]];
      const overlap = a.x + a.half + 10 - (b.x - b.half);
      if (overlap > 0) {
        a.x = clampX(a.x - overlap / 2, a.half);
        b.x = clampX(b.x + overlap / 2, b.half);
        const still = a.x + a.half + 10 - (b.x - b.half);
        if (still > 0) {
          a.x = clampX(a.x - still, a.half);
          b.x = clampX(b.x + still, b.half);
        }
      }
    }
    entries.forEach(([who], i) => {
      const { x, y, visible } = points[i];
      const el = labelEls[who];
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.classList.toggle('off', !visible);
    });
  }

  // ---------- Keeps the frame rate up on slower computers ----------
  // If frames take too long, draw at a lower resolution, and as a last step use smaller shadows
  const perf = { time: 0, frames: 0, smallShadows: false };
  function adaptQuality(frameTime) {
    if (frameTime > 0.2 || document.hidden) return;   // the tab was in the background, not a slow frame
    perf.time += frameTime;
    perf.frames++;
    if (perf.frames < 90) return;
    const average = perf.time / perf.frames;
    perf.time = 0;
    perf.frames = 0;
    if (average < 1 / 45) return;   // fast enough
    if (pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
    } else if (!perf.smallShadows) {
      perf.smallShadows = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;   // made again at the new size
    }
  }

  const clock = new THREE.Clock();
  function loop() {
    const frameTime = clock.getDelta();
    const dt = Math.min(frameTime, 0.05);
    const t = clock.elapsedTime;
    if (!paused) {
      resize();
      frameCamera(dt, t);
      let quake = 0;
      for (const s of Object.values(students)) quake = Math.max(quake, animateStudent(s, dt, t));
      shake = Math.max(quake, shake - dt * 2);
      renderer.render(scene, camera);
      placeLabels();
      adaptQuality(frameTime);
    }
    requestAnimationFrame(loop);
  }
  resize();
  frameCamera(1, 0);
  requestAnimationFrame(loop);

  // ---------- Dance studio: live previews of the victory dances for the shop cards ----------
  // One small extra renderer draws a copy of your student per dance and copies each
  // picture into that card's own <canvas>.
  function createDanceStudio() {
    const studio = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    studio.setPixelRatio(dpr);
    studio.outputColorSpace = THREE.SRGBColorSpace;
    studio.setClearColor(0x000000, 0);
    const studioScene = new THREE.Scene();
    studioScene.add(new THREE.HemisphereLight('#ffffff', '#8a6a4a', 2));
    const key = new THREE.DirectionalLight('#fff3dd', 2.3);
    key.position.set(5, 12, 10);
    studioScene.add(key);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

    // Soft round shadow under each chair
    const shadowCanvas = makeCanvas(128, 128);
    const sg = shadowCanvas.getContext('2d');
    const grad = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 128, 128);
    const shadowMat = new THREE.MeshBasicMaterial({ map: texFrom(shadowCanvas), transparent: true, depthWrite: false });

    const stages = [];
    let running = false;
    let last = 0;
    let time = 0;
    let size = { w: 0, h: 0 };
    // Only the cards that are scrolled into view get drawn
    const watcher = 'IntersectionObserver' in window
      ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          const stage = stages.find(st => st.canvas === entry.target);
          if (stage) stage.onScreen = entry.isIntersecting;
        }
      })
      : null;
    function addToStudio(stage) {
      stage.onScreen = true;
      stages.push(stage);
      watcher?.observe(stage.canvas);
    }

    // A small wooden stage under every chair (it also hides whoever falls through the trapdoor)
    const plinthMat = mat('#ffffff', { map: plankTexture(['#c98f57', '#c08550', '#d29a62', '#bd834d'], [2, 2], 9) });

    function makeStage(look) {
      const x = stages.length * 16;   // far apart so they never show up in each other's picture
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.5, 40), plinthMat);
      add(studioScene, plinth, x, -0.25, STUDENT_Z);
      const chair = buildChair(studioScene, x, STUDENT_Z);
      const s = buildStudent(studioScene, x, look, faces, { withPaper: false });
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      add(studioScene, shadow, x, 0.02, STUDENT_Z + 0.15);
      return { s, chair, x };
    }

    // Your student doing a victory dance on repeat
    function addStage(dance, canvas) {
      const { s, x } = makeStage(looks.player);
      s.dance = dance;
      s.pose = 'win';
      s.winStart = -stages.length * 0.37;   // so the cards don't all move in sync
      addToStudio({ s, x, canvas, ctx: canvas.getContext('2d') });
    }

    // Sam being hit by a finisher on repeat
    function addFinisherStage(kind, canvas) {
      const { s, chair, x } = makeStage(looks.bot);
      s.pose = 'lose';
      s.fx = createFinisher(studioScene, s, chair, { stage: true });
      const order = stages.filter(st => st.finisher).length;   // so they don't all start at once
      addToStudio({ s, x, canvas, ctx: canvas.getContext('2d'), finisher: kind, nextStart: 0.4 + order * 0.35 });
    }

    function loopFinisher(stage) {
      const { fx } = stage.s;
      if (!fx.kind && time >= stage.nextStart) fx.start(stage.finisher, time);
      if (fx.kind && fx.elapsed(time) > FINISHER_LENGTH[stage.finisher] + 0.6) {
        fx.reset();
        stage.nextStart = time + 0.9;   // a short pause with Sam back on his chair
      }
    }

    function frame(now) {
      if (!running) return;
      const dt = Math.min((now - last) / 1000 || 0.016, 0.05);
      last = now;
      time += dt;
      for (const stage of stages) {
        // Cards scrolled out of view are paused (a finisher started there would never get its
        // effects moved into place, and they'd show up in the first card)
        if (!stage.onScreen) continue;
        if (stage.finisher) loopFinisher(stage);
        const { canvas } = stage;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) continue;
        if (w !== size.w || h !== size.h) {
          size = { w, h };
          studio.setSize(w, h, false);
        }
        const pw = Math.round(w * dpr);
        const ph = Math.round(h * dpr);
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
        }
        animateStudent(stage.s, dt, time);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
        cam.position.set(stage.x + 2.6, 5.9, STUDENT_Z + 14);
        cam.lookAt(stage.x, 4.6, STUDENT_Z);
        studio.render(studioScene, cam);
        stage.ctx.clearRect(0, 0, pw, ph);
        stage.ctx.drawImage(studio.domElement, 0, 0, pw, ph);
      }
      requestAnimationFrame(frame);
    }

    return {
      addStage,
      addFinisherStage,
      start() {
        if (running) return;
        running = true;
        last = performance.now();
        requestAnimationFrame(frame);
      },
      stop() {
        running = false;
      },
    };
  }

  return {
    createDanceStudio,
    // Play a finisher on the student who lost (a key of FINISHER_LENGTH)
    finish(who, kind) {
      students[who].fx.start(kind, clock.elapsedTime);
    },
    // Put both students (and their chairs) back after a finisher
    resetFinishers() {
      for (const s of Object.values(students)) s.fx.reset();
    },
    // Stop drawing the classroom while something covers the whole screen
    setPaused(value) {
      paused = value;
    },
    // 'menu', 'game' (both students), 'focusPlayer' / 'focusBot' (close-up).
    // instant = jump straight there without a camera move
    setView(mode, instant = false) {
      viewMode = mode;
      if (instant) {
        viewDir.copy(VIEWS[mode].dir);
        focus.copy(VIEWS[mode].focus);
        Object.assign(subject, VIEWS[mode].subject);
        dirVel.set(0, 0, 0);
        focusVel.set(0, 0, 0);
        Object.assign(subjectVel, { w: 0, h: 0 });
      }
    },
    setBoard(rangeText) {
      drawChalkboard(room.boardCanvas, rangeText);
      room.boardTex.needsUpdate = true;
    },
    setPose(who, pose) {
      const s = students[who];
      if (pose === 'win' && s.pose !== 'win') s.winStart = clock.elapsedTime;
      s.pose = pose;
    },
    // Which victory dance the 'win' pose uses: 'hop' or a key of DANCES
    setDance(who, dance) {
      students[who].dance = dance;
    },
    look(who, on) {
      students[who].look = on;
    },
    // kind: 'wave' | 'cheer' | 'bounce' | 'nod' | 'think' | 'slump', face: optional face to show meanwhile
    emote(who, kind, face = null) {
      const s = students[who];
      s.emote = { kind, face, start: clock.elapsedTime, dur: EMOTE_DURATION[kind] ?? 1.2 };
      if (kind === 'nod') s.nodStart = clock.elapsedTime;
    },
    nod(who) {
      students[who].nodStart = clock.elapsedTime;
    },
    talk(who, seconds) {
      students[who].talkUntil = clock.elapsedTime + seconds;
    },
    setPaper(who, text) {
      const s = students[who];
      const value = text == null ? '' : String(text);
      if (value === s.paperText) return;
      s.paperText = value;
      drawPaper(s.paperCanvas, value);
      s.paperTex.needsUpdate = true;
    },
    setInsets(values, instant = false) {
      // Called on every redraw of the page: only a real change starts a new move (from wherever the camera is now)
      if (!instant && Object.keys(values).every(key => values[key] === insetTarget[key])) return;
      Object.assign(insetTarget, values);
      Object.assign(insetFrom, inset);
      insetStart = instant ? -Infinity : performance.now();
      if (instant) Object.assign(inset, insetTarget);
    },
  };
}
