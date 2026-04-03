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

function stripHtml(text = "") {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .trim();
}

async function naverSearch(type, query) {
  const url = `https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(query)}&display=5&sort=sim`;

  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
    },
  });

  const data = await res.json();
  return data.items || [];
}

function needsNaverSearch(text) {
  const keywords = [
    "주소",
    "위치",
    "어디",
    "본사",
    "회사 정보",
    "홈페이지",
    "전화번호",
    "최근 뉴스",
    "기사",
    "알아봐줘",
    "찾아줘"
  ];

  return keywords.some((k) => text.includes(k));
}

async function buildSearchContext(userText) {
  if (
    userText.includes("주소") ||
    userText.includes("위치") ||
    userText.includes("어디") ||
    userText.includes("본사")
  ) {
    const localItems = await naverSearch("local", userText);

    if (localItems.length > 0) {
      return localItems
        .map(
          (item, i) => `${i + 1}. ${stripHtml(item.title)}
주소: ${stripHtml(item.address || "")}
도로명: ${stripHtml(item.roadAddress || "")}
전화: ${stripHtml(item.telephone || "")}
카테고리: ${stripHtml(item.category || "")}`
        )
        .join("\n\n");
    }
  }

  if (userText.includes("뉴스") || userText.includes("기사")) {
    const newsItems = await naverSearch("news", userText);

    if (newsItems.length > 0) {
      return newsItems
        .map(
          (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
        )
        .join("\n\n");
    }
  }

  const blogItems = await naverSearch("blog", userText).catch(() => []);
  if (blogItems.length > 0) {
    return blogItems
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
      )
      .join("\n\n");
  }

  return "검색 결과를 찾지 못했어요.";
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

    if (userText === "/help") {
      await sendTelegramMessage(
        chatId,
        `안녕하세요. 개인비서 봇이에요.

사용 가능한 명령어:
/help - 사용법 보기
/todo 할일 - 할 일 저장
/summary - 최근 대화 요약

예시:
- 게임테일즈 회사 주소 알아봐줘
- 넷마블 본사 위치 알려줘
- 최근 게임업계 뉴스 찾아줘`
      );
      return;
    }

    if (userText.startsWith("/todo")) {
      const todoText = userText.replace("/todo", "").trim();

      if (!todoText) {
        await sendTelegramMessage(
          chatId,
          "저장할 할 일을 같이 보내주세요.\n예: /todo 오후 3시에 파트너사 메일 보내기"
        );
        return;
      }

      state.todos.push({
        text: todoText,
        createdAt: new Date().toISOString(),
      });

      await sendTelegramMessage(
        chatId,
        `할 일 저장했어요.\n- ${todoText}\n\n현재 할 일 개수: ${state.todos.length}개`
      );
      return;
    }

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
            content: "너는 개인비서다. 아래 대화를 한국어로 짧고 명확하게 5줄 이내로 요약해라.",
          },
          {
            role: "user",
            content: historyText,
          },
        ],
      });

      const summaryText =
        summaryResponse.output_text || "요약을 만들지 못했어요.";

      await sendTelegramMessage(chatId, `최근 대화 요약:\n\n${summaryText}`);
      return;
    }

    state.history.push({
      role: "user",
      content: userText,
    });

    if (state.history.length > 20) {
      state.history = state.history.slice(-20);
    }

    const todoText =
      state.todos.length > 0
        ? state.todos.map((t, i) => `${i + 1}. ${t.text}`).join("\n")
        : "현재 저장된 할 일 없음";

    let finalPrompt = `
너는 한국어 개인비서다.
항상 친절하고 짧고 실용적으로 답한다.
불필요하게 길게 말하지 말고, 바로 실행 가능한 형태로 답해라.

현재 저장된 할 일:
${todoText}

사용자 질문:
${userText}
`;

   if (needsNaverSearch(userText)) {
  const searchContext = await buildSearchContext(userText);

  await sendTelegramMessage(
    chatId,
    "🔎 네이버 검색 결과 확인용:\n\n" + searchContext
  );

  finalPrompt = `
너는 한국어 개인비서다.
아래 네이버 검색 결과를 바탕으로 짧고 정확하게 답해라.
주소/위치는 가장 신뢰할 수 있는 후보를 먼저 말하고,
확실하지 않으면 "추가 확인이 필요합니다"라고 덧붙여라.

현재 저장된 할 일:
${todoText}

사용자 질문:
${userText}

네이버 검색 결과:
${searchContext}
`;
}

    const response = await client.responses.create({
      model: "gpt-5.4-mini",
      input: finalPrompt,
    });

    const reply = response.output_text || "답변을 만들지 못했어요.";

    state.history.push({
      role: "assistant",
      content: reply,
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
