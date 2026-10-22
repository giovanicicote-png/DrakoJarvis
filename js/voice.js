// Motor de voz do Drako: escuta contínua (SpeechRecognition) e fala
// (speechSynthesis), com reinício automático e proteção contra eco.

import { normalize, splitForSpeech, similarity, detectWake } from "./phrases.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const recognitionSupported = Boolean(SR);
export const synthesisSupported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

const isIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Pequeno emissor de eventos. */
class Emitter {
  #handlers = new Map();
  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return this;
  }
  emit(type, data) {
    for (const fn of this.#handlers.get(type) || []) fn(data);
  }
}

/**
 * Escuta contínua.
 *  - modo "wake": procura "Olá Drako" em resultados parciais (resposta rápida).
 *  - modo "command": junta a fala até um silêncio e emite "utterance".
 *
 * Eventos: wake {rest}, utterance text, activity, error {kind, fatal}, ok, state
 */
export class Listener extends Emitter {
  mode = "wake";
  #rec = null;
  #wanted = false; // deve estar ouvindo?
  #paused = false; // pausado enquanto o Drako fala
  #running = false;
  #blocked = null; // erro que exige ação do usuário (permissão)
  #restartTimer = 0;
  #silenceTimer = 0;
  #failures = 0;
  #transcript = "";
  #emitted = false;
  #ignoreUntil = 0;
  #startedAt = 0;

  silenceMs = 1300;

  get blocked() {
    return this.#blocked;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.#resetBuffer();
    this.#cycle(); // reinicia para limpar o buffer do reconhecedor
  }

  start() {
    this.#wanted = true;
    this.#paused = false;
    this.#ensure();
  }

  stop() {
    this.#wanted = false;
    this.#halt();
  }

  /** Para de ouvir (ex.: enquanto o Drako fala). */
  pause() {
    this.#paused = true;
    this.#halt();
  }

  /** Volta a ouvir, descartando o que for captado nos próximos `guardMs`. */
  resume(guardMs = 0) {
    this.#paused = false;
    this.#ignoreUntil = performance.now() + guardMs;
    this.#ensure();
  }

  /** Chamado após um toque do usuário: libera bloqueios de permissão. */
  retryAfterGesture() {
    this.#blocked = null;
    this.#failures = 0;
    if (this.#wanted && !this.#paused) {
      // Inicia dentro do próprio toque: o Safari exige um gesto do usuário.
      this.#halt();
      this.#begin();
    }
  }

  #resetBuffer() {
    clearTimeout(this.#silenceTimer);
    this.#transcript = "";
    this.#emitted = false;
  }

  #halt() {
    clearTimeout(this.#restartTimer);
    this.#resetBuffer();
    if (this.#rec) {
      const rec = this.#rec;
      this.#rec = null;
      rec.onresult = rec.onerror = rec.onend = rec.onstart = rec.onspeechstart = null;
      try {
        rec.abort();
      } catch {}
    }
    this.#running = false;
  }

  #cycle() {
    if (!this.#running) return;
    this.#halt();
    this.#ensure();
  }

  #ensure() {
    if (!SR || !this.#wanted || this.#paused || this.#blocked || this.#running) return;
    clearTimeout(this.#restartTimer);
    const delay = this.#failures ? Math.min(250 * 2 ** (this.#failures - 1), 8000) : 0;
    this.#restartTimer = setTimeout(() => this.#begin(), delay);
  }

  #begin() {
    if (!this.#wanted || this.#paused || this.#blocked || this.#running) return;
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.#startedAt = performance.now();
      this.emit("state", "listening");
    };
    rec.onspeechstart = () => this.emit("activity", 0.6);
    rec.onresult = (e) => this.#onResult(e);
    rec.onerror = (e) => this.#onError(e.error);
    rec.onend = () => {
      if (this.#rec !== rec) return;
      this.#rec = null;
      this.#running = false;
      // Se a sessão terminou com fala pendente, entrega o que tiver.
      if (this.mode === "command" && this.#transcript && !this.#emitted) this.#flush();
      // Sessões que terminam logo após começar indicam problema (ex.: iOS sem Siri).
      if (performance.now() - this.#startedAt < 400) this.#failures++;
      this.#ensure();
    };

    this.#rec = rec;
    this.#running = true;
    this.#resetBuffer();
    try {
      rec.start();
    } catch (err) {
      this.#rec = null;
      this.#running = false;
      this.#failures++;
      this.#ensure();
    }
  }

  #onResult(e) {
    if (performance.now() < this.#ignoreUntil) return;
    if (this.#failures) {
      this.#failures = 0;
      this.emit("ok");
    }
    // Junta todos os trechos; o Safari às vezes repete o trecho anterior como prefixo.
    const parts = [];
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (!t) continue;
      const prev = parts.at(-1);
      if (prev && normalize(t).startsWith(normalize(prev))) parts[parts.length - 1] = t;
      else parts.push(t);
    }
    const text = parts.join(" ").trim();
    if (!text || text === this.#transcript) return;
    this.#transcript = text;
    this.emit("activity", 1);

    if (this.mode === "wake") {
      const wake = detectWake(text);
      if (wake && !this.#emitted) {
        this.#emitted = true;
        // espera um instante para capturar um pedido que venha junto
        clearTimeout(this.#silenceTimer);
        this.#silenceTimer = setTimeout(() => {
          const final = detectWake(this.#transcript) || wake || { rest: "" };
          this.#halt();
          this.emit("wake", final);
          this.#ensure();
        }, wake.rest ? this.silenceMs : 500);
      } else if (this.#emitted) {
        clearTimeout(this.#silenceTimer);
        this.#silenceTimer = setTimeout(() => {
          const final = detectWake(this.#transcript) || wake || { rest: "" };
          this.#halt();
          this.emit("wake", final);
          this.#ensure();
        }, this.silenceMs);
      } else if (text.length > 160) {
        // conversa longa sem ativação: reinicia para não acumular
        this.#cycle();
      }
      return;
    }

    clearTimeout(this.#silenceTimer);
    this.#silenceTimer = setTimeout(() => this.#flush(), this.silenceMs);
  }

  #flush() {
    clearTimeout(this.#silenceTimer);
    const text = this.#transcript.trim();
    if (!text || this.#emitted) return;
    this.#emitted = true;
    // Reinicia a sessão para que a próxima fala comece com o buffer limpo.
    this.#halt();
    this.emit("utterance", text);
    this.#ensure();
  }

  #onError(code) {
    switch (code) {
      case "no-speech":
      case "aborted":
        return; // normal; onend reinicia
      case "not-allowed": {
        const hasGesture = navigator.userActivation ? navigator.userActivation.hasBeenActive : false;
        this.#blocked = hasGesture ? "mic-denied" : "needs-gesture";
        this.emit("error", { kind: this.#blocked, fatal: true });
        return;
      }
      case "service-not-allowed":
        this.#blocked = "speech-unavailable";
        this.emit("error", { kind: this.#blocked, fatal: true });
        return;
      case "audio-capture":
        this.#failures++;
        this.emit("error", { kind: "mic-failure", fatal: false });
        return;
      case "network":
        this.#failures++;
        this.emit("error", { kind: "network", fatal: false });
        return;
      case "language-not-supported":
        this.#blocked = "speech-unavailable";
        this.emit("error", { kind: this.#blocked, fatal: true });
        return;
      default:
        this.#failures++;
        this.emit("error", { kind: "speech-error", fatal: false });
    }
  }
}

/**
 * Fala do Drako. Eventos: start, boundary, end.
 */
export class Speaker extends Emitter {
  #voice = null;
  #unlocked = false;
  #token = 0;
  speaking = false;
  lastSpoken = "";

  constructor() {
    super();
    if (!synthesisSupported) return;
    const pick = () => (this.#voice = pickVoice(speechSynthesis.getVoices()));
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  get unlocked() {
    return this.#unlocked;
  }

  /** Precisa ser chamado dentro de um toque/clique (exigência do iOS e do Chrome). */
  unlock() {
    if (!synthesisSupported || this.#unlocked) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      u.lang = "pt-BR";
      speechSynthesis.speak(u);
      this.#unlocked = true;
    } catch {}
  }

  cancel() {
    this.#token++;
    if (synthesisSupported) speechSynthesis.cancel();
    if (this.speaking) {
      this.speaking = false;
      this.emit("end");
    }
  }

  /** Fala o texto inteiro; resolve quando terminar (ou for cancelado). */
  async say(text) {
    if (!synthesisSupported || !text) return;
    const token = ++this.#token;
    speechSynthesis.cancel();
    this.lastSpoken = text;
    this.speaking = true;
    this.emit("start");
    try {
      for (const chunk of splitForSpeech(text)) {
        if (token !== this.#token) return;
        await this.#speakChunk(chunk, token);
      }
    } finally {
      if (token === this.#token) {
        this.speaking = false;
        this.emit("end");
      }
    }
  }

  /** O texto captado parece ser a própria voz do Drako? */
  isEcho(heard) {
    return this.lastSpoken && similarity(heard, this.lastSpoken) >= 0.7;
  }

  #speakChunk(text, token) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-BR";
      if (this.#voice) u.voice = this.#voice;
      u.rate = isIOS ? 1.02 : 1.0;
      u.pitch = 0.82;
      u.volume = 1;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        resolve();
      };
      // Alguns navegadores não disparam "end"; o vigia evita travar a conversa.
      const watchdog = setTimeout(finish, 4000 + text.length * 110);
      u.onend = finish;
      u.onerror = finish;
      u.onboundary = () => this.emit("boundary");
      if (token !== this.#token) return finish();
      speechSynthesis.speak(u);
      // Chrome às vezes fica pausado após um tempo em segundo plano.
      if (speechSynthesis.paused) speechSynthesis.resume();
    });
  }
}

const PREFERRED = ["antonio", "felipe", "daniel", "thiago", "google portugues do brasil", "francisca", "luciana"];

function pickVoice(voices) {
  const pt = voices.filter((v) => /^pt[-_]br/i.test(v.lang));
  const pool = pt.length ? pt : voices.filter((v) => /^pt/i.test(v.lang));
  if (!pool.length) return null;
  for (const name of PREFERRED) {
    const v = pool.find((x) => normalize(x.name).includes(name));
    if (v) return v;
  }
  return pool.find((v) => v.localService) || pool[0];
}
