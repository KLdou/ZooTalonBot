const { MONTHS } = require("../../utils/documentArchive");
const { sendArchive } = require("../comands/documents");
const { logError } = require("../../utils/helpers");

async function handleSendDocs(bot, chatId, key, deps = {}) {
  try {
    const month = MONTHS.find((m) => m.index === key.month);
    if (!month) {
      throw new Error(`Неизвестный месяц: ${key.month}`);
    }

    await sendArchive(bot, chatId, month, key.year, deps);
  } catch (err) {
    logError("Ошибка обработки callback documents", err);
    await bot.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
  }
}

module.exports = handleSendDocs;
