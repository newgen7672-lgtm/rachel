import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ===== 사용자별 메모리 =====
const userData = new Map();

function getUserState(chatId) {
  if (!userData.has(chatId)) {
    userData.set(chatId, {
      todos: [],
      history: [],
      memories: [
        "오빠는 LINE 다니고 있어",
        "오빠는 NEXT Market 업무 하고 있어",
        "오빠 팀원은 6명이야",
        "오빠 회사 주소는 백현동 535야",
        "오빠 집주소는 분당구 양현로 166번길 20이야"
      ]
    });
  }
  return userData.get(chatId);
}

// ===== 텔레그램 =====
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

// ===== 유틸 =====
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

function compactText(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

function buildNaverMapSearchLink(query) {
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

function cleanSearchText(text) {
  return compactText(
    text
      .replace(/오빠/gi, "")
      .replace(/네이버에서/gi, "")
      .replace(/인터넷에서/gi, "")
      .replace(/검색해서/gi, "")
      .replace(/검색해줘/gi, "")
      .replace(/찾아줘/gi, "")
      .replace(/알아봐줘/gi, "")
      .replace(/알려줘/gi, "")
      .replace(/보여줘/gi, "")
      .replace(/추천해줘/gi, "")
      .replace(/추천해 줘/gi, "")
      .replace(/좀/gi, "")
      .replace(/정확한/gi, "")
      .replace(/공식/gi, "")
      .replace(/홈페이지/gi, "")
      .replace(/사이트/gi, "")
      .replace(/주소/gi, "")
      .replace(/위치/gi, "")
      .replace(/본사/gi, "")
      .replace(/전화번호/gi, "")
      .replace(/url/gi, "")
      .replace(/링크/gi, "")
      .replace(/\?/g, "")
  );
}

function classifySearchIntent(text) {
  const t = text.toLowerCase();

  const companyWords = [
    "회사", "본사", "기업", "법인", "대표", "주소", "위치", "홈페이지", "사이트", "url", "링크"
  ];
  const placeWords = [
    "맛집", "식당", "가게", "회집", "술집", "카페", "밥집", "플레이스", "지도", "근처"
  ];
  const newsWords = ["뉴스", "기사", "보도", "이슈", "최근"];

  const companyScore = companyWords.filter((w) => t.includes(w)).length;
  const placeScore = placeWords.filter((w) => t.includes(w)).length;
  const newsScore = newsWords.filter((w) => t.includes(w)).length;

  if (newsScore > 0) return "news";
  if (placeScore > companyScore) return "place";

  if (
    t.includes("주소") ||
    t.includes("위치") ||
    t.includes("본사") ||
    t.includes("홈페이지") ||
    t.includes("사이트") ||
    t.includes("url") ||
    t.includes("링크")
  ) {
    return "company";
  }

  return "general";
}

async function naverSearch(type, query, display = 5) {
  const url = `https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(query)}&display=${display}&sort=sim`;

  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET
    }
  });

  const data = await res.json();
  console.log(`NAVER ${type} / ${query}:`, JSON.stringify(data));
  return data.items || [];
}

function needsNaverSearch(text) {
  const keywords = [
    "주소", "위치", "어디", "본사", "회사", "홈페이지", "사이트", "url", "링크",
    "맛집", "식당", "가게", "회집", "술집", "카페", "추천", "근처",
    "뉴스", "기사", "검색", "찾아줘", "알아봐줘", "알려줘"
  ];
  return keywords.some((k) => text.includes(k));
}

// ===== 기억 =====
function addMemory(chatId, memoryText, source = "manual") {
  const state = getUserState(chatId);
  const cleaned = memoryText.trim();
  if (!cleaned) return false;

  const alreadyExists = state.memories.some(
    (m) => m.toLowerCase() === cleaned.toLowerCase()
  );
  if (alreadyExists) return false;

  state.memories.push(cleaned);

  if (state.memories.length > 50) {
    state.memories = state.memories.slice(-50);
  }

  return true;
}

function deleteMemory(chatId, keyword) {
  const state = getUserState(chatId);
  const before = state.memories.length;

  state.memories = state.memories.filter(
    (m) => !m.toLowerCase().includes(keyword.toLowerCase())
  );

  return before - state.memories.length;
}

function formatMemories(chatId) {
  const state = getUserState(chatId);
  if (state.memories.length === 0) return "저장된 기억 없음";
  return state.memories.map((m, i) => `${i + 1}. ${m}`).join("\n");
}

function shouldAutoRemember(text) {
  const patterns = [
    "내 이름은 ", "난 ", "나는 ", "오빠가 좋아하는 ", "내가 좋아하는 ",
    "내가 싫어하는 ", "나를 ", "앞으로 ", "항상 ", "내 직업은 ",
    "내 회사는 ", "내 취향은 ", "내 집은 ", "우리 팀은 "
  ];
  return patterns.some((p) => text.includes(p));
}

async function extractMemoryFromText(userText) {
  const response = await client.responses.create({
    model: "gpt-5.4-mini",
    input: [
      {
        role: "system",
        content:
          "너는 사용자의 발화에서 장기적으로 기억할 만한 핵심 개인 선호, 호칭, 이름, 직업, 취향, 주소, 팀 정보만 짧게 1개 추출하는 도우미다. 추출할 가치가 없으면 NONE만 출력해라. 한국어 1줄만 출력해라."
      },
      {
        role: "user",
        content: userText
      }
    ]
  });

  return (response.output_text || "NONE").trim();
}

// ===== 검색 로직 =====
async function searchCompanyInfo(userText) {
  const cleaned = cleanSearchText(userText);

  const localItems = await naverSearch("local", `${cleaned} 본사`, 3).catch(() => []);
  const addressItems = await naverSearch("webkr", `${cleaned} 회사 주소`, 5).catch(() => []);
  const homeItems = await naverSearch("webkr", `${cleaned} 공식 홈페이지`, 5).catch(() => []);

  return { cleaned, localItems, addressItems, homeItems };
}

async function searchPlaceInfo(userText) {
  const cleaned = cleanSearchText(userText);

  const localItems = await naverSearch("local", cleaned, 5).catch(() => []);
  const webItems = await naverSearch("webkr", `${cleaned} 네이버 플레이스`, 3).catch(() => []);
  const blogItems = await naverSearch("blog", `${cleaned} 후기`, 2).catch(() => []);

  return { cleaned, localItems, webItems, blogItems };
}

async function searchNewsInfo(userText) {
  const cleaned = cleanSearchText(userText);
  const newsItems = await naverSearch("news", cleaned, 5).catch(() => []);
  return { cleaned, newsItems };
}

function buildCompanyContext(result) {
  const { cleaned, localItems, addressItems, homeItems } = result;

  let text = `검색 대상: ${cleaned}\n\n`;

  if (localItems.length > 0) {
    text += `로컬 결과:\n`;
    text += localItems
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
주소: ${stripHtml(item.address || "")}
도로명: ${stripHtml(item.roadAddress || "")}
전화: ${stripHtml(item.telephone || "")}
카테고리: ${stripHtml(item.category || "")}`
      )
      .join("\n\n");
    text += "\n\n";
  }

  if (addressItems.length > 0) {
    text += `주소/회사 정보 후보:\n`;
    text += addressItems
      .slice(0, 3)
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
      )
      .join("\n\n");
    text += "\n\n";
  }

  if (homeItems.length > 0) {
    text += `공식 홈페이지 후보:\n`;
    text += homeItems
      .slice(0, 3)
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
      )
      .join("\n\n");
  }

  return text.trim();
}

function buildPlaceContext(result) {
  const { cleaned, localItems, webItems, blogItems } = result;

  let text = `검색 대상: ${cleaned}\n\n`;

  if (localItems.length > 0) {
    text += `플레이스/로컬 결과:\n`;
    text += localItems
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
주소: ${stripHtml(item.address || "")}
도로명: ${stripHtml(item.roadAddress || "")}
전화: ${stripHtml(item.telephone || "")}
카테고리: ${stripHtml(item.category || "")}
지도링크: ${buildNaverMapSearchLink(stripHtml(item.title))}`
      )
      .join("\n\n");
    text += "\n\n";
  }

  if (webItems.length > 0) {
    text += `플레이스/웹 후보:\n`;
    text += webItems
      .slice(0, 2)
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
      )
      .join("\n\n");
    text += "\n\n";
  }

  if (blogItems.length > 0) {
    text += `후기 참고:\n`;
    text += blogItems
      .slice(0, 2)
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
      )
      .join("\n\n");
  }

  return text.trim();
}

function buildNewsContext(result) {
  const { cleaned, newsItems } = result;

  let text = `검색 대상: ${cleaned}\n\n`;

  if (newsItems.length > 0) {
    text += newsItems
      .map(
        (item, i) => `${i + 1}. ${stripHtml(item.title)}
요약: ${stripHtml(item.description || "")}
링크: ${item.link || ""}`
      )
      .join("\n\n");
  } else {
    text += "뉴스 검색 결과 없음";
  }

  return text.trim();
}

// ===== 서버 =====
app.get("/", (req, res) => {
  res.send("Bot is running");
});

app.post("/webhook", async (req, res) => {
  console.log("✅ webhook hit");
  console.log("body:", JSON.stringify(req.body));

  res.sendStatus(200);

  try {
    const msg = req.body.message;
    if (!msg?.text) return;

    const chatId = msg.chat.id;
    const userText = msg.text.trim();
    const state = getUserState(chatId);

    if (userText === "/help") {
      await sendTelegramMessage(
        chatId,
        `알겠어, 오빠. 사용법 바로 정리해줄게.

사용 가능한 명령어:
/help - 사용법 보기
/todo 할일 - 할 일 저장
/summary - 최근 대화 요약
/memory - 저장된 기억 보기
/forget 내용 - 관련 기억 삭제
기억해줘: 내용 - 명시적으로 기억시키기

검색 예시:
- 넷마블 본사 주소 알려줘
- 넷마블 홈페이지 url 알려줘
- 판교역 근처 회집 추천해줘
- 어부의 바다 네이버 플레이스 링크 찾아줘
- 최근 게임업계 뉴스 알려줘`
      );
      return;
    }

    if (userText === "/memory") {
      await sendTelegramMessage(
        chatId,
        `알겠어, 오빠. 지금 기억하고 있는 내용이야.\n\n${formatMemories(chatId)}`
      );
      return;
    }

    if (userText.startsWith("/forget")) {
      const keyword = userText.replace("/forget", "").trim();

      if (!keyword) {
        await sendTelegramMessage(
          chatId,
          "알겠어, 오빠. 지울 기억 키워드를 같이 보내줘.\n예: /forget 리니지"
        );
        return;
      }

      const deletedCount = deleteMemory(chatId, keyword);

      if (deletedCount > 0) {
        await sendTelegramMessage(
          chatId,
          `알겠어, 오빠. "${keyword}" 관련 기억 ${deletedCount}개 지웠어.`
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `오빠, "${keyword}" 관련해서 지울 기억을 못 찾았어.`
        );
      }
      return;
    }

    if (userText.startsWith("기억해줘:") || userText.startsWith("기억해줘 ")) {
      const memoryText = userText
        .replace("기억해줘:", "")
        .replace("기억해줘", "")
        .trim();

      if (!memoryText) {
        await sendTelegramMessage(
          chatId,
          "알겠어, 오빠. 기억할 내용을 같이 보내줘.\n예: 기억해줘: 오빠가 좋아하는 게임은 리니지야"
        );
        return;
      }

      const added = addMemory(chatId, memoryText);

      if (added) {
        await sendTelegramMessage(
          chatId,
          `알겠어, 오빠. 이건 기억해둘게.\n- ${memoryText}`
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `오빠, 그건 이미 기억하고 있어.\n- ${memoryText}`
        );
      }
      return;
    }

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

    // 일반 대화 기록 저장
    state.history.push({
      role: "user",
      content: userText
    });

    if (state.history.length > 20) {
      state.history = state.history.slice(-20);
    }

    // 자동 기억
    if (shouldAutoRemember(userText)) {
      try {
        const extracted = await extractMemoryFromText(userText);
        if (extracted && extracted !== "NONE") {
          addMemory(chatId, extracted, "auto");
        }
      } catch (memoryError) {
        console.error("❌ auto memory error:", memoryError);
      }
    }

    const todoText =
      state.todos.length > 0
        ? state.todos.map((t, i) => `${i + 1}. ${t.text}`).join("\n")
        : "현재 저장된 할 일 없음";

    const memoryText = formatMemories(chatId);

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

현재 저장된 기억:
${memoryText}

현재 저장된 할 일:
${todoText}

사용자 질문:
${userText}
`;

    if (needsNaverSearch(userText)) {
      const intent = classifySearchIntent(userText);

      if (intent === "company") {
        const searchResult = await searchCompanyInfo(userText);
        const searchContext = buildCompanyContext(searchResult);

        finalPrompt = `
너는 사용자의 한국어 개인비서다.
반드시 사용자를 "오빠"라고 부른다.
회사/기업 검색 결과를 기반으로 답한다.

규칙:
1. 주소를 물으면 주소를 먼저 말한다.
2. URL/홈페이지를 물으면 가장 가능성 높은 공식 홈페이지 링크를 먼저 말한다.
3. 검색 결과를 전부 나열하지 말고 정답 중심으로 짧게 답한다.
4. 확실하지 않으면 "추가 확인이 필요해, 오빠."라고 말한다.
5. 답변은 자연스럽고 친절하게 한다.

현재 저장된 기억:
${memoryText}

현재 저장된 할 일:
${todoText}

사용자 질문:
${userText}

검색 결과:
${searchContext}
`;
      } else if (intent === "place") {
        const searchResult = await searchPlaceInfo(userText);
        const searchContext = buildPlaceContext(searchResult);

        finalPrompt = `
너는 사용자의 한국어 개인비서다.
반드시 사용자를 "오빠"라고 부른다.
가게/맛집/플레이스 검색 결과를 기반으로 답한다.

규칙:
1. 추천해달라고 하면 2~3곳 정도만 추려서 추천한다.
2. 가능하면 상호명, 주소, 카테고리, 네이버 지도 검색 링크를 포함한다.
3. 링크가 필요하면 네이버 지도 검색 링크를 우선 준다.
4. 검색 결과를 길게 나열하지 말고 사람이 검색해서 쓰는 느낌으로 자연스럽게 정리한다.
5. 확실하지 않으면 "추가 확인이 필요해, 오빠."라고 말한다.

현재 저장된 기억:
${memoryText}

현재 저장된 할 일:
${todoText}

사용자 질문:
${userText}

검색 결과:
${searchContext}
`;
      } else if (intent === "news") {
        const searchResult = await searchNewsInfo(userText);
        const searchContext = buildNewsContext(searchResult);

        finalPrompt = `
너는 사용자의 한국어 개인비서다.
반드시 사용자를 "오빠"라고 부른다.
뉴스 검색 결과를 기반으로 짧고 정확하게 요약한다.

규칙:
1. 최신성 있는 핵심만 3줄 내외로 정리한다.
2. 필요하면 링크 1~2개만 언급한다.
3. 과장 없이 깔끔하게 정리한다.

현재 저장된 기억:
${memoryText}

현재 저장된 할 일:
${todoText}

사용자 질문:
${userText}

검색 결과:
${searchContext}
`;
      }
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
