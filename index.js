import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 사용자별 간단 메모리
const userData = new Map();

function getUserState(chatId) {
  if (!userData.has(chatId)) {
    userData.set(chatId, {
      todos: [],
      history: []
    });
  }
  return userData.get(chatId);
}

async function sendTelegramMessage(chatId, text) {
  const telegramRes = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    }
  );

  const result = await telegramRes.text();
  console.log("Telegram status:", telegramRes.status);
  console.log("Telegram response:", result);
}

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

    const chatId = msg.chat.id;
    const userText = msg.text.trim();
    const state = getUserState(chatId);

    // /help
    if (userText === "/help") {
      await sendTelegramMessage(
        chatId,
        `안녕하세요. 개인비서 봇이에요.\n\n사용 가능한 명령어:\n/help - 사용법 보기\n/todo 할일 - 할 일 저장\n/summary - 최근 대화 요약\n\n그냥 일반 대화도 가능해요.\n예: 내일 일정 정리해줘`
      );
      return;
    }

    // /todo
    if (userText.startsWith("/todo")) {
      const todoText = userText.replace("/todo", "").trim();

      if (!todoText) {
        await sendTelegramMessage(
          chatId,
          "저장할 할 일을 같이 보내주세요.\n예: /todo 오후 3시에 거래처 메일 보내기"
        );
        return;
      }

      state.todos.push({
        text: todoText,
        createdAt: new Date().toISOString()
      });

      await sendTelegramMessage(
        chatId,
        `할 일 저장했어요.\n- ${todoText}\n\n현재 할 일 개수: ${state.todos.length}개`
      );
      return;
    }

    // /summary
    if (userText === "/summary") {
      if (state.history.length === 0) {
        await sendTelegramMessage(chatId, "아직 요약할 대화가 없어요.");
        return;
      }

      const recentHistory = state.history.slice(-10);
      const historyText = recentHistory
        .map((item) => `${item.role}: ${item.content}`)
        .join("\n");

      const summaryResponse = await client.responses.create({
        model: "gpt-5.4-mini",
        input: [
          {
            role: "system",
            content:
              "너는 개인비서다. 아래 대화를 한국어로 짧고 명확하게 5줄 이내로 요약해라."
          },
          {
            role: "user",
            content: historyText
          }
        ]
      });

      const summaryText =
        summaryResponse.output_text || "요약을 만들지 못했어요.";

      await sendTelegramMessage(chatId, `최근 대화 요약:\n\n${summaryText}`);
      return;
    }

    // 일반 대화 기록 저장
    state.history.push({
      role: "user",
      content: userText
    });

    if (state.history.length > 20) {
      state.history = state.history.slice(-20);
    }

    const todoText =
      state.todos.length > 0
        ? state.todos.map((t, i) => `${i + 1}. ${t.text}`).join("\n")
        : "현재 저장된 할 일 없음";

    const historyForPrompt = state.history
      .slice(-10)
      .map((item) => `${item.role}: ${item.content}`)
      .join("\n");

    const response = await client.responses.create({
      model: "gpt-5.4-mini",
      input: [
        {
          role: "system",
          content:
            `너는 사용자의 한국어 개인비서다.
항상 친절하고 짧고 실용적으로 답한다.
불필요하게 길게 말하지 말고, 바로 실행 가능한 형태로 답해라.
사용자의 현재 저장된 할 일:
${todoText}`
        },
        {
          role: "user",
          content:
            `최근 대화:\n${historyForPrompt}\n\n사용자 새 메시지:\n${userText}`
        }
      ]
    });

    const reply = response.output_text || "답변을 만들지 못했어요.";

    state.history.push({
      role: "assistant",
      content: reply
    });

    if (state.history.length > 20) {
      state.history = state.history.slice(-20);
    }

    await sendTelegramMessage(chatId, reply);
  } catch (error) {
    console.error("❌ webhook error:", error);

    try {
      const msg = req.body.message;
      if (msg?.chat?.id) {
        await sendTelegramMessage(
          msg.chat.id,
          `에러가 발생했어요.\n${error.message}`
        );
      }
    } catch (sendError) {
      console.error("❌ failed to send error message:", sendError);
    }
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server started");
});
