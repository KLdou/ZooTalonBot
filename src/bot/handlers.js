const { log, logError } = require("../utils/helpers");
const { handleCallbackAction } = require("./callbacks");
const { handleCommand } = require("./comands");
const { handleUserMessage } = require("./messages");

const allowedUsers = [653859626, 485720926];

async function handleCallback(bot, query) {
  log(`🔁 callback_query: ${JSON.stringify(query)}`);
  const chatId = query.message.chat.id;
  try {
    const key = JSON.parse(query.data);
    const handled = await handleCallbackAction(bot, chatId, key);

    if (!handled) {
      await bot.sendMessage(chatId, "❌ Неизвестное действие callback.");
    }
  } catch (err) {
    const errorMessage = `Ошибка при подтверждении: ${err.message}`;
    bot.sendMessage(chatId, errorMessage);
    logError(`Ошибка при обработке запроса от ${chatId}`, err);
  }
}

async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  if (!allowedUsers.includes(chatId)) {
    bot.sendMessage(chatId, "Вам не разрешено использование данного бота.");
    console.log(`Данный пользователь хотел воспользоваться ботом
${JSON.stringify(msg.chat)}`);
    return;
  }

  log(`📩 Получено сообщение от ${chatId}: ${msg.text}`);

  if (await handleCommand(bot, msg)) {
    return;
  }

  try {
    await handleUserMessage(bot, msg);
  } catch (err) {
    logError(`Ошибка обработки запроса от ${chatId}`, err);
    bot.sendMessage(chatId, `Ошибка обработки запроса: ${err.message}`);
  }
}

module.exports = { handleMessage, handleCallback };
