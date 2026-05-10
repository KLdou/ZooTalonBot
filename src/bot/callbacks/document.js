const { fetchToken, createDocument } = require("../../services/api");
const { getPayload, removePayload, log } = require("../../utils/helpers");

async function handleDocument(bot, chatId, key, deps) {
  const token = await fetchToken();
  const { payload, baseData } = getPayload(key);
  const doc = await createDocument(payload, token);

  try {
    deps.createDocumentFile(baseData, bot, chatId);
  } catch {}

  removePayload(key);

  await bot.sendMessage(
    chatId,
    `✅ Документ создан.\nИмя документа: ${doc.name}\nhttps://petapps.org/document/${doc.documentId}`,
  );
  log(`Документ создан: ${doc.name}`);

  await deps.createTalonFlow(bot, chatId, baseData, doc, token, payload.pet);
}

module.exports = handleDocument;
