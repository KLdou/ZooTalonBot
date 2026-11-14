const { revokeInvite, getInvite } = require("../../services/inviteService");
const { log, getAllowedUsers } = require("../../utils/helpers");

async function handleRevokeInvite(bot, chatId, key) {
  const allowedUsers = getAllowedUsers();
  if (!allowedUsers.includes(chatId)) {
    await bot.sendMessage(
      chatId,
      "🔒 Отзыв приглашений доступен только администраторам.",
    );
    return;
  }

  const code = key.code;
  const invite = getInvite(code);

  if (!invite) {
    await bot.sendMessage(chatId, "⚠️ Приглашение не найдено.");
    return;
  }

  const revoked = revokeInvite(code, chatId);
  if (revoked) {
    const label = invite.label ? ` (${invite.label})` : "";
    await bot.sendMessage(chatId, `✅ Приглашение \`${code}\`${label} успешно отозвано.`, {
      parse_mode: "Markdown",
    });
    log(`Приглашение ${code} отозвано админом ${chatId}`);
  } else {
    await bot.sendMessage(chatId, "❌ Не удалось отозвать приглашение.");
  }
}

module.exports = handleRevokeInvite;
