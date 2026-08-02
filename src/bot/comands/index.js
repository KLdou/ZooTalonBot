const providerCommand = require("./provider");
const documentsCommand = require("./documents");
const helpCommand = require("./help");
const giveawayCommand = require("./giveaway");
const getTalonStatCommand = require("./getTalonStat");

const commands = [providerCommand, documentsCommand, helpCommand, giveawayCommand, getTalonStatCommand];

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
    const { log } = require("../../utils/helpers");
    const botCommands = commands.map((cmd) => ({
      command: cmd.name.replace(/^\//, ""),
      description: cmd.description || "Без описания",
    }));
    await bot.setMyCommands(botCommands);
    log("✅ Команды бота успешно зарегистрированы в Telegram API");
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
