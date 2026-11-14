const assert = require("assert");
const { getProvider, setProvider } = require("../src/services/llmService");
const { handleCallback } = require("../src/bot/handlers");
const { getAllowedUsers } = require("../src/utils/helpers");
const {
  startWizard,
  hasActiveSession,
  clearSession,
} = require("../src/bot/wizard/talonWizard");
const { createInvite, _clearForTests } = require("../src/services/inviteService");

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

async function testNonAdminBlockedFromAdminCallbacks() {
  const mockBot = createMockBot();
  const nonAdminChatId = 999999;
  const initialProvider = getProvider();

  assert.ok(
    !getAllowedUsers().includes(nonAdminChatId),
    "nonAdminChatId must not be in allowed users",
  );

  // 1. Попытка смены провайдера не-админом
  await handleCallback(mockBot, {
    message: { chat: { id: nonAdminChatId } },
    from: { id: nonAdminChatId },
    data: JSON.stringify({ action: "set_provider", provider: "gemini" }),
  });

  const lastMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1];
  assert.ok(lastMsg, "Бот должен отправить сообщение");
  assert.ok(
    lastMsg.text.includes("доступно только администраторам"),
    `Ожидалось сообщение о запрете доступа, получено: ${lastMsg.text}`,
  );
  assert.strictEqual(
    getProvider(),
    initialProvider,
    "Провайдер не должен измениться при попытке не-админа",
  );

  // 2. Попытка одобрения заявки не-админом
  await handleCallback(mockBot, {
    message: { chat: { id: nonAdminChatId } },
    from: { id: nonAdminChatId },
    data: JSON.stringify({ action: "approve_wiz", id: "wiz_fake_id" }),
  });

  const approveMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1];
  assert.ok(
    approveMsg.text.includes("доступно только администраторам"),
    `Ожидалось сообщение о запрете одобрения, получено: ${approveMsg.text}`,
  );

  // 3. Попытка отзыва инвайта не-админом
  await handleCallback(mockBot, {
    message: { chat: { id: nonAdminChatId } },
    from: { id: nonAdminChatId },
    data: JSON.stringify({ action: "revoke_inv", code: "inv_fake" }),
  });

  const revokeMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1];
  assert.ok(
    revokeMsg.text.includes("доступно только администраторам"),
    `Ожидалось сообщение о запрете отзыва инвайта, получено: ${revokeMsg.text}`,
  );

  // 4. Попытка вызвать reject не-админом
  await handleCallback(mockBot, {
    message: { chat: { id: nonAdminChatId } },
    from: { id: nonAdminChatId },
    data: JSON.stringify({ reject: true, id: "fake_id" }),
  });

  const rejectMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1];
  assert.ok(
    rejectMsg.text.includes("доступно только администраторам"),
    `Ожидалось сообщение о запрете reject, получено: ${rejectMsg.text}`,
  );

  // 5. Попытка отправить send_docs не-админом
  await handleCallback(mockBot, {
    message: { chat: { id: nonAdminChatId } },
    from: { id: nonAdminChatId },
    data: JSON.stringify({ action: "send_docs", month: 1, year: 2026 }),
  });

  const sendDocsMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1];
  assert.ok(
    sendDocsMsg.text.includes("доступно только администраторам"),
    `Ожидалось сообщение о запрете send_docs, получено: ${sendDocsMsg.text}`,
  );

  // 6. Попытка отправить прямой строковый payload key не-админом
  await handleCallback(mockBot, {
    message: { chat: { id: nonAdminChatId } },
    from: { id: nonAdminChatId },
    data: JSON.stringify("fake_payload_key"),
  });

  const payloadMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1];
  assert.ok(
    payloadMsg.text.includes("доступно только администраторам"),
    `Ожидалось сообщение о запрете прямого payload, получено: ${payloadMsg.text}`,
  );
}

async function testAdminAllowedAdminCallbacks() {
  const mockBot = createMockBot();
  const adminChatId = getAllowedUsers()[0];
  const original = getProvider();

  try {
    await handleCallback(mockBot, {
      message: { chat: { id: adminChatId } },
      from: { id: adminChatId },
      data: JSON.stringify({ action: "set_provider", provider: "gemini" }),
    });

    const lastMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1];
    assert.ok(
      lastMsg.text.includes("переключён на: gemini"),
      `Ожидалось подтверждение смены провайдера, получено: ${lastMsg.text}`,
    );
    assert.strictEqual(getProvider(), "gemini");
  } finally {
    setProvider(original);
  }
}

async function testNonAdminWizardCallbackAllowed() {
  _clearForTests();
  const mockBot = createMockBot();
  const applicantId = 777777;
  const user = { id: 777777, username: "applicant", first_name: "Вася" };

  const invite = createInvite({
    createdBy: 653859626,
    creatorName: "admin",
    label: "Котик",
  });

  await startWizard(mockBot, applicantId, user, invite);
  assert.ok(hasActiveSession(applicantId), "Сессия должна быть активна");

  // Заявитель нажимает кнопку отмены анкеты визарда
  await handleCallback(mockBot, {
    message: { chat: { id: applicantId } },
    from: { id: applicantId },
    data: JSON.stringify({ action: "wiz_cancel" }),
  });

  const cancelMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1];
  assert.ok(
    cancelMsg.text.includes("Оформление заявки отменено"),
    `Ожидалось сообщение об отмене визарда, получено: ${cancelMsg.text}`,
  );
  assert.strictEqual(
    hasActiveSession(applicantId),
    false,
    "Сессия должна завершиться",
  );
}

async function runTests() {
  console.log("Running callback security tests...");
  await testNonAdminBlockedFromAdminCallbacks();
  await testAdminAllowedAdminCallbacks();
  await testNonAdminWizardCallbackAllowed();
  console.log("✅ All callback security tests passed!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
