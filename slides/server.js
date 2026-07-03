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

function callAnthropic(userText) {
  return new Promise((resolve, reject) => {
    const apiKey = ENV.CLAUDE_API_KEY;
    if (!apiKey) return reject(new Error("CLAUDE_API_KEY가 .env에 없습니다"));
    const payload = JSON.stringify({
      model: ENV.CLAUDE_MODEL || "claude-sonnet-4-5",
      max_tokens: 4096,
      system: AI_SLIDE_SYSTEM_PROMPT,
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
      let body = "";
      apiRes.on("data", (chunk) => (body += chunk));
      apiRes.on("end", () => {
        try {
          const json = JSON.parse(body);
          if (apiRes.statusCode !== 200) {
            return reject(new Error((json.error && json.error.message) || "Anthropic API 오류 " + apiRes.statusCode));
          }
          const text = (json.content || []).map((c) => c.text || "").join("");
          resolve(text);
        } catch (e) {
          reject(e);
        }
      });
    });
    apiReq.on("error", reject);
    apiReq.write(payload);
    apiReq.end();
  });
}

function cleanAiHtml(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "");
  return s.trim();
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

function callOpenAiImage(prompt, size) {
  return new Promise((resolve, reject) => {
    const apiKey = ENV.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error("OPENAI_API_KEY가 .env에 없습니다"));
    const payload = JSON.stringify({
      model: ENV.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt: prompt,
      size: size || "1536x1024",
      n: 1,
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
      let body = "";
      apiRes.on("data", (chunk) => (body += chunk));
      apiRes.on("end", () => {
        try {
          const json = JSON.parse(body);
          if (apiRes.statusCode !== 200) {
            return reject(new Error((json.error && json.error.message) || "OpenAI API 오류 " + apiRes.statusCode));
          }
          const b64 = json.data && json.data[0] && json.data[0].b64_json;
          if (!b64) return reject(new Error("이미지 데이터를 받지 못했습니다"));
          resolve(b64);
        } catch (e) {
          reject(e);
        }
      });
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
      callAnthropic(userText)
        .then((raw) => {
          console.log("AI 텍스트 생성 완료");
          send(res, 200, JSON.stringify({ ok: true, html: cleanAiHtml(raw) }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        })
        .catch((e) => {
          console.error("AI 텍스트 생성 실패:", e.message || e);
          send(res, 500, JSON.stringify({ ok: false, error: String((e && e.message) || e) }), {
            "Content-Type": "application/json; charset=utf-8",
          });
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
      callOpenAiImage(fullPrompt, parsed.size)
        .then((b64) => {
          console.log("AI 이미지 생성 완료");
          send(res, 200, JSON.stringify({ ok: true, dataUrl: "data:image/png;base64," + b64 }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        })
        .catch((e) => {
          console.error("AI 이미지 생성 실패:", e.message || e);
          send(res, 500, JSON.stringify({ ok: false, error: String((e && e.message) || e) }), {
            "Content-Type": "application/json; charset=utf-8",
          });
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
