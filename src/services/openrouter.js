const { OpenAI  } = require("openai");

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPEN_ROUTER_API_KEY,
});

async function sendPrompt(prompt) {
  const response = await openai.chat.completions.create({
    model: process.env.OPEN_ROUTER_MODEL,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });
  return response.choices[0].message.content;  
}

module.exports = {
  sendPrompt,
};
