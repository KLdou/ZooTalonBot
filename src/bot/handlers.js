const {
  log,
  logError,
  confirmationKeyboard,
  storePayload,
  existsPayload,
  getPayload,
  removePayload,
  normalizePhoneNumber,
  formatPhoneNumber,
  storeEditSession,
  getEditSession,
  getActiveEditSession,
  updateEditSession,
  removeEditSession,
} = require("../utils/helpers");
const {
  fetchToken,
  getDocuments,
  getDocumentsWithSearch,
  getRefList,
  getRefListCached,
  createCoupon,
  createDocument,
} = require("../services/api");
const {
  findDocument,
  matchEntity,
  parseUserMessage,
  askSimpleQuestion,
  formatAddress,
  formatGoal,
  formatPet,
  formatMonth,
  formatShortFio,
} = require("../services/llmService");
const { validateAllFields } = require("../utils/validators");
const { openAndReplacePlaceholders } = require("../utils/docxGenerator");
const path = require("path");

const API_USER = "5fe385b10c6dd3a023270d10";
const allowedUsers = [653859626, 485720926];
async function handleCallback(bot, query) {
  log(`🔁 callback_query: ${JSON.stringify(query)}`);
  const chatId = query.message.chat.id;
  try {
    const key = JSON.parse(query.data);

    if (typeof key === "object" && key.reject) {
      bot.sendMessage(chatId, "❌ Запрос отменён.");
      log(`Отклонён запрос от ${chatId}`);
      return;
    }

    // НОВОЕ: Обработка запроса на редактирование поля
    if (key.action === "edit_field") {
      await startFieldEdit(bot, chatId, key.session, key.field);
      return;
    }

    if (!existsPayload(key)) {
      const errorMessage = `Истёк срок действия запроса или данные не найдены для ключа: ${JSON.stringify(
        key
      )}`;
      bot.sendMessage(chatId, errorMessage);
      logError(
        `Ошибка при обработке запроса от ${chatId}`,
        new Error(errorMessage)
      );
      return;
    }

    const { type, payload } = getPayload(key);

    if (type === "document") {
      const token = await fetchToken();
      const { payload, baseData } = getPayload(key);
      const doc = await createDocument(payload, token);
      try {
        CreateDocumentFile(baseData, bot, chatId);
      } catch {}

      removePayload(key);

      bot.sendMessage(
        chatId,
        `✅ Документ создан.\nИмя документа: ${doc.name}\nhttps://petapps.org/document/${doc.documentId}`
      );
      log(`Документ создан: ${doc.name}`);

      await createTalonFlow(bot, chatId, baseData, doc, token, payload.pet);
    }

    if (type === "talon") {
      const token = await fetchToken();
      const newCoupon = await createCoupon(payload, token);
      removePayload(key);
      bot.sendMessage(
        chatId,
        `✅ Талон создан.\nНомер: ${newCoupon.name}\nhttps://petapps.org/coupon/${newCoupon.couponId}`
      );
      log(`Талон создан для ${payload.visitor}`);
      return;
    }
  } catch (err) {
    const errorMessage = `Ошибка при подтверждении: ${err.message}`;
    bot.sendMessage(chatId, errorMessage);
    logError(`Ошибка при обработке запроса от ${chatId}`, err);
  }
}

async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  if (!allowedUsers.includes(chatId)) {
    bot.sendMessage(chatId, "Вам не разрешено использование данного бота.");
    console.log(`Данный пользователь хотел воспользоваться ботом
${JSON.stringify(msg.chat)}`);
    return;
  }

  log(`📩 Получено сообщение от ${chatId}: ${msg.text}`);

  try {
    // Проверяем, не находимся ли мы в режиме редактирования
    const editSession = getActiveEditSession(chatId);
    if (editSession && editSession.editingField) {
      // Пользователь отправил новое значение для редактируемого поля
      await handleFieldEdit(bot, chatId, editSession, msg.text);
      return;
    }

    const baseData = await parseUserMessage(msg.text);
    const names = Array.isArray(baseData.animal_name)
      ? baseData.animal_name
      : [baseData.animal_name];
    if (baseData.phone) {
      baseData.phone = normalizePhoneNumber(baseData.phone);
    }

    // Валидация всех полей
    const validationErrors = validateAllFields(baseData);

    if (Object.keys(validationErrors).length > 0) {
      // Найдены ошибки - загружаем справочники и показываем интерфейс редактирования
      const token = await fetchToken();
      
      // Загружаем справочники с кешированием
      const types = await getRefListCached("/coupon-secured/v1/type", token, "types");
      const clinics = await getRefListCached("/coupon-secured/v1/vet", token, "clinics");
      const goals = await getRefListCached("/coupon-secured/v1/goal?type=", token, "goals");
      
      const refLists = { types, clinics, goals };
      
      await showDataEditInterface(bot, chatId, baseData, validationErrors, refLists);
      return;
    }

    const token = await fetchToken();

    // Обрабатываем каждое имя последовательно для снижения нагрузки на сервер
    const results = [];
    for (const name of names) {
      const result = await processName(name, bot, chatId, baseData, token);
      results.push(result);
    }

    // Анализируем результаты
    const confirmationNeeded = results.find(
      (r) => r.status === "await_confirmation"
    );
    if (confirmationNeeded) {
      return; // Ждём подтверждения от пользователя
    }

    const errors = results.filter((r) => r.status === "error");
    if (errors.length > 0) {
      await bot.sendMessage(
        chatId,
        `Ошибки при обработке: ${errors
          .map((e) => `${e.name} - ${e.error}`)
          .join(", ")}`
      );
    }
  } catch (err) {
    logError(`Ошибка обработки запроса от ${chatId}`, err);
    bot.sendMessage(chatId, `Ошибка обработки запроса: ${err.message}`);
  }
}

async function processName(name, bot, chatId, baseData, token) {
  try {
    const docs = await getDocumentsWithSearch(name, token);
    const docInfo = await findDocument(docs, baseData.fio, name);

    if (!docInfo || !docInfo.exist) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const newDocPayload = {
        type: "ADMISSION_APPLICATION",
        pet: name,
        applicant: baseData.fio,
        phone: baseData.phone,
        address: baseData.address,
        date: startOfDay.toISOString(),
      };

      const missingDocFields = Object.entries(newDocPayload)
        .filter(([key, val]) => !val || val === "")
        .map(([key]) => key);

      if (missingDocFields.length > 0) {
        await bot.sendMessage(
          chatId,
          `❌ Невозможно создать документ. Отсутствуют значения для: ${missingDocFields.join(
            ", "
          )}`
        );
        return { status: "missing_fields", name };
      }

      const docKey = storePayload(chatId, {
        type: "document",
        payload: newDocPayload,
        baseData: baseData,
      });

      await bot.sendMessage(
        chatId,
        `Создать документ для животного: ${name}\nФИО Владельца: ${baseData.fio}`,
        confirmationKeyboard(docKey)
      );

      return { status: "await_confirmation", name, docKey };
    }

    await createTalonFlow(bot, chatId, baseData, docInfo, token, name);
    return { status: "talon_created", name };
  } catch (error) {
    logError(`Error processing ${name}`, error);
    return { status: "error", name, error };
  }
}

async function createTalonFlow(
  bot,
  chatId,
  baseData,
  docInfoOrDoc,
  token,
  name
) {
  const types = await getRefListCached("/coupon-secured/v1/type", token, "types");
  const clinics = await getRefListCached("/coupon-secured/v1/vet", token, "clinics");
  const goals = await getRefListCached("/coupon-secured/v1/goal?type=", token, "goals");

  const matchedType = await matchEntity("source", types, "call center");
  const matchedClinic = await matchEntity("clinic", clinics, baseData.clinic);
  const matchedGoal = await matchEntity("type", goals, baseData.type);

  const talonPayload = {
    type: matchedType.id,
    vet: matchedClinic.id,
    visitor: baseData.fio,
    user: API_USER,
    goal: matchedGoal.id,
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
        ", "
      )}`
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
    confirmationKeyboard(key)
  );
}

async function CreateDocumentFile(baseData, bot, chatId) {
  const today = new Date();

  const address = await formatAddress(baseData.address);
  const goal = await formatGoal(baseData.type);
  const pet = await formatPet(baseData.animal_type, baseData.animal_name);
  const month = await formatMonth(today);
  const shortFio = await formatShortFio(baseData.fio);

  docxPayload = {
    fio: baseData.fio,
    address,
    homePhone: /^\+37517/.test(baseData.phone)
      ? formatPhoneNumber(baseData.phone)
      : "",
    mobilePhone: /^\+375(?!17)\d{9}$/.test(baseData.phone)
      ? formatPhoneNumber(baseData.phone)
      : "",
    goal,
    pet,
    day: today.toLocaleDateString("ru-RU", { day: "2-digit" }),
    month,
    shortFio,
    year: today.toLocaleDateString("en-US", { year: "numeric" }),
  };

  const inputFilename = path.join(
    __dirname,
    "..",
    "..",
    "documents",
    "example.docx"
  );
  const outputFilename = path.join(
    __dirname,
    "..",
    "..",
    "documents",
    `${baseData.animal_name} - ${docxPayload.fio}.docx`
  );

  const newFile = await openAndReplacePlaceholders(
    inputFilename,
    outputFilename,
    docxPayload
  );
  if (bot && chatId && newFile) {
    bot
      .sendDocument(
        chatId,
        newFile,
        {},
        {
          filename: `${baseData.animal_name} - ${docxPayload.fio}.docx`,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
      )
      .then(() => console.log("Файл успешно отправлен!"))
      .catch((err) => logError("Ошибка отправки", err));
  }

  return newFile;
}

/**
 * Валидация специальных полей (clinic, type) через закешированные справочники
 * @param {Object} session - Сессия редактирования
 * @param {string} field - Имя поля
 * @param {string} newValue - Новое значение
 * @returns {Promise<{valid: boolean, error?: string, matchedEntity?: Object}>}
 */
async function validateSpecialFields(session, field, newValue) {
  if (field === "clinic" && session.refLists && session.refLists.clinics) {
    const matchedClinic = await matchEntity(
      "clinic",
      session.refLists.clinics,
      newValue
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
      newValue
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

/**
 * Обработка редактирования поля
 * @param {Object} bot - Экземпляр бота
 * @param {number} chatId - ID чата
 * @param {Object} session - Сессия редактирования
 * @param {string} newValue - Новое значение поля
 */
async function handleFieldEdit(bot, chatId, session, newValue) {
  const field = session.editingField;
  const sessionKey = session.key;

  // Обновляем значение поля
  session.baseData[field] = newValue.trim();

  // Применяем нормализацию для специальных полей
  if (field === "phone") {
    session.baseData.phone = normalizePhoneNumber(newValue);
  }

  // Валидация специальных полей (clinic, type)
  const specialValidation = await validateSpecialFields(
    session,
    field,
    newValue.trim()
  );

  if (!specialValidation.valid) {
    // Валидация не прошла - показываем ошибку и просим ввести снова
    await bot.sendMessage(
      chatId,
      `❌ ${specialValidation.error}\n\nПожалуйста, введите корректное значение:`
    );
    return;
  }

  // Убираем флаг редактирования
  session.editingField = null;

  // Повторная валидация ВСЕХ полей
  const validationErrors = validateAllFields(session.baseData);

  if (Object.keys(validationErrors).length > 0) {
    // Всё ещё есть ошибки - показываем интерфейс снова
    await bot.sendMessage(
      chatId,
      "✅ Значение обновлено. Проверяю остальные поля..."
    );
    await showDataEditInterface(
      bot,
      chatId,
      session.baseData,
      validationErrors,
      session.refLists
    );
  } else {
    // Все поля валидны - переходим к обычному flow
    await bot.sendMessage(
      chatId,
      "✅ Все данные корректны! Продолжаю обработку..."
    );

    // Удаляем сессию редактирования
    removeEditSession(sessionKey);

    // Продолжаем обычную логику обработки
    const token = await fetchToken();
    const names = Array.isArray(session.baseData.animal_name)
      ? session.baseData.animal_name
      : [session.baseData.animal_name];

    const results = [];
    for (const name of names) {
      const result = await processName(
        name,
        bot,
        chatId,
        session.baseData,
        token
      );
      results.push(result);
    }

    // Анализируем результаты
    const confirmationNeeded = results.find(
      (r) => r.status === "await_confirmation"
    );
    if (confirmationNeeded) {
      return;
    }

    const errors = results.filter((r) => r.status === "error");
    if (errors.length > 0) {
      await bot.sendMessage(
        chatId,
        `Ошибки при обработке: ${errors
          .map((e) => `${e.name} - ${e.error}`)
          .join(", ")}`
      );
    }
  }
}

/**
 * Начало редактирования конкретного поля
 * @param {Object} bot - Экземпляр бота
 * @param {number} chatId - ID чата
 * @param {string} sessionKey - Ключ сессии редактирования
 * @param {string} field - Имя поля для редактирования
 */
async function startFieldEdit(bot, chatId, sessionKey, field) {
  const session = getEditSession(sessionKey);
  if (!session) {
    await bot.sendMessage(
      chatId,
      "❌ Сессия редактирования истекла. Отправьте данные заново."
    );
    return;
  }

  // Обновляем сессию - помечаем, какое поле редактируется
  session.editingField = field;
  updateEditSession(sessionKey, session);

  // Подсказки для каждого поля
  const fieldPrompts = {
    fio: "Введите ФИО в формате: Фамилия Имя Отчество",
    phone: "Введите номер телефона в формате: +375XXXXXXXXX",
    address: "Введите полный адрес (улица, дом, квартира)",
    clinic: "Введите название клиники",
    animal_type: "Введите тип животного (кошка, собака и т.д.)",
    animal_name: "Введите кличку животного",
    type: "Введите цель визита (стерилизация, лечение и т.д.)",
    date: "Введите дату в формате ДД.ММ.ГГГГ или оставьте пустым для текущей даты",
  };

  const prompt = fieldPrompts[field] || `Введите новое значение для ${field}`;
  await bot.sendMessage(chatId, `✏️ ${prompt}`);
}

/**
 * Показ интерфейса редактирования данных с кнопками для исправления ошибок
 * @param {Object} bot - Экземпляр бота
 * @param {number} chatId - ID чата
 * @param {Object} baseData - Данные пользователя
 * @param {Object} errors - Объект с ошибками валидации
 * @param {Object} refLists - Закешированные справочники
 */
async function showDataEditInterface(bot, chatId, baseData, errors, refLists) {
  // Сохраняем сессию редактирования
  const sessionKey = storeEditSession(chatId, baseData, errors, refLists);

  // Формируем сообщение с подсветкой ошибочных полей
  let message = "⚠️ Обнаружены проблемы с данными:\n\n";

  // Показываем каждое поле с индикатором ошибки
  const fieldLabels = {
    fio: "👤 ФИО",
    phone: "📞 Телефон",
    address: "📍 Адрес",
    clinic: "🏥 Клиника",
    animal_type: "🐾 Тип животного",
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

  // Создаём inline кнопки для редактирования проблемных полей
  const keyboard = [];

  for (const [field, error] of Object.entries(errors)) {
    const label = fieldLabels[field] || field;
    keyboard.push([
      {
        text: `✏️ Исправить ${label}`,
        callback_data: JSON.stringify({
          action: "edit_field",
          field: field,
          session: sessionKey,
        }),
      },
    ]);
  }

  // Кнопка отмены
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

module.exports = { handleMessage, handleCallback };
