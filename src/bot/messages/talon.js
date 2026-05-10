const { getCouponRefListsCached } = require("../../services/api");
const { matchEntity } = require("../../services/llmService");
const { confirmationKeyboard, storePayload } = require("../../utils/helpers");

const API_USER = "5fe385b10c6dd3a023270d10";

async function createTalonFlow(
  bot,
  chatId,
  baseData,
  docInfoOrDoc,
  token,
  name,
) {
  const { types, clinics, goals } = await getCouponRefListsCached(token);

  const matchedType = await matchEntity("source", types, "call center");
  const matchedClinic = await matchEntity("clinic", clinics, baseData.clinic);
  const matchedGoal = await matchEntity("type", goals, baseData.type);

  const talonPayload = {
    type: matchedType?.id,
    vet: matchedClinic?.id,
    visitor: baseData.fio,
    user: API_USER,
    goal: matchedGoal?.id,
    applicationRequired: true,
    application: docInfoOrDoc.documentId,
  };

  const missingFields = Object.entries(talonPayload)
    .filter(([key, val]) => !val || val === "")
    .map(([key]) => key);

  if (missingFields.length > 0) {
    await bot.sendMessage(
      chatId,
      `❌ Невозможно создать талон. Отсутствуют значения для: ${missingFields.join(
        ", ",
      )}`,
    );
    return;
  }

  const key = storePayload(chatId, { type: "talon", payload: talonPayload });

  await bot.sendMessage(
    chatId,
    `Создать талон для животного: ${name}
ФИО Владельца: ${baseData.fio}
Документ: ${docInfoOrDoc.name}
Клиника: ${matchedClinic.name}
Цель: ${matchedGoal.name}
От кого: ${matchedType.name}`,
    confirmationKeyboard(key),
  );
}

module.exports = {
  createTalonFlow,
};
