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
} = require("../utils/helpers");
const {
  fetchToken,
  getDocuments,
  getDocumentsWithSearch,
  getRefList,
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
  }

  log(`📩 Получено сообщение от ${chatId}: ${msg.text}`);

  try {
    const baseData = await parseUserMessage(msg.text);
    const names = Array.isArray(baseData.animal_name)
      ? baseData.animal_name
      : [baseData.animal_name];
    if (baseData.phone) {
      baseData.phone = normalizePhoneNumber(baseData.phone);
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
  const types = await getRefList("/coupon-secured/v1/type", token);
  const clinics = await getRefList("/coupon-secured/v1/vet", token);
  const goals = await getRefList("/coupon-secured/v1/goal?type=", token);

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

module.exports = { handleMessage, handleCallback };
