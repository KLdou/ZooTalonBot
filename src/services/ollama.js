
const { Ollama } = require("ollama");
const ollama = new Ollama();
const ollamaModel = process.env.OLLAMA_MODEL;

/**
 * Отправляет промпт в Ollama и возвращает message.content
 * @param {string} prompt
 * @returns {Promise<string>} message.content
 */
async function sendPrompt(prompt) {
  const { message } = await ollama.chat({
    model: ollamaModel,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content;
}

module.exports = {
  sendPrompt,
};
