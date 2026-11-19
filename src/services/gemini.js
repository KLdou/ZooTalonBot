const { log, logError } = require("../utils/helpers");
const { OpenAI } = require("openai");

let cachedClient = null;
let lastApiKey = null;
let lastProxy = null;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  const proxy = process.env.GEMINI_PROXY || process.env.HTTPS_PROXY;
  if (!cachedClient || lastApiKey !== apiKey || lastProxy !== proxy) {
    const options = {
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: apiKey,
    };

    if (proxy) {
      try {
        const { fetch: undiciFetch, ProxyAgent, Socks5ProxyAgent } = require("undici");
        options.fetch = undiciFetch;
        if (proxy.startsWith("socks5://") || proxy.startsWith("socks5h://")) {
          options.fetchOptions = {
            dispatcher: new Socks5ProxyAgent(
              proxy.replace("socks5h://", "socks5://"),
            ),
          };
        } else {
          options.fetchOptions = {
            dispatcher: new ProxyAgent(proxy),
          };
        }
        log(`Gemini: using proxy ${proxy}`);
      } catch (err) {
        logError("Gemini: failed to initialize proxy agent:", err);
      }
    }

    cachedClient = new OpenAI(options);
    lastApiKey = apiKey;
    lastProxy = proxy;
  }
  return cachedClient;
}

// Кеш последней успешной модели на 10 минут
const MODEL_CACHE_TIME = 10 * 60 * 1000;
let lastSuccessfulModel = null;
let lastSuccessfulModelTime = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPrompt(prompt, models = null) {
  const client = getClient();

  if (!models) {
    const modelString = process.env.GEMINI_MODEL;
    if (!modelString) {
      throw new Error("GEMINI_MODEL not configured");
    }
    models = modelString.split(",").map((model) => model.trim());
  }

  // Проверяем кеш последней успешной модели
  const now = Date.now();
  if (
    lastSuccessfulModel &&
    lastSuccessfulModelTime &&
    now - lastSuccessfulModelTime < MODEL_CACHE_TIME
  ) {
    const cachedIndex = models.indexOf(lastSuccessfulModel);
    if (cachedIndex !== -1) {
      log(`Gemini: using cached successful model ${lastSuccessfulModel}`);
      models = [
        lastSuccessfulModel,
        ...models.filter((m) => m !== lastSuccessfulModel),
      ];
    }
  }

  const retryDelay = process.env.NODE_ENV === "test" ? 10 : 2000;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    log(`Gemini: trying model ${model} (${i + 1}/${models.length})`);

    try {
      const response = await client.chat.completions.create({
        model: model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
      });

      if (
        !response.choices ||
        !response.choices[0] ||
        !response.choices[0].message
      ) {
        logError(
          `Gemini: Invalid response structure from ${model}`,
          JSON.stringify(response, null, 2),
        );
        throw new Error(`Invalid response structure from ${model}`);
      }

      lastSuccessfulModel = model;
      lastSuccessfulModelTime = Date.now();
      log(`Gemini: cached successful model ${model} for next requests`);

      return response.choices[0].message.content;
    } catch (error) {
      const cause = error.cause ? ` (Cause: ${error.cause.message || JSON.stringify(error.cause)})` : "";
      logError(`Gemini error with model ${model}${cause}:`, error);

      if (i === models.length - 1) {
        logError(`Gemini: All models failed. Last error:`, error);
        throw error;
      }

      await sleep(retryDelay);
      log(`Gemini: Trying next model...`);
    }
  }
}

module.exports = {
  sendPrompt,
};
