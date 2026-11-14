const assert = require("assert");
const {
  createInvite,
  validateInvite,
  _clearForTests,
} = require("../src/services/inviteService");
const {
  startWizard,
  handleStepInput,
  handleWizardCallback,
  hasActiveSession,
  getSession,
  clearSession,
} = require("../src/bot/wizard/talonWizard");
const { getPayload } = require("../src/utils/helpers");

// Mock Bot helper
function createMockBot() {
  const sentMessages = [];
  return {
    sentMessages,
    sendMessage: async (chatId, text, options) => {
      sentMessages.push({ chatId, text, options });
      return { message_id: sentMessages.length };
    },
  };
}

async function runWizardTests() {
  _clearForTests();

  const mockBot = createMockBot();
  const testChatId = 888888;
  const user = { id: 888888, username: "test_user", first_name: "Анна" };

  // 1. Создаем инвайт
  const invite = createInvite({
    createdBy: 653859626,
    creatorName: "admin",
    label: "Тестовая кошка",
  });

  // 2. Старт визарда
  await startWizard(mockBot, testChatId, user, invite);
  assert.strictEqual(hasActiveSession(testChatId), true, "Сессия должна быть активна");

  const session = getSession(testChatId);
  assert.strictEqual(session.inviteCode, invite.code);

  // 3. Шаг 1: ФИО (сначала ошибка, потом корректно)
  await handleStepInput(mockBot, testChatId, { text: "Иван" }); // 1 слово
  assert.strictEqual(session.data.fio, "", "ФИО не должно сохраниться при ошибке");

  await handleStepInput(mockBot, testChatId, { text: "Иванов Иван Иванович" });
  assert.strictEqual(session.data.fio, "Иванов Иван Иванович");
  assert.strictEqual(session.currentStepIndex, 1, "Должен перейти на шаг телефона");

  // 4. Шаг 2: Телефон
  await handleStepInput(mockBot, testChatId, { text: "+375 (29) 123-45-67" });
  assert.strictEqual(session.data.phone, "+375291234567");
  assert.strictEqual(session.currentStepIndex, 2, "Должен перейти на шаг адреса");

  // 5. Шаг 3: Адрес
  await handleStepInput(mockBot, testChatId, { text: "г. Минск, ул. Ленина, д. 1" });
  assert.strictEqual(session.data.address, "г. Минск, ул. Ленина, д. 1");

  // 6. Шаг 4: Вид животного (через callback кнопку)
  await handleWizardCallback(mockBot, testChatId, {
    action: "wiz_set",
    field: "animal_type",
    val: "Кошка",
  });
  assert.strictEqual(session.data.animal_type, "Кошка");

  // 7. Шаг 5: Кличка
  await handleStepInput(mockBot, testChatId, { text: "Муся" });
  assert.strictEqual(session.data.animal_name, "Муся");

  // 8. Шаг 6: Окрас
  await handleStepInput(mockBot, testChatId, { text: "Черный с белым" });
  assert.strictEqual(session.data.coat_color, "Черный с белым");

  // 9. Шаг 7: Место (пропуск)
  await handleWizardCallback(mockBot, testChatId, {
    action: "wiz_skip",
    field: "place",
  });
  assert.strictEqual(session.data.place, "");

  // 10. Шаг 8: Клиника (текстовый ввод или кнопка)
  await handleStepInput(mockBot, testChatId, { text: "Доктор Вет" });
  assert.strictEqual(session.data.clinic, "Доктор Вет");

  // 11. Шаг 9: Цель визита (кнопка)
  await handleWizardCallback(mockBot, testChatId, {
    action: "wiz_set",
    field: "type",
    val: "Стерилизация",
  });
  assert.strictEqual(session.data.type, "Стерилизация");

  // 12. Шаг 10: Комментарий (пропуск)
  await handleWizardCallback(mockBot, testChatId, {
    action: "wiz_skip",
    field: "comment",
  });
  assert.strictEqual(session.data.comment, "");

  // 13. Мы на экране проверки (Review)
  assert.strictEqual(session.currentStepIndex, 10);

  // 14. Тестирование точечного изменения поля (например, окрас)
  await handleWizardCallback(mockBot, testChatId, {
    action: "wiz_edit",
    f: "coat_color",
  });
  assert.strictEqual(session.editingSpecificField, "coat_color");

  await handleStepInput(mockBot, testChatId, { text: "Полностью черный" });
  assert.strictEqual(session.data.coat_color, "Полностью черный");
  assert.strictEqual(session.editingSpecificField, null, "Должен сбросить режим точечного редактирования");
  assert.strictEqual(session.currentStepIndex, 10, "Должен вернуться на экран проверки");

  // 15. Финальная отправка заявки
  await handleWizardCallback(mockBot, testChatId, { action: "wiz_submit" });
  assert.strictEqual(hasActiveSession(testChatId), false, "Сессия визарда должна завершиться");

  // Проверка что инвайт погашен
  const invStatus = validateInvite(invite.code);
  assert.strictEqual(invStatus.valid, false, "Инвайт должен быть погашен после отправки");

  _clearForTests();
  console.log("✅ All talonWizard tests passed successfully!");
  process.exit(0);
}

runWizardTests().catch((err) => {
  console.error("Wizard test failed:", err);
  process.exit(1);
});
