const assert = require("assert");

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function requireFresh(modulePath) {
  clearModule(modulePath);
  return require(modulePath);
}

function createFakeBot() {
  return {
    messages: [],
    commandsRegistered: null,
    async sendMessage(chatId, text, options) {
      this.messages.push({ chatId, text, options });
    },
    async setMyCommands(commands) {
      this.commandsRegistered = commands;
    }
  };
}

async function testCommandsListAndDescriptions() {
  const { commands } = requireFresh("../src/bot/comands");
  
  assert.ok(Array.isArray(commands));
  assert.ok(commands.length >= 3); // /provider, /documents, /help

  const providerCmd = commands.find(c => c.name === "/provider");
  assert.ok(providerCmd);
  assert.strictEqual(typeof providerCmd.description, "string");
  assert.ok(providerCmd.description.length > 0);

  const docsCmd = commands.find(c => c.name === "/documents");
  assert.ok(docsCmd);
  assert.strictEqual(typeof docsCmd.description, "string");
  assert.ok(docsCmd.description.length > 0);

  const helpCmd = commands.find(c => c.name === "/help");
  assert.ok(helpCmd);
  assert.strictEqual(typeof helpCmd.description, "string");
  assert.ok(helpCmd.description.length > 0);
}

async function testHelpCommandOutput() {
  const helpCmd = requireFresh("../src/bot/comands/help");
  const bot = createFakeBot();

  await helpCmd.handle(bot, { chat: { id: 456 } });

  assert.strictEqual(bot.messages.length, 1);
  assert.strictEqual(bot.messages[0].chatId, 456);
  assert.ok(bot.messages[0].text.includes("/help"));
  assert.ok(bot.messages[0].text.includes("/provider"));
  assert.ok(bot.messages[0].text.includes("/documents"));
  assert.strictEqual(bot.messages[0].options.parse_mode, "Markdown");
}

async function testRegisterBotCommands() {
  const { registerBotCommands } = requireFresh("../src/bot/comands");
  const bot = createFakeBot();

  await registerBotCommands(bot);

  assert.ok(bot.commandsRegistered);
  assert.strictEqual(bot.commandsRegistered.length, 3);
  
  const providerReg = bot.commandsRegistered.find(c => c.command === "provider");
  assert.ok(providerReg);
  assert.strictEqual(providerReg.description, "Выбрать LLM-провайдер для генерации документов");

  const helpReg = bot.commandsRegistered.find(c => c.command === "help");
  assert.ok(helpReg);
  assert.strictEqual(helpReg.description, "Показать список доступных команд и их описание");
}

async function testHandleCommand() {
  const { handleCommand } = requireFresh("../src/bot/comands");
  const bot = createFakeBot();
  
  // Test case 1: unknown command
  const handledUnknown = await handleCommand(bot, { text: "/unknown", chat: { id: 123 } });
  assert.strictEqual(handledUnknown, false);

  // Test case 2: non-command text
  const handledNonCommand = await handleCommand(bot, { text: "hello", chat: { id: 123 } });
  assert.strictEqual(handledNonCommand, false);

  // Test case 3: valid command (/help)
  const handledHelp = await handleCommand(bot, { text: "/help", chat: { id: 123 } });
  assert.strictEqual(handledHelp, true);
  assert.strictEqual(bot.messages.length, 1);
  assert.ok(bot.messages[0].text.includes("/help"));
}

async function run() {
  await testCommandsListAndDescriptions();
  await testHelpCommandOutput();
  await testRegisterBotCommands();
  await testHandleCommand();
  console.log("All commands tests passed successfully!");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
