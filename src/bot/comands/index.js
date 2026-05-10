const providerCommand = require("./provider");

const commands = [providerCommand];

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

  const command = commands.find((item) => item.name === commandName);

  if (!command) {
    return false;
  }

  await command.handle(bot, msg);
  return true;
}

module.exports = {
  handleCommand,
};
