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
  console.log("✅ webhook hit");
  console.log("body:", JSON.stringify(req.body));

  res.sendStatus(200);

  try {
    const msg = req.body.message;
    if (!msg?.text) {
      console.log("No text message");
      return;
    }

    const response = await client.responses.create({
      model: "gpt-5.4-mini",
      input: msg.text,
    });

    const reply = response.output_text || "답변을 만들지 못했어요.";

    const telegramRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: msg.chat.id,
          text: reply,
        }),
      }
    );

    console.log("Telegram status:", telegramRes.status);
    console.log("Telegram response:", await telegramRes.text());
  } catch (error) {
    console.error("❌ webhook error:", error);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server started");
});
