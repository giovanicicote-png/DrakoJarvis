// Drako — controlador principal.
//
// standby (tela preta, esperando "Olá Drako")
//   -> ativo: "Olá, senhor." -> ouvir -> pensar (Claude) -> falar -> ouvir ...
//   -> "Drako até mais": "Até mais, senhor." -> standby

import { Visual } from "./visual.js";
import { Listener, Speaker, recognitionSupported, synthesisSupported } from "./voice.js";
import { Brain, BrainError, ERROR_SPEECH, absorbHashConfig, apiUrl } from "./brain.js";
import { isSleepCommand, isOnlyWake, classifyConfirmation } from "./phrases.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // volta à espera após 10 min sem falar
const ECHO_GUARD_MS = 450; // ignora o microfone logo após o Drako falar

absorbHashConfig();

const visual = new Visual(document.getElementById("scene"));
const listener = new Listener();
const speaker = new Speaker();
const brain = new Brain();

let mode = "standby"; // standby | active
let busy = false; // pensando
let talking = false;
let listenerAlert = null;
let netAlert = navigator.onLine === false ? "offline" : null;
let brainAlert = null;
let gestureSeen = Boolean(navigator.userActivation?.hasBeenActive);
let idleTimer = 0;
let hearTimer = 0;
let wakeLock = null;
const spokenOnce = new Set();

visual.start();
boot();

function boot() {
  if (!recognitionSupported) {
    listenerAlert = "speech-unavailable";
    refresh();
    return;
  }
  listener.setMode("wake");
  listener.start();
  refresh();
  if (apiUrl()) checkServer();
}

// ---------------------------------------------------------------------------
// Estado visual

function refresh() {
  let alert = listenerAlert || netAlert;
  if (!alert && !gestureSeen) alert = "needs-gesture";
  if (mode === "active" && !alert) alert = brainAlert || (brain.pending ? "confirm" : null);
  visual.setAlert(alert);

  if (mode === "standby" && !talking) visual.setState("off");
  else if (talking) visual.setState("speaking");
  else if (busy) visual.setState("thinking");
  else visual.setState("listening");

  document.body.classList.toggle("active", mode === "active" || talking);
}

// ---------------------------------------------------------------------------
// Eventos de voz

listener.on("wake", ({ rest }) => {
  if (mode === "standby" && !talking) activate(rest);
});

listener.on("utterance", (text) => {
  if (mode === "active") handleUtterance(text);
});

listener.on("activity", (level) => {
  if (mode !== "active") return;
  visual.activity(level);
  touchIdle();
  if (!busy && !talking) {
    visual.setState("hearing");
    clearTimeout(hearTimer);
    hearTimer = setTimeout(refresh, 900);
  }
});

listener.on("error", ({ kind }) => {
  listenerAlert = kind === "needs-gesture" ? null : kind;
  if (kind === "needs-gesture") gestureSeen = false;
  refresh();
  if (mode === "active" && !spokenOnce.has(kind)) {
    const msg = {
      network: "Perdi a conexão do reconhecimento de voz, senhor. Vou continuar tentando.",
      "mic-failure": "Não estou conseguindo usar o microfone, senhor.",
      "mic-denied": "Não tenho permissão para usar o microfone, senhor.",
      "speech-unavailable": "O reconhecimento de voz não está disponível neste aparelho, senhor.",
    }[kind];
    if (msg) {
      spokenOnce.add(kind);
      say(msg);
    }
  }
});

listener.on("ok", () => {
  listenerAlert = null;
  refresh();
});

// ---------------------------------------------------------------------------
// Fluxo da conversa

async function activate(rest = "") {
  mode = "active";
  brain.reset();
  brainAlert = null;
  spokenOnce.clear();
  listener.setMode("command");
  touchIdle();
  refresh();
  await say("Olá, senhor.");
  if (rest && mode === "active") handleUtterance(rest);
}

async function deactivate(silent = false) {
  brain.abort();
  clearTimeout(idleTimer);
  mode = "standby";
  busy = false;
  listener.setMode("wake");
  if (!silent) await say("Até mais, senhor.");
  brain.reset();
  brainAlert = null;
  refresh();
}

async function handleUtterance(text) {
  if (speaker.isEcho(text)) return; // a própria voz voltando pelo microfone
  touchIdle();

  if (isSleepCommand(text)) {
    await deactivate();
    return;
  }
  if (busy || talking) return;
  if (isOnlyWake(text)) {
    await say("Olá, senhor.");
    return;
  }

  let request;
  if (brain.pending) {
    const answer = classifyConfirmation(text);
    if (answer === "unclear") {
      await say("Não entendi, senhor. Responda apenas sim ou não.");
      return;
    }
    request = () => brain.confirm(answer === "yes");
  } else {
    request = () => brain.ask(text);
  }

  busy = true;
  refresh();
  let speech = "";
  try {
    speech = (await request()) || "Certo, senhor.";
    brainAlert = null;
  } catch (err) {
    if (err instanceof BrainError && err.kind === "aborted") return;
    const kind = err instanceof BrainError ? err.kind : "server";
    brainAlert = {
      "not-configured": "unconfigured",
      "server-not-configured": "unconfigured",
      unauthorized: "unauthorized",
      origin: "unauthorized",
      "upstream-auth": "unauthorized",
      "not-logged-in": "unconfigured",
      "claude-missing": "unconfigured",
      "usage-limit": "server",
      timeout: "server",
      offline: "offline",
      unreachable: "network",
    }[kind] || "server";
    speech = ERROR_SPEECH[kind] || ERROR_SPEECH.server;
  } finally {
    busy = false;
  }
  if (mode !== "active") return;
  refresh();
  await say(speech);
}

/** Fala sem escutar a si mesmo: pausa o microfone e retoma depois. */
async function say(text) {
  if (!synthesisSupported || !text) return;
  talking = true;
  listener.pause();
  refresh();
  try {
    await speaker.say(text);
  } finally {
    talking = false;
    listener.resume(ECHO_GUARD_MS);
    refresh();
  }
}

speaker.on("boundary", () => visual.beat());

function touchIdle() {
  clearTimeout(idleTimer);
  if (mode === "active") idleTimer = setTimeout(() => deactivate(true), IDLE_TIMEOUT_MS);
}

async function checkServer() {
  try {
    const key = localStorage.getItem("drako.accessKey");
    const res = await fetch(`${apiUrl()}/health`, { headers: key ? { "X-Drako-Key": key } : {} });
    const data = await res.json();
    if (!data.configured) brainAlert = "unconfigured";
    else if (!data.authorized) brainAlert = "unauthorized";
  } catch {
    // sem conexão agora; o erro aparece de verdade no primeiro pedido
  }
  refresh();
}

// ---------------------------------------------------------------------------
// Navegador: toque inicial, tela ligada, rede e segundo plano

function onGesture() {
  speaker.unlock(); // iOS/Chrome só liberam a voz após um toque
  const hadBlock = listener.blocked;
  gestureSeen = true;
  if (hadBlock) listenerAlert = null;
  if (recognitionSupported) listener.retryAfterGesture();
  requestWakeLock();
  refresh();
  if (!recognitionSupported && !spokenOnce.has("unsupported")) {
    spokenOnce.add("unsupported");
    say(
      "Este navegador não oferece reconhecimento de voz. No iPhone use o Safari; no computador use o Chrome, o Edge ou o Safari.",
    );
  } else if (hadBlock === "mic-denied" && !spokenOnce.has("mic-denied")) {
    spokenOnce.add("mic-denied");
    say("Senhor, preciso de permissão para usar o microfone. Libere o acesso nos ajustes do navegador.");
  } else if (hadBlock === "speech-unavailable" && !spokenOnce.has("speech-unavailable")) {
    spokenOnce.add("speech-unavailable");
    say("Senhor, o reconhecimento de voz está desativado. No iPhone, ative a Siri e o Ditado nos Ajustes.");
  }
}

for (const type of ["pointerdown", "touchend", "keydown"]) {
  addEventListener(type, onGesture, { capture: true, passive: true });
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => (wakeLock = null));
  } catch {
    // não suportado ou negado: a tela pode apagar e o iPhone bloquear
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    // iOS suspende a página em segundo plano; para tudo de forma limpa.
    listener.stop();
    speaker.cancel();
    brain.abort();
  } else if (recognitionSupported) {
    listener.start();
    requestWakeLock();
  }
  refresh();
});

addEventListener("online", () => {
  netAlert = null;
  refresh();
});
addEventListener("offline", () => {
  netAlert = "offline";
  refresh();
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// Acesso para depuração pelo console do navegador.
window.drako = { visual, listener, speaker, brain, activate, deactivate };
