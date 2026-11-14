const { fetchToken } = require("../../services/api");
const {
  getPayload,
  removePayload,
  log,
  logError,
  getAllowedUsers,
} = require("../../utils/helpers");
const { processNames } = require("../messages/index");

async function handleApproveWizard(bot, chatId, key, deps = {}) {
  const allowedUsers = getAllowedUsers();
  if (!allowedUsers.includes(chatId)) {
    await bot.sendMessage(
      chatId,
      "🔒 Одобрение заявок доступно только администраторам.",
    );
    return;
  }

  const requestId = key.id;
  const request = getPayload(requestId);

  if (!request || !request.baseData) {
    await bot.sendMessage(
      chatId,
      "⚠️ Данные заявки не найдены или уже были обработаны.",
    );
    return;
  }

  const { baseData, names, applicantChatId } = request;
  removePayload(requestId);

  await bot.sendMessage(
    chatId,
    `⏳ Заявка от *${baseData.fio}* одобрена. Запуск создания документов и талонов...`,
    { parse_mode: "Markdown" },
  );

  try {
    const token = await fetchToken();
    const processFn = deps.processNames || processNames;
    const petNames = Array.isArray(names) && names.length > 0
      ? names
      : (Array.isArray(baseData.animal_name) ? baseData.animal_name : [baseData.animal_name]);

    log(`Одобрена заявка из визарда для ${baseData.fio} админом ${chatId}`);
    await processFn(petNames, bot, chatId, baseData, token);

    // Уведомление заявителю
    if (applicantChatId) {
      try {
        await bot.sendMessage(
          applicantChatId,
          `🎉 *Ваша заявка одобрена!*
Куратор запустил оформление талона для: *${petNames.join(", ")}*.
После выпуска талона документ будет зарегистрирован в системе.`,
          { parse_mode: "Markdown" },
        );
      } catch (userNoticeErr) {
        logError(`Не удалось отправить уведомление заявителю ${applicantChatId}`, userNoticeErr);
      }
    }
  } catch (error) {
    logError(`Ошибка при обработке заявки из визарда для ${baseData.fio}`, error);
    await bot.sendMessage(
      chatId,
      `❌ Ошибка при создании талона по заявке: ${error.message}`,
    );
  }
}

async function handleRejectWizard(bot, chatId, key) {
  const allowedUsers = getAllowedUsers();
  if (!allowedUsers.includes(chatId)) {
    await bot.sendMessage(
      chatId,
      "🔒 Отклонение заявок доступно только администраторам.",
    );
    return;
  }

  const requestId = key.id;
  const request = getPayload(requestId);

  if (requestId) {
    removePayload(requestId);
  }

  const applicant = request?.baseData?.fio ? ` от *${request.baseData.fio}*` : "";
  await bot.sendMessage(
    chatId,
    `❌ Заявка${applicant} отклонена.`,
    { parse_mode: "Markdown" },
  );

  // Уведомление заявителю
  if (request?.applicantChatId) {
    try {
      await bot.sendMessage(
        request.applicantChatId,
        `ℹ️ Ваша заявка на талон была отклонена куратором.
Если у вас есть вопросы, пожалуйста, свяжитесь с администратором для уточнения деталей.`,
      );
    } catch (userNoticeErr) {
      logError(`Не удалось отправить уведомление об отклонении заявителю ${request.applicantChatId}`, userNoticeErr);
    }
  }

  log(`Заявка из визарда отклонена админом ${chatId}`);
}

module.exports = {
  handleApproveWizard,
  handleRejectWizard,
};
