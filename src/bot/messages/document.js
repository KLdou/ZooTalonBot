const path = require("path");
const { getDocumentsWithSearch } = require("../../services/api");
const {
  findDocument,
  formatAddress,
  formatPet,
  formatMonth,
  formatShortFio,
  formatFoundPlace,
} = require("../../services/llmService");
const {
  confirmationKeyboard,
  storePayload,
  formatPhoneNumber,
  logError,
} = require("../../utils/helpers");
const { openAndReplacePlaceholders } = require("../../utils/docxGenerator");

async function checkDocument(name, bot, chatId, baseData, token) {
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
        notes: baseData.animal_type,
        date: startOfDay.toISOString(),
      };

      const missingDocFields = Object.entries(newDocPayload)
        .filter(([key, val]) => !val || val === "")
        .map(([key]) => key);

      if (missingDocFields.length > 0) {
        await bot.sendMessage(
          chatId,
          `❌ Невозможно создать документ. Отсутствуют значения для: ${missingDocFields.join(
            ", ",
          )}`,
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
        confirmationKeyboard(docKey),
      );

      return { status: "await_confirmation", name, docKey };
    }

    return { status: "document_found", name, document: docInfo };
  } catch (error) {
    logError(`Error checking document for ${name}`, error);
    return { status: "error", name, error };
  }
}

async function createDocumentFile(baseData, bot, chatId) {
  const today = new Date();

  const address = await formatAddress(baseData.address);
  const pet = await formatPet(
    baseData.animal_type,
    baseData.coat_color,
    baseData.animal_name,
  );
  const month = await formatMonth(today);
  const shortFio = await formatShortFio(baseData.fio);
  const place = baseData.place ? await formatFoundPlace(baseData.place) : "";

  const docxPayload = {
    fio: baseData.fio,
    address,
    place,
    mobilePhone: /^\+375(?!17)\d{9}$/.test(baseData.phone)
      ? formatPhoneNumber(baseData.phone)
      : "",
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
    "..",
    "documents",
    "example.docx",
  );
  const outputFilename = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "documents",
    `${baseData.animal_name} - ${docxPayload.fio}.docx`,
  );

  const newFile = await openAndReplacePlaceholders(
    inputFilename,
    outputFilename,
    docxPayload,
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
        },
      )
      .then(() => console.log("Файл успешно отправлен!"))
      .catch((err) => logError("Ошибка отправки", err));
  }

  return newFile;
}

module.exports = {
  checkDocument,
  createDocumentFile,
};
