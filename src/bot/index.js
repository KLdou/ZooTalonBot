require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { log } = require("../utils/helpers");
const { handleMessage, handleCallback } = require("./handlers");
let bot;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
function createBot() {
  // Уничтожаем предыдущий экземпляр бота, если он существует
  if (bot) {
    try {
      bot.stopPolling();
    } catch (e) {
      log('Error while stopping previous bot:', e);
    }
  }

  // Создаем новый экземпляр бота
  bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: true,
    // Дополнительные опции для лучшей обработки ошибок
    request: {
      timeout: 60000,
      agent: null
    }
  });

  // Обработчики событий
  bot.on("message", (msg) => handleMessage(bot, msg));
  bot.on("callback_query", (query) => handleCallback(bot, query));

  // Обработка ошибок polling
  bot.on("polling_error", (error) => {
    log('Polling error:', error.code, error.message);
    
    // Перезапускаем бота при фатальных ошибках
    if (error.code === 'EFATAL' || error.message.includes('ECONNRESET')) {
      log('Restarting bot due to fatal error...');
      setTimeout(createBot, 5000); // Перезапуск через 5 секунд
    }
  });

  bot.on("webhook_error", (error) => {
    log('Webhook error:', error);
  });

  log('Bot started successfully');
}

createBot();
log("🚀 Бот для zoo талонов запущен...");
