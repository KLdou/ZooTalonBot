const { log, logError, getAllowedUsers } = require("../utils/helpers");
const { validateInvite } = require("../services/inviteService");
const {
  startWizard,
  handleStepInput,
  hasActiveSession,
  clearSession,
} = require("./wizard/talonWizard");
const { handleCallbackAction } = require("./callbacks");
const { handleCommand } = require("./comands");
const { handleUserMessage } = require("./messages");

const ALLOWED_WIZARD_ACTIONS = new Set([
  "wiz_back",
  "wiz_cancel",
  "wiz_to_review",
  "wiz_edit",
  "wiz_set",
  "wiz_skip",
  "wiz_clinic",
  "wiz_goal",
  "wiz_submit",
]);

async function handleCallback(bot, query) {
  log(`🔁 callback_query: ${JSON.stringify(query)}`);
  const chatId = query.message.chat.id;
  const userId = query.from?.id || chatId;
  const allowedUsers = getAllowedUsers();
  const isAdmin = allowedUsers.includes(userId);

  try {
    const key = JSON.parse(query.data);

    // Не-админам разрешены ТОЛЬКО строго определенные действия визарда
    const isWizardAction =
      typeof key === "object" &&
      typeof key.action === "string" &&
      ALLOWED_WIZARD_ACTIONS.has(key.action);

    if (!isAdmin && !isWizardAction) {
      log(`⛔ Неавторизованный callback от ${userId}: ${query.data}`);
      await bot.sendMessage(
        chatId,
        "🔒 Действие доступно только администраторам.",
      );
      return;
    }

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
  const allowedUsers = getAllowedUsers();
  const isAdmin = allowedUsers.includes(chatId);
  const text = msg.text ? msg.text.trim() : "";

  log(`📩 Получено сообщение от ${chatId} (${msg.from?.username || msg.from?.first_name || "id"}): ${text}`);

  // 1. Обработка команды /start (с инвайтом или без)
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const startPayload = parts[1] || "";

    if (startPayload) {
      const inviteValidation = validateInvite(startPayload);
      if (inviteValidation.valid) {
        log(`Пользователь ${chatId} начал оформление по инвайту ${startPayload}`);
        await startWizard(bot, chatId, msg.from, inviteValidation.invite);
        return;
      } else {
        await bot.sendMessage(
          chatId,
          `⚠️ *Не удалось войти по приглашению:*\n\n${inviteValidation.reason}\n\nПожалуйста, обратитесь к куратору/администратору за новой ссылкой.`,
          { parse_mode: "Markdown" },
        );
        return;
      }
    }

    if (isAdmin) {
      await bot.sendMessage(
        chatId,
        `👋 *Здравствуйте, администратор!*\n\nВы можете:\n• Создать ссылку-приглашение: \`/invite [метка]\`\n• Посмотреть активные ссылки: \`/invites\`\n• Отправить текст заявки в свободной форме для прямого создания талона\n• Выгрузить документы: \`/documents\`\n• Посмотреть статистику: \`/gettalonstat\`\n• Узнать обо всех командах: \`/help\``,
        { parse_mode: "Markdown" },
      );
      return;
    } else {
      await bot.sendMessage(
        chatId,
        `🔒 *Оформление талонов доступно только по приглашению администратора.*\n\nЕсли вам необходимо оформить ветеринарный талон на животное, пожалуйста, обратитесь к куратору вашей группы для получения персональной ссылки-приглашения.`,
        { parse_mode: "Markdown" },
      );
      return;
    }
  }

  // 2. Обработка отмены активного визарда
  if (text === "/cancel" && hasActiveSession(chatId)) {
    clearSession(chatId);
    await bot.sendMessage(
      chatId,
      "❌ Оформление заявки отменено. Ваша ссылка-приглашение осталась активна.",
    );
    return;
  }

  // 3. Если у пользователя активна сессия пошаговой анкеты (Wizard)
  if (hasActiveSession(chatId)) {
    const handled = await handleStepInput(bot, chatId, msg);
    if (handled) return;
  }

  // 4. Проверка прав администратора для обычных команд и свободного текста
  if (!isAdmin) {
    bot.sendMessage(
      chatId,
      "🔒 Оформление талонов доступно только по персональному приглашению администратора. Пожалуйста, используйте выданную вам ссылку.",
    );
    console.log(`Неавторизованный пользователь ${chatId} попытался отправить: ${text}`);
    return;
  }

  // 5. Обработка команд администратора
  if (await handleCommand(bot, msg)) {
    return;
  }

  // 6. Обработка текстового сообщения администратора через LLM
  try {
    await handleUserMessage(bot, msg);
  } catch (err) {
    logError(`Ошибка обработки запроса от админа ${chatId}`, err);
    bot.sendMessage(chatId, `Ошибка обработки запроса: ${err.message}`);
  }
}

module.exports = { handleMessage, handleCallback };
