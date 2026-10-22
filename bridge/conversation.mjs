// Lógica de um turno de conversa com o Claude Code, incluindo a confirmação por
// voz antes de qualquer ação que altere algo no computador.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// Modo normal: só leitura e pesquisa. Nada pode ser alterado.
export const READ_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];
// Modo de execução: só depois de um "sim" falado.
export const ACT_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Bash", "Edit", "Write", "NotebookEdit"];

const MARKER = /\[\[\s*CONFIRMAR\s*:\s*([\s\S]+?)\s*\]\]/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VOICE_RULES = `Você é o Drako, o assistente pessoal por voz do usuário. Você roda no computador dele por meio do Claude Code.

Como falar:
- Tudo o que você escreve será lido em voz alta. Não use markdown, listas, tabelas, emojis, links, caminhos longos ou blocos de código. Escreva números e siglas como devem ser falados quando isso ajudar.
- Responda sempre em português brasileiro, de forma natural e direta. Normalmente use de uma a três frases curtas; estenda só se o usuário pedir detalhes.
- Trate o usuário por "senhor".
- A fala do usuário chega por reconhecimento de voz e pode ter erros de transcrição. Interprete com bom senso; se algo importante estiver ambíguo, peça para repetir.
- Você não controla o iPhone nem aplicativos do celular. Nunca diga que fez algo que não fez.`;

export const READ_PROMPT = `${VOICE_RULES}

Modo atual: somente leitura. Você pode ler arquivos do computador, procurar arquivos e pesquisar na web, mas não pode alterar nada.
Quando o pedido exigir qualquer alteração ou ação (criar, editar, mover ou apagar arquivos; executar comandos, scripts ou programas; instalar algo; enviar, comprar ou transferir; mudar configurações), NÃO tente executar. Diga em uma frase curta o que pretende fazer e termine a resposta com uma linha exatamente neste formato:
[[CONFIRMAR: descrição curta e completa da ação]]
O sistema pedirá a confirmação por voz. Se o senhor disser sim, você receberá permissão para executar somente essa ação.`;

export function actPrompt(action) {
  return `${VOICE_RULES}

Modo atual: execução autorizada. O senhor confirmou por voz SOMENTE a seguinte ação: "${action}".
Execute apenas essa ação, confira o resultado e responda em uma ou duas frases faladas. Não faça nada além disso. Se for preciso fazer algo diferente ou mais arriscado do que o confirmado, pare e explique, terminando com uma nova linha [[CONFIRMAR: ...]].`;
}

/**
 * @param {object} p
 * @param {(opts: object) => Promise<{text: string, sessionId: string}>} p.run   executor (runClaude)
 * @param {object} p.config  { secret, cwd, model, bin, timeoutMs }
 * @param {object} p.body    corpo do pedido { input, session, confirm, timeZone }
 * @param {AbortSignal} [p.signal]
 */
export async function runTurn({ run, config, body, signal }) {
  const input = typeof body.input === "string" ? body.input.trim().slice(0, 2000) : "";
  const timeZone = typeof body.timeZone === "string" ? body.timeZone.slice(0, 64) : "";
  let sessionId = typeof body.session === "string" && UUID.test(body.session) ? body.session : null;
  const resume = Boolean(sessionId);
  if (!sessionId) sessionId = randomUUID();

  const base = { sessionId, resume, cwd: config.cwd, model: config.model, bin: config.bin, timeoutMs: config.timeoutMs, signal };

  if (body.confirm) {
    const { pending, approved } = body.confirm;
    if (!resume || !verify(pending, sessionId, config.secret)) {
      throw Object.assign(new Error("invalid_confirmation"), { code: "invalid_confirmation" });
    }
    const action = pending.action;
    const out = approved
      ? await run({
          ...base,
          tools: ACT_TOOLS,
          systemPrompt: actPrompt(action),
          prompt: `O senhor disse "sim" por voz. Execute agora: ${action}`,
        })
      : await run({
          ...base,
          tools: READ_TOOLS,
          systemPrompt: READ_PROMPT,
          prompt: `O senhor NÃO autorizou a ação: ${action}. Não execute nada. Confirme o cancelamento em uma frase.${
            input ? ` Ele também disse: "${input}"` : ""
          }`,
        });
    return finish(out, config, approved ? "act" : "read");
  }

  if (!input) throw Object.assign(new Error("empty_input"), { code: "empty_input" });
  const now = formatNow(timeZone);
  const out = await run({
    ...base,
    tools: READ_TOOLS,
    systemPrompt: READ_PROMPT,
    prompt: `[Agora: ${now}]\n${input}`,
  });
  return finish(out, config, "read");
}

function finish(out, config, mode) {
  const match = MARKER.exec(out.text);
  let speech = out.text.replace(new RegExp(MARKER.source, "gi"), " ").replace(/\s+/g, " ").trim();
  let pending = null;
  if (match) {
    const action = match[1].replace(/\s+/g, " ").trim().slice(0, 500);
    pending = { action, sig: sign(out.sessionId, action, config.secret) };
    speech = `${speech || `Devo ${action}?`} Posso executar? Diga sim ou não.`.trim();
  }
  if (!speech) speech = mode === "act" ? "Pronto, senhor." : "Certo, senhor.";
  return { speech, session: out.sessionId, pending, messages: [] };
}

function sign(sessionId, action, secret) {
  return createHmac("sha256", secret).update(`${sessionId}\n${action}`).digest("base64");
}

function verify(pending, sessionId, secret) {
  if (!pending || typeof pending.action !== "string" || typeof pending.sig !== "string") return false;
  const expected = Buffer.from(sign(sessionId, pending.action, secret));
  const given = Buffer.from(pending.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function formatNow(timeZone) {
  const opts = { dateStyle: "full", timeStyle: "short" };
  try {
    return `${new Intl.DateTimeFormat("pt-BR", { ...opts, timeZone: timeZone || undefined }).format(new Date())} (${timeZone || "fuso local"})`;
  } catch {
    return new Intl.DateTimeFormat("pt-BR", opts).format(new Date());
  }
}
