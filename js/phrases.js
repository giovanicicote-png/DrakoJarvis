// Reconhecimento das frases de controle ("Olá Drako", "Drako até mais") e das
// respostas de confirmação. Funções puras, testadas em tests/phrases.test.mjs.

/** Minúsculas, sem acentos e sem pontuação. */
export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// O reconhecedor de voz costuma escrever "Drako" de vários jeitos.
const NAME = "(?:drako|draco|drakko|dracko|drago|draku|drakon|dracon|drake|dracul|traco|trako|drac|dracos|dracao)";
const HELLO = "(?:ola|oi|alo|hola|hello|oh la|o la)";

const WAKE_RE = new RegExp(`(?:^|\\s)${HELLO}\\s+${NAME}(?=\\s|$)`);
const SLEEP_RES = [
  new RegExp(`(?:^|\\s)${NAME}\\s+(?:ate mais|ate logo|ate a proxima|ate breve)(?=\\s|$)`),
  new RegExp(`(?:^|\\s)(?:ate mais|ate logo)\\s+${NAME}(?=\\s|$)`),
];

/**
 * Procura a frase de ativação. Retorna null se não houver, ou o texto que vier
 * depois dela (ex.: "Olá Drako, que horas são?" -> "que horas são").
 */
export function detectWake(text) {
  const norm = normalize(text);
  const m = WAKE_RE.exec(norm);
  if (!m) return null;
  return { rest: norm.slice(m.index + m[0].length).trim() };
}

export function isSleepCommand(text) {
  const norm = normalize(text);
  return SLEEP_RES.some((re) => re.test(norm));
}

/** Frase que contém apenas a ativação (sem pedido junto). */
export function isOnlyWake(text) {
  const w = detectWake(text);
  return Boolean(w) && w.rest === "";
}

const YES = /(?:^|\s)(sim|confirmo|confirmado|pode|autorizo|autorizado|claro|positivo|isso|com certeza|fa(c|z)a|manda|vai em frente|ok|okay)(?=\s|$)/;
const NO = /(?:^|\s)(nao|negativo|cancela|cancelar|cancele|pare|nunca|jamais|nem pensar|espera|espere)(?=\s|$)/;

/** "yes", "no" ou "unclear". Negação vence: "não, pode cancelar" é "no". */
export function classifyConfirmation(text) {
  const norm = normalize(text);
  if (!norm) return "unclear";
  if (NO.test(norm)) return "no";
  if (YES.test(norm)) return "yes";
  return "unclear";
}

/**
 * Semelhança (0..1) entre duas frases, por palavras. Usada para descartar
 * trechos da própria voz do Drako captados pelo microfone.
 */
export function similarity(a, b) {
  const wa = normalize(a).split(" ").filter((w) => w.length > 2);
  const wb = new Set(normalize(b).split(" ").filter((w) => w.length > 2));
  if (!wa.length || !wb.size) return 0;
  const hits = wa.filter((w) => wb.has(w)).length;
  return hits / wa.length;
}

/** Remove marcações que soariam mal na voz sintetizada. */
export function cleanForSpeech(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#`>|~]+/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Divide o texto em trechos curtos (o iOS e o Chrome cortam falas longas). */
export function splitForSpeech(text, max = 180) {
  const sentences = cleanForSpeech(text).match(/[^.!?;:]+[.!?;:]*\s*/g) || [];
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      chunks.push(cur.trim());
      cur = "";
    }
    if (s.length > max) {
      // frase muito longa: quebra por vírgulas/palavras
      let piece = "";
      for (const word of s.split(/(?<=,)\s+|\s+/)) {
        if ((piece + " " + word).length > max && piece) {
          chunks.push(piece.trim());
          piece = "";
        }
        piece += " " + word;
      }
      cur += piece;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
