const { fetchToken } = require("../../services/api");
const { matchEntity } = require("../../services/llmService");
const {
  normalizePhoneNumber,
  storeEditSession,
  removeEditSession,
} = require("../../utils/helpers");
const { validateAllFields } = require("../../utils/validators");

async function validateSpecialFields(session, field, newValue) {
  if (field === "clinic" && session.refLists && session.refLists.clinics) {
    const matchedClinic = await matchEntity(
      "clinic",
      session.refLists.clinics,
      newValue,
    );

    if (!matchedClinic.id || matchedClinic.name === "") {
      return {
        valid: false,
        error: `Клиника "${newValue}" не найдена в системе. Проверьте название.`,
      };
    }

    return { valid: true, matchedEntity: matchedClinic };
  }

  if (field === "type" && session.refLists && session.refLists.goals) {
    const matchedGoal = await matchEntity(
      "type",
      session.refLists.goals,
      newValue,
    );

    if (!matchedGoal.id || matchedGoal.name === "") {
      return {
        valid: false,
        error: `Тип лечения "${newValue}" не найден. Проверьте название.`,
      };
    }

    return { valid: true, matchedEntity: matchedGoal };
  }

  return { valid: true };
}

async function handleFieldEdit(bot, chatId, session, newValue, processNames) {
  const field = session.editingField;
  const sessionKey = session.key;

  session.baseData[field] = newValue.trim();

  if (field === "phone") {
    session.baseData.phone = normalizePhoneNumber(newValue);
  }

  const specialValidation = await validateSpecialFields(
    session,
    field,
    newValue.trim(),
  );

  if (!specialValidation.valid) {
    await bot.sendMessage(
      chatId,
      `❌ ${specialValidation.error}\n\nПожалуйста, введите корректное значение:`,
    );
    return;
  }

  session.editingField = null;

  const validationErrors = validateAllFields(session.baseData);

  if (Object.keys(validationErrors).length > 0) {
    await bot.sendMessage(
      chatId,
      "✅ Значение обновлено. Проверяю остальные поля...",
    );
    await showDataEditInterface(
      bot,
      chatId,
      session.baseData,
      validationErrors,
      session.refLists,
    );
    return;
  }

  await bot.sendMessage(chatId, "✅ Все данные корректны! Продолжаю обработку...");

  removeEditSession(sessionKey);

  const token = await fetchToken();
  const names = Array.isArray(session.baseData.animal_name)
    ? session.baseData.animal_name
    : [session.baseData.animal_name];

  await processNames(names, bot, chatId, session.baseData, token);
}

async function showDataEditInterface(bot, chatId, baseData, errors, refLists) {
  storeEditSession(chatId, baseData, errors, refLists);

  let message = "⚠️ Обнаружены проблемы с данными:\n\n";

  const fieldLabels = {
    fio: "👤 ФИО",
    phone: "📞 Телефон",
    address: "📍 Адрес",
    clinic: "🏥 Клиника",
    animal_type: "🐾 Тип животного",
    coat_color: "🎨 Окрас животного",
    animal_name: "🐾 Имя животного",
    type: "🎯 Цель визита",
    date: "📅 Дата",
  };

  for (const [field, label] of Object.entries(fieldLabels)) {
    const value = baseData[field] || "(не указано)";
    const hasError = errors[field];
    const icon = hasError ? "❌" : "✅";

    message += `${icon} ${label}: ${value}\n`;
    if (hasError) {
      message += `   └─ ${errors[field]}\n`;
    }
  }

  message += "\n📝 Выберите поле для редактирования:";

  const keyboard = [];

  for (const [field] of Object.entries(errors)) {
    const label = fieldLabels[field] || field;
    keyboard.push([
      {
        text: `✏️ Исправить ${label}`,
        callback_data: JSON.stringify({
          action: "edit_field",
          field: field,
          chat: chatId,
        }),
      },
    ]);
  }

  keyboard.push([
    {
      text: "❌ Отменить",
      callback_data: JSON.stringify({ reject: true }),
    },
  ]);

  await bot.sendMessage(chatId, message, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

module.exports = {
  handleFieldEdit,
  showDataEditInterface,
};
