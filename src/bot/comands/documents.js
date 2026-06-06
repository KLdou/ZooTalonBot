const {
  parseRussianMonth,
  getBelarusYearForMonth,
  createDocumentsArchive,
} = require("../../utils/documentArchive");
const { logError } = require("../../utils/helpers");

const name = "/documents";

function getMonthArgument(text) {
  const parts = String(text || "").trim().split(/\s+/);
  return parts[1] || "";
}

async function handle(bot, msg, options = {}) {
  const chatId = msg.chat.id;
  const rawMonth = getMonthArgument(msg.text);

  if (!rawMonth) {
    await bot.sendMessage(
      chatId,
      "Использование: /documents июнь\nКоманда принимает месяц на русском языке и отправляет ZIP с документами за ближайший прошедший или текущий такой месяц.",
    );
    return;
  }

  const month = parseRussianMonth(rawMonth);
  if (!month) {
    await bot.sendMessage(
      chatId,
      `Не понял месяц "${rawMonth}". Пример команды: /documents июнь`,
    );
    return;
  }

  const year = getBelarusYearForMonth(month.index, options.now || new Date());

  try {
    const archive = createDocumentsArchive({
      documentsDir: options.documentsDir,
      month: month.index,
      year,
      preferMtimeForTests: options.preferMtimeForTests,
    });

    if (archive.count === 0) {
      await bot.sendMessage(
        chatId,
        `Документы за ${month.nominative} ${year} не найдены.`,
      );
      return;
    }

    await bot.sendDocument(
      chatId,
      archive.buffer,
      {
        caption: `Документы за ${month.nominative} ${year}: ${archive.count}`,
      },
      {
        filename: archive.fileName,
        contentType: "application/zip",
      },
    );
  } catch (error) {
    logError("Ошибка при создании архива документов", error);
    await bot.sendMessage(
      chatId,
      `Ошибка при создании архива документов: ${error.message}`,
    );
  }
}

module.exports = {
  name,
  handle,
  getMonthArgument,
};
