#!/usr/bin/env node
// Ponte local do Drako: roda no seu computador (Mac), usa o Claude Code da sua
// assinatura como cérebro e também serve a interface do Drako.
//
//   node bridge/server.mjs
//
// Rotas:
//   /                 interface do Drako (mesmos arquivos do GitHub Pages)
//   GET  /api/health  estado (sem segredos)
//   POST /api/chat    um turno de conversa por voz
//
// Configuração em ~/.drako/config.json (criada na primeira execução) ou por
// variáveis de ambiente: DRAKO_PORT, DRAKO_HOST, DRAKO_WORKDIR, DRAKO_MODEL,
// DRAKO_CLAUDE_BIN, DRAKO_ACCESS_KEY, DRAKO_ALLOWED_ORIGINS.

import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude, ClaudeError } from "./claude.mjs";
import { runTurn } from "./conversation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_DIR = path.join(homedir(), ".drako");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const MAX_BODY = 64 * 1024;

// Só estes arquivos do repositório são servidos (nunca bridge/, worker/, .git...).
const PUBLIC = /^\/(index\.html|manifest\.json|sw\.js|icon\.svg|icon-180\.png|icon-512\.png|css\/[\w.-]+\.css|js\/[\w.-]+\.js)$/;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export async function loadConfig(env = process.env) {
  let saved = {};
  try {
    saved = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
  } catch {}
  if (!saved.accessKey) {
    saved.accessKey = randomBytes(24).toString("base64url");
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    await writeFile(CONFIG_FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
  }
  return {
    port: Number(env.DRAKO_PORT || saved.port || 8787),
    host: env.DRAKO_HOST || saved.host || "127.0.0.1",
    cwd: env.DRAKO_WORKDIR || saved.workdir || homedir(),
    model: env.DRAKO_MODEL || saved.model || "",
    bin: env.DRAKO_CLAUDE_BIN || saved.claudeBin || "claude",
    accessKey: env.DRAKO_ACCESS_KEY || saved.accessKey,
    secret: saved.accessKey + ":confirm",
    timeoutMs: Number(env.DRAKO_TIMEOUT_MS || saved.timeoutMs || 240_000),
    allowedOrigins: String(env.DRAKO_ALLOWED_ORIGINS || saved.allowedOrigins || "https://giovanicicote-png.github.io")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  };
}

/** Cria o servidor. `run` pode ser trocado nos testes. */
export function createServer(config, { run = runClaude } = {}) {
  let queue = Promise.resolve(); // uma execução do Claude Code por vez

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, "http://localhost");
    const sameOrigin = origin && origin === `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
    const cors = corsHeaders(origin, config, sameOrigin);

    if (origin && !sameOrigin && !originAllowed(origin, config)) {
      return send(res, 403, { error: "origin_not_allowed" }, cors);
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }

    if (url.pathname === "/api/health" && req.method === "GET") {
      return send(
        res,
        200,
        { ok: true, configured: true, protected: true, authorized: authorized(req, config), brain: "claude-code" },
        cors,
      );
    }

    if (url.pathname === "/api/chat") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, cors);
      if (!authorized(req, config)) return send(res, 401, { error: "unauthorized" }, cors);
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: "invalid_json" }, cors);
      }

      // Se o navegador desistir (ex.: "Drako até mais"), encerra o Claude Code.
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });

      const job = queue.then(() =>
        controller.signal.aborted
          ? Promise.reject(new ClaudeError("aborted"))
          : runTurn({ run, config, body, signal: controller.signal }),
      );
      queue = job.catch(() => {});
      try {
        const result = await job;
        return send(res, 200, result, cors);
      } catch (err) {
        const { status, code } = mapError(err);
        if (status >= 500) console.error(`[drako] ${code}: ${err.message}`);
        return send(res, status, { error: code }, cors);
      }
    }

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 404, { error: "not_found" }, cors);
    return serveStatic(url.pathname, res);
  });
}

async function serveStatic(pathname, res) {
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/js/config.js") {
    // A interface servida pela ponte fala com a própria ponte.
    res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
    return res.end('window.DRAKO_CONFIG = { apiUrl: location.origin + "/api" };\n');
  }
  if (!PUBLIC.test(pathname)) return send(res, 404, { error: "not_found" });
  const file = path.join(ROOT, pathname);
  try {
    await stat(file);
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    send(res, 404, { error: "not_found" });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too_large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authorized(req, config) {
  const given = Buffer.from(String(req.headers["x-drako-key"] || ""));
  const expected = Buffer.from(config.accessKey);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function originAllowed(origin, config) {
  if (config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /^https:\/\/[\w-]+\.[\w-]+\.ts\.net$/.test(origin);
}

function corsHeaders(origin, config, sameOrigin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Drako-Key",
    // Chrome: página pública acessando um endereço da rede privada (Tailscale).
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && (sameOrigin || originAllowed(origin, config))) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function send(res, status, data, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...headers, "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

export function mapError(err) {
  if (err.code === "invalid_confirmation") return { status: 400, code: "invalid_confirmation" };
  if (err.code === "empty_input") return { status: 400, code: "empty_input" };
  if (err instanceof ClaudeError) {
    switch (err.kind) {
      case "aborted":
        return { status: 499, code: "aborted" };
      case "usage-limit":
        return { status: 429, code: "usage_limit" };
      case "not-logged-in":
        return { status: 503, code: "not_logged_in" };
      case "claude-missing":
        return { status: 503, code: "claude_missing" };
      case "session-lost":
        return { status: 400, code: "upstream_bad_request" };
      case "claude-offline":
        return { status: 502, code: "upstream_unreachable" };
      case "timeout":
        return { status: 504, code: "timeout" };
    }
  }
  return { status: 500, code: "internal_error" };
}

// Execução direta: `node bridge/server.mjs`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await loadConfig();
  const server = createServer(config);
  server.requestTimeout = 0; // tarefas do Claude Code podem demorar
  server.listen(config.port, config.host, () => {
    console.log(`
  Drako (ponte local com Claude Code) no ar.

  Neste computador:   http://localhost:${config.port}/#chave=${config.accessKey}
  Pasta de trabalho:  ${config.cwd}
  Modelo:             ${config.model || "padrão do Claude Code"}

  No iPhone (via Tailscale): https://SEU-MAC.SUA-REDE.ts.net/#chave=${config.accessKey}
  A chave fica em ${CONFIG_FILE}. Não compartilhe.
`);
  });
}
