// Executa o Claude Code em modo não interativo (`claude -p`) e devolve o resultado.
// Usa o login do próprio Claude Code (sua assinatura Pro/Max), sem chave de API.

import { spawn } from "node:child_process";

// Variáveis de uma sessão do Claude Code que não devem vazar para o processo filho
// (por exemplo, se a ponte for iniciada de dentro de um terminal do Claude Code).
const NESTED_VARS = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION"];

export class ClaudeError extends Error {
  constructor(kind, detail = "") {
    super(detail || kind);
    this.kind = kind;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.sessionId   UUID da conversa
 * @param {boolean} opts.resume     true para continuar uma conversa existente
 * @param {string} opts.systemPrompt  instruções acrescentadas ao prompt do Claude Code
 * @param {string[]} opts.tools     ferramentas disponíveis nesta execução
 * @param {string} opts.cwd         pasta de trabalho
 * @param {string} [opts.model]
 * @param {string} [opts.bin]       caminho do executável `claude`
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ text: string, sessionId: string }>}
 */
export function runClaude(opts) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--append-system-prompt",
    opts.systemPrompt,
    "--tools",
    opts.tools.join(","),
    "--allowedTools",
    opts.tools.join(","),
    // Qualquer coisa fora da lista acima é negada automaticamente (nunca fica esperando).
    "--permission-mode",
    "dontAsk",
    ...(opts.resume ? ["--resume", opts.sessionId] : ["--session-id", opts.sessionId]),
    ...(opts.model ? ["--model", opts.model] : []),
  ];

  const env = { ...process.env };
  for (const name of NESTED_VARS) delete env[name];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(opts.bin || "claude", args, { cwd: opts.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      reject(new ClaudeError("claude-missing", err.message));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const kill = () => {
      try {
        child.kill("SIGTERM");
      } catch {}
    };
    const onAbort = () => {
      kill();
      finish(reject, new ClaudeError("aborted"));
    };
    const timer = setTimeout(() => {
      kill();
      finish(reject, new ClaudeError("timeout"));
    }, opts.timeoutMs ?? 240_000);
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      finish(reject, new ClaudeError(err.code === "ENOENT" ? "claude-missing" : "claude-failed", err.message));
    });
    child.on("close", (code) => {
      const data = parseResult(stdout);
      if (!data) {
        finish(reject, classify(`${stderr}\n${stdout}`, code));
        return;
      }
      if (data.is_error || data.subtype !== "success") {
        finish(reject, classify(`${data.result || ""}\n${stderr}`, code));
        return;
      }
      finish(resolve, { text: String(data.result || "").trim(), sessionId: data.session_id || opts.sessionId });
    });

    // O pedido vai pela entrada padrão (evita qualquer problema com argumentos).
    child.stdin.on("error", () => {});
    child.stdin.end(opts.prompt);
  });
}

function parseResult(stdout) {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      if (data && data.type === "result") return data;
    } catch {}
  }
  return null;
}

function classify(text, code) {
  const t = text.toLowerCase();
  if (/usage limit|limit reached|rate limit|limite de uso|out of extra usage/.test(t)) {
    return new ClaudeError("usage-limit", text.trim());
  }
  if (/not logged in|please run \/login|invalid api key|authentication|oauth|unauthorized|401/.test(t)) {
    return new ClaudeError("not-logged-in", text.trim());
  }
  if (/no conversation found|session.*not found/.test(t)) {
    return new ClaudeError("session-lost", text.trim());
  }
  if (/enotfound|econnreset|etimedout|network|fetch failed/.test(t)) {
    return new ClaudeError("claude-offline", text.trim());
  }
  return new ClaudeError("claude-failed", `código ${code}: ${text.trim().slice(0, 500)}`);
}
