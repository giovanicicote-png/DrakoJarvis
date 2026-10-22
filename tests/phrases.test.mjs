import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectWake, isSleepCommand, isOnlyWake, classifyConfirmation, similarity, splitForSpeech, cleanForSpeech,
} from "../js/phrases.js";

test("detecta a ativação em várias transcrições", () => {
  for (const t of ["Olá Drako", "olá, Draco!", "Ola drago", "OLÁ DRAKO.", "oi drako", "hum olá Drako"]) {
    assert.ok(detectWake(t), t);
  }
  for (const t of ["olá", "drako", "olá doutor", "falando do dragão"]) {
    assert.equal(detectWake(t), null, t);
  }
});

test("extrai o pedido que vem junto da ativação", () => {
  assert.equal(detectWake("Olá Drako, que horas são?").rest, "que horas sao");
  assert.ok(isOnlyWake("Olá, Drako."));
  assert.ok(!isOnlyWake("Olá Drako tudo bem"));
});

test("detecta o encerramento", () => {
  for (const t of ["Drako até mais", "drako, até mais!", "Draco até logo", "até mais Drako"]) {
    assert.ok(isSleepCommand(t), t);
  }
  for (const t of ["até mais", "drako", "vou sair até mais tarde"]) {
    assert.ok(!isSleepCommand(t), t);
  }
});

test("classifica confirmações", () => {
  assert.equal(classifyConfirmation("Sim"), "yes");
  assert.equal(classifyConfirmation("pode fazer"), "yes");
  assert.equal(classifyConfirmation("confirmo"), "yes");
  assert.equal(classifyConfirmation("Não"), "no");
  assert.equal(classifyConfirmation("não pode"), "no");
  assert.equal(classifyConfirmation("cancela isso"), "no");
  assert.equal(classifyConfirmation("pode apagar para mim"), "yes");
  assert.equal(classifyConfirmation("qual é a previsão do tempo"), "unclear");
});

test("semelhança com a própria fala", () => {
  assert.ok(similarity("hoje está ensolarado em São Paulo", "Hoje está ensolarado em São Paulo, senhor.") > 0.8);
  assert.ok(similarity("que horas são", "Hoje está ensolarado") < 0.3);
});

test("prepara texto para fala", () => {
  assert.equal(cleanForSpeech("**Olá** veja https://x.com agora"), "Olá veja agora");
  const long = "Frase um. ".repeat(40);
  const chunks = splitForSpeech(long, 100);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((c) => c.length <= 100));
  const giant = "palavra ".repeat(100);
  assert.ok(splitForSpeech(giant, 80).every((c) => c.length <= 80));
});
