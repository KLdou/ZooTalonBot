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
    commandCalls: [],
    commandsRegistered: null,
    async sendMessage(chatId, text, options) {
      this.messages.push({ chatId, text, options });
    },
    async setMyCommands(commands, options) {
      this.commandCalls.push({ commands, options });
      this.commandsRegistered = commands;
    },
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

  const giveawayCmd = commands.find(c => c.name === "/giveaway");
  assert.ok(giveawayCmd);
  assert.strictEqual(typeof giveawayCmd.description, "string");
  assert.ok(giveawayCmd.description.length > 0);
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
  assert.ok(bot.messages[0].text.includes("/giveaway"));
  assert.strictEqual(bot.messages[0].options.parse_mode, "Markdown");
}

async function testRegisterBotCommands() {
  const { registerBotCommands } = requireFresh("../src/bot/comands");
  const bot = createFakeBot();

  await registerBotCommands(bot);

  assert.ok(bot.commandCalls.length >= 2, "Должно быть минимум 2 вызова setMyCommands (default + админы)");
  
  // Проверка что для default scope список пустой (обычные юзеры не видят админских команд)
  const defaultCall = bot.commandCalls.find(
    (c) => c.options && (c.options.scope === '{"type":"default"}' || c.options.scope?.type === "default"),
  );
  assert.ok(defaultCall, "Должен быть вызов для scope default");
  assert.strictEqual(defaultCall.commands.length, 0, "Для обычных пользователей меню команд должно быть пустым");

  // Проверка что для админов зарегистрированы все 7 команд
  const adminCall = bot.commandCalls.find(
    (c) => c.options && (typeof c.options.scope === "string" && c.options.scope.includes("chat")),
  );
  assert.ok(adminCall, "Должен быть вызов для scope chat (администратора)");
  assert.strictEqual(adminCall.commands.length, 7, "Для администратора должны быть зарегистрированы все 7 команд");
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
