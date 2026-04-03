import express from "express";

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.get("/", (req, res) => {
  res.send("Bot is running");
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const msg = req.body.message;
    if (!msg?.text) return;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: msg.chat.id,
        text: "테스트 성공! 네 메시지 잘 받았어: " + msg.text,
      }),
    });
  } catch (error) {
    console.error("Webhook test error:", error);
  }
});

app.listen(process.env.PORT || 3000);
