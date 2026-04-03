import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (req, res) => {
  res.send("Bot is running");
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const msg = req.body.message;
    if (!msg?.text) return;

    const chatId = msg.chat.id;
    const userText = msg.text;

    const response = await client.responses.create({
      model: "gpt-5.4-mini",
      input: userText,
    });

    const reply = response.output_text || "응답 없음";

    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: reply,
      }),
    });
  } catch (e) {
    console.error(e);
  }
});

app.listen(process.env.PORT || 3000);
