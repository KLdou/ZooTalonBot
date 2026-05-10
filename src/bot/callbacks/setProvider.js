const { setProvider } = require("../../services/llmService");

async function handleSetProvider(bot, chatId, key) {
  try {
    setProvider(key.provider);
    await bot.sendMessage(chatId, `✅ LLM-провайдер переключён на: ${key.provider}`);
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
  }
}

module.exports = handleSetProvider;
