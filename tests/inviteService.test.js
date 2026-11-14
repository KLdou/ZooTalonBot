const assert = require("assert");
const {
  createInvite,
  getInvite,
  validateInvite,
  consumeInvite,
  listActiveInvites,
  revokeInvite,
  _clearForTests,
} = require("../src/services/inviteService");

function runInviteTests() {
  _clearForTests();

  // Test 1: Create invite with default TTL (24h)
  const inv1 = createInvite({
    createdBy: 12345,
    creatorName: "admin1",
    label: "Кошка Муся",
  });
  assert(inv1.code.startsWith("inv_"), "Код инвайта должен начинаться с inv_");
  assert.strictEqual(inv1.status, "active", "Инвайт должен быть активен");
  assert.strictEqual(inv1.maxUses, 1, "Дефолтный лимит - 1");
  assert.strictEqual(inv1.usedCount, 0, "usedCount должен быть 0");

  // Test 2: Validate active invite
  const val1 = validateInvite(inv1.code);
  assert.strictEqual(val1.valid, true, "Инвайт должен быть валиден");
  assert.strictEqual(val1.invite.code, inv1.code);

  // Test 3: List active invites
  const activeList = listActiveInvites();
  assert.strictEqual(activeList.length, 1, "Должен быть 1 активный инвайт");
  assert.strictEqual(activeList[0].code, inv1.code);

  // Test 4: Consume invite
  const consumeRes = consumeInvite(inv1.code, { id: 99999, username: "volunteer_cat" });
  assert.strictEqual(consumeRes.success, true, "Погашение должно пройти успешно");
  assert.strictEqual(consumeRes.invite.status, "used", "Статус должен смениться на used");

  // Test 5: Re-validate consumed invite
  const valUsed = validateInvite(inv1.code);
  assert.strictEqual(valUsed.valid, false, "Использованный инвайт не должен быть валиден");
  assert(valUsed.reason.includes("уже было использовано"), "Причина должна сообщать об использовании");

  // Test 6: Revoke invite
  const inv2 = createInvite({ createdBy: 12345, label: "Собака Шарик" });
  const revokeRes = revokeInvite(inv2.code, 12345);
  assert.strictEqual(revokeRes, true, "Отзыв должен вернуть true");

  const valRevoked = validateInvite(inv2.code);
  assert.strictEqual(valRevoked.valid, false, "Отозванный инвайт не должен быть валиден");
  assert(valRevoked.reason.includes("отозвано"), "Причина должна сообщать об отзыве");

  // Test 7: Expired invite (simulate 0 hour TTL)
  const invExpired = createInvite({ createdBy: 12345, ttlHours: -1 });
  const valExpired = validateInvite(invExpired.code);
  assert.strictEqual(valExpired.valid, false, "Истекший инвайт не должен быть валиден");
  assert(valExpired.reason.includes("истёк"), "Причина должна сообщать об истечении срока");

  // Test 8: Non-existent invite
  const valNonExistent = validateInvite("inv_nonexistent");
  assert.strictEqual(valNonExistent.valid, false, "Несуществующий инвайт должен быть невалиден");

  _clearForTests();
  console.log("✅ All inviteService tests passed successfully!");
}

runInviteTests();
