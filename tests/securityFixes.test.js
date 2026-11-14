const assert = require("assert");
const path = require("path");
const { getPayload, getAllowedUsers } = require("../src/utils/helpers");
const {
  startWizard,
  handleStepInput,
  handleWizardCallback,
  hasActiveSession,
  getSession,
  clearSession,
} = require("../src/bot/wizard/talonWizard");
const { createInvite, _clearForTests } = require("../src/services/inviteService");
const { handleCallback } = require("../src/bot/handlers");
const { handleApproveWizard } = require("../src/bot/callbacks/wizardReview");
const { createDocumentFile } = require("../src/bot/messages/document");

function createMockBot() {
  const sentMessages = [];
  return {
    sentMessages,
    sendMessage: async (chatId, text, options) => {
      sentMessages.push({ chatId, text, options });
      return { message_id: sentMessages.length };
    },
    sendDocument: async (chatId, file, options, fileOptions) => {
      return { message_id: 1 };
    },
  };
}

// ---------------------------------------------------------------
// TEST 1 (Item 1): Wizard approval payload key integrity
// ---------------------------------------------------------------
async function testWizardApprovalPayloadKeyIntegrity() {
  _clearForTests();
  const mockBot = createMockBot();
  const applicantId = 111222;
  const adminId = getAllowedUsers()[0];
  const user = { id: applicantId, username: "applicant", first_name: "Иван" };

  const invite = createInvite({
    createdBy: adminId,
    creatorName: "admin",
    label: "Котик",
  });

  await startWizard(mockBot, applicantId, user, invite);
  const session = getSession(applicantId);

  // Заполняем обязательные поля
  session.data.fio = "Иванов Иван Иванович";
  session.data.phone = "+375291234567";
  session.data.address = "г. Минск, ул. Ленина, д. 1";
  session.data.animal_type = "Кот";
  session.data.animal_name = "Барсик";
  session.data.coat_color = "Серый";
  session.data.clinic = "Ветклиника Друг";
  session.data.type = "Стерилизация";
  session.currentStepIndex = 10; // Review

  // Отправляем заявку
  await handleWizardCallback(mockBot, applicantId, { action: "wiz_submit" });

  // Проверяем карточку, отправленную админу
  const adminCardMsg = mockBot.sentMessages.find((m) => m.chatId === adminId);
  assert.ok(adminCardMsg, "Админ должен получить карточку заявки");
  assert.ok(
    adminCardMsg.options?.reply_markup?.inline_keyboard,
    "Карточка должна содержать inline кнопки",
  );

  const approveButton =
    adminCardMsg.options.reply_markup.inline_keyboard[0][0];
  const callbackData = JSON.parse(approveButton.callback_data);
  assert.strictEqual(callbackData.action, "approve_wiz");

  // КЛЮЧЕВАЯ ПРОВЕРКА: getPayload(callbackData.id) ДОЛЖЕН найти данные заявки!
  const storedPayload = getPayload(callbackData.id);
  assert.ok(
    storedPayload,
    `Payload должен быть найден по id=${callbackData.id}, но вернулся undefined`,
  );
  assert.strictEqual(storedPayload.baseData.fio, "Иванов Иван Иванович");

  // Проверка одобрения админом
  mockBot.sentMessages.length = 0;
  let processNamesCalled = false;
  await handleApproveWizard(
    mockBot,
    adminId,
    callbackData,
    {
      processNames: async () => {
        processNamesCalled = true;
      },
    },
  );

  const approveResultMsg = mockBot.sentMessages.find(
    (m) => m.chatId === adminId && m.text.includes("одобрена"),
  );
  assert.ok(
    approveResultMsg,
    "Админ должен получить подтверждение одобрения заявки",
  );
  assert.strictEqual(
    mockBot.sentMessages.some((m) =>
      m.text.includes("Данные заявки не найдены"),
    ),
    false,
    "Не должно быть ошибки о ненайденных данных",
  );
}

// ---------------------------------------------------------------
// TEST 2 (Item 2): Protection against field injection and invalid wiz callbacks
// ---------------------------------------------------------------
async function testWizardFieldInjectionProtection() {
  _clearForTests();
  const mockBot = createMockBot();
  const applicantId = 333444;
  const user = { id: applicantId, username: "attacker", first_name: "Петр" };

  const invite = createInvite({
    createdBy: getAllowedUsers()[0],
    creatorName: "admin",
    label: "Тест инъекций",
  });

  // 1. Попытка не-админа вызвать незарегистрированный wiz-экшен
  await handleCallback(mockBot, {
    message: { chat: { id: applicantId } },
    from: { id: applicantId },
    data: JSON.stringify({ action: "wiz_arbitrary_unlisted_action" }),
  });

  const lastMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1];
  assert.ok(
    lastMsg.text.includes("доступно только администраторам"),
    `Ожидалась блокировка произвольного wiz action, получено: ${lastMsg.text}`,
  );

  // 2. Старт визарда
  await startWizard(mockBot, applicantId, user, invite);
  const session = getSession(applicantId);

  // Попытка внедрить запрещенное поле через wiz_set
  const setHandled = await handleWizardCallback(mockBot, applicantId, {
    action: "wiz_set",
    field: "admin_override",
    val: "evil_val",
  });
  assert.strictEqual(setHandled, false, "wiz_set с неразрешенным полем должен быть отклонен");
  assert.strictEqual(
    session.data.admin_override,
    undefined,
    "Запрещенное поле не должно попасть в session.data",
  );

  // Попытка wiz_edit на недопустимый шаг
  const editHandled = await handleWizardCallback(mockBot, applicantId, {
    action: "wiz_edit",
    f: "nonexistent_step",
  });
  assert.strictEqual(editHandled, false, "wiz_edit на несуществующий шаг должен быть отклонен");
  assert.strictEqual(session.editingSpecificField, null);

  // Попытка wiz_clinic с out-of-bounds индексом
  const clinicHandled = await handleWizardCallback(mockBot, applicantId, {
    action: "wiz_clinic",
    idx: 9999,
  });
  assert.strictEqual(clinicHandled, false, "wiz_clinic с out-of-bounds idx должен быть отклонен");

  // Попытка отправки wiz_submit с пустыми обязательными полями
  mockBot.sentMessages.length = 0;
  const submitEmptyHandled = await handleWizardCallback(mockBot, applicantId, {
    action: "wiz_submit",
  });
  assert.ok(
    hasActiveSession(applicantId),
    "Сессия не должна завершиться при отправке с пустыми полями",
  );
}

// ---------------------------------------------------------------
// TEST 3 (Item 3): Path traversal protection in document generation
// ---------------------------------------------------------------
async function testDocumentPathTraversalProtection() {
  const documentsDir = path.resolve(__dirname, "../documents");

  const llmPath = require.resolve("../src/services/llmService");
  const docxPath = require.resolve("../src/utils/docxGenerator");
  const originalLlm = require.cache[llmPath];
  const originalDocx = require.cache[docxPath];

  let interceptedOutputFilename = null;

  require.cache[llmPath] = {
    exports: {
      findDocument: async () => null,
      formatAddress: async (addr) => addr,
      formatFoundPlace: async (pl) => pl,
      formatPet: async () => "Кот",
      formatMonth: async () => "ноября",
      formatShortFio: async (fio) => fio,
      getProvider: () => "mock",
    },
  };

  require.cache[docxPath] = {
    exports: {
      openAndReplacePlaceholders: async (input, output, payload) => {
        interceptedOutputFilename = output;
        return output;
      },
    },
  };

  try {
    delete require.cache[require.resolve("../src/bot/messages/document")];
    const { createDocumentFile } = require("../src/bot/messages/document");

    const baseData = {
      fio: "../../../evil_fio",
      animal_name: "../../malicious_name",
      address: "ул. Ленина, д. 1",
      phone: "+375291234567",
      animal_type: "Кот",
      coat_color: "Белый",
      date: "14.11.2026",
      clinic: "Друг",
      type: "Стерилизация",
    };

    const createdFile = await createDocumentFile(baseData, null, null);
    assert.ok(createdFile, "Документ должен быть сгенерирован");

    const resolvedPath = path.resolve(interceptedOutputFilename);
    assert.ok(
      resolvedPath.startsWith(documentsDir),
      `Сгенерированный файл (${resolvedPath}) должен находиться строго внутри папки documents (${documentsDir})`,
    );
    assert.strictEqual(
      resolvedPath.includes("..\\.."),
      false,
      "Путь не должен содержать последовательностей ..",
    );
  } finally {
    if (originalLlm) require.cache[llmPath] = originalLlm;
    else delete require.cache[llmPath];
    if (originalDocx) require.cache[docxPath] = originalDocx;
    else delete require.cache[docxPath];
    delete require.cache[require.resolve("../src/bot/messages/document")];
  }
}

async function runTests() {
  console.log("Running security fixes tests (Items 1-3)...");
  await testWizardApprovalPayloadKeyIntegrity();
  await testWizardFieldInjectionProtection();
  await testDocumentPathTraversalProtection();
  console.log("✅ All security fixes tests passed!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
