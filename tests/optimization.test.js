const assert = require("assert");
const path = require("path");

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function requireFresh(modulePath) {
  clearModule(modulePath);
  return require(modulePath);
}

function isLoaded(relativePath) {
  const resolved = require.resolve(path.join("..", relativePath));
  return Boolean(require.cache[resolved]);
}

async function testLocalFormattingAvoidsLlm() {
  process.env.LLM_PROVIDER = "openrouter";
  process.env.OPEN_ROUTER_MODEL = "";
  const llm = requireFresh("../src/services/llmService");

  assert.strictEqual(await llm.formatMonth(new Date("2026-05-14T12:00:00Z")), "мая");
  assert.strictEqual(await llm.formatShortFio("Иванов Петр Сергеевич"), "Иванов П.С.");
  assert.strictEqual(await llm.formatShortFio("Иванов Иван"), "Иванов И.");
  assert.strictEqual(
    await llm.formatPet("Кошка", "трехцветная", "Плюша, Марина"),
    "кошка трехцветная Плюша, Марина",
  );
}

function testLlmProvidersAreLoadedLazily() {
  process.env.LLM_PROVIDER = "openrouter";
  clearModule("../src/services/llmService");
  clearModule("../src/services/openrouter");
  clearModule("../src/services/ollama");
  clearModule("../src/services/ollamaCloud");

  const llm = require("../src/services/llmService");

  assert.strictEqual(llm.getProvider(), "openrouter");
  assert.strictEqual(isLoaded("src/services/openrouter.js"), false);
  assert.strictEqual(isLoaded("src/services/ollama.js"), false);
  assert.strictEqual(isLoaded("src/services/ollamaCloud.js"), false);
}

async function testFetchTokenUsesCache() {
  clearModule("../src/services/api");
  const axios = require("axios");
  const originalGet = axios.get;
  const originalNow = Date.now;
  let tokenCalls = 0;
  let now = 1_000_000;

  axios.get = async (url) => {
    if (url.includes("/user/v1/token")) {
      tokenCalls += 1;
      return { data: { access_token: `cached-token-${tokenCalls}` } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  Date.now = () => now;

  try {
    const api = require("../src/services/api");
    assert.strictEqual(await api.fetchToken(), "cached-token-1");
    now += 3 * 60 * 1000 - 1;
    assert.strictEqual(await api.fetchToken(), "cached-token-1");
    assert.strictEqual(tokenCalls, 1);

    now += 2;
    assert.strictEqual(await api.fetchToken(), "cached-token-2");
    assert.strictEqual(tokenCalls, 2);
  } finally {
    axios.get = originalGet;
    Date.now = originalNow;
  }
}

async function testMatchEntityUsesLocalFuzzyMatchBeforeLlm() {
  process.env.LLM_PROVIDER = "openrouter";
  process.env.OPEN_ROUTER_MODEL = "";
  const llm = requireFresh("../src/services/llmService");

  const result = await llm.matchEntity(
    "clinic",
    [{ id: "1", name: "Алешка" }],
    "клиника Алешка ул. Строителей",
  );

  assert.deepStrictEqual(result, { id: "1", name: "Алешка" });
}

async function testMatchEntityDoesNotPreferGenericClinicWord() {
  process.env.LLM_PROVIDER = "openrouter";
  process.env.OPEN_ROUTER_MODEL = "";
  const llm = requireFresh("../src/services/llmService");

  const result = await llm.matchEntity(
    "clinic",
    [
      { id: "generic", name: "клиника" },
      { id: "1", name: "Алешка" },
    ],
    "клиника Алешка ул. Строителей",
  );

  assert.deepStrictEqual(result, { id: "1", name: "Алешка" });
}

async function run() {
  await testLocalFormattingAvoidsLlm();
  testLlmProvidersAreLoadedLazily();
  await testFetchTokenUsesCache();
  await testMatchEntityUsesLocalFuzzyMatchBeforeLlm();
  await testMatchEntityDoesNotPreferGenericClinicWord();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
