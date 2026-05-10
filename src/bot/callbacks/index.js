const {
  existsPayload,
  getPayload,
  logError,
} = require("../../utils/helpers");
const handleReject = require("./reject");
const handleEditField = require("./editField");
const handleSetProvider = require("./setProvider");
const handleDocument = require("./document");
const handleTalon = require("./talon");
const { createDocumentFile } = require("../messages/document");
const { createTalonFlow } = require("../messages/talon");

const actionHandlers = {
  edit_field: handleEditField,
  set_provider: handleSetProvider,
};

const payloadTypeHandlers = {
  document: handleDocument,
  talon: handleTalon,
};

async function handleCallbackAction(bot, chatId, key, deps = {}) {
  const callbackDeps = {
    createDocumentFile,
    createTalonFlow,
    ...deps,
  };

  if (typeof key === "object" && key.reject) {
    await handleReject(bot, chatId, key);
    return true;
  }

  if (typeof key === "object" && key.action) {
    const actionHandler = actionHandlers[key.action];
    if (!actionHandler) {
      return false;
    }

    await actionHandler(bot, chatId, key, callbackDeps);
    return true;
  }

  if (!existsPayload(key)) {
    const errorMessage = `Истёк срок действия запроса или данные не найдены для ключа: ${JSON.stringify(
      key,
    )}`;
    await bot.sendMessage(chatId, errorMessage);
    logError(
      `Ошибка при обработке запроса от ${chatId}`,
      new Error(errorMessage),
    );
    return true;
  }

  const { type } = getPayload(key);
  const handler = payloadTypeHandlers[type];
  if (!handler) {
    return false;
  }

  await handler(bot, chatId, key, callbackDeps);
  return true;
}

module.exports = { handleCallbackAction };
