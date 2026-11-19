const assert = require("assert");
process.env.NODE_ENV = "test";

const { getProvider, setProvider, PROVIDERS } = require("../src/services/llmService");

function clearModule(modulePath) {
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch (e) {
    // ignore
  }
}

function requireFresh(modulePath) {
  clearModule(modulePath);
  return require(modulePath);
}

async function testProviderRegistration() {
  assert.ok(PROVIDERS.includes("gemini"), "PROVIDERS array should include 'gemini'");
  
  const original = getProvider();
  try {
    setProvider("gemini");
    assert.strictEqual(getProvider(), "gemini");
  } finally {
    setProvider(original);
  }
}

async function testGeminiServiceExports() {
  const gemini = requireFresh("../src/services/gemini");
  assert.strictEqual(typeof gemini.sendPrompt, "function", "gemini should export sendPrompt function");
}

async function testGeminiServiceSendPromptSuccess() {
  process.env.GEMINI_API_KEY = "test-api-key";
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite,gemini-3.8-flash";

  let createdClientOptions = null;
  let chatCompletionArgs = null;

  const openaiPath = require.resolve("openai");
  const originalOpenAI = require.cache[openaiPath];

  require.cache[openaiPath] = {
    exports: {
      OpenAI: class MockOpenAI {
        constructor(options) {
          createdClientOptions = options;
          this.chat = {
            completions: {
              create: async (args) => {
                chatCompletionArgs = args;
                return {
                  choices: [
                    {
                      message: {
                        content: "Hello from Gemini",
                      },
                    },
                  ],
                };
              },
            },
          };
        }
      },
    },
  };

  try {
    const gemini = requireFresh("../src/services/gemini");
    const result = await gemini.sendPrompt("Test prompt");

    assert.strictEqual(result, "Hello from Gemini");
    assert.strictEqual(
      createdClientOptions.baseURL,
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    );
    assert.strictEqual(createdClientOptions.apiKey, "test-api-key");
    assert.strictEqual(chatCompletionArgs.model, "gemini-3.5-flash-lite");
    assert.strictEqual(chatCompletionArgs.messages[0].content, "Test prompt");
  } finally {
    if (originalOpenAI) {
      require.cache[openaiPath] = originalOpenAI;
    } else {
      delete require.cache[openaiPath];
    }
  }
}

async function testGeminiServiceFallback() {
  process.env.GEMINI_API_KEY = "test-api-key";
  process.env.GEMINI_MODEL = "failing-model,gemini-3.8-flash";

  const attempts = [];
  const openaiPath = require.resolve("openai");
  const originalOpenAI = require.cache[openaiPath];

  require.cache[openaiPath] = {
    exports: {
      OpenAI: class MockOpenAI {
        constructor() {
          this.chat = {
            completions: {
              create: async (args) => {
                attempts.push(args.model);
                if (args.model === "failing-model") {
                  throw new Error("Model quota exceeded");
                }
                return {
                  choices: [
                    {
                      message: {
                        content: "Fallback response",
                      },
                    },
                  ],
                };
              },
            },
          };
        }
      },
    },
  };

  try {
    const gemini = requireFresh("../src/services/gemini");
    const result = await gemini.sendPrompt("Fallback prompt");

    assert.strictEqual(result, "Fallback response");
    assert.deepStrictEqual(attempts, ["failing-model", "gemini-3.8-flash"]);
  } finally {
    if (originalOpenAI) {
      require.cache[openaiPath] = originalOpenAI;
    } else {
      delete require.cache[openaiPath];
    }
  }
}

async function testGeminiServiceAllModelsFail() {
  process.env.GEMINI_API_KEY = "test-api-key";
  process.env.GEMINI_MODEL = "model1,model2";

  const openaiPath = require.resolve("openai");
  const originalOpenAI = require.cache[openaiPath];

  require.cache[openaiPath] = {
    exports: {
      OpenAI: class MockOpenAI {
        constructor() {
          this.chat = {
            completions: {
              create: async () => {
                throw new Error("API completely down");
              },
            },
          };
        }
      },
    },
  };

  try {
    const gemini = requireFresh("../src/services/gemini");
    let caughtError = null;
    try {
      await gemini.sendPrompt("Prompt");
    } catch (err) {
      caughtError = err;
    }
    assert.ok(caughtError, "Should throw when all models fail");
    assert.strictEqual(caughtError.message, "API completely down");
  } finally {
    if (originalOpenAI) {
      require.cache[openaiPath] = originalOpenAI;
    } else {
      delete require.cache[openaiPath];
    }
  }
}

async function testLlmServiceIntegrationWithGemini() {
  const originalProvider = getProvider();
  clearModule("../src/services/gemini");
  const openaiPath = require.resolve("openai");
  const originalOpenAI = require.cache[openaiPath];

  process.env.GEMINI_API_KEY = "dummy-key";
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";

  require.cache[openaiPath] = {
    exports: {
      OpenAI: class MockOpenAI {
        constructor() {
          this.chat = {
            completions: {
              create: async () => {
                return {
                  choices: [{ message: { content: "ул. Ленина, д. 10, кв. 5" } }],
                };
              },
            },
          };
        }
      },
    },
  };

  try {
    const llmService = requireFresh("../src/services/llmService");
    llmService.setProvider("gemini");
    process.env.GEMINI_API_KEY = "dummy-key";
    process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";

    const formatted = await llmService.formatAddress("улица Ленина дом 10 квартира 5");
    assert.strictEqual(formatted, "ул. Ленина, д. 10, кв. 5");
  } finally {
    clearModule("../src/services/gemini");
    if (originalOpenAI) {
      require.cache[openaiPath] = originalOpenAI;
    } else {
      delete require.cache[openaiPath];
    }
    setProvider(originalProvider);
  }
}

async function testGeminiServiceProxyConfig() {
  process.env.GEMINI_API_KEY = "test-api-key";
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  process.env.GEMINI_PROXY = "socks5://127.0.0.1:40000";

  let createdClientOptions = null;
  const openaiPath = require.resolve("openai");
  const originalOpenAI = require.cache[openaiPath];

  require.cache[openaiPath] = {
    exports: {
      OpenAI: class MockOpenAI {
        constructor(options) {
          createdClientOptions = options;
          this.chat = {
            completions: {
              create: async () => ({
                choices: [{ message: { content: "Proxy response" } }],
              }),
            },
          };
        }
      },
    },
  };

  try {
    const gemini = requireFresh("../src/services/gemini");
    const result = await gemini.sendPrompt("Proxy test");

    assert.strictEqual(result, "Proxy response");
    assert.ok(createdClientOptions.fetchOptions, "Should have fetchOptions");
    assert.ok(
      createdClientOptions.fetchOptions.dispatcher,
      "Should configure undici dispatcher for proxy",
    );
  } finally {
    delete process.env.GEMINI_PROXY;
    if (originalOpenAI) {
      require.cache[openaiPath] = originalOpenAI;
    } else {
      delete require.cache[openaiPath];
    }
  }
}

async function runTests() {
  console.log("Running Gemini provider tests...");
  await testProviderRegistration();
  await testGeminiServiceExports();
  await testGeminiServiceSendPromptSuccess();
  await testGeminiServiceFallback();
  await testGeminiServiceAllModelsFail();
  await testGeminiServiceProxyConfig();
  await testLlmServiceIntegrationWithGemini();
  console.log("✅ All Gemini provider tests passed!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
