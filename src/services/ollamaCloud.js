const { log, logError } = require("../utils/helpers");
const { Ollama } = require("ollama");

const ollama = new Ollama({
  host: "https://ollama.com",
  headers: {
    Authorization: "Bearer " + process.env.OLLAMA_CLOUD_API_KEY,
  },
});

// Кеш последней успешной модели на 10 минут
const MODEL_CACHE_TIME = 10 * 60 * 1000;
let lastSuccessfulModel = null;
let lastSuccessfulModelTime = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPrompt(prompt) {
  const modelString = process.env.OLLAMA_CLOUD_MODEL;
  if (!modelString) {
    throw new Error("OLLAMA_CLOUD_MODEL not configured");
  }
  let models = modelString.split(",").map((model) => model.trim());

  // Проверяем кеш последней успешной модели
  const now = Date.now();
  if (
    lastSuccessfulModel &&
    lastSuccessfulModelTime &&
    now - lastSuccessfulModelTime < MODEL_CACHE_TIME
  ) {
    const cachedIndex = models.indexOf(lastSuccessfulModel);
    if (cachedIndex !== -1) {
      log(`OllamaCloud: using cached successful model ${lastSuccessfulModel}`);
      models = [
        lastSuccessfulModel,
        ...models.filter((m) => m !== lastSuccessfulModel),
      ];
    }
  }

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    log(`OllamaCloud: trying model ${model} (${i + 1}/${models.length})`);

    try {
      const { message } = await ollama.chat({
        model: model,
        messages: [{ role: "user", content: prompt }],
      });

      lastSuccessfulModel = model;
      lastSuccessfulModelTime = Date.now();
      log(`OllamaCloud: cached successful model ${model} for next requests`);

      return message.content;
    } catch (error) {
      logError(`OllamaCloud error with model ${model}:`, error);
      await sleep(3000);

      if (i === models.length - 1) {
        logError(`OllamaCloud: All models failed. Last error:`, error);
        throw error;
      }

      log(`OllamaCloud: Trying next model...`);
    }
  }
}

module.exports = {
  sendPrompt,
};
