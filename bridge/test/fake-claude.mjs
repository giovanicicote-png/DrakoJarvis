#!/usr/bin/env node
// Simula o executável `claude -p --output-format json` para os testes.
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  const get = (f) => args[args.indexOf(f) + 1];
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, prompt }) + "\n");
  const sessionId = get("--session-id") || get("--resume");
  if (prompt.includes("limite")) {
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached", session_id: sessionId }));
    return;
  }
  let result = "Olá, senhor.";
  if (prompt.includes("apague")) result = "Vou apagar o arquivo notas.txt da Mesa.\n[[CONFIRMAR: apagar o arquivo ~/Desktop/notas.txt]]";
  if (prompt.includes("Execute agora")) result = "Pronto, senhor, o arquivo foi apagado.";
  if (prompt.includes("NÃO autorizou")) result = "Tudo bem, senhor, cancelei.";
  const delay = prompt.includes("demora") ? 5000 : 10;
  setTimeout(() => console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result, session_id: sessionId })), delay);
});
