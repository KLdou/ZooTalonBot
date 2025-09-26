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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPrompt(prompt, model = process.env.OPEN_ROUTER_MODEL) {
  await sleep(1000);
  // Удаляем старые таймстемпы
  const now = Date.now();
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
    
    // Логируем весь response для отладки
    log(`OpenRouter response:`, JSON.stringify(response, null, 2));
    
    requestTimestamps.push(Date.now());
    
    // Проверяем структуру ответа
    if (!response.choices || !response.choices[0] || !response.choices[0].message) {
      logError('OpenRouter: Invalid response structure', response);
      throw new Error('Invalid response structure from OpenRouter');
    }
    
    return response.choices[0].message.content;
  } catch (error) {
    logError(`OpenRouter error`, error);
    await sleep(REQUEST_WINDOW_MS);
    if (model === process.env.OPEN_ROUTER_MODEL) {
      return await sendPrompt(prompt, process.env.OPEN_ROUTER_MODEL_RESERVE);
    }

    throw error;
  }
}

module.exports = {
  sendPrompt,
};
