const { fetchToken, createDocument } = require("../../services/api");
const { getPayload, removePayload, log, logError } = require("../../utils/helpers");

async function handleDocument(bot, chatId, key, deps) {
  const token = await fetchToken();
  const { payload, baseData } = getPayload(key);
  const doc = await createDocument(payload, token);

  try {
    Promise.resolve(deps.createDocumentFile(baseData, bot, chatId)).catch((error) =>
      logError("Ошибка создания или отправки файла документа", error),
    );
  } catch (error) {
    logError("Ошибка запуска создания файла документа", error);
  }

  removePayload(key);

  await bot.sendMessage(
    chatId,
    `✅ Документ создан.\nИмя документа: ${doc.name}\nhttps://petapps.org/document/${doc.documentId}`,
  );
  log(`Документ создан: ${doc.name}`);

  await deps.createTalonFlow(bot, chatId, baseData, doc, token, payload.pet);
}

module.exports = handleDocument;
