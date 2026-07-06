// 로컬 슬라이드 에디터 서버 (외부 패키지 없이 Node 기본 모듈만 사용)
// 실행: node server.js  →  http://localhost:5500 접속
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = 5500;

// .env 파일 로딩 (외부 dotenv 패키지 없이 직접 파싱).
// API 키는 항상 서버(이 프로세스)에서만 사용하고, 브라우저로는 절대 내려보내지 않는다.
function loadEnvFile(filePath) {
  const env = {};
  try {
    const content = fs.readFileSync(filePath, "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    });
  } catch (e) {
    // .env가 없으면 조용히 무시 (AI 기능만 비활성화됨)
  }
  return env;
}

const ENV = Object.assign(
  {},
  loadEnvFile(path.join(ROOT, "..", ".env")),
  loadEnvFile(path.join(ROOT, ".env"))
);

const AI_SLIDE_SYSTEM_PROMPT = `당신은 다크 테마 16:9 발표 슬라이드의 HTML 조각을 작성/수정하는 전문 에디터입니다.

결과물은 <div class="slide">...</div> 안에 들어갈 내용(innerHTML)만 출력하세요.
절대로 설명 문장, 마크다운 코드펜스(\`\`\`), <html>/<head>/<body>/<script>/<div class="slide"> 태그 자체를 포함하지 마세요.

[사용 가능한 디자인 시스템 클래스]
- kicker: 좌상단 작은 라벨 텍스트
- title-xl / title-lg: 큰 제목(xl이 더 큼). 안에 <span class="accent">문구</span>로 포인트 컬러(오렌지) 강조 가능
- body-lg: 본문 문단
- center-stage / top-stage: 남는 세로 공간을 채우는 flex 컨테이너. 보통 kicker/title 다음에 하나만 최상위 자식으로 두고 그 안을 자유롭게 구성
- row (flex row, gap 있음) / col (flex column, gap 있음)
- card-grid (grid; style="grid-template-columns:repeat(N,1fr)" 직접 지정) > card > card-num, card-title, card-desc (card에 marked 클래스를 추가하면 포인트 컬러로 강조됨)
- todo-block > todo-label, todo-desc: 사용자가 나중에 실제 데이터를 채워 넣을 안내 박스 (구체적인 수치/스크린샷 등 답을 알 수 없는 내용은 이 박스에 TODO로 남길 것)
- check-list: <ul class="check-list"><li>...</li></ul>
- quote-list > quote-card
- framework-step > step-num(원형 번호), step-body > step-title, step-desc
- hl-box: <span class="hl-box">텍스트</span> 검정 박스 강조
- hook-text / hook-sub: 화면 전체를 채우는 큰 한 문장용. 이 클래스를 쓸 때는 결과의 맨 첫 줄에 반드시 <!-- root-class: hook --> 주석 한 줄을 추가하세요 (슬라이드 루트가 중앙 정렬되도록). 이 주석이 없으면 hook-text가 중앙 정렬되지 않습니다.
- free-el free-el--text / free-el free-el--image / free-el free-el--shape: position:absolute; left/top/width(%, 슬라이드 기준) 인라인 스타일로 자유 배치하는 요소. 자유 배치가 꼭 필요할 때만 사용.
- 마지막에는 항상 <div class="page-number" id="page-number"></div> 를 그대로 포함하세요 (페이지 번호 자동 표시용, 절대 삭제/수정 금지).

[언어]
- 모든 텍스트(제목, 본문, 라벨 등)는 반드시 한국어로 작성하세요. class 이름이나 style 속성 값(영문 CSS)은 그대로 영문을 쓰되, 사용자에게 보이는 문구는 전부 한국어여야 합니다.

[톤 & 스타일]
- 배경은 어두운 톤(#0b0c10 계열), 텍스트는 밝은 회색/흰색, 포인트 컬러는 오렌지(#ff6b4a) 하나만 사용.
- 화려한 장식/그라데이션보다 여백 있고 담백한 미니멀 디자인을 선호.
- 폰트 크기/간격 등 수치는 vw 단위를 사용 (예: font-size:1.2vw).
- 사용자의 요청이 기존 슬라이드의 일부만 고치는 것이면 나머지 구조는 최대한 유지하고, 새로 작성해달라는 요청이면 위 클래스들을 조합해 자유롭게 재구성하세요.
- 실제 수치, 스크린샷, 고유명사 등 알 수 없는 정보는 지어내지 말고 todo-block으로 표시하세요.`;

// "AI 앱" — 슬라이드 안에 바로 심을 수 있는 완전히 독립적인 인터랙티브 데모/미니게임을
// 만들어주는 모드. PPT는 절대 흉내 낼 수 없는, "발표 중에 실제로 동작하는 것을 그 자리에서
// 만들어서 보여준다"는 이 편집기의 핵심 차별점이다.
const AI_APP_SYSTEM_PROMPT = `당신은 발표 슬라이드 위에 바로 삽입할 완전히 독립적인(self-contained) 인터랙티브 데모/미니게임을 만드는 전문 프론트엔드 엔지니어입니다.

[출력 형식 — 반드시 지킬 것]
- 결과물은 <!DOCTYPE html>부터 </html>까지, 완전한 HTML 문서 하나여야 합니다. <style>과 <script>는 전부 그 문서 안에 인라인으로 포함하세요.
- 설명 문장, 주석 삼은 대화, 마크다운 코드펜스(\`\`\`)를 절대 포함하지 말고 HTML 문서 자체만 출력하세요.
- 외부 리소스(CDN 스크립트/폰트/이미지 URL, npm 패키지 등)를 절대 쓰지 마세요. 순수 HTML/CSS/JS와 필요하면 <canvas>만으로, 이 파일 하나 안에서 완전히 동작해야 합니다. (샌드박스 iframe 안에서 실행되어 네트워크 요청이 막혀 있습니다.)

[화면/크기]
- 사용자가 자유롭게 리사이즈하는 박스(대략 가로 500~900px, 세로 400~650px 범위) 안에서 실행됩니다. 고정 픽셀 대신 100%/vw/vh 기반 반응형으로 만들어 박스 크기에 맞게 늘어나도록 하세요.
- 다크 테마(짙은 배경, 밝은 텍스트)로 만들고, 포인트 컬러로 오렌지(#ff6b4a)를 활용하면 발표 슬라이드 톤과 잘 어울립니다.

[조작/내용]
- 키보드(방향키/스페이스 등) 또는 마우스 클릭처럼 간단한 조작으로 즉시 플레이/사용 가능해야 하며, 화면 안에 조작 방법을 한 줄로 안내하세요.
- 사용자가 요청한 것(예: 팩맨, 퐁, 틱택토, 스네이크, 카운터, 타이머, 간단한 계산기/시각화 등)을 실제로 동작하는 수준으로 구현하세요. 완벽한 원작 재현보다, 짧고 버그 없이 실제로 돌아가는 것이 훨씬 중요합니다.
- 요청이 모호하면 가장 대표적이고 누구나 알아볼 수 있는 형태로 스스로 판단해서 만드세요.`;

// "AI 챗봇" 도구는 버튼을 3개로 나누지 않고 자연어 요청 하나만 받는다. 문제는
// "내용을 정리해주고 이미지로도 보충해줘"처럼 한 요청 안에 여러 작업이 섞여
// 있는 경우가 많다는 것 — 그래서 단일 action이 아니라 순서가 있는 단계
// (steps) 목록으로 쪼개서 돌려준다. 이미지 단계는 사용자의 (보통 모호한)
// 문장을 그대로 이미지 프롬프트로 쓰지 않고, 지금 슬라이드 내용을 참고해서
// 실제로 그릴 수 있는 구체적인 장면 묘사(detail)를 미리 만들어준다.
const AI_ROUTE_SYSTEM_PROMPT = `당신은 발표 슬라이드 편집기의 AI 챗봇이 받은 한국어 요청 하나를 분석해서, 실행할 작업 단계로 쪼개는 플래너입니다.
지금 슬라이드의 현재 내용(innerHTML)과 사용자의 요청을 함께 드립니다. 설명 없이 JSON 객체 하나만 출력하세요.

출력 형식: {"steps":[{"action":"text"|"image"|"app","detail":"..."}]}

- 요청에 필요한 작업만큼 1~2개의 step을 순서대로 담으세요. 대부분은 1개면 충분합니다.
- "text": 슬라이드의 글/제목/구성/레이아웃을 작성하거나 고치는 단계. 애매하거나 판단이 안 서면 이 하나만 쓰세요(기본값). detail은 빈 문자열로 두세요.
- "image": 정적인 이미지 한 장을 그리는 단계. detail에는 사용자의 문장을 그대로 옮기지 말고, 지금 슬라이드 내용과 요청을 참고해서 실제로 그림을 그릴 수 있을 만큼 구체적인 장면/구성/스타일을 직접 묘사하세요. (예: "오렌지색 포인트 컬러의 미니멀한 3단계 플로우차트 아이콘, 어두운 배경, 문서→AI→결과물의 자동화 흐름을 표현")
- "app": 게임/카운터/계산기/타이머처럼 실제로 클릭·키보드 조작이 가능한 인터랙티브 데모를 만드는 단계 (예: 팩맨, 퐁, 틱택토, 스네이크). detail은 빈 문자열로 두세요.
- 사용자가 "내용도 정리하고 이미지도 보충해줘"처럼 텍스트와 이미지를 함께 원하면 steps에 text와 image를 순서대로 모두 넣으세요.

반드시 위 형식의 JSON 객체 하나만 출력하세요.`;

// Anthropic 메시지를 스트리밍(SSE)으로 호출한다. 델타 텍스트가 도착할 때마다
// onDelta로 즉시 넘겨주므로, 브라우저 쪽에서 "타이핑되듯" 생성 과정을 그대로
// 보여줄 수 있다. 이벤트 블록은 빈 줄("\n\n")로 구분되고, 그 안의 "data: {...}"
// 줄만 JSON으로 파싱해서 필요한 델타만 뽑아 쓴다.
function callAnthropicStream(userText, systemPrompt, maxTokens, onDelta) {
  return new Promise((resolve, reject) => {
    const apiKey = ENV.CLAUDE_API_KEY;
    if (!apiKey) return reject(new Error("CLAUDE_API_KEY가 .env에 없습니다"));
    const payload = JSON.stringify({
      model: ENV.CLAUDE_MODEL || "claude-sonnet-4-5",
      max_tokens: maxTokens || 4096,
      system: systemPrompt,
      stream: true,
      messages: [{ role: "user", content: userText }],
    });
    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const apiReq = https.request(options, (apiRes) => {
      if (apiRes.statusCode !== 200) {
        let errBody = "";
        apiRes.setEncoding("utf8");
        apiRes.on("data", (chunk) => (errBody += chunk));
        apiRes.on("end", () => {
          let msg = "Anthropic API 오류 " + apiRes.statusCode;
          try {
            const json = JSON.parse(errBody);
            msg = (json.error && json.error.message) || msg;
          } catch (e) {
            // 본문이 JSON이 아니면 기본 메시지 사용
          }
          reject(new Error(msg));
        });
        return;
      }
      let full = "";
      let buffer = "";
      apiRes.setEncoding("utf8");
      apiRes.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const eventBlock = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = eventBlock.split("\n").find((l) => l.indexOf("data:") === 0);
          if (!dataLine) continue;
          const jsonStr = dataLine.slice(5).trim();
          if (!jsonStr) continue;
          let evt;
          try {
            evt = JSON.parse(jsonStr);
          } catch (e) {
            continue;
          }
          if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
            full += evt.delta.text;
            onDelta(evt.delta.text);
          } else if (evt.type === "error") {
            reject(new Error((evt.error && evt.error.message) || "Anthropic 스트림 오류"));
          }
        }
      });
      apiRes.on("end", () => resolve(full));
      apiRes.on("error", reject);
    });
    apiReq.on("error", reject);
    apiReq.write(payload);
    apiReq.end();
  });
}

// 브라우저(index.html)가 넘겨주는 전체 발표 맥락(deckContext)을 Claude가 읽기 좋은
// 텍스트 블록으로 바꾼다. "지금 이 슬라이드 하나"만 보고 재작성하면 앞뒤 슬라이드와
// 겹치거나 전체 흐름/톤과 어긋나는 결과가 나오기 쉬워서, 발표 주제와 전체 구성,
// 이 슬라이드의 위치를 함께 알려준다.
function formatDeckContext(deckContext) {
  if (!deckContext || typeof deckContext !== "object") return "";
  const outline = Array.isArray(deckContext.outline) ? deckContext.outline : [];
  const lines = [];
  lines.push("[전체 발표 정보]");
  if (deckContext.deckTitle) lines.push("제목: " + deckContext.deckTitle);
  if (deckContext.deckSubtitle) lines.push("부제: " + deckContext.deckSubtitle);
  if (typeof deckContext.currentIndex === "number" && deckContext.total) {
    lines.push(
      "이 슬라이드 위치: 전체 " + deckContext.total + "장 중 " + (deckContext.currentIndex + 1) + "번째" +
        (deckContext.currentAct ? " · \"" + deckContext.currentAct + "\" 섹션" : "")
    );
  }
  if (outline.length) {
    lines.push("");
    lines.push("[전체 슬라이드 구성] (→ 표시가 지금 재작성 중인 슬라이드)");
    let lastAct = null;
    outline.forEach((item, i) => {
      if (item.act !== lastAct) {
        lines.push(item.act + ":");
        lastAct = item.act;
      }
      const marker = i === deckContext.currentIndex ? "→ " : "   ";
      lines.push(marker + (i + 1) + ". " + item.title + (item.todo ? " (TODO 남음)" : ""));
    });
  }
  lines.push("");
  lines.push(
    "위 구성을 참고해서, 다른 슬라이드에서 이미 다루는 내용과 중복되지 않게 하고 " +
      "전체 발표의 흐름·톤에 맞춰 이 슬라이드만 자연스럽게 이어지도록 작성/수정하세요."
  );
  return lines.join("\n");
}

// 이미지 생성 모델은 슬라이드 전체 구성까지는 필요 없지만, 발표 주제와 톤을
// 모르면 맥락 없이 동떨어진 그림이 나오기 쉬우므로 짧은 배경 설명만 앞에 붙인다.
function buildImageContextPrefix(deckContext) {
  if (!deckContext || typeof deckContext !== "object") return "";
  const topic = [deckContext.deckTitle, deckContext.deckSubtitle].filter(Boolean).join(" — ");
  const slideInfo = [deckContext.currentAct, deckContext.currentTitle].filter(Boolean).join(" / ");
  const bits = [];
  if (topic) bits.push("발표 주제: " + topic);
  if (slideInfo) bits.push("이 이미지가 들어갈 슬라이드: " + slideInfo);
  if (!bits.length) return "";
  return bits.join(". ") + ". 다크 테마(#0b0c10 배경) 슬라이드 안에 배치될 그림이며, 포인트 컬러는 오렌지(#ff6b4a) 계열입니다. 아래 요청에 맞게 그려주세요.\n\n";
}

// gpt-image 계열 모델은 images.generate 요청에 stream:true + partial_images(1~3)를
// 주면, 완성되기 전에도 흐릿한 중간 결과 이미지를 SSE로 몇 장 먼저 내려준다.
// "그런 척"이 아니라 실제로 매번 다른, 점점 선명해지는 이미지 데이터가 온다.
// onEvent({phase:"partial"|"done", index, b64})로 매 이벤트를 그대로 넘겨준다.
function callOpenAiImageStream(prompt, size, onEvent) {
  return new Promise((resolve, reject) => {
    const apiKey = ENV.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error("OPENAI_API_KEY가 .env에 없습니다"));
    const payload = JSON.stringify({
      model: ENV.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt: prompt,
      size: size || "1536x1024",
      n: 1,
      stream: true,
      partial_images: 3,
    });
    const options = {
      hostname: "api.openai.com",
      path: "/v1/images/generations",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const apiReq = https.request(options, (apiRes) => {
      if (apiRes.statusCode !== 200) {
        let errBody = "";
        apiRes.setEncoding("utf8");
        apiRes.on("data", (chunk) => (errBody += chunk));
        apiRes.on("end", () => {
          let msg = "OpenAI API 오류 " + apiRes.statusCode;
          try {
            const json = JSON.parse(errBody);
            msg = (json.error && json.error.message) || msg;
          } catch (e) {
            // 본문이 JSON이 아니면 기본 메시지 사용
          }
          reject(new Error(msg));
        });
        return;
      }
      let buffer = "";
      let finalB64 = null;
      apiRes.setEncoding("utf8");
      apiRes.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const eventBlock = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = eventBlock.split("\n").find((l) => l.indexOf("data:") === 0);
          if (!dataLine) continue;
          const jsonStr = dataLine.slice(5).trim();
          if (!jsonStr) continue;
          let evt;
          try {
            evt = JSON.parse(jsonStr);
          } catch (e) {
            continue;
          }
          if (evt.type === "image_generation.partial_image" && evt.b64_json) {
            onEvent({ phase: "partial", index: evt.partial_image_index, b64: evt.b64_json });
          } else if (evt.type === "image_generation.completed" && evt.b64_json) {
            finalB64 = evt.b64_json;
            onEvent({ phase: "done", b64: evt.b64_json });
          } else if (evt.type === "error" || evt.error) {
            reject(new Error((evt.error && evt.error.message) || "OpenAI 스트림 오류"));
          }
        }
      });
      apiRes.on("end", () => {
        if (finalB64) resolve(finalB64);
        else reject(new Error("이미지 데이터를 받지 못했습니다"));
      });
      apiRes.on("error", reject);
    });
    apiReq.on("error", reject);
    apiReq.write(payload);
    apiReq.end();
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers) {
  res.writeHead(status, headers || {});
  res.end(body);
}

function safeJoin(base, targetRelative) {
  const targetPath = path.normalize(path.join(base, targetRelative));
  if (!targetPath.startsWith(base)) return null;
  return targetPath;
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);

  if (req.method === "POST" && url === "/api/save-manifest") {
    let mbody = "";
    req.on("data", (chunk) => (mbody += chunk));
    req.on("end", () => {
      try {
        const { deck } = JSON.parse(mbody);
        if (!Array.isArray(deck)) {
          return send(res, 400, JSON.stringify({ ok: false, error: "invalid deck" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        const manifestPath = safeJoin(ROOT, "assets/deck.json");
        fs.writeFileSync(manifestPath, JSON.stringify(deck, null, 2), "utf8");
        console.log(`슬라이드 순서 저장됨`);
        send(res, 200, JSON.stringify({ ok: true }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: String(e) }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
    });
    return;
  }

  if (req.method === "POST" && url === "/api/ai/route") {
    let rbody = "";
    req.on("data", (chunk) => (rbody += chunk));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(rbody);
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: "invalid json" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      const prompt = parsed.prompt;
      if (!prompt || typeof prompt !== "string") {
        return send(res, 400, JSON.stringify({ ok: false, error: "prompt가 필요합니다" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      // 슬라이드 현재 내용을 같이 줘야, "이미지로 보충해줘"처럼 모호한 요청에도
      // 실제로 무엇에 대한 이미지인지 구체적으로 판단해서 detail을 만들 수 있다.
      const html = parsed.html || "";
      const deckContextText = formatDeckContext(parsed.deckContext);
      const userText =
        (deckContextText ? deckContextText + "\n\n" : "") +
        "현재 슬라이드 내용(innerHTML):\n---\n" + html + "\n---\n\n사용자 요청: " + prompt;
      // 분류는 스트리밍이 필요 없으니, 델타를 그냥 버리고 전체 텍스트만 받는다.
      callAnthropicStream(userText, AI_ROUTE_SYSTEM_PROMPT, 300, () => {})
        .then((raw) => {
          let steps = [{ action: "text", detail: "" }];
          try {
            const start = raw.indexOf("{");
            const end = raw.lastIndexOf("}");
            const jsonStr = start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
            const json = JSON.parse(jsonStr);
            if (Array.isArray(json.steps) && json.steps.length) {
              const cleaned = json.steps
                .filter((s) => s && (s.action === "text" || s.action === "image" || s.action === "app"))
                .map((s) => ({ action: s.action, detail: typeof s.detail === "string" ? s.detail : "" }))
                .slice(0, 3);
              if (cleaned.length) steps = cleaned;
            }
          } catch (e) {
            // 계획 응답 파싱에 실패하면 가장 무난한 기본값(text 한 단계)을 쓴다
          }
          console.log("AI 챗봇 플랜:", steps.map((s) => s.action).join(" -> "));
          send(res, 200, JSON.stringify({ ok: true, steps: steps }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        })
        .catch((e) => {
          console.error("AI 라우팅 실패:", e.message || e);
          send(res, 500, JSON.stringify({ ok: false, error: String((e && e.message) || e) }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        });
    });
    return;
  }

  if (req.method === "POST" && url === "/api/ai/text") {
    let abody = "";
    req.on("data", (chunk) => (abody += chunk));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(abody);
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: "invalid json" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      const prompt = parsed.prompt;
      const html = parsed.html || "";
      if (!prompt || typeof prompt !== "string") {
        return send(res, 400, JSON.stringify({ ok: false, error: "prompt가 필요합니다" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      const deckContextText = formatDeckContext(parsed.deckContext);
      const userText =
        (deckContextText ? deckContextText + "\n\n" : "") +
        "현재 슬라이드 내용(innerHTML):\n---\n" + html + "\n---\n\n요청: " + prompt +
        "\n\n위 요청에 따라 슬라이드 전체 innerHTML을 다시 작성해서 출력하세요.";
      // 완료된 JSON을 한 번에 내려주는 대신, 델타 텍스트가 도착하는 즉시
      // text/plain 스트림으로 그대로 흘려보낸다. 헤더는 첫 델타가 올 때(=Anthropic이
      // 200으로 응답했다는 뜻)까지 미뤄서, 그 전에 에러가 나면 평소처럼 JSON 에러를 보낼 수 있게 한다.
      let headerSent = false;
      callAnthropicStream(userText, AI_SLIDE_SYSTEM_PROMPT, 4096, (delta) => {
        if (!headerSent) {
          headerSent = true;
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        }
        res.write(delta);
      })
        .then(() => {
          console.log("AI 텍스트 생성 완료(스트리밍)");
          if (!headerSent) {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          }
          res.end();
        })
        .catch((e) => {
          console.error("AI 텍스트 생성 실패:", e.message || e);
          if (!headerSent) {
            send(res, 500, JSON.stringify({ ok: false, error: String((e && e.message) || e) }), {
              "Content-Type": "application/json; charset=utf-8",
            });
          } else {
            res.end();
          }
        });
    });
    return;
  }

  if (req.method === "POST" && url === "/api/ai/app") {
    let apbody = "";
    req.on("data", (chunk) => (apbody += chunk));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(apbody);
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: "invalid json" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      const prompt = parsed.prompt;
      if (!prompt || typeof prompt !== "string") {
        return send(res, 400, JSON.stringify({ ok: false, error: "prompt가 필요합니다" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      const userText = "요청: " + prompt + "\n\n위 요청에 맞는 완전한 HTML 문서 하나를 작성해서 출력하세요.";
      let headerSent = false;
      callAnthropicStream(userText, AI_APP_SYSTEM_PROMPT, 8192, (delta) => {
        if (!headerSent) {
          headerSent = true;
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        }
        res.write(delta);
      })
        .then(() => {
          console.log("AI 앱 생성 완료(스트리밍)");
          if (!headerSent) {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          }
          res.end();
        })
        .catch((e) => {
          console.error("AI 앱 생성 실패:", e.message || e);
          if (!headerSent) {
            send(res, 500, JSON.stringify({ ok: false, error: String((e && e.message) || e) }), {
              "Content-Type": "application/json; charset=utf-8",
            });
          } else {
            res.end();
          }
        });
    });
    return;
  }

  if (req.method === "POST" && url === "/api/ai/image") {
    let ibody = "";
    req.on("data", (chunk) => (ibody += chunk));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(ibody);
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: "invalid json" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      const prompt = parsed.prompt;
      if (!prompt || typeof prompt !== "string") {
        return send(res, 400, JSON.stringify({ ok: false, error: "prompt가 필요합니다" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      const fullPrompt = buildImageContextPrefix(parsed.deckContext) + prompt;
      // 델타 텍스트가 아니라 이미지(base64) 이벤트라서, 한 줄에 완결된 JSON 하나씩
      // 개행으로 구분해서 내려준다 (NDJSON). 클라이언트는 줄 단위로 읽어서 매 이벤트를
      // 바로바로 미리보기 <img>에 반영해서 실제로 점점 선명해지는 걸 보여줄 수 있다.
      let headerSent = false;
      callOpenAiImageStream(fullPrompt, parsed.size, (evt) => {
        if (!headerSent) {
          headerSent = true;
          res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
        }
        res.write(JSON.stringify(evt) + "\n");
      })
        .then(() => {
          console.log("AI 이미지 생성 완료(스트리밍)");
          res.end();
        })
        .catch((e) => {
          console.error("AI 이미지 생성 실패:", e.message || e);
          if (!headerSent) {
            send(res, 500, JSON.stringify({ ok: false, error: String((e && e.message) || e) }), {
              "Content-Type": "application/json; charset=utf-8",
            });
          } else {
            res.end();
          }
        });
    });
    return;
  }

  if (req.method === "POST" && url === "/api/create-slide") {
    let cbody = "";
    req.on("data", (chunk) => (cbody += chunk));
    req.on("end", () => {
      try {
        const { file, html } = JSON.parse(cbody);
        if (
          !file ||
          typeof file !== "string" ||
          !file.startsWith("deck/") ||
          file.includes("..") ||
          !file.endsWith(".html")
        ) {
          return send(res, 400, JSON.stringify({ ok: false, error: "invalid file path" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        const filePath = safeJoin(ROOT, file);
        if (!filePath) {
          return send(res, 400, JSON.stringify({ ok: false, error: "invalid file path" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        if (fs.existsSync(filePath)) {
          return send(res, 409, JSON.stringify({ ok: false, error: "file already exists" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        fs.writeFileSync(filePath, html, "utf8");
        console.log(`새 슬라이드 생성됨: ${file}`);
        send(res, 200, JSON.stringify({ ok: true }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: String(e) }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
    });
    return;
  }

  if (req.method === "POST" && url === "/api/delete-slide") {
    let dbody = "";
    req.on("data", (chunk) => (dbody += chunk));
    req.on("end", () => {
      try {
        const { file } = JSON.parse(dbody);
        if (
          !file ||
          typeof file !== "string" ||
          !file.startsWith("deck/") ||
          file.includes("..") ||
          !file.endsWith(".html")
        ) {
          return send(res, 400, JSON.stringify({ ok: false, error: "invalid file path" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        const filePath = safeJoin(ROOT, file);
        if (!filePath) {
          return send(res, 400, JSON.stringify({ ok: false, error: "invalid file path" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`슬라이드 삭제됨: ${file}`);
        }
        send(res, 200, JSON.stringify({ ok: true }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: String(e) }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
    });
    return;
  }

  if (req.method === "POST" && url === "/api/save") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { file, html } = JSON.parse(body);
        if (
          !file ||
          typeof file !== "string" ||
          !file.startsWith("deck/") ||
          file.includes("..") ||
          !file.endsWith(".html")
        ) {
          return send(res, 400, JSON.stringify({ ok: false, error: "invalid file path" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        const filePath = safeJoin(ROOT, file);
        if (!filePath || !fs.existsSync(filePath)) {
          return send(res, 404, JSON.stringify({ ok: false, error: "file not found" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        fs.writeFileSync(filePath, html, "utf8");
        console.log(`저장됨: ${file} (${html.length.toLocaleString()} bytes)`);
        send(res, 200, JSON.stringify({ ok: true }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: String(e) }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
    });
    return;
  }

  let relPath = url === "/" ? "/index.html" : url;
  const filePath = safeJoin(ROOT, "." + relPath);
  if (!filePath) return send(res, 400, "bad request");

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, "Not found: " + url);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // 편집기를 계속 고치는 동안 브라우저가 옛날 JS/CSS를 캐싱해서
    // "고쳤는데도 그대로다" 라는 혼란이 생기지 않도록 캐시를 끈다.
    send(res, 200, data, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store, must-revalidate",
    });
  });
});

server.listen(PORT, () => {
  console.log(`슬라이드 에디터 서버 실행 중`);
  console.log(`  → http://localhost:${PORT}/ 를 브라우저에서 열어주세요`);
  console.log(`  종료하려면 Ctrl+C`);
});
