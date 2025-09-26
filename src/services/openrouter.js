const { log, logError } = require("../utils/helpers");
const { OpenAI } = require("openai");

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPEN_ROUTER_API_KEY,
});

// Лимит: 20 запросов в минуту, пауза если 19 за минуту
const REQUEST_LIMIT = 20;
const REQUEST_WINDOW_MS = 60 * 1000;
let requestTimestamps = [];

// Кеш последней успешной модели на 10 минут
const MODEL_CACHE_TIME = 10 * 60 * 1000; // 10 минут
let lastSuccessfulModel = null;
let lastSuccessfulModelTime = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPrompt(prompt, models = null) {
  await sleep(1000);
  
  // Если models не передан, получаем список из env переменной
  if (!models) {
    const modelString = process.env.OPEN_ROUTER_MODEL;
    if (!modelString) {
      throw new Error('OPEN_ROUTER_MODEL not configured');
    }
    models = modelString.split(',').map(model => model.trim());
  }

  // Проверяем кеш последней успешной модели
  const now = Date.now();
  if (lastSuccessfulModel && 
      lastSuccessfulModelTime && 
      (now - lastSuccessfulModelTime) < MODEL_CACHE_TIME) {
    // Если кешированная модель есть в списке, начинаем с неё
    const cachedIndex = models.indexOf(lastSuccessfulModel);
    if (cachedIndex !== -1) {
      log(`OpenRouter: using cached successful model ${lastSuccessfulModel}`);
      // Перестраиваем массив, чтобы начать с кешированной модели
      models = [lastSuccessfulModel, ...models.filter(m => m !== lastSuccessfulModel)];
    }
  }

  // Удаляем старые таймстемпы
  requestTimestamps = requestTimestamps.filter(
    (ts) => now - ts < REQUEST_WINDOW_MS
  );

  if (requestTimestamps.length >= REQUEST_LIMIT - 1) {
    log(
      `OpenRouter: достигнут лимит ${
        REQUEST_LIMIT - 1
      } запросов за минуту, пауза 60 секунд...`
    );
    await sleep(REQUEST_WINDOW_MS);
    // После паузы обновим список
    const afterSleep = Date.now();
    requestTimestamps = requestTimestamps.filter(
      (ts) => afterSleep - ts < REQUEST_WINDOW_MS
    );
  }

  // Пробуем каждую модель по очереди
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    log(`OpenRouter: trying model ${model} (${i + 1}/${models.length})`);
    
    try {
      const response = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
        top_p: 0.1,
      });
      
      requestTimestamps.push(Date.now());
      
      // Проверяем структуру ответа
      if (!response.choices || !response.choices[0] || !response.choices[0].message) {
        logError(`OpenRouter: Invalid response structure from ${model}`, JSON.stringify(response, null, 2));
        throw new Error(`Invalid response structure from ${model}`);
      }
      
      // Сохраняем успешную модель в кеш
      lastSuccessfulModel = model;
      lastSuccessfulModelTime = Date.now();
      log(`OpenRouter: cached successful model ${model} for next requests`);
      
      return response.choices[0].message.content;
    } catch (error) {
      logError(`OpenRouter error with model ${model}:`, error);
      await sleep(5000);
      
      // Если это последняя модель, выбрасываем ошибку
      if (i === models.length - 1) {
        logError(`OpenRouter: All models failed. Last error:`, error);
        throw error;
      }
      
      // Иначе переходим к следующей модели
      log(`OpenRouter: Trying next model...`);
    }
  }
}

module.exports = {
  sendPrompt,
};
