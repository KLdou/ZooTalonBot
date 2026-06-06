const {
  parseRussianMonth,
  getBelarusYearForMonth,
  getRecentMonths,
  createDocumentsArchive,
} = require("../../utils/documentArchive");
const { logError } = require("../../utils/helpers");

const name = "/documents";
const description = "Получить ZIP-архив документов за указанный месяц (использование: /documents месяц)";

function getMonthArgument(text) {
  const parts = String(text || "").trim().split(/\s+/);
  return parts[1] || "";
}

async function sendArchive(bot, chatId, month, year, options = {}) {
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
}

async function handle(bot, msg, options = {}) {
  const chatId = msg.chat.id;
  const rawMonth = getMonthArgument(msg.text);

  if (!rawMonth) {
    const recent = getRecentMonths(options.now || new Date());
    const keyboard = recent.map((item) => [
      {
        text: `${item.nominative.charAt(0).toUpperCase() + item.nominative.slice(1)} ${item.year}`,
        callback_data: JSON.stringify({ action: "send_docs", month: item.index, year: item.year }),
      },
    ]);

    await bot.sendMessage(
      chatId,
      "Выберите месяц для выгрузки документов:",
      {
        reply_markup: { inline_keyboard: keyboard },
      },
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
    await sendArchive(bot, chatId, month, year, options);
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
  description,
  handle,
  sendArchive,
  getMonthArgument,
};
