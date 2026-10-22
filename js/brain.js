// Cliente do cérebro do Drako. Funciona com os dois backends:
//  - ponte local (bridge/), que usa o Claude Code da sua assinatura;
//  - Cloudflare Worker (worker/), que usa a API da Anthropic.
// Nunca contém chaves secretas: só o endereço do backend e a chave de acesso
// pessoal guardada neste aparelho.

const STORE_API = "drako.apiUrl";
const STORE_KEY = "drako.accessKey";
const TIMEOUT_MS = 300_000; // tarefas no computador podem levar alguns minutos

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key) || "";
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
  return value;
}

/**
 * Lê configurações passadas uma única vez pelo endereço, ex.:
 *   https://usuario.github.io/DrakoJarvis/#api=https://drako.x.workers.dev&chave=SEGREDO
 * Guarda no aparelho e limpa o endereço para a chave não ficar visível.
 */
export function absorbHashConfig() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash);
  let changed = false;
  if (params.has("api")) {
    store(STORE_API, params.get("api").trim().replace(/\/+$/, ""));
    changed = true;
  }
  if (params.has("chave")) {
    store(STORE_KEY, params.get("chave").trim());
    changed = true;
  }
  if (changed) history.replaceState(null, "", location.pathname + location.search);
}

export function apiUrl() {
  const fromConfig = (window.DRAKO_CONFIG && window.DRAKO_CONFIG.apiUrl) || "";
  return (store(STORE_API) || fromConfig).replace(/\/+$/, "");
}

export class BrainError extends Error {
  constructor(kind, status = 0) {
    super(kind);
    this.kind = kind;
    this.status = status;
  }
}

export class Brain {
  messages = []; // histórico (Worker)
  session = null; // conversa do Claude Code (ponte local)
  pending = null;
  #controller = null;

  get configured() {
    return Boolean(apiUrl());
  }

  reset() {
    this.abort();
    this.messages = [];
    this.session = null;
    this.pending = null;
  }

  abort() {
    this.#controller?.abort();
    this.#controller = null;
  }

  /** Envia a fala do usuário; devolve o texto que o Drako deve falar. */
  async ask(text) {
    return this.#send({ input: text });
  }

  /** Responde a uma confirmação pendente. */
  async confirm(approved, text = "") {
    const pending = this.pending;
    return this.#send({ confirm: { pending, approved }, input: text });
  }

  async #send(payload) {
    const base = apiUrl();
    if (!base) throw new BrainError("not-configured");
    if (navigator.onLine === false) throw new BrainError("offline");

    const body = {
      ...payload,
      messages: this.messages,
      session: this.session,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    this.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const timer = setTimeout(() => controller.abort("timeout"), TIMEOUT_MS);

    let res;
    try {
      const headers = { "Content-Type": "application/json" };
      const key = store(STORE_KEY);
      if (key) headers["X-Drako-Key"] = key;
      res = await fetch(`${base}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new BrainError(controller.signal.reason === "timeout" ? "timeout" : "aborted");
      }
      throw new BrainError(navigator.onLine === false ? "offline" : "unreachable");
    } finally {
      clearTimeout(timer);
      if (this.#controller === controller) this.#controller = null;
    }

    let data = null;
    try {
      data = await res.json();
    } catch {}

    if (!res.ok) {
      const code = data?.error || "";
      // Histórico inválido ou longo demais: recomeça a conversa e tenta de novo uma vez.
      if (
        payload.input &&
        !payload.retried &&
        !payload.confirm &&
        ["history_too_long", "upstream_bad_request", "invalid_messages", "too_large"].includes(code) &&
        this.messages.length
      ) {
        this.reset();
        return this.#send({ ...payload, retried: true });
      }
      if (code === "aborted") throw new BrainError("aborted");
      if (code === "invalid_confirmation" || code === "invalid_confirm") {
        this.pending = null;
      }
      throw new BrainError(errorKind(res.status, code), res.status);
    }

    this.messages = Array.isArray(data.messages) ? data.messages : [];
    this.session = data.session || null;
    this.pending = data.pending || null;
    return data.speech || "";
  }
}

function errorKind(status, code) {
  if (code === "not_configured") return "server-not-configured";
  if (code === "unauthorized") return "unauthorized";
  if (code === "origin_not_allowed") return "origin";
  if (code === "upstream_auth") return "upstream-auth";
  if (code === "usage_limit") return "usage-limit";
  if (code === "not_logged_in") return "not-logged-in";
  if (code === "claude_missing") return "claude-missing";
  if (code === "upstream_unreachable") return "unreachable";
  if (code === "timeout" || status === 504) return "timeout";
  if (code === "rate_limited" || status === 429) return "busy";
  if (code === "overloaded" || status === 503) return "busy";
  return "server";
}

/** Frases faladas para cada falha (o Drako não exibe texto na tela). */
export const ERROR_SPEECH = {
  "not-configured":
    "Senhor, minha conexão com a inteligência artificial ainda não foi configurada. Por enquanto só consigo ouvir e falar.",
  "server-not-configured": "Senhor, o servidor está no ar, mas a chave da Anthropic ainda não foi cadastrada nele.",
  unauthorized: "Senhor, o servidor recusou o acesso. A chave de acesso deste aparelho não confere.",
  origin: "Senhor, o servidor não aceita pedidos deste endereço. Verifique a lista de origens permitidas.",
  "upstream-auth": "Senhor, a chave da Anthropic cadastrada no servidor foi recusada.",
  "usage-limit": "Senhor, o limite de uso da sua assinatura do Claude foi atingido. Tente novamente mais tarde.",
  "not-logged-in":
    "Senhor, o Claude Code no computador não está conectado à sua conta. Abra o terminal, rode claude e faça o login.",
  "claude-missing": "Senhor, não encontrei o Claude Code instalado no computador.",
  busy: "Estou sobrecarregado no momento, senhor. Tente novamente em instantes.",
  offline: "Estou sem conexão com a internet, senhor.",
  unreachable: "Não consegui alcançar o meu servidor, senhor. Verifique a conexão e se o computador está ligado.",
  timeout: "O servidor demorou demais para responder, senhor.",
  server: "Ocorreu um erro no meu servidor, senhor.",
};
