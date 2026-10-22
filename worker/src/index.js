// Drako — backend (Cloudflare Worker).
//
// Guarda a chave da Anthropic como secret, conversa com o Claude e executa as
// ferramentas do registro em tools.js. O navegador nunca vê a chave.
//
// Rotas:
//   GET  /health  -> estado da configuração (sem expor segredos)
//   POST /chat    -> um turno de conversa por voz

import Anthropic, {
  APIConnectionError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { TOOLS, toolDefinitions } from "./tools.js";

const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_EFFORT = "low"; // conversa por voz: respostas rápidas
const MAX_TOKENS = 8000;
const MAX_LOOP = 8;
const MAX_HISTORY = 160;
const MAX_BODY_BYTES = 4_000_000;
const MAX_INPUT_CHARS = 2000;

export const SYSTEM_PROMPT = `Você é o Drako, um assistente pessoal que conversa exclusivamente por voz, em português brasileiro.

Como falar:
- Tudo o que você escreve será lido em voz alta por um sintetizador. Não use markdown, listas, tabelas, emojis, links, código ou símbolos. Escreva números e siglas como devem ser falados quando isso ajudar a pronúncia.
- Seja natural, cordial e direto. Na maioria das vezes responda em uma a três frases curtas; só se estenda quando o usuário pedir detalhes.
- Trate o usuário por "senhor".
- A fala do usuário chega por reconhecimento de voz e pode conter erros de transcrição. Interprete com bom senso; se algo importante estiver ambíguo, peça para ele repetir.

O que você realmente consegue fazer:
- Conversar, explicar, planejar, fazer contas e responder perguntas com o seu conhecimento.
- Usar somente as ferramentas que estiverem disponíveis nesta conversa (por exemplo, consultar a data e a hora atuais e, se estiver habilitada, pesquisar na web).
- Você NÃO controla aplicativos, NÃO acessa arquivos, contatos, fotos, mensagens ou ajustes do iPhone ou do computador, NÃO faz ligações, compras nem transferências, a menos que exista uma ferramenta específica para isso. Quando pedirem algo assim, diga com honestidade que essa capacidade ainda não foi instalada.
- Nunca diga que executou uma ação sem ter chamado a ferramenta correspondente e recebido um resultado de sucesso.

Ações sensíveis:
- Ferramentas destrutivas, financeiras ou com efeitos difíceis de desfazer passam por uma confirmação falada que o sistema solicita automaticamente antes de executar. Se o resultado da ferramenta indicar que o usuário não autorizou, não insista; confirme que a ação foi cancelada.`;

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {{ client?: any, tools?: import("./tools.js").DrakoTool[] }} [deps]  injeção para testes
 */
export async function handleRequest(request, env, deps = {}) {
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin, env);

  if (origin && !isOriginAllowed(origin, env)) {
    return json({ error: "origin_not_allowed" }, 403, cors);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

  if (request.method === "GET" && (path === "/health" || path === "/")) {
    return json(
      {
        ok: true,
        configured: Boolean(env.ANTHROPIC_API_KEY),
        protected: Boolean(env.DRAKO_ACCESS_KEY),
        authorized: await isAuthorized(request, env),
        model: env.DRAKO_MODEL || DEFAULT_MODEL,
      },
      200,
      cors,
    );
  }

  if (request.method !== "POST" || path !== "/chat") {
    return json({ error: "not_found" }, 404, cors);
  }

  if (!(await isAuthorized(request, env))) {
    return json({ error: "unauthorized" }, 401, cors);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "not_configured" }, 503, cors);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413, cors);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400, cors);
  }

  const parsed = parseChatBody(body);
  if (parsed.error) return json({ error: parsed.error }, 400, cors);

  const client =
    deps.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 55_000, maxRetries: 1 });

  try {
    const result = await runTurn({
      client,
      env,
      tools: deps.tools ?? TOOLS,
      ...parsed.value,
    });
    return json(result, 200, cors);
  } catch (error) {
    const mapped = mapError(error);
    if (mapped.status >= 500) console.error("drako: erro", error);
    return json({ error: mapped.code }, mapped.status, cors);
  }
}

// ---------------------------------------------------------------------------
// Conversa

/**
 * Executa um turno: acrescenta a fala do usuário (ou a resposta a uma
 * confirmação), chama o Claude e roda ferramentas até haver uma resposta falada
 * ou uma ação sensível aguardando confirmação.
 */
export async function runTurn({ client, env, tools, messages, input, confirm, timeZone }) {
  const history = messages.slice();
  const ctx = { timeZone, env };
  const signingKey = env.DRAKO_ACCESS_KEY || env.ANTHROPIC_API_KEY;
  const spoken = [];

  if (confirm) {
    const ok = await verifyPending(confirm.pending, signingKey, history);
    if (!ok) {
      const err = new Error("invalid_confirmation");
      err.code = "invalid_confirmation";
      throw err;
    }
    const { results, calls } = confirm.pending.data;
    const finalResults = results.slice();
    for (const call of calls) {
      if (confirm.approved) {
        finalResults.push(await executeTool(tools, call, ctx));
      } else {
        finalResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: "O usuário NÃO autorizou esta ação por voz. Ela não foi executada.",
          is_error: true,
        });
      }
    }
    const content = [...finalResults];
    if (input) content.push({ type: "text", text: input });
    history.push({ role: "user", content });
  } else {
    history.push({ role: "user", content: input });
  }

  const baseLength = messages.length;

  for (let i = 0; i < MAX_LOOP; i++) {
    const response = await client.beta.messages.create(buildRequest(env, tools, history));

    if (response.stop_reason === "refusal") {
      const text = collectText(response.content);
      if (response.content.length && text) {
        history.push({ role: "assistant", content: response.content });
        return reply(spoken.concat(text), history, null, response.model);
      }
      // Recusa sem conteúdo: descarta o turno para manter o histórico válido.
      return reply(
        ["Desculpe, senhor, não posso ajudar com isso."],
        messages.slice(),
        null,
        response.model,
      );
    }

    history.push({ role: "assistant", content: response.content });
    const text = collectText(response.content);
    if (text) spoken.push(text);

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") {
      return reply(spoken, history, null, response.model);
    }

    const calls = response.content.filter((b) => b.type === "tool_use");
    const results = [];
    const sensitive = [];
    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      if (tool?.sensitive) sensitive.push({ id: call.id, name: call.name, input: call.input });
      else results.push(await executeTool(tools, call, ctx));
    }

    if (sensitive.length) {
      const data = { results, calls: sensitive };
      const pending = { data, sig: await hmac(data, signingKey) };
      const question = sensitive
        .map((c) => {
          const tool = tools.find((t) => t.name === c.name);
          return tool.confirmation ? tool.confirmation(c.input) : `executar a ação ${c.name}`;
        })
        .join(" e ");
      spoken.push(`Antes de continuar, preciso da sua confirmação: devo ${question}? Diga sim ou não.`);
      return reply(spoken, history, pending, response.model);
    }

    history.push({ role: "user", content: results });
  }

  // Muitas voltas de ferramenta: responde com o que houver, sem quebrar o histórico.
  if (history.at(-1)?.role === "user" && history.length > baseLength + 1) {
    const response = await client.beta.messages.create({
      ...buildRequest(env, tools, history),
      tool_choice: { type: "none" },
    });
    history.push({ role: "assistant", content: response.content });
    spoken.push(collectText(response.content));
  }
  return reply(spoken, history, null, null);
}

function buildRequest(env, tools, messages) {
  const apiTools = toolDefinitions(tools);
  if (env.DRAKO_WEB_SEARCH !== "off") {
    apiTools.push({ type: "web_search_20260209", name: "web_search", max_uses: 3 });
  }
  const request = {
    model: env.DRAKO_MODEL || DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: apiTools,
    output_config: { effort: env.DRAKO_EFFORT || DEFAULT_EFFORT },
    messages,
  };
  if (env.DRAKO_FALLBACKS !== "off") {
    // Se o modelo principal recusar por política, a própria API tenta o modelo recomendado.
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = "default";
  }
  return request;
}

async function executeTool(tools, call, ctx) {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    return {
      type: "tool_result",
      tool_use_id: call.id,
      content: `Ferramenta desconhecida: ${call.name}`,
      is_error: true,
    };
  }
  try {
    const out = await tool.run(call.input ?? {}, ctx);
    return { type: "tool_result", tool_use_id: call.id, content: String(out) };
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: call.id,
      content: `Falha ao executar ${call.name}: ${error?.message || "erro desconhecido"}`,
      is_error: true,
    };
  }
}

function collectText(content) {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}

function reply(spoken, messages, pending, model) {
  const speech = spoken.filter(Boolean).join(" ").trim();
  return { speech, messages, pending, model };
}

// ---------------------------------------------------------------------------
// Validação

export function parseChatBody(body) {
  if (!body || typeof body !== "object") return { error: "invalid_body" };
  const { messages = [], input, confirm, timeZone } = body;

  if (!Array.isArray(messages)) return { error: "invalid_messages" };
  if (messages.length > MAX_HISTORY) return { error: "history_too_long" };
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return { error: "invalid_messages" };
    if (typeof m.content !== "string" && !Array.isArray(m.content)) return { error: "invalid_messages" };
  }
  if (messages.length && messages[0].role !== "user") return { error: "invalid_messages" };

  const text = typeof input === "string" ? input.trim().slice(0, MAX_INPUT_CHARS) : "";

  if (confirm) {
    if (typeof confirm !== "object" || typeof confirm.approved !== "boolean" || !confirm.pending) {
      return { error: "invalid_confirm" };
    }
    if (messages.at(-1)?.role !== "assistant") return { error: "invalid_confirm" };
  } else {
    if (!text) return { error: "empty_input" };
    if (messages.length && messages.at(-1).role !== "assistant") return { error: "invalid_messages" };
  }

  return {
    value: {
      messages,
      input: text,
      confirm: confirm || null,
      timeZone: typeof timeZone === "string" ? timeZone.slice(0, 64) : "",
    },
  };
}

// ---------------------------------------------------------------------------
// Assinatura das confirmações pendentes (impede que o navegador forje uma
// "aprovação" para chamadas que o Claude não pediu).

async function hmac(data, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(key)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(JSON.stringify(data)));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifyPending(pending, key, history) {
  if (!pending || typeof pending !== "object" || !pending.data || typeof pending.sig !== "string") {
    return false;
  }
  const { data } = pending;
  if (!Array.isArray(data.results) || !Array.isArray(data.calls) || !data.calls.length) return false;
  if (!timingSafeEqual(await hmac(data, key), pending.sig)) return false;

  // As chamadas pendentes precisam ser exatamente as da última resposta do Claude.
  const last = history.at(-1);
  if (last?.role !== "assistant" || !Array.isArray(last.content)) return false;
  const ids = new Set(last.content.filter((b) => b.type === "tool_use").map((b) => b.id));
  const covered = [...data.results.map((r) => r.tool_use_id), ...data.calls.map((c) => c.id)];
  return covered.length === ids.size && covered.every((id) => ids.has(id));
}

// ---------------------------------------------------------------------------
// Acesso, CORS e erros

async function isAuthorized(request, env) {
  if (!env.DRAKO_ACCESS_KEY) return true;
  const given = request.headers.get("X-Drako-Key") || "";
  return timingSafeEqual(given, env.DRAKO_ACCESS_KEY);
}

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function isOriginAllowed(origin, env) {
  const list = allowedOrigins(env);
  if (!list.length || list.includes("*")) return true;
  if (list.includes(origin)) return true;
  // Desenvolvimento local
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin, env) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Drako-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && isOriginAllowed(origin, env)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function mapError(error) {
  if (error?.code === "invalid_confirmation") return { status: 400, code: "invalid_confirmation" };
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return { status: 502, code: "upstream_auth" };
  }
  if (error instanceof RateLimitError) return { status: 429, code: "rate_limited" };
  if (error instanceof BadRequestError) return { status: 400, code: "upstream_bad_request" };
  if (error instanceof InternalServerError) return { status: 503, code: "overloaded" };
  if (error instanceof APIConnectionError) return { status: 502, code: "upstream_unreachable" };
  return { status: 500, code: "internal_error" };
}
