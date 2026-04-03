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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function naverSearch(type, query) {
  const url = `https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(query)}&display=5&sort=sim`;

  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET
    }
  });

  const data = await res.json();
  console.log(`NAVER ${type}:`, JSON.stringify(data));
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
    "찾아줘",
    "검색해줘"
  ];

  return keywords.some((k) => text.includes(k));
}

async function buildSearchContext(userText) {
  // 주소/위치/본사 관련 질문
  if (
    userText.includes("주소") ||
    userText.includes("위치") ||
    userText.includes("어디") ||
    userText.includes("본사")
  ) {
    const localItems = await naverSearch("local", userText + " 본사 위치").catch(() => []);

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

    const webItems = await naverSearch("webkr", userText + " 본사 주소").catch(() => []);

    if (webItems.length > 0) {
      return webItems
        .map(
          (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
        )
        .join("\n\n");
    }

    return "회사 주소 관련 검색 결과를 찾지 못했어.";
  }

  // 뉴스/기사 질문
  if (userText.includes("뉴스") || userText.includes("기사")) {
    const newsItems = await naverSearch("news", userText).catch(() => []);

    if (newsItems.length > 0) {
      return newsItems
        .map(
          (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
        )
        .join("\n\n");
    }

    return "뉴스 검색 결과를 찾지 못했어.";
  }

  // 일반 회사 정보
  const webItems = await naverSearch("webkr", userText + " 회사 정보").catch(() => []);

  if (webItems.length > 0) {
    return webItems
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
      )
      .join("\n\n");
  }

  // 마지막 fallback만 blog
  const blogItems = await naverSearch("blog", userText + " 회사 정보").catch(() => []);

  if (blogItems.length > 0) {
    return blogItems
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
      )
      .join("\n\n");
  }

  return "검색 결과를 찾지 못했어.";
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
        `알겠어, 오빠. 사용법 바로 정리해줄게.

사용 가능한 명령어:
/help - 사용법 보기
/todo 할일 - 할 일 저장
/summary - 최근 대화 요약

예시:
- 게임테일즈 회사 주소 알아봐줘
- 넷마블 본사 위치 알려줘
- 최근 게임업계 뉴스 찾아줘
- 내일 일정 정리해줘`
      );
      return;
    }

    // /todo
    if (userText.startsWith("/todo")) {
      const todoText = userText.replace("/todo", "").trim();

      if (!todoText) {
        await sendTelegramMessage(
          chatId,
          "알겠어, 오빠. 저장할 할 일을 같이 보내줘.\n예: /todo 오후 3시에 파트너사 메일 보내기"
        );
        return;
      }

      state.todos.push({
        text: todoText,
        createdAt: new Date().toISOString()
      });

      await sendTelegramMessage(
        chatId,
        `알겠어, 오빠. 할 일 저장해뒀어.\n- ${todoText}\n\n현재 할 일은 ${state.todos.length}개야.`
      );
      return;
    }

    // /summary
    if (userText === "/summary") {
      if (state.history.length === 0) {
        await sendTelegramMessage(chatId, "알겠어, 오빠. 아직 요약할 대화가 없어.");
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
              "너는 사용자의 개인비서다. 항상 사용자를 '오빠'라고 부른다. 아래 대화를 한국어로 짧고 명확하게 5줄 이내로 요약해라. 말투는 부드럽고 친근하게 유지해라."
          },
          {
            role: "user",
            content: historyText
          }
        ]
      });

      const summaryText =
        summaryResponse.output_text || "요약을 만들지 못했어.";

      await sendTelegramMessage(chatId, `알겠어, 오빠. 최근 대화 요약해줄게.\n\n${summaryText}`);
      return;
    }

    // 사용자 대화 기록 저장
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

    let finalPrompt = `
너는 사용자의 한국어 개인비서다.
반드시 사용자를 "오빠"라고 부른다.
말투는 다정하고 자연스럽고 친근하게 한다.
예시 말투:
- "알겠어, 오빠."
- "응, 오빠. 바로 정리해줄게."
- "오빠, 이건 이렇게 보면 돼."
- "좋아, 오빠. 내가 찾아봤어."

규칙:
1. 항상 한국어로 답한다.
2. 항상 사용자를 "오빠"라고 부른다.
3. 너무 과장된 애교 말투는 쓰지 말고, 자연스럽고 부드럽게 답한다.
4. 답변은 실용적으로 짧고 명확하게 한다.
5. 모르면 모른다고 말하고, 추측은 줄인다.

현재 저장된 할 일:
${todoText}

사용자 질문:
${userText}
`;

    if (needsNaverSearch(userText)) {
      const searchContext = await buildSearchContext(userText);

      finalPrompt = `
너는 사용자의 한국어 개인비서다.
반드시 사용자를 "오빠"라고 부른다.
말투는 다정하고 자연스럽고 친근하게 한다.
답변은 짧고 실용적으로 한다.

규칙:
1. 항상 한국어로 답한다.
2. 반드시 "오빠"라고 부른다.
3. 검색 결과를 그대로 길게 나열하지 말고, 핵심만 정리한다.
4. 주소/위치는 가장 신뢰할 수 있는 후보를 먼저 말한다.
5. 확실하지 않으면 "추가 확인이 필요해, 오빠."라고 말한다.
6. 링크를 전부 나열하지 말고, 필요할 때만 언급한다.

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
      input: finalPrompt
    });

    const reply = response.output_text || "알겠어, 오빠. 지금은 답변을 만들지 못했어.";

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
          `알겠어, 오빠. 에러가 발생했어.\n${error.message}`
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
