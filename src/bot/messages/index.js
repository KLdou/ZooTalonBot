const { fetchToken, getCouponRefListsCached } = require("../../services/api");
const { matchEntity, parseUserMessage } = require("../../services/llmService");
const {
  getActiveEditSession,
  normalizePhoneNumber,
} = require("../../utils/helpers");
const { validateAllFields } = require("../../utils/validators");
const { checkDocument } = require("./document");
const { handleFieldEdit, showDataEditInterface } = require("./editField");
const { createTalonFlow } = require("./talon");

async function processName(name, bot, chatId, baseData, token) {
  const documentResult = await checkDocument(
    name,
    bot,
    chatId,
    baseData,
    token,
  );
  if (documentResult.status !== "document_found") {
    return documentResult;
  }

  await createTalonFlow(
    bot,
    chatId,
    baseData,
    documentResult.document,
    token,
    name,
  );
  return { status: "talon_created", name };
}

async function processNames(names, bot, chatId, baseData, token) {
  const results = [];
  for (const name of names) {
    const result = await processName(name, bot, chatId, baseData, token);
    results.push(result);
  }

  const confirmationNeeded = results.find(
    (result) => result.status === "await_confirmation",
  );
  if (confirmationNeeded) {
    return results;
  }

  const errors = results.filter((result) => result.status === "error");
  if (errors.length > 0) {
    await bot.sendMessage(
      chatId,
      `Ошибки при обработке: ${errors
        .map((error) => `${error.name} - ${error.error}`)
        .join(", ")}`,
    );
  }

  return results;
}

async function handleUserMessage(bot, msg) {
  const chatId = msg.chat.id;

  const editSession = getActiveEditSession(chatId);
  if (editSession && editSession.editingField) {
    await handleFieldEdit(bot, chatId, editSession, msg.text, processNames);
    return;
  }

  const baseData = await parseUserMessage(msg.text);
  const names = Array.isArray(baseData.animal_name)
    ? baseData.animal_name
    : [baseData.animal_name];

  if (baseData.phone) {
    baseData.phone = normalizePhoneNumber(baseData.phone);
  }

  const token = await fetchToken();
  const { types, clinics, goals } = await getCouponRefListsCached(token);

  const matchedType = await matchEntity("source", types, "call-center");
  const matchedClinic = await matchEntity("clinic", clinics, baseData.clinic);
  const matchedGoal = await matchEntity("type", goals, baseData.type);

  const validationErrors = validateAllFields(baseData);

  if (!matchedClinic.id || matchedClinic.name === "") {
    validationErrors.clinic = `Клиника "${baseData.clinic}" не найдена в системе. Проверьте название.`;
  }

  if (!matchedGoal.id || matchedGoal.name === "") {
    validationErrors.type = `Цель визита "${baseData.type}" не найдена. Проверьте название.`;
  }

  if (!matchedType.id || matchedType.name === "") {
    validationErrors.source = `Источник "call-center" не найден в системе.`;
  }

  if (Object.keys(validationErrors).length > 0) {
    await showDataEditInterface(bot, chatId, baseData, validationErrors, {
      types,
      clinics,
      goals,
    });
    return;
  }

  await processNames(names, bot, chatId, baseData, token);
}

module.exports = {
  handleUserMessage,
  processName,
  processNames,
};
