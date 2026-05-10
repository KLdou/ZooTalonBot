const { log } = require("../../utils/helpers");

async function handleReject(bot, chatId) {
  await bot.sendMessage(chatId, "❌ Запрос отменён.");
  log(`Отклонён запрос от ${chatId}`);
}

module.exports = handleReject;
