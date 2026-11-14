const providerCommand = require("./provider");
const documentsCommand = require("./documents");
const helpCommand = require("./help");
const giveawayCommand = require("./giveaway");
const getTalonStatCommand = require("./getTalonStat");
const inviteCommand = require("./invite");
const invitesListCommand = require("./invitesList");

const commands = [
  inviteCommand,
  invitesListCommand,
  providerCommand,
  documentsCommand,
  getTalonStatCommand,
  giveawayCommand,
  helpCommand,
];

function getCommandName(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const [command] = text.trim().split(/\s+/);
  return command || null;
}

async function handleCommand(bot, msg) {
  const commandName = getCommandName(msg.text);
  if (!commandName) {
    return false;
  }

  const lowerCmd = commandName.toLowerCase();
  const command = commands.find(
    (item) =>
      item.name.toLowerCase() === lowerCmd ||
      (Array.isArray(item.aliases) && item.aliases.some((alias) => alias.toLowerCase() === lowerCmd))
  );

  if (!command) {
    return false;
  }

  await command.handle(bot, msg);
  return true;
}

async function registerBotCommands(bot) {
  try {
    const { log, logError, getAllowedUsers } = require("../../utils/helpers");
    const adminCommands = commands.map((cmd) => ({
      command: cmd.name.replace(/^\//, ""),
      description: cmd.description || "Без описания",
    }));

    // 1. Для всех обычных пользователей (scope: default) очищаем меню от админских команд
    try {
      await bot.setMyCommands([], {
        scope: JSON.stringify({ type: "default" }),
      });
    } catch (defaultScopeError) {
      // Fallback если scope передается объектом
      try {
        await bot.setMyCommands([], { scope: { type: "default" } });
      } catch (_) {}
    }

    // 2. Для каждого администратора регистрируем персональное меню с полным набором команд
    const adminList = getAllowedUsers();
    for (const adminChatId of adminList) {
      try {
        await bot.setMyCommands(adminCommands, {
          scope: JSON.stringify({ type: "chat", chat_id: adminChatId }),
        });
      } catch (adminScopeError) {
        try {
          await bot.setMyCommands(adminCommands, {
            scope: { type: "chat", chat_id: adminChatId },
          });
        } catch (e) {
          logError(`Ошибка регистрации команд для админа ${adminChatId}`, e);
        }
      }
    }

    log("✅ Команды бота успешно зарегистрированы с разделением доступа (пользователи / админы)");
  } catch (error) {
    const { logError } = require("../../utils/helpers");
    logError("Ошибка при регистрации команд в Telegram API", error);
  }
}

module.exports = {
  handleCommand,
  registerBotCommands,
  commands,
};
