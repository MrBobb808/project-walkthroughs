/* ==========================================================================
   District 31 PPS Director — interactive 3D tri-fold brochure
   Vanilla JS + CSS 3D transforms driven by damped spring physics.

   Model
   -----
   The sheet is three absolutely-positioned panels. The left panel hinges on
   its right edge, the cover (right) panel hinges on its left edge — the two
   real fold lines. `p` is the open progress (0 folded → 1 cover open →
   2 fully open); each hinge runs its own under-damped spring chasing a
   target derived from `p`, which produces the sequential, overshooting,
   settling paper motion. A nested ".bend" layer flexes with hinge velocity
   so the paper bows near the crease while it moves.
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t, a, b) => {
  t = clamp((t - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/* ---------------- spring ---------------- */

class Spring {
  constructor(value = 0, stiffness = 90, zeta = 1) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.k = stiffness;
    this.zeta = zeta;
  }
  step(dt) {
    if (reducedMotion.matches) {
      this.x = this.target;
      this.v = 0;
      return this.x;
    }
    const c = 2 * this.zeta * Math.sqrt(this.k);
    const a = -this.k * (this.x - this.target) - c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  snap(v = this.target) {
    this.x = v;
    this.v = 0;
    return this;
  }
  get settled() {
    return Math.abs(this.x - this.target) < 5e-4 && Math.abs(this.v) < 5e-4;
  }
}

/* ---------------- elements ---------------- */

const app = $("#app");
const stage = $("#stage");
const scene = $("#scene");
const pivot = $("#pivot");
const book = $("#book");
const panelL = $("#panelL");
const panelR = $("#panelR");
const bendL = $("#bendL");
const bendR = $("#bendR");
const hint = $("#hint");
const statusPill = $("#statusPill");
const statusText = $("#statusText");
const announcer = $("#announcer");
const tourCaption = $("#tourCaption");

const btnStart = $("#btnStart");
const btnOpen = $("#btnOpen");
const btnFlip = $("#btnFlip");
const btnTour = $("#btnTour");
const btnReset = $("#btnReset");
const btnFullscreen = $("#btnFullscreen");
const btnMore = $("#btnMore");
const moreMenu = $("#moreMenu");
const btnPrint = $("#btnPrint");
const btnHelp = $("#btnHelp");

/* ---------------- feature check ---------------- */

const supports3D =
  typeof CSS !== "undefined" &&
  CSS.supports &&
  CSS.supports("transform-style", "preserve-3d");

if (!supports3D) {
  document.body.classList.add("no3d");
  $("#no3dNote").hidden = false;
  $("#intro").classList.add("hide");
}

/* ---------------- inject dynamic shading layers ---------------- */

for (const face of $$(".panel.left .face, .panel.right .face")) {
  const d = document.createElement("div");
  d.className = "shade";
  face.appendChild(d);
}
for (const cls of ["cast-left", "cast-right"]) {
  const d = document.createElement("div");
  d.className = cls;
  $(".face-inside-center").appendChild(d);
}
{
  const d = document.createElement("div");
  d.className = "cast-cover";
  $(".face-outside-left").appendChild(d);
}

/* ---------------- state ---------------- */

const FOLD_DEG = 178.7; // slightly under 180 so folded panels never z-fight

const state = {
  started: false,
  // fold progress: 0 folded, 1 cover open, 2 fully open
  p: new Spring(0, 26, 1),
  dragP: null, // non-null while the user is scrubbing the fold
  foldL: new Spring(1, 95, 0.62),
  foldR: new Spring(1, 95, 0.62),
  flip: new Spring(0, 60, 0.8),
  pendingFlip: false,
  // camera
  yaw: new Spring(-24, 60, 1),
  pitch: new Spring(7, 60, 1),
  zoom: new Spring(1, 55, 0.85),
  camX: new Spring(0, 45, 0.95),
  parX: new Spring(0, 80, 1),
  parY: new Spring(0, 80, 1),
  orbit: { yaw: 0, pitch: 0 },
  paperW: 900,
  foldedZoom: 1.1,
  view: "folded",
  opened: false, // opened at least once (hides hint)
  touring: false,
  tourToken: 0,
};

/* ---------------- fit to viewport ---------------- */

const SHEET_RATIO = 2001 / 1545; // three 667x1545 panels side by side

function fit() {
  // Use the true viewport width, not stage.clientWidth: a large scene can grow
  // the grid column and report back an inflated stage width (a feedback loop).
  const vw = document.documentElement.clientWidth || innerWidth;
  const w = Math.min(stage.clientWidth, vw);
  const h = stage.clientHeight;
  if (!w || !h) return;
  // Size the paper so the *open* three-panel spread always fits (its width is
  // the binding constraint). Narrow screens may use a touch more width; a cap
  // keeps the brochure crisp and composed on very large displays.
  const availW = w * (w < 560 ? 0.95 : 0.9);
  const availH = h * 0.86;
  let paperW = Math.min(availW, availH * SHEET_RATIO, 1360);
  paperW = Math.max(paperW, 232);
  const paperH = paperW / SHEET_RATIO;
  state.paperW = paperW;
  // How much bigger the single folded cover can be drawn to fill the stage —
  // large on tall/portrait screens where the open-spread size leaves headroom.
  const panelW = paperW / 3;
  state.foldedZoom = clamp(
    Math.min((w * 0.82) / panelW, (h * 0.82) / paperH),
    1,
    2.15
  );
  const root = document.documentElement;
  root.style.setProperty("--paper-w", paperW.toFixed(1) + "px");
  root.style.setProperty("--paper-h", paperH.toFixed(1) + "px");
}

new ResizeObserver(fit).observe(stage);
addEventListener("orientationchange", () => setTimeout(fit, 120));
fit();

/* ---------------- camera pose per state ---------------- */

function cameraTargets() {
  const open = clamp(state.p.x / 2, 0, 1);
  let yaw = lerp(-24, -6, open);
  let pitch = lerp(7, 3.5, open);
  // Folded state fills the stage (big on portrait); eases to 1x as it opens so
  // the full spread fits. `open` here means fully unfolded, so cover the first
  // half of the fold with the folded zoom, then settle to 1.
  const foldedZoom = state.foldedZoom || 1.1;
  let zoom = lerp(foldedZoom, 1, clamp(state.p.x / 1.15, 0, 1));
  if (state.flip.x > 0.04) {
    // frontal, slightly higher view for the outside spread
    yaw = lerp(yaw, 6, state.flip.x);
    pitch = lerp(pitch, 5, state.flip.x);
  }
  return { yaw, pitch, zoom };
}

/* ---------------- main loop ---------------- */

let lastT = performance.now();

function frame(now) {
  const dt = clamp((now - lastT) / 1000, 0.001, 1 / 30);
  lastT = now;

  // fold progress
  if (state.dragP != null) {
    state.p.x = state.dragP;
  } else {
    state.p.step(dt);
  }
  const p = clamp(state.p.x, 0, 2);

  // deferred flip once the sheet is far enough open
  if (state.pendingFlip && p > 1.55) {
    state.flip.target = 1;
    state.pendingFlip = false;
  }

  // hinge targets derive from p (overlapping stages feel like real paper)
  state.foldR.target = 1 - smooth(p, 0, 1.12);
  state.foldL.target = 1 - smooth(p, 0.88, 2);
  state.foldR.step(dt);
  state.foldL.step(dt);
  state.flip.step(dt);

  const fL = clamp(state.foldL.x, -0.06, 1.06);
  const fR = clamp(state.foldR.x, -0.06, 1.06);

  // camera
  const cam = cameraTargets();
  state.yaw.target = cam.yaw + state.orbit.yaw;
  state.pitch.target = cam.pitch + state.orbit.pitch;
  state.zoom.target = cam.zoom;
  state.yaw.step(dt);
  state.pitch.step(dt);
  state.zoom.step(dt);
  state.camX.step(dt);
  state.parX.step(dt);
  state.parY.step(dt);

  const liftUnit = state.paperW * 0.0055;

  // panels — rotate about the true fold lines, float up by "paper thickness",
  // and carry a slight rotateZ misalignment while folded
  const aL = fL * FOLD_DEG;
  const aR = -fR * (FOLD_DEG + 0.4);
  const liftL = Math.max(fL, 0) * liftUnit;
  const liftR = Math.max(fR, 0) * liftUnit * 2.3;
  panelL.style.transform =
    `translate3d(0,0,${liftL.toFixed(2)}px) rotateY(${aL.toFixed(3)}deg) rotateZ(${(fL * -0.55).toFixed(3)}deg)`;
  panelR.style.transform =
    `translate3d(0,0,${liftR.toFixed(2)}px) rotateY(${aR.toFixed(3)}deg) rotateZ(${(fR * 0.4).toFixed(3)}deg)`;

  // paper flex: velocity lag + a slight resting curl while folded
  const bL = clamp(-state.foldL.v * 7, -6, 6) + fL * 2.0;
  const bR = clamp(state.foldR.v * 7, -6, 6) - fR * 2.6;
  bendL.style.transform = `rotateY(${bL.toFixed(3)}deg)`;
  bendR.style.transform = `rotateY(${bR.toFixed(3)}deg)`;

  // whole-sheet flip (inside <-> outside) with a small mid-flip lift
  const flipTz = Math.sin(state.flip.x * Math.PI) * state.paperW * 0.05;
  book.style.transform =
    `translateZ(${flipTz.toFixed(2)}px) rotateY(${(state.flip.x * 180).toFixed(3)}deg)`;

  // camera pivot
  pivot.style.transform =
    `translateX(${state.camX.x.toFixed(2)}px) ` +
    `rotateX(${(state.pitch.x + state.parY.x).toFixed(3)}deg) ` +
    `rotateY(${(state.yaw.x + state.parX.x).toFixed(3)}deg) ` +
    `scale(${state.zoom.x.toFixed(4)})`;

  // dynamic shading + contact shadow
  const openness = 1 - (fL + fR) / 2;
  const bs = book.style;
  bs.setProperty("--foldL", fL.toFixed(3));
  bs.setProperty("--foldR", fR.toFixed(3));
  bs.setProperty("--castL", (Math.sin(clamp(fL, 0, 1) * Math.PI) * 0.85 + fL * 0.1).toFixed(3));
  bs.setProperty("--castR", (Math.sin(clamp(fR, 0, 1) * Math.PI) * 0.7).toFixed(3));
  bs.setProperty("--castFlap", (clamp(fR, 0, 1) * clamp(fL, 0, 1)).toFixed(3));
  const sh = document.documentElement.style;
  sh.setProperty("--shW", lerp(44, 104, openness).toFixed(1) + "%");
  sh.setProperty("--shOp", lerp(0.62, 0.42, openness).toFixed(3));

  updateView(p);
  requestAnimationFrame(frame);
}

if (supports3D) requestAnimationFrame(frame);

/* ---------------- view bookkeeping ---------------- */

function computeView(p) {
  if (state.flip.x > 0.5) return "outside";
  if (p < 0.3) return "folded";
  if (p < 1.55 && state.foldL.x > 0.45) return "flap";
  return "inside";
}

const VIEW_LABEL = {
  folded: "Folded",
  flap: "Cover open",
  inside: "Inside spread",
  outside: "Outside spread",
};

function updateView(p) {
  const v = computeView(p);
  if (v === state.view) return;
  state.view = v;
  book.dataset.view = v;
  statusText.textContent = VIEW_LABEL[v];
  statusPill.classList.toggle("is-open", v !== "folded");
  announce(`Brochure: ${VIEW_LABEL[v]}`);
  btnOpen.innerHTML = v === "folded"
    ? "📖 <span>Open</span>"
    : "📕 <span>Close</span>";
  btnFlip.setAttribute("aria-pressed", String(v === "outside"));
  btnFlip.innerHTML = v === "outside"
    ? "🔄 <span>Inside</span>"
    : "🔄 <span>Outside</span>";
  // keep hidden faces out of the tab order
  const interactive = {
    folded: [".face-cover"],
    flap: [".face-inside-right", ".face-outside-left"],
    inside: [".face.front"],
    outside: [".face.back"],
  }[v];
  for (const face of $$(".face")) {
    face.inert = !interactive.some((sel) => face.matches(sel));
  }
  if (v !== "folded" && !state.opened) {
    state.opened = true;
    hint.hidden = true;
  }
}

function announce(msg) {
  announcer.textContent = msg;
}

/* ---------------- actions ---------------- */

function openBrochure() {
  state.p.target = 2;
}
function closeBrochure() {
  state.flip.target = 0;
  state.pendingFlip = false;
  state.p.target = 0;
}
function toggleOpen() {
  state.p.target >= 1.5 && state.p.x > 0.4 ? closeBrochure() : openBrochure();
}
function toggleFlip() {
  if (state.flip.target === 1) {
    state.flip.target = 0;
    state.pendingFlip = false;
    return;
  }
  if (state.p.x < 1.55) {
    state.pendingFlip = true;
    state.p.target = 2;
  } else {
    state.flip.target = 1;
  }
}
function resetView() {
  state.orbit.yaw = 0;
  state.orbit.pitch = 0;
  state.camX.target = 0;
  state.parX.snap(0);
  state.parY.snap(0);
}

/* ---------------- intro ---------------- */

btnStart.addEventListener("click", () => {
  state.started = true;
  $("#intro").classList.add("hide");
  if (!supports3D) return;
  if (!reducedMotion.matches) {
    // entrance: the folded brochure swings in and settles
    state.yaw.snap(-70);
    state.pitch.snap(22);
    state.zoom.snap(0.55);
  }
  setTimeout(() => {
    if (!state.opened) hint.hidden = false;
  }, 1100);
  book.focus({ preventScroll: true });
});

/* ---------------- pointer: fold scrub / orbit / parallax ---------------- */

let drag = null;

book.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".hotspot") || state.touring) return;
  drag = {
    id: e.pointerId,
    x0: e.clientX,
    y0: e.clientY,
    p0: clamp(state.p.x, 0, 2),
    moved: false,
    lastX: e.clientX,
    lastT: performance.now(),
    vel: 0,
  };
  book.setPointerCapture(e.pointerId);
});

book.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0;
  if (Math.abs(dx) > 6 || Math.abs(e.clientY - drag.y0) > 6) drag.moved = true;
  if (!drag.moved) return;
  const panelW = state.paperW / 3;
  const dir = state.flip.x > 0.5 ? -1 : 1; // mirrored when viewing the back
  state.dragP = clamp(drag.p0 + (dir * dx * 1.15) / panelW, 0, 2);
  const now = performance.now();
  const dtm = Math.max(now - drag.lastT, 1);
  drag.vel = ((e.clientX - drag.lastX) / dtm) * 1000; // px/s
  drag.lastX = e.clientX;
  drag.lastT = now;
});

function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  if (drag.moved && state.dragP != null) {
    const panelW = state.paperW / 3;
    const dir = state.flip.x > 0.5 ? -1 : 1;
    const vP = (dir * drag.vel * 1.15) / panelW; // fold-units per second
    state.p.x = state.dragP;
    state.p.v = clamp(vP, -6, 6);
    const projected = clamp(state.dragP + vP * 0.18, -0.4, 2.4);
    // settle to the nearest natural rest state: closed, flap, or open
    state.p.target = [0, 1, 2].reduce((best, s) =>
      Math.abs(s - projected) < Math.abs(best - projected) ? s : best, 0);
  }
  state.dragP = null;
  const wasDrag = drag.moved;
  drag = null;
  return wasDrag;
}

book.addEventListener("pointerup", (e) => {
  const wasDrag = endDrag(e);
  if (wasDrag || state.touring) return;
  // plain click/tap: open when folded or on the flap view
  if (state.view === "folded" || state.view === "flap") openBrochure();
});
book.addEventListener("pointercancel", endDrag);

/* orbit: drag the stage background to tilt the brochure */
let orbitDrag = null;
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#book, .hint, .tour-caption, button")) return;
  orbitDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!orbitDrag || e.pointerId !== orbitDrag.id) return;
  state.orbit.yaw = clamp(state.orbit.yaw + (e.clientX - orbitDrag.x) * 0.12, -26, 26);
  state.orbit.pitch = clamp(state.orbit.pitch - (e.clientY - orbitDrag.y) * 0.1, -16, 16);
  orbitDrag.x = e.clientX;
  orbitDrag.y = e.clientY;
});
const endOrbit = (e) => {
  if (orbitDrag && e.pointerId === orbitDrag.id) orbitDrag = null;
};
stage.addEventListener("pointerup", endOrbit);
stage.addEventListener("pointercancel", endOrbit);

/* gentle hover parallax */
addEventListener("pointermove", (e) => {
  if (drag || orbitDrag || reducedMotion.matches || e.pointerType === "touch") return;
  const nx = e.clientX / innerWidth - 0.5;
  const ny = e.clientY / innerHeight - 0.5;
  state.parX.target = nx * 3.5;
  state.parY.target = -ny * 2.5;
});

/* ---------------- controls ---------------- */

btnOpen.addEventListener("click", () => { cancelTour(); toggleOpen(); });
btnFlip.addEventListener("click", () => { cancelTour(); toggleFlip(); });
btnReset.addEventListener("click", () => { cancelTour(); resetView(); announce("View reset"); });

btnFullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    announce("Fullscreen is not available in this browser.");
  }
});
addEventListener("fullscreenchange", () => {
  btnFullscreen.innerHTML = document.fullscreenElement
    ? "⛶ <span>Exit Full</span>"
    : "⛶ <span>Fullscreen</span>";
  setTimeout(fit, 80);
});

btnMore.addEventListener("click", () => {
  const open = moreMenu.hidden;
  moreMenu.hidden = !open;
  btnMore.setAttribute("aria-expanded", String(open));
});
addEventListener("pointerdown", (e) => {
  if (!moreMenu.hidden && !e.target.closest(".more-wrap")) {
    moreMenu.hidden = true;
    btnMore.setAttribute("aria-expanded", "false");
  }
});

/* keyboard */
book.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    cancelTour();
    toggleOpen();
  }
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("#modalBackdrop").hidden) return closeModal();
    if (state.touring) return cancelTour();
    if (!moreMenu.hidden) {
      moreMenu.hidden = true;
      btnMore.setAttribute("aria-expanded", "false");
    }
    return;
  }
  const tag = document.activeElement?.tagName;
  if (tag === "BUTTON" || tag === "INPUT" || !$("#modalBackdrop").hidden) return;
  if (!state.started) return;
  if (e.key === " ") { e.preventDefault(); cancelTour(); toggleOpen(); }
  else if (e.key === "f" || e.key === "F") { cancelTour(); toggleFlip(); }
  else if (e.key === "r" || e.key === "R") { cancelTour(); resetView(); }
  else if (e.key === "t" || e.key === "T") { btnTour.click(); }
});

/* ---------------- modals ---------------- */

const MODALS = {
  mission: {
    emoji: "🎯",
    title: "Our Mission",
    body: `<p>We believe every student deserves <strong>safety</strong>, <strong>social-emotional
      support</strong>, <strong>equity</strong>, and <strong>college-and-career readiness</strong>.</p>
      <p>A Pupil Personnel Services (PPS) Administrator provides leadership and oversight for
      student support services to promote equity and compliance — looking at student success
      through an equity lens, every day.</p>`,
  },
  responsibilities: {
    emoji: "🧭",
    title: "PPS Director — Position Responsibilities",
    body: `<ul>
      <li>Provides visionary leadership for all student support services throughout the district.</li>
      <li>Analyzes data to improve student outcomes.</li>
      <li>Promotes Multi-Tiered Systems of Support (MTSS).</li>
      <li>Works collaboratively with principals, teachers, families, and community agencies, and
          coordinates with special education stakeholders to remove barriers to student success.</li>
      <li>Develops programs that promote equity, compliance, and inclusion.</li>
      <li>Supervises attendance programs and community partnerships.</li>
      <li>Oversees crisis response and intervention.</li>
    </ul>`,
  },
  qualifications: {
    emoji: "🎓",
    title: "Do You Qualify?",
    body: `<ul>
      <li>New York State School District Leader (SDL/SBL) certification.</li>
      <li>Master’s degree in Educational Leadership or a related field.</li>
      <li>Knowledge of special education law (IDEA, Section 504).</li>
      <li>Experience supervising support personnel.</li>
      <li>Strong communication and leadership skills.</li>
      <li>Committed to equity and student success.</li>
    </ul>`,
  },
  benefits: {
    emoji: "🌟",
    title: "Why Work With District 31?",
    body: `<p>District 31 serves thousands of students throughout Staten Island and is committed
      to equitable, inclusive, high-quality educational opportunities for every learner.</p>
      <ul>
        <li>Competitive salary</li>
        <li>Excellent benefits</li>
        <li>Professional development</li>
        <li>Mentorship opportunities</li>
        <li>Diverse school community</li>
        <li>Collaborative leadership</li>
      </ul>`,
  },
  apply: {
    emoji: "✉️",
    title: "Application Process",
    body: `<p>Ready to lead student support services for every learner, every day? Here’s how to apply:</p>
      <ul>
        <li>Gather your resume and proof of qualifications.</li>
        <li>Access the TEACH Portal.</li>
        <li>Build your candidate profile and complete the application.</li>
        <li>Apply for open postings.</li>
        <li>Prepare for a rigorous interview process.</li>
      </ul>
      <p class="note">The address, phone number, and website shown on the brochure are sample
      placeholders — replace them with the district’s official application details before
      publishing.</p>`,
  },
  help: {
    emoji: "⌨️",
    title: "Keyboard Shortcuts",
    body: `<ul>
      <li><strong>Space</strong> — open / close the brochure</li>
      <li><strong>F</strong> — flip between inside and outside</li>
      <li><strong>T</strong> — start or stop the auto tour</li>
      <li><strong>R</strong> — reset the camera view</li>
      <li><strong>Esc</strong> — close dialogs or stop the tour</li>
    </ul>
    <p>You can also drag the brochure to fold or unfold it, and drag the background to tilt it in 3D.</p>`,
  },
};

const modalBackdrop = $("#modalBackdrop");
let lastFocused = null;

function openModal(key) {
  const data = MODALS[key];
  if (!data) return;
  lastFocused = document.activeElement;
  $("#modalEmoji").textContent = data.emoji;
  $("#modalTitle").textContent = data.title;
  $("#modalBody").innerHTML = data.body;
  modalBackdrop.hidden = false;
  $("#modalClose").focus();
}
function closeModal() {
  modalBackdrop.hidden = true;
  if (lastFocused && lastFocused.isConnected) lastFocused.focus({ preventScroll: true });
}

$("#modalClose").addEventListener("click", closeModal);
modalBackdrop.addEventListener("pointerdown", (e) => {
  if (e.target === modalBackdrop) closeModal();
});
$("#modal").addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusables = $$("button, a[href]", $("#modal"));
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

for (const spot of $$(".hotspot")) {
  spot.addEventListener("click", (e) => {
    e.stopPropagation();
    openModal(spot.dataset.modal);
  });
  spot.addEventListener("pointerdown", (e) => e.stopPropagation());
}

btnHelp.addEventListener("click", () => {
  moreMenu.hidden = true;
  btnMore.setAttribute("aria-expanded", "false");
  openModal("help");
});

/* ---------------- auto tour ---------------- */

const sleep = (ms, token) =>
  new Promise((res) => {
    const id = setInterval(() => {
      if (token !== state.tourToken) { clearInterval(id); res(false); }
    }, 60);
    setTimeout(() => { clearInterval(id); res(token === state.tourToken); }, ms);
  });

function caption(text) {
  tourCaption.textContent = text;
  tourCaption.hidden = !text;
}

async function runTour() {
  const token = ++state.tourToken;
  state.touring = true;
  btnTour.setAttribute("aria-pressed", "true");
  btnTour.innerHTML = "⏹ <span>Stop Tour</span>";
  hint.hidden = true;
  const speed = reducedMotion.matches ? 0.55 : 1;
  const step = async (ms) => sleep(ms * speed, token);

  resetView();
  state.flip.target = 0;
  state.pendingFlip = false;
  state.p.target = 0;
  caption("This is the brochure as it arrives — folded, with the front cover facing you.");
  if (!(await step(2800))) return;

  state.p.target = 1;
  caption("Lift the cover… the qualification flap greets you first, just like the printed piece.");
  if (!(await step(3000))) return;

  state.p.target = 2;
  caption("Unfold the full inside spread — the role, the mission, and the responsibilities.");
  if (!(await step(2800))) return;

  const panelW = () => state.paperW / 3;
  $(".face-inside-left").classList.add("tour-highlight");
  state.camX.target = panelW();
  state.zoom.target = 1; // zoom handled by cameraTargets; nudge via orbit
  state.orbit.yaw = 6;
  caption("Now hiring for 2026–2027 — District 31, Staten Island, New York City Public Schools.");
  if (!(await step(2600))) return;

  $(".face-inside-left").classList.remove("tour-highlight");
  $(".face-inside-center").classList.add("tour-highlight");
  state.camX.target = 0;
  state.orbit.yaw = 0;
  caption("Do you look at student success through an equity lens? Join our team.");
  if (!(await step(2600))) return;

  $(".face-inside-center").classList.remove("tour-highlight");
  $(".face-inside-right").classList.add("tour-highlight");
  state.camX.target = -panelW();
  state.orbit.yaw = -6;
  caption("What the PPS Director leads — data, MTSS, partnerships, and crisis response.");
  if (!(await step(2600))) return;

  $(".face-inside-right").classList.remove("tour-highlight");
  state.camX.target = 0;
  state.orbit.yaw = 0;
  state.flip.target = 1;
  caption("Flip it over — qualifications, district benefits, and how to apply.");
  if (!(await step(3400))) return;

  $(".face-outside-left").classList.add("tour-highlight");
  $(".face-outside-center").classList.add("tour-highlight");
  if (!(await step(2400))) return;
  $(".face-outside-left").classList.remove("tour-highlight");
  $(".face-outside-center").classList.remove("tour-highlight");

  state.flip.target = 0;
  caption("Explore on your own — drag the paper, tilt the view, and tap the ⓘ dots for details.");
  if (!(await step(2600))) return;

  finishTour();
}

function finishTour() {
  state.touring = false;
  caption("");
  btnTour.setAttribute("aria-pressed", "false");
  btnTour.innerHTML = "✨ <span>Auto Tour</span>";
  for (const f of $$(".tour-highlight")) f.classList.remove("tour-highlight");
  resetView();
}

function cancelTour() {
  if (!state.touring) return;
  state.tourToken++;
  finishTour();
}

btnTour.addEventListener("click", () => {
  state.touring ? cancelTour() : runTour();
});
stage.addEventListener("pointerdown", () => cancelTour(), true);

/* ---------------- print ---------------- */

function buildPrintSheet() {
  const sheet = $("#printSheet");
  sheet.innerHTML = "";
  const spreads = [
    ["Inside spread (open brochure)", [".face-inside-left", ".face-inside-center", ".face-inside-right"]],
    ["Outside spread (reverse side)", [".face-outside-left", ".face-outside-center", ".face-cover"]],
  ];
  for (const [label, faces] of spreads) {
    const title = document.createElement("p");
    title.className = "print-label";
    title.textContent = label;
    sheet.appendChild(title);
    const row = document.createElement("div");
    row.className = "print-spread";
    for (const sel of faces) {
      const cell = document.createElement("div");
      cell.className = "print-cell";
      cell.appendChild($(sel).cloneNode(true));
      row.appendChild(cell);
    }
    sheet.appendChild(row);
  }
}

addEventListener("beforeprint", buildPrintSheet);
addEventListener("afterprint", () => { $("#printSheet").innerHTML = ""; });

btnPrint.addEventListener("click", () => {
  moreMenu.hidden = true;
  btnMore.setAttribute("aria-expanded", "false");
  buildPrintSheet();
  print();
});

/* ---------------- initial UI state ---------------- */

book.dataset.view = "folded";
statusText.textContent = VIEW_LABEL.folded;
