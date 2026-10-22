// Interface visual do Drako: dragão holográfico procedural, anéis de HUD,
// partículas e indicadores de estado. Nenhuma palavra é desenhada.
//
// Estados: off (tela preta), listening, hearing, thinking, speaking
// Alertas: null | needs-gesture | mic-denied | mic-failure | speech-unavailable |
//          network | offline | unconfigured | unauthorized | server | confirm

const TAU = Math.PI * 2;
const COLORS = {
  green: [57, 255, 136],
  amber: [255, 176, 46],
  red: [255, 64, 84],
};
const ALERT_COLOR = {
  "needs-gesture": "green",
  confirm: "amber",
  "mic-failure": "amber",
  network: "amber",
  offline: "amber",
  server: "amber",
  unconfigured: "amber",
  "mic-denied": "red",
  "speech-unavailable": "red",
  unauthorized: "red",
};

const STATE_PARAMS = {
  off: { glow: 0, ring: 0.05, particles: 0, wave: 0, eye: 0.2, sweep: 0 },
  listening: { glow: 0.75, ring: 0.12, particles: 0.35, wave: 0.12, eye: 0.85, sweep: 0 },
  hearing: { glow: 0.9, ring: 0.18, particles: 0.6, wave: 0.55, eye: 1, sweep: 0 },
  thinking: { glow: 0.95, ring: 0.6, particles: 0.9, wave: 0.2, eye: 1, sweep: 1 },
  speaking: { glow: 1, ring: 0.22, particles: 0.8, wave: 0.9, eye: 1, sweep: 0 },
};

// Coluna do dragão (unidade = raio R). Começa no pescoço e termina na cauda.
const SPINE = [
  [-0.3, -0.6],
  [-0.06, -0.82],
  [0.26, -0.76],
  [0.46, -0.5],
  [0.4, -0.18],
  [0.1, 0.0],
  [-0.28, 0.1],
  [-0.55, 0.34],
  [-0.5, 0.66],
  [-0.16, 0.82],
  [0.24, 0.76],
  [0.48, 0.52],
  [0.36, 0.26],
  [0.04, 0.26],
  [-0.14, 0.46],
  [0.02, 0.66],
  [0.4, 0.86],
  [0.78, 0.9],
  [1.04, 0.76],
];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (t) => t * t * (3 - 2 * t);

function catmull(points, samples) {
  const out = [];
  const n = points.length;
  for (let s = 0; s < samples; s++) {
    const t = (s / (samples - 1)) * (n - 1);
    const i = Math.min(Math.floor(t), n - 2);
    const f = t - i;
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, n - 1)];
    const f2 = f * f;
    const f3 = f2 * f;
    const c = (a, b, c2, d) =>
      0.5 * (2 * b + (-a + c2) * f + (2 * a - 5 * b + 4 * c2 - d) * f2 + (-a + 3 * b - 3 * c2 + d) * f3);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

export class Visual {
  state = "off";
  alert = null;

  #canvas;
  #ctx;
  #w = 0;
  #h = 0;
  #dpr = 1;
  #t = 0;
  #last = 0;
  #raf = 0;
  #reveal = 0; // 0 = apagado, 1 = interface completa
  #p = { ...STATE_PARAMS.off };
  #color = [...COLORS.green];
  #activity = 0; // nível da fala do usuário
  #voice = 0; // envelope da voz do Drako
  #voiceTarget = 0;
  #particles = [];
  #series = [];
  #bg = null;
  #reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  #lastDraw = 0;
  #glitch = 0;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d");
    for (let i = 0; i < 4; i++) this.#series.push(Array.from({ length: 64 }, () => Math.random()));
    addEventListener("resize", () => this.#resize());
    this.#resize();
  }

  start() {
    if (this.#raf) return;
    this.#last = performance.now();
    const loop = (now) => {
      this.#raf = requestAnimationFrame(loop);
      this.#frame(now);
    };
    this.#raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  setState(state) {
    if (!STATE_PARAMS[state]) return;
    if (state !== this.state && state !== "off" && this.state === "off") this.#glitch = 1;
    this.state = state;
  }

  setAlert(alert) {
    this.alert = alert || null;
  }

  /** Fala do usuário detectada (0..1). */
  activity(level = 1) {
    this.#activity = Math.max(this.#activity, level);
  }

  /** Batida da voz do Drako (limite de palavra). */
  beat() {
    this.#voiceTarget = 1;
  }

  // -------------------------------------------------------------------------

  #resize() {
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#w = innerWidth;
    this.#h = innerHeight;
    this.#canvas.width = Math.round(this.#w * this.#dpr);
    this.#canvas.height = Math.round(this.#h * this.#dpr);
    this.#bg = null;
  }

  #frame(now) {
    const dt = Math.min((now - this.#last) / 1000, 0.1);
    this.#last = now;

    const on = this.state !== "off";
    // Tela preta: desenha bem menos quadros para poupar bateria.
    if (!on && this.#reveal <= 0.001 && now - this.#lastDraw < 90) return;
    this.#lastDraw = now;

    const speed = this.#reduced ? 0.35 : 1;
    this.#t += dt * speed;
    this.#reveal = clamp(this.#reveal + (on ? dt / 1.6 : -dt / 1.1));

    const target = STATE_PARAMS[this.state];
    const k = 1 - Math.exp(-dt * 4);
    for (const key in target) this.#p[key] = lerp(this.#p[key], target[key], k);

    const colorName = ALERT_COLOR[this.alert] && this.alert !== "needs-gesture" ? ALERT_COLOR[this.alert] : "green";
    const tc = COLORS[colorName];
    for (let i = 0; i < 3; i++) this.#color[i] = lerp(this.#color[i], tc[i], 1 - Math.exp(-dt * 3));

    // Envelope da voz: batidas por palavra + oscilação enquanto fala.
    if (this.state === "speaking") {
      const syll = 0.55 + 0.45 * Math.abs(Math.sin(this.#t * 11.3) * Math.sin(this.#t * 4.1 + 1));
      this.#voiceTarget = Math.max(this.#voiceTarget * Math.exp(-dt * 5), syll * 0.8);
    } else {
      this.#voiceTarget *= Math.exp(-dt * 6);
    }
    this.#voice = lerp(this.#voice, this.#voiceTarget, 1 - Math.exp(-dt * 18));
    this.#activity *= Math.exp(-dt * 2.5);
    this.#glitch *= Math.exp(-dt * 3);

    this.#draw(dt);
  }

  #rgba(a, c = this.#color) {
    return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a)})`;
  }

  #draw(dt) {
    const ctx = this.#ctx;
    const w = this.#w;
    const h = this.#h;
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    const r = this.#reveal;
    if (r <= 0.001) {
      this.#drawStandby();
      return;
    }

    const ev = ease(r);
    const flicker = r < 1 ? (Math.random() < 0.35 * (1 - r) ? 0.25 : 1) : 1;
    const portrait = h > w * 1.15;
    const size = Math.min(w * (portrait ? 0.92 : 0.62), h * 0.78);
    const R = size * 0.42;
    const cx = w / 2;
    const cy = portrait ? h * 0.5 : h * 0.49;

    ctx.globalAlpha = ev * flicker;
    this.#drawBackground(cx, cy, R);
    this.#drawProjector(cx, cy, R);
    this.#drawRings(cx, cy, R * lerp(0.75, 1, ev));
    this.#drawDragon(cx, cy, R * 0.92);
    this.#updateParticles(dt, cx, cy, R);
    this.#drawWidgets(cx, cy, R, portrait);
    this.#drawWave(cx, portrait ? h * 0.85 : h * 0.9, Math.min(w * 0.8, 620));
    this.#drawFrame();
    this.#drawAlert(cx, cy + R * 1.18, R);
    ctx.globalAlpha = 1;

    // Pequenas falhas holográficas.
    if (!this.#reduced && (this.#glitch > 0.05 || Math.random() < 0.006)) {
      const slices = 1 + ((Math.random() * 3) | 0);
      for (let i = 0; i < slices; i++) {
        const y = Math.random() * h;
        const sh = 2 + Math.random() * 14;
        const dx = (Math.random() - 0.5) * 24 * (0.4 + this.#glitch);
        ctx.drawImage(
          this.#canvas,
          0,
          y * this.#dpr,
          w * this.#dpr,
          sh * this.#dpr,
          dx,
          y,
          w,
          sh,
        );
      }
    }
  }

  // Tela preta de espera: só um ponto mínimo (ou o ícone do problema).
  #drawStandby() {
    const ctx = this.#ctx;
    const x = this.#w / 2;
    const y = this.#h - Math.max(28, this.#h * 0.05);
    const breathe = 0.5 + 0.5 * Math.sin(this.#t * 1.6);
    if (this.alert === "needs-gesture") {
      // anéis lentos convidando a tocar na tela
      for (let i = 0; i < 3; i++) {
        const ph = (this.#t * 0.35 + i / 3) % 1;
        ctx.strokeStyle = this.#rgba(0.28 * (1 - ph), COLORS.green);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(this.#w / 2, this.#h / 2, 18 + ph * 70, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = this.#rgba(0.35 + 0.25 * breathe, COLORS.green);
      ctx.beginPath();
      ctx.arc(this.#w / 2, this.#h / 2, 4, 0, TAU);
      ctx.fill();
      return;
    }
    if (this.alert) {
      ctx.globalAlpha = 0.45;
      this.#drawAlert(this.#w / 2, y - 12, 120);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = this.#rgba(0.1 + 0.12 * breathe, COLORS.green);
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, TAU);
    ctx.fill();
  }

  #drawBackground(cx, cy, R) {
    const ctx = this.#ctx;
    if (!this.#bg) {
      // grade hexagonal pré-renderizada
      const c = document.createElement("canvas");
      c.width = this.#w * this.#dpr;
      c.height = this.#h * this.#dpr;
      const g = c.getContext("2d");
      g.scale(this.#dpr, this.#dpr);
      const s = Math.max(16, Math.min(this.#w, this.#h) / 26);
      g.strokeStyle = "rgba(255,255,255,1)";
      g.lineWidth = 0.6;
      for (let y = 0, row = 0; y < this.#h + s; y += s * 0.866, row++) {
        for (let x = row % 2 ? s / 2 : 0; x < this.#w + s; x += s) {
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU + Math.PI / 6;
            g.lineTo(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5);
          }
          g.closePath();
          g.stroke();
        }
      }
      this.#bg = c;
    }
    const grad = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 2.2);
    grad.addColorStop(0, this.#rgba(0.16 * this.#p.glow + 0.06 * this.#voice));
    grad.addColorStop(0.5, this.#rgba(0.04));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.#w, this.#h);

    // a grade aparece só em volta, desvanecendo
    ctx.save();
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * 0.05;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(this.#bg, 0, 0, this.#w, this.#h);
    ctx.restore();
    ctx.save();
    const mask = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.4);
    mask.addColorStop(0, "rgba(0,0,0,0.92)");
    mask.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, this.#w, this.#h);
    ctx.restore();
  }

  #drawProjector(cx, cy, R) {
    const ctx = this.#ctx;
    const baseY = cy + R * 1.42;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(0, baseY, 0, cy - R * 0.6);
    g.addColorStop(0, this.#rgba(0.16 + 0.1 * this.#voice));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.32, baseY);
    ctx.lineTo(cx + R * 0.32, baseY);
    ctx.lineTo(cx + R * 1.25, cy - R * 0.6);
    ctx.lineTo(cx - R * 1.25, cy - R * 0.6);
    ctx.closePath();
    ctx.fill();
    // base do projetor
    ctx.strokeStyle = this.#rgba(0.7);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, baseY, R * 0.42, R * 0.06, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = this.#rgba(0.3);
    ctx.beginPath();
    ctx.ellipse(cx, baseY, R * 0.6, R * 0.09, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  #drawRings(cx, cy, R) {
    const ctx = this.#ctx;
    const t = this.#t;
    const p = this.#p;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = "lighter";

    // anel de marcações
    const r1 = R * 1.26;
    ctx.rotate(t * p.ring * 0.6);
    ctx.strokeStyle = this.#rgba(0.22);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r1, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU;
      const len = i % 10 === 0 ? 10 : 4;
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * (r1 + len), Math.sin(a) * (r1 + len));
    }
    ctx.strokeStyle = this.#rgba(0.35);
    ctx.stroke();
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.translate(cx, cy);

    // arcos tracejados em sentido contrário
    const r2 = R * 1.36;
    ctx.rotate(-t * p.ring);
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = this.#rgba(0.55);
      ctx.beginPath();
      ctx.arc(0, 0, r2, (i / 4) * TAU, (i / 4) * TAU + TAU * 0.16);
      ctx.stroke();
    }
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.translate(cx, cy);

    // arco de progresso (pensando) e varredura de radar
    if (p.sweep > 0.02) {
      const r3 = R * 1.18;
      const a = t * 3.2;
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.#rgba(0.85 * p.sweep);
      ctx.beginPath();
      ctx.arc(0, 0, r3, a, a + TAU * (0.15 + 0.1 * Math.sin(t * 2)));
      ctx.stroke();
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = this.#rgba(0.05 * p.sweep * (1 - i / 14));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R * 1.24, -a * 0.7 - i * 0.05, -a * 0.7 - (i + 1) * 0.05, true);
        ctx.closePath();
        ctx.fill();
      }
    }

    // pulso com a voz do Drako
    if (this.#voice > 0.02) {
      ctx.strokeStyle = this.#rgba(0.5 * this.#voice);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, R * (1.1 + 0.08 * this.#voice), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Dragão

  #drawDragon(cx, cy, R) {
    const ctx = this.#ctx;
    const t = this.#t;
    const p = this.#p;
    const glow = p.glow * (0.85 + 0.3 * this.#voice);

    // coluna animada (ondulação suave)
    const pts = SPINE.map(([x, y], i) => {
      const amp = 0.025 + 0.012 * this.#voice;
      return [
        cx + (x + Math.sin(t * 1.1 + i * 0.8) * amp) * R,
        cy + (y + Math.cos(t * 0.9 + i * 0.7) * amp) * R,
      ];
    });
    const N = 280;
    const spine = catmull(pts, N);
    const L = [];
    const Rr = [];
    const width = [];
    const normals = [];
    for (let i = 0; i < N; i++) {
      const a = spine[Math.max(i - 1, 0)];
      const b = spine[Math.min(i + 1, N - 1)];
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const s = i / (N - 1);
      // pescoço mais fino, corpo cheio, cauda afinando
      const prof = s < 0.08 ? lerp(0.62, 0.95, s / 0.08) : s < 0.55 ? 1 : Math.pow(1 - (s - 0.55) / 0.45, 1.25);
      const wv = R * 0.085 * Math.max(prof, 0.03);
      width.push(wv);
      normals.push([nx, ny]);
      L.push([spine[i][0] + nx * wv, spine[i][1] + ny * wv]);
      Rr.push([spine[i][0] - nx * wv, spine[i][1] - ny * wv]);
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // brilho difuso (trechos contínuos para não acumular discos)
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const group = 28;
    for (let g = 0; g < N - 1; g += group) {
      const end = Math.min(g + group, N - 1);
      const wv = width[Math.min(g + (group >> 1), N - 1)];
      ctx.beginPath();
      ctx.moveTo(spine[g][0], spine[g][1]);
      for (let i = g + 1; i <= end; i++) ctx.lineTo(spine[i][0], spine[i][1]);
      ctx.strokeStyle = this.#rgba(0.045 * glow);
      ctx.lineWidth = wv * 4.5;
      ctx.stroke();
      ctx.strokeStyle = this.#rgba(0.05 * glow);
      ctx.lineWidth = wv * 2.8;
      ctx.stroke();
    }
    ctx.restore();

    // corpo em blocos, da cauda para a cabeça (sobreposição correta)
    const chunk = 7;
    for (let end = N - 1; end > 0; end -= chunk) {
      const start = Math.max(0, end - chunk);
      this.#bodyChunk(start, end, L, Rr, spine, width, normals, glow);
      // patas
      const legAt = [0.16, 0.5];
      for (const f of legAt) {
        const li = Math.round(f * (N - 1));
        if (li >= start && li < end) this.#leg(spine[li], normals[li], width[li], glow, f);
      }
    }

    // cabeça
    const h0 = spine[0];
    const h1 = spine[6];
    const ang = Math.atan2(h0[1] - h1[1], h0[0] - h1[0]);
    this.#head(h0[0], h0[1], ang, R * 0.4, glow);
  }

  #bodyChunk(start, end, L, Rr, spine, width, normals, glow) {
    const ctx = this.#ctx;
    ctx.save();
    // preenchimento escuro: esconde o que passa por trás
    ctx.beginPath();
    ctx.moveTo(L[start][0], L[start][1]);
    for (let i = start + 1; i <= end; i++) ctx.lineTo(L[i][0], L[i][1]);
    for (let i = end; i >= start; i--) ctx.lineTo(Rr[i][0], Rr[i][1]);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,8,4,0.94)";
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = this.#rgba(0.07 + 0.08 * glow);
    ctx.fill();

    // contornos
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const [edge, alpha] of [
      [L, 0.95],
      [Rr, 0.7],
    ]) {
      ctx.beginPath();
      ctx.moveTo(edge[start][0], edge[start][1]);
      for (let i = start + 1; i <= end; i++) ctx.lineTo(edge[i][0], edge[i][1]);
      ctx.strokeStyle = this.#rgba(0.18 * glow);
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = this.#rgba(alpha * glow);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // escamas (chevrons) e linha do ventre
    ctx.lineWidth = 1;
    for (let i = start; i <= end; i++) {
      const s = spine[i];
      const n = normals[i];
      const wv = width[i];
      if (i % 4 === 0 && wv > 1.5) {
        const nxt = spine[Math.min(i + 3, spine.length - 1)];
        const fx = (nxt[0] - s[0]) * 0.6;
        const fy = (nxt[1] - s[1]) * 0.6;
        ctx.strokeStyle = this.#rgba(0.45 * glow);
        ctx.beginPath();
        ctx.moveTo(s[0] + n[0] * wv * 0.92, s[1] + n[1] * wv * 0.92);
        ctx.lineTo(s[0] + fx, s[1] + fy);
        ctx.lineTo(s[0] - n[0] * wv * 0.92, s[1] - n[1] * wv * 0.92);
        ctx.stroke();
      }
      // espinhos dorsais
      if (i % 9 === 0 && wv > 2 && i > 6) {
        const nxt = spine[Math.max(i - 4, 0)];
        const bx = s[0] + n[0] * wv;
        const by = s[1] + n[1] * wv;
        const tip = wv * (0.9 + 0.25 * Math.sin(this.#t * 2 + i));
        ctx.strokeStyle = this.#rgba(0.85 * glow);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + n[0] * tip + (nxt[0] - s[0]) * 0.5, by + n[1] * tip + (nxt[1] - s[1]) * 0.5);
        ctx.lineTo(bx + (s[0] - nxt[0]) * 0.4, by + (s[1] - nxt[1]) * 0.4);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    for (let i = start; i <= end; i++) {
      const s = spine[i];
      const n = normals[i];
      const x = s[0] - n[0] * width[i] * 0.45;
      const y = s[1] - n[1] * width[i] * 0.45;
      if (i === start) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = this.#rgba(0.3 * glow);
    ctx.stroke();
    ctx.restore();
  }

  #leg(base, n, wv, glow, f) {
    const ctx = this.#ctx;
    const t = this.#t;
    const sway = Math.sin(t * 1.4 + f * 9) * 0.15;
    const ox = -n[0];
    const oy = -n[1];
    const len = wv * 1.7;
    const kx = base[0] + ox * len + (oy * 0.6 + sway) * len * 0.5;
    const ky = base[1] + oy * len + (-ox * 0.6) * len * 0.5;
    const fx = kx + ox * len * 0.7 - oy * len * 0.5;
    const fy = ky + oy * len * 0.7 + ox * len * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.strokeStyle = this.#rgba(0.2 * glow);
    ctx.lineWidth = wv * 0.9;
    ctx.beginPath();
    ctx.moveTo(base[0], base[1]);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.strokeStyle = this.#rgba(0.85 * glow);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // garras
    for (let c = -1; c <= 1; c++) {
      const a = Math.atan2(fy - ky, fx - kx) + c * 0.55;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(
        fx + Math.cos(a) * wv * 0.7,
        fy + Math.sin(a) * wv * 0.7,
        fx + Math.cos(a + 0.5) * wv * 1.1,
        fy + Math.sin(a + 0.5) * wv * 1.1,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  #head(x, y, ang, s, glow) {
    const ctx = this.#ctx;
    const t = this.#t;
    const jaw = 0.1 + 0.05 * Math.sin(t * 1.3) + 0.32 * this.#voice;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (Math.cos(ang) < 0) ctx.scale(1, -1); // mantém o topo da cabeça para cima
    ctx.scale(s, s);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const lw = 1.4 / s;

    const strokeGlow = (alpha = 1) => {
      ctx.strokeStyle = this.#rgba(0.2 * glow);
      ctx.lineWidth = lw * 4;
      ctx.stroke();
      ctx.strokeStyle = this.#rgba(alpha * glow);
      ctx.lineWidth = lw;
      ctx.stroke();
    };

    // juba (atrás de tudo)
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 9; i++) {
      const a = -2.2 + i * 0.5;
      const wob = Math.sin(t * 2 + i) * 0.06;
      const l = 0.55 + (i % 3) * 0.15;
      ctx.beginPath();
      ctx.moveTo(-0.05, 0);
      ctx.quadraticCurveTo(
        Math.cos(a + Math.PI) * l * 0.5 - 0.1,
        Math.sin(a + Math.PI) * l * 0.5 + wob,
        Math.cos(a + Math.PI + 0.4) * l - 0.15,
        Math.sin(a + Math.PI + 0.4) * l + wob,
      );
      ctx.strokeStyle = this.#rgba(0.45 * glow);
      ctx.lineWidth = lw;
      ctx.stroke();
    }

    // chifres
    for (const [ox, len, alpha] of [
      [0.12, 1, 1],
      [0.02, 0.8, 0.6],
    ]) {
      ctx.beginPath();
      ctx.moveTo(ox + 0.18, -0.26);
      ctx.bezierCurveTo(-0.1, -0.5 * len, -0.45 * len, -0.62 * len, -0.75 * len, -0.5 * len);
      ctx.bezierCurveTo(-0.45 * len, -0.5 * len, -0.15, -0.38, ox + 0.05, -0.22);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0,8,4,0.9)";
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      strokeGlow(alpha);
    }

    // mandíbula inferior (abre com a voz)
    ctx.save();
    ctx.translate(0.3, 0.06);
    ctx.rotate(jaw);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0.62, 0.02);
    ctx.lineTo(0.6, 0.1);
    ctx.quadraticCurveTo(0.3, 0.22, -0.18, 0.2);
    ctx.closePath();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,8,4,0.95)";
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = this.#rgba(0.12 * glow);
    ctx.fill();
    strokeGlow(0.9);
    // dentes de baixo
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const tx = 0.1 + i * 0.1;
      ctx.moveTo(tx, 0.02);
      ctx.lineTo(tx + 0.025, -0.05);
      ctx.lineTo(tx + 0.05, 0.02);
    }
    ctx.strokeStyle = this.#rgba(0.8 * glow);
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();
    ctx.restore();

    // brilho dentro da boca
    if (jaw > 0.15) {
      const g = ctx.createRadialGradient(0.55, 0.12, 0, 0.55, 0.12, 0.3);
      g.addColorStop(0, this.#rgba(0.5 * this.#voice * glow));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0.2, -0.2, 0.7, 0.6);
    }

    // crânio e focinho
    ctx.beginPath();
    ctx.moveTo(-0.12, 0.12);
    ctx.quadraticCurveTo(-0.15, -0.2, 0.12, -0.3);
    ctx.quadraticCurveTo(0.35, -0.36, 0.5, -0.24);
    ctx.quadraticCurveTo(0.7, -0.2, 0.92, -0.14);
    ctx.quadraticCurveTo(1.04, -0.1, 1.0, -0.02);
    ctx.lineTo(0.94, 0.05);
    ctx.lineTo(0.3, 0.07);
    ctx.quadraticCurveTo(0.1, 0.16, -0.12, 0.12);
    ctx.closePath();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,8,4,0.95)";
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = this.#rgba(0.14 * glow);
    ctx.fill();
    strokeGlow(1);

    // dentes de cima
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const tx = 0.36 + i * 0.09;
      ctx.moveTo(tx, 0.065);
      ctx.lineTo(tx + 0.02, 0.13);
      ctx.lineTo(tx + 0.045, 0.06);
    }
    ctx.strokeStyle = this.#rgba(0.85 * glow);
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();

    // detalhes: sobrancelha, narina, bochecha
    ctx.beginPath();
    ctx.moveTo(0.22, -0.27);
    ctx.quadraticCurveTo(0.42, -0.34, 0.6, -0.2);
    ctx.moveTo(0.86, -0.1);
    ctx.lineTo(0.93, -0.08);
    ctx.moveTo(0.05, -0.05);
    ctx.quadraticCurveTo(0.2, 0.02, 0.28, -0.1);
    ctx.moveTo(-0.02, 0.05);
    ctx.lineTo(0.12, -0.18);
    ctx.strokeStyle = this.#rgba(0.6 * glow);
    ctx.lineWidth = lw * 0.9;
    ctx.stroke();

    // olho
    const eye = this.#p.eye * (0.85 + 0.15 * Math.sin(t * 3));
    ctx.save();
    ctx.shadowColor = this.#rgba(1);
    ctx.shadowBlur = 18 * eye;
    ctx.beginPath();
    ctx.moveTo(0.32, -0.17);
    ctx.quadraticCurveTo(0.42, -0.25, 0.52, -0.18);
    ctx.quadraticCurveTo(0.42, -0.13, 0.32, -0.17);
    ctx.fillStyle = `rgba(220,255,235,${clamp(eye)})`;
    ctx.fill();
    ctx.restore();

    // bigodes longos
    for (const [sx, sy, dir] of [
      [0.95, -0.03, 1],
      [0.8, 0.0, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      const w1 = Math.sin(t * 1.7 + dir) * 0.12;
      const w2 = Math.sin(t * 1.3 + dir * 2) * 0.2;
      ctx.bezierCurveTo(1.25, 0.25 + w1, 0.6, 0.6 + w2 * dir, 0.1 + w2, 0.9 + w1);
      ctx.strokeStyle = this.#rgba(0.6 * glow);
      ctx.lineWidth = lw * 0.9;
      ctx.stroke();
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------

  #updateParticles(dt, cx, cy, R) {
    const ctx = this.#ctx;
    const max = this.#w < 600 ? 90 : 160;
    const rate = (8 + 50 * this.#p.particles + 50 * this.#voice) * dt;
    for (let i = 0; i < rate && this.#particles.length < max; i++) {
      const a = Math.random() * TAU;
      const d = R * (0.3 + Math.random() * 0.9);
      this.#particles.push({
        x: cx + Math.cos(a) * d,
        y: cy + Math.sin(a) * d * 0.95,
        vx: (Math.random() - 0.5) * 14,
        vy: -8 - Math.random() * 26,
        life: 1,
        decay: 0.25 + Math.random() * 0.5,
        size: 0.6 + Math.random() * 1.8,
      });
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const thinking = this.#p.sweep;
    this.#particles = this.#particles.filter((p) => {
      p.life -= p.decay * dt;
      if (p.life <= 0) return false;
      if (thinking > 0.1) {
        // espiral em direção ao centro enquanto pensa
        const dx = cx - p.x;
        const dy = cy - p.y;
        p.vx += (dx * 0.6 - dy * 1.2) * dt * thinking;
        p.vy += (dy * 0.6 + dx * 1.2) * dt * thinking;
        p.vx *= 0.96;
        p.vy *= 0.96;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.fillStyle = this.#rgba(p.life * 0.9);
      ctx.fillRect(p.x, p.y, p.size, p.size);
      return true;
    });
    ctx.restore();
  }

  #drawWidgets(cx, cy, R, portrait) {
    const ctx = this.#ctx;
    const w = this.#w;
    const h = this.#h;
    const t = this.#t;
    // rola as séries de dados
    if (Math.random() < 0.25 + this.#p.sweep * 0.5) {
      for (const s of this.#series) {
        s.shift();
        const last = s.at(-1);
        s.push(clamp(last + (Math.random() - 0.5) * 0.35 + (0.5 - last) * 0.08));
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    if (portrait) {
      const top = Math.max(28, h * 0.06);
      const g = Math.min(w * 0.075, 40);
      this.#gauge(30 + g, top + g, g, 0.55 + 0.35 * Math.sin(t * 0.7));
      this.#gauge(w - 30 - g, top + g, g, 0.5 + 0.4 * Math.sin(t * 0.5 + 2));
      this.#graph(w / 2 - w * 0.22, top, w * 0.44, g * 2, this.#series[0]);
    } else {
      const pw = Math.min(w * 0.18, 260);
      const left = Math.max(24, cx - R * 1.6 - pw);
      const right = Math.min(w - 24 - pw, cx + R * 1.6);
      if (left > 8) {
        this.#panel(left, cy - R * 1.1, pw, R * 0.95);
        this.#gauge(left + pw * 0.28, cy - R * 0.8, pw * 0.17, 0.6 + 0.3 * Math.sin(t * 0.6));
        this.#gauge(left + pw * 0.72, cy - R * 0.8, pw * 0.17, 0.4 + 0.4 * Math.sin(t * 0.4 + 1));
        this.#bars(left + pw * 0.1, cy - R * 0.45, pw * 0.8, this.#series[1]);
        this.#panel(left, cy + R * 0.0, pw, R * 0.9);
        this.#graph(left + pw * 0.06, cy + R * 0.12, pw * 0.88, R * 0.42, this.#series[2]);
        this.#hexes(left + pw * 0.2, cy + R * 0.72, pw * 0.07);
      }
      if (right < w - 8) {
        this.#panel(right, cy - R * 1.1, pw, R * 0.95);
        this.#radar(right + pw / 2, cy - R * 0.62, Math.min(pw * 0.32, R * 0.36));
        this.#panel(right, cy + R * 0.0, pw, R * 0.9);
        this.#analyzer(right + pw / 2, cy + R * 0.45, Math.min(pw * 0.3, R * 0.34));
      }
    }
    ctx.restore();
  }

  #panel(x, y, w, h) {
    const ctx = this.#ctx;
    ctx.strokeStyle = this.#rgba(0.25);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = this.#rgba(0.7);
    ctx.lineWidth = 2;
    const c = 10;
    ctx.beginPath();
    ctx.moveTo(x, y + c);
    ctx.lineTo(x, y);
    ctx.lineTo(x + c, y);
    ctx.moveTo(x + w - c, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - c);
    ctx.stroke();
    ctx.fillStyle = this.#rgba(0.025);
    ctx.fillRect(x, y, w, h);
  }

  #gauge(x, y, r, v) {
    const ctx = this.#ctx;
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = this.#rgba(0.15);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = this.#rgba(0.8);
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(v));
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.#rgba(0.35);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.62, this.#t, this.#t + TAU * 0.6);
    ctx.stroke();
    ctx.fillStyle = this.#rgba(0.6 + 0.4 * this.#voice);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.12, 0, TAU);
    ctx.fill();
  }

  #graph(x, y, w, h, data) {
    const ctx = this.#ctx;
    ctx.beginPath();
    data.forEach((v, i) => {
      const px = x + (i / (data.length - 1)) * w;
      const py = y + h - v * h;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.strokeStyle = this.#rgba(0.75);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, this.#rgba(0.25));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = this.#rgba(0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo(x, y + (h * i) / 4);
      ctx.lineTo(x + w, y + (h * i) / 4);
    }
    ctx.stroke();
  }

  #bars(x, y, w, data) {
    const ctx = this.#ctx;
    for (let i = 0; i < 3; i++) {
      const by = y + i * 16;
      ctx.strokeStyle = this.#rgba(0.4);
      ctx.lineWidth = 1;
      ctx.strokeRect(x, by, w, 7);
      ctx.fillStyle = this.#rgba(0.75);
      ctx.fillRect(x + 1, by + 1, (w - 2) * (0.3 + 0.65 * data[data.length - 1 - i * 9]), 5);
    }
  }

  #hexes(x, y, s) {
    const ctx = this.#ctx;
    for (let i = 0; i < 7; i++) {
      const hx = x + (i % 4) * s * 1.8 + ((i / 4) | 0) * s * 0.9;
      const hy = y + ((i / 4) | 0) * s * 1.55;
      const on = Math.sin(this.#t * 2 + i * 1.7) > 0.3;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + Math.PI / 6;
        ctx.lineTo(hx + Math.cos(a) * s, hy + Math.sin(a) * s);
      }
      ctx.closePath();
      ctx.strokeStyle = this.#rgba(0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (on) {
        ctx.fillStyle = this.#rgba(0.3);
        ctx.fill();
      }
    }
  }

  #radar(x, y, r) {
    const ctx = this.#ctx;
    ctx.strokeStyle = this.#rgba(0.4);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(x, y, (r * i) / 3, 0, TAU);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.strokeStyle = this.#rgba(0.2);
    ctx.stroke();
    const a = this.#t * (1.2 + 3 * this.#p.sweep);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = this.#rgba(0.12 * (1 - i / 10));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, a - i * 0.07, a - (i + 1) * 0.07, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = this.#rgba(0.9);
    const bx = x + Math.cos(a * 0.3) * r * 0.5;
    const by = y + Math.sin(a * 0.45) * r * 0.4;
    ctx.fillRect(bx - 2, by - 2, 4, 4);
  }

  #analyzer(x, y, r) {
    const ctx = this.#ctx;
    ctx.strokeStyle = this.#rgba(0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    const level = Math.max(this.#voice, this.#activity * 0.8, 0.06);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const px = x - r * 0.8 + (i / 48) * r * 1.6;
      const env = Math.sin((i / 48) * Math.PI);
      const py = y + Math.sin(i * 0.9 + this.#t * 14) * Math.sin(i * 0.37 + this.#t * 5) * r * 0.55 * level * env;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.strokeStyle = this.#rgba(0.9);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  #drawWave(cx, y, width) {
    const ctx = this.#ctx;
    const n = 48;
    const level = clamp(this.#p.wave * 0.15 + this.#voice * 0.9 + this.#activity * 0.8);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const bw = width / n;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(i - (n - 1) / 2) / (n / 2);
      const env = Math.pow(1 - d, 1.4);
      const noise = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + this.#t * 9) * Math.sin(i * 0.53 + this.#t * 3.3));
      const hh = 2 + env * noise * level * 46;
      ctx.fillStyle = this.#rgba(0.25 + 0.6 * env);
      ctx.fillRect(cx - width / 2 + i * bw + bw * 0.2, y - hh / 2, bw * 0.6, hh);
    }
    ctx.restore();
  }

  #drawFrame() {
    const ctx = this.#ctx;
    const w = this.#w;
    const h = this.#h;
    const m = 12;
    const c = Math.min(w, h) * 0.08;
    ctx.save();
    ctx.strokeStyle = this.#rgba(0.5);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [
      [m, m, 1, 1],
      [w - m, m, -1, 1],
      [m, h - m, 1, -1],
      [w - m, h - m, -1, -1],
    ]) {
      ctx.moveTo(x, y + sy * c);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * c, y);
    }
    ctx.stroke();
    // barra superior estilizada
    ctx.strokeStyle = this.#rgba(0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 - c * 1.6, m + 4);
    ctx.lineTo(w / 2 - c * 1.2, m + 10);
    ctx.lineTo(w / 2 + c * 1.2, m + 10);
    ctx.lineTo(w / 2 + c * 1.6, m + 4);
    ctx.stroke();
    ctx.restore();
  }

  // Ícones (sem texto) para os problemas.
  #drawAlert(x, y, R) {
    const a = this.alert;
    if (!a || a === "needs-gesture") return;
    const ctx = this.#ctx;
    const s = Math.max(14, Math.min(R * 0.12, 26));
    const pulse = 0.6 + 0.4 * Math.sin(this.#t * 4);
    const col = COLORS[ALERT_COLOR[a] || "amber"];
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = this.#rgba(0.95 * pulse, col);
    ctx.fillStyle = this.#rgba(0.95 * pulse, col);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.6, 0, TAU);
    ctx.globalAlpha *= 0.6;
    ctx.stroke();
    ctx.globalAlpha /= 0.6;
    ctx.beginPath();
    let slash = true;
    if (a === "mic-denied" || a === "mic-failure" || a === "speech-unavailable") {
      // microfone
      ctx.roundRect ? ctx.roundRect(-s * 0.3, -s * 0.8, s * 0.6, s * 1.05, s * 0.3) : ctx.rect(-s * 0.3, -s * 0.8, s * 0.6, s * 1.05);
      ctx.moveTo(-s * 0.55, -s * 0.05);
      ctx.quadraticCurveTo(-s * 0.55, s * 0.55, 0, s * 0.55);
      ctx.quadraticCurveTo(s * 0.55, s * 0.55, s * 0.55, -s * 0.05);
      ctx.moveTo(0, s * 0.55);
      ctx.lineTo(0, s * 0.85);
    } else if (a === "network" || a === "offline") {
      // ondas de conexão
      for (let i = 1; i <= 3; i++) {
        ctx.moveTo(Math.cos(-2.4) * s * 0.33 * i, s * 0.5 + Math.sin(-2.4) * s * 0.33 * i);
        ctx.arc(0, s * 0.5, s * 0.33 * i, -2.4, -0.74);
      }
      ctx.moveTo(s * 0.08, s * 0.5);
      ctx.arc(0, s * 0.5, s * 0.08, 0, TAU);
    } else if (a === "unauthorized") {
      // cadeado
      ctx.rect(-s * 0.55, -s * 0.1, s * 1.1, s * 0.85);
      ctx.moveTo(-s * 0.35, -s * 0.1);
      ctx.arc(0, -s * 0.35, s * 0.35, Math.PI, 0);
      ctx.lineTo(s * 0.35, -s * 0.1);
    } else if (a === "unconfigured" || a === "server") {
      // nó de rede desconectado
      ctx.arc(-s * 0.5, s * 0.2, s * 0.22, 0, TAU);
      ctx.moveTo(s * 0.72, -s * 0.2);
      ctx.arc(s * 0.5, -s * 0.2, s * 0.22, 0, TAU);
      ctx.moveTo(-s * 0.28, s * 0.1);
      ctx.lineTo(-s * 0.05, 0);
      ctx.moveTo(s * 0.05, -s * 0.05);
      ctx.lineTo(s * 0.28, -s * 0.12);
    } else if (a === "confirm") {
      // escudo
      slash = false;
      ctx.moveTo(0, -s * 0.85);
      ctx.lineTo(s * 0.7, -s * 0.55);
      ctx.quadraticCurveTo(s * 0.65, s * 0.45, 0, s * 0.85);
      ctx.quadraticCurveTo(-s * 0.65, s * 0.45, -s * 0.7, -s * 0.55);
      ctx.closePath();
      ctx.moveTo(-s * 0.28, 0);
      ctx.lineTo(-s * 0.05, s * 0.22);
      ctx.lineTo(s * 0.3, -s * 0.2);
    }
    ctx.stroke();
    if (slash) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.85, -s * 0.85);
      ctx.lineTo(s * 0.85, s * 0.85);
      ctx.stroke();
    }
    ctx.restore();
  }
}
