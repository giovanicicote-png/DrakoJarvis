// Registro de ferramentas do Drako.
//
// Cada ferramenta é executada no servidor (Worker), nunca no navegador.
// Para adicionar uma nova ação real:
//   1. Acrescente um objeto ao array TOOLS com name, description, input_schema e run().
//   2. Se a ação for destrutiva, envolver dinheiro, compras, transferências, envio de
//      mensagens em seu nome ou qualquer efeito difícil de desfazer, marque
//      `sensitive: true` e escreva `confirmation(input)`. O Worker então NÃO executa a
//      ferramenta: ele devolve a pergunta de confirmação, o Drako a fala, e a ação só
//      roda se o usuário responder "sim" por voz.
//   3. Credenciais de serviços externos ficam em secrets do Worker (env), nunca aqui.
//
// O Claude só fica sabendo das ferramentas listadas abaixo, então ele não pode
// afirmar que executou algo que não existe.

/**
 * @typedef {object} ToolContext
 * @property {string} timeZone  Fuso horário IANA informado pelo aparelho do usuário.
 * @property {Record<string, unknown>} env  Variáveis e secrets do Worker.
 *
 * @typedef {object} DrakoTool
 * @property {string} name
 * @property {string} description
 * @property {object} input_schema
 * @property {boolean} [sensitive]  Exige confirmação falada antes de executar.
 * @property {(input: any) => string} [confirmation]  Pergunta falada antes da execução.
 * @property {(input: any, ctx: ToolContext) => Promise<string> | string} run
 */

/** @type {DrakoTool[]} */
export const TOOLS = [
  {
    name: "data_hora_atual",
    description:
      "Retorna a data, o dia da semana e a hora atuais no fuso horário do aparelho do usuário. " +
      "Use sempre que precisar saber que dia ou que horas são.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    run(_input, ctx) {
      const timeZone = safeTimeZone(ctx.timeZone);
      const text = new Intl.DateTimeFormat("pt-BR", {
        timeZone,
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date());
      return `${text} (fuso ${timeZone})`;
    },
  },
];

function safeTimeZone(tz) {
  try {
    if (typeof tz === "string" && tz) {
      new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
      return tz;
    }
  } catch {
    // fuso inválido: usa o padrão abaixo
  }
  return "America/Sao_Paulo";
}

/** Definições no formato da API da Anthropic (sem os campos internos). */
export function toolDefinitions(tools = TOOLS) {
  return tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}
