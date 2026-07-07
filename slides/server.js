// 로컬 슬라이드 에디터 서버 (외부 패키지 없이 Node 기본 모듈만 사용)
// 실행: node server.js  →  http://localhost:5500 접속
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = 5500;

// "슬라이드 마스터" 테마 저장에서 쓰는 색상 변수 키 <-> assets/styles.css의
// CSS 커스텀 프로퍼티 이름 매핑. 클라이언트(editor.js)의 THEME_CSS_VAR와 반드시
// 짝이 맞아야 한다.
const THEME_CSS_VAR = {
  bg: "--bg",
  bgPanel: "--bg-panel",
  text: "--text",
  muted: "--muted",
  muted2: "--muted-2",
  accent: "--accent",
  line: "--line",
};
// 글꼴은 임의 문자열을 그대로 CSS에 꽂지 않고(주입 위험), 항상 이 허용 목록의
// 키 하나만 받아서 실제 font-stack은 서버가 직접 채운다. editor.js의
// THEME_FONT_STACKS와 반드시 같은 값을 유지해야 한다.
const THEME_FONT_STACKS = {
  default: "'Pretendard','Apple SD Gothic Neo','Malgun Gothic',-apple-system,BlinkMacSystemFont,sans-serif",
  gothic: "'Malgun Gothic','Apple SD Gothic Neo',sans-serif",
  dotum: "'Dotum','돋움',sans-serif",
  batang: "'Batang','바탕',serif",
  gungseo: "'Gungsuh','궁서',serif",
};
function isHexColor(v) {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

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
- title-xl / title-lg: 큰 제목(xl이 더 큼). 안에 <span class="accent">문구</span>로 포인트 컬러(accent) 강조 가능
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
- 색은 절대 하드코딩하지 말고 테마 CSS 변수를 쓰세요: var(--bg) 배경, var(--bg-panel) 패널, var(--text) 본문, var(--muted)/var(--muted-2) 보조 텍스트, var(--accent) 포인트, var(--line) 구분선. 이렇게 해야 슬라이드 마스터에서 테마를 바꿔도 함께 바뀝니다.
- 포인트 컬러는 var(--accent) 하나만 사용하고, 나머지는 무채색 명도 차이로 구분하세요.
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
- 외부 리소스(CDN 스크립트/폰트, npm 패키지, 실제 이미지 URL 등)를 절대 쓰지 마세요. 순수 HTML/CSS/JS와 필요하면 <canvas>만으로, 이 파일 하나 안에서 완전히 동작해야 합니다. (샌드박스 iframe 안에서 실행되어 외부 네트워크 요청은 막혀 있습니다.)

[화면/크기]
- 사용자가 자유롭게 리사이즈하는 박스(대략 가로 500~900px, 세로 400~650px 범위) 안에서 실행됩니다. 고정 픽셀 대신 100%/vw/vh 기반 반응형으로 만들어 박스 크기에 맞게 늘어나도록 하세요.
- 다크 테마(짙은 배경, 밝은 텍스트)로 만들고, 포인트 컬러로 오렌지(#ff6b4a)를 활용하면 발표 슬라이드 톤과 잘 어울립니다.

[조작/내용]
- 키보드(방향키/스페이스 등) 또는 마우스 클릭처럼 간단한 조작으로 즉시 플레이/사용 가능해야 하며, 화면 안에 조작 방법을 한 줄로 안내하세요.
- 사용자가 요청한 것(예: 팩맨, 퐁, 틱택토, 스네이크, 카운터, 타이머, 간단한 계산기/시각화 등)을 실제로 동작하는 수준으로 구현하세요. 완벽한 원작 재현보다, 짧고 버그 없이 실제로 돌아가는 것이 훨씬 중요합니다.
- 요청이 모호하면 가장 대표적이고 누구나 알아볼 수 있는 형태로 스스로 판단해서 만드세요.

[미리 생성된 이미지 리소스 재사용 — 사용 가능하다고 안내받았을 때만]
- 사용자 요청 끝에 "사용 가능한 이미지: {{IMAGE_1}}, ..." 같은 안내가 있으면, 그 이미지들을 캐릭터/스프라이트/배경/아이콘 등으로 데모 안에서 실제로 활용하세요.
- 이미지가 필요한 자리에는 반드시 안내받은 플레이스홀더 문자열을 정확히 그대로(예: <img src="{{IMAGE_1}}"> 또는 CSS의 background-image:url({{IMAGE_1}}))만 쓰세요. 실제 base64 데이터나 다른 URL을 절대 지어내지 마세요 — 그 문자열은 나중에 실제 이미지로 자동 치환됩니다.
- 그런 안내가 없으면 이미지 없이 도형/색/텍스트만으로 구현하세요.

[기존 데모 수정 — "지금 있는 데모의 코드" 섹션이 주어졌을 때만]
- 사용자가 이미 만들어진 데모를 보면서 후속 요청을 한 것입니다(예: "배경을 파란색으로", "속도를 더 빠르게", "점수판도 보여줘"). 처음부터 새로 만드는 게 아니라, 주어진 기존 코드를 기반으로 요청한 부분만 자연스럽게 고치고 나머지 구조/로직/스타일은 최대한 그대로 유지하세요.
- 그래도 출력은 항상 완전한 HTML 문서 하나(수정된 전체 버전)여야 합니다. diff나 일부분만 출력하지 마세요.`;

// "AI 챗봇"은 이제 한 슬라이드짜리 단발 분류기가 아니라, 전체 덱을 스스로
// 검토하고 여러 슬라이드를 만들고/고치고/정리할 수 있는 도구-호출(tool use)
// 에이전트다. 실제 도구 실행(슬라이드 읽기/쓰기/생성/삭제/이동/이미지·앱 생성)은
// 전부 브라우저(index.html) 쪽에서 일어나고, 서버는 "다음에 뭘 할지" 한 턴을
// 판단해주는 역할만 한다 — 그래서 이 프롬프트/도구 스키마는 index.html의
// 다이렉트 모드 사본과 반드시 같은 내용을 유지해야 한다.
const AI_AGENT_SYSTEM_PROMPT = `당신은 발표 슬라이드 편집기에 내장된 자율 에이전트입니다. 사용자와 대화하면서, 필요하면 실제로 도구를 호출해 전체 발표 덱(여러 슬라이드)을 검토하고 만들고 고칠 수 있습니다.

[동작 방식]
- 확실히 답할 수 있는 질문/잡담이면 도구를 쓰지 않고 바로 자연어로 답하세요.
- 실행이 필요하면(검토/작성/생성/정리 등) 알맞은 도구를 호출하세요. 한 턴에 여러 도구를 부를 수도 있고, 결과를 본 뒤 이어서 다른 도구를 부를 수도 있습니다 — 몇 단계가 필요한지 스스로 판단해서 끝까지 진행하세요.
- "OO 주제로 N장짜리 발표 만들어줘" 같은 요청을 받으면: 먼저 list_slides로 지금 상태를 보고, 필요하면 read_slides로 기존 내용을 확인한 뒤, create_slide를 필요한 만큼 반복 호출해서 실제로 슬라이드를 만드세요. "정말 만들까요?"처럼 되묻지 말고 바로 실행하세요 — 사용자가 이미 실행을 요청한 것입니다.
- "전체 슬라이드 검토해줘"류 요청에는 list_slides → read_slides(all:true)로 실제 내용을 다 읽고, 문제(중복되는 내용, 톤 불일치, 방치된 TODO 등)를 구체적으로 짚어 자연어로 보고하세요. 사용자가 명확히 고쳐달라고 하지 않았다면 함부로 슬라이드를 고치지 마세요.
- 되돌릴 수 없는 작업(delete_slide)은 사용자가 명확히 삭제를 요청했을 때만 하세요.
- write_slide/create_slide/delete_slide/add_image/add_app은 실행 즉시 반영되지 않습니다 — 사용자에게 변경 전/후 미리보기가 뜨고, 사용자가 직접 수락하거나 취소합니다. 그러니 "정말 진행할까요?"처럼 채팅으로 되묻지 말고 바로 도구를 호출하세요(최종 승인은 화면에서 사용자가 합니다). 도구 결과에 "사용자가 거부함"이라고 나오면 그 변경은 적용되지 않은 것이니 다음 계획에 반영하세요.
- 모든 도구 호출이 끝나면 마지막에 무엇을 했는지 한국어로 간단히 요약해서 답하세요 — 도구 호출 없이 텍스트로만 답하면 그게 최종 답변이고, 그 순간 실행이 끝난 것으로 간주됩니다. 거부된 변경이 있었다면 요약에도 그 사실을 알려주세요.
- 슬라이드 인덱스는 0부터 시작합니다. list_slides/read_slides가 알려준 인덱스를 그대로 쓰세요.`;

// 서버(callAnthropicOnce)와 index.html의 다이렉트 모드가 똑같이 사용하는 도구
// 스키마. 실제 실행은 전부 브라우저에서 이뤄지므로(서버는 어떤 도구가 있는지만
// 알면 됨) input_schema는 Anthropic tool use 규격 그대로다.
const AGENT_TOOLS = [
  {
    name: "list_slides",
    description: "전체 발표 덱의 슬라이드 목록(순서, 섹션, 제목, TODO 표시 여부)을 가져온다. 다른 작업 전에 전체 구성을 파악할 때 사용한다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_slides",
    description: "지정한 슬라이드들의 실제 텍스트 내용을 읽는다(이미지/앱 등 첨부 리소스는 제외하고 글 내용만). 전체 검토나 특정 슬라이드의 현재 내용 확인에 사용한다.",
    input_schema: {
      type: "object",
      properties: {
        indices: { type: "array", items: { type: "integer" }, description: "0부터 시작하는 슬라이드 인덱스 목록" },
        all: { type: "boolean", description: "true면 전체 슬라이드를 읽는다(이때 indices는 무시됨)" },
      },
    },
  },
  {
    name: "write_slide",
    description: "지정한 슬라이드 한 장의 본문(글/제목/레이아웃)을 다시 쓰거나 고친다. 사용자가 직접 배치한 이미지/도형/영상/데모는 항상 그대로 유지된다.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "integer", description: "고칠 슬라이드의 0부터 시작하는 인덱스" },
        instruction: { type: "string", description: "이 슬라이드에 무엇을 어떻게 쓸지에 대한 구체적인 지시" },
      },
      required: ["index", "instruction"],
    },
  },
  {
    name: "create_slide",
    description: "새 슬라이드를 만든다. instruction을 함께 주면 만들자마자 그 내용으로 채워진다.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "슬라이드 제목(사이드바에 표시됨)" },
        act: { type: "string", description: "속할 섹션(막) 이름. 기존 섹션과 이름이 같으면 그 섹션에 들어가고, 새 이름이면 새 섹션이 만들어진다." },
        after_index: { type: "integer", description: "이 인덱스의 슬라이드 바로 뒤에 삽입한다. 생략하면 해당 섹션 맨 끝에 추가된다." },
        instruction: { type: "string", description: "새 슬라이드에 바로 채워 넣을 내용에 대한 지시. 생략하면 빈 슬라이드만 만든다." },
      },
      required: ["title", "act"],
    },
  },
  {
    name: "delete_slide",
    description: "슬라이드 한 장을 삭제한다. 되돌릴 수 없으니 사용자가 명확히 요청했을 때만 사용한다.",
    input_schema: { type: "object", properties: { index: { type: "integer" } }, required: ["index"] },
  },
  {
    name: "move_slide",
    description: "슬라이드 순서를 옮긴다.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "integer", description: "옮길 슬라이드의 현재 인덱스" },
        to_index: { type: "integer", description: "이동 후 기준으로 도착시킬 목표 인덱스" },
      },
      required: ["index", "to_index"],
    },
  },
  {
    name: "add_image",
    description: "지정한 슬라이드에 AI로 그린 이미지 한 장을 자유 배치로 추가한다.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "integer" },
        prompt: { type: "string", description: "그릴 장면/구성/스타일에 대한 구체적인 묘사" },
      },
      required: ["index", "prompt"],
    },
  },
  {
    name: "add_app",
    description: "지정한 슬라이드에 실제로 조작 가능한 인터랙티브 데모/미니게임을 자유 배치로 추가한다.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "integer" },
        prompt: { type: "string", description: "무엇을 만들지에 대한 지시(예: 팩맨, 카운터, 계산기 등)" },
      },
      required: ["index", "prompt"],
    },
  },
];

// Anthropic 메시지를 스트리밍(SSE)으로 호출한다. 델타 텍스트가 도착할 때마다
// onDelta로 즉시 넘겨주므로, 브라우저 쪽에서 "타이핑되듯" 생성 과정을 그대로
// 보여줄 수 있다. 이벤트 블록은 빈 줄("\n\n")로 구분되고, 그 안의 "data: {...}"
// 줄만 JSON으로 파싱해서 필요한 델타만 뽑아 쓴다.
function callAnthropicStream(messagesOrText, systemPrompt, maxTokens, onDelta) {
  return new Promise((resolve, reject) => {
    const apiKey = ENV.CLAUDE_API_KEY;
    if (!apiKey) return reject(new Error("CLAUDE_API_KEY가 .env에 없습니다"));
    // 대부분의 호출(text/app 생성 등)은 단발성 지시라 문자열 하나만 넘기면
    // user 메시지 한 개로 감싸주고, 대화형 라우팅처럼 실제 멀티턴 맥락이
    // 필요할 때만 {role, content} 배열을 그대로 넘긴다.
    const messages = Array.isArray(messagesOrText)
      ? messagesOrText
      : [{ role: "user", content: messagesOrText }];
    const payload = JSON.stringify({
      model: ENV.CLAUDE_MODEL || "claude-sonnet-5",
      max_tokens: maxTokens || 4096,
      system: systemPrompt,
      stream: true,
      // Sonnet 5부터는 적응형 사고(adaptive thinking)가 기본으로 켜져 있어서,
      // 아무 설정도 안 하면 답변 앞에 "생각하는" 토큰을 쓰고 그것도 max_tokens
      // 예산을 같이 깎아먹는다. 여기 작업(HTML/JSON 생성)은 깊은 추론이 필요
      // 없고 답변 길이 자체가 아슬아슬한 경우가 많아서, 명시적으로 꺼서
      // max_tokens 전부를 실제 결과물에 쓰게 한다.
      thinking: { type: "disabled" },
      messages: messages,
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

// 에이전트 도구 호출 루프의 "한 턴"을 위한 비스트리밍 호출. 도구 선택 자체는
// 사용자에게 타이핑되듯 보여줄 필요가 없는 내부 판단이고, tool_use 블록은
// 완성된 JSON으로 한 번에 와야 안전하게 파싱할 수 있어서 스트리밍을 쓰지
// 않는다(실제 슬라이드 본문/이미지/앱 생성처럼 오래 걸리는 부분은 각 도구
// 실행기 안에서 기존 callAnthropicStream을 그대로 재사용해 계속 스트리밍된다).
function callAnthropicOnce(messages, systemPrompt, tools, maxTokens) {
  return new Promise((resolve, reject) => {
    const apiKey = ENV.CLAUDE_API_KEY;
    if (!apiKey) return reject(new Error("CLAUDE_API_KEY가 .env에 없습니다"));
    const payload = JSON.stringify({
      model: ENV.CLAUDE_MODEL || "claude-sonnet-5",
      max_tokens: maxTokens || 2048,
      system: systemPrompt,
      thinking: { type: "disabled" },
      tools: tools,
      messages: messages,
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
      apiRes.setEncoding("utf8");
      apiRes.on("data", (chunk) => (body += chunk));
      apiRes.on("end", () => {
        let json;
        try {
          json = JSON.parse(body);
        } catch (e) {
          return reject(new Error("Anthropic 응답 파싱 실패"));
        }
        if (apiRes.statusCode !== 200) {
          return reject(new Error((json.error && json.error.message) || "Anthropic API 오류 " + apiRes.statusCode));
        }
        resolve(json);
      });
      apiRes.on("error", reject);
    });
    apiReq.on("error", reject);
    apiReq.write(payload);
    apiReq.end();
  });
}

// 클라이언트가 AI 컨텍스트를 보낼 때 이미지/데모의 base64는 미리 걸러서 보내지만,
// 혹시 모를 예외 상황(다른 경로로 큰 데이터가 섞여 들어오는 경우 등)에 대비해
// 서버에서도 한 번 더 길이를 제한한다. 이게 없으면 Claude의 입력 토큰 한도(20만)를
// 넘겨 "prompt is too long"으로 요청 전체가 실패해버린다.
const HTML_CONTEXT_MAX_CHARS = 60000;
function capHtmlContext(html) {
  const s = String(html || "");
  if (s.length <= HTML_CONTEXT_MAX_CHARS) return s;
  return s.slice(0, HTML_CONTEXT_MAX_CHARS) + "\n<!-- (내용이 너무 길어 이후는 생략됨) -->";
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
        const parsed = JSON.parse(mbody);
        const deck = parsed.deck;
        if (!Array.isArray(deck)) {
          return send(res, 400, JSON.stringify({ ok: false, error: "invalid deck" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        // 멀티 덱: 덱마다 assets/deck-<id>.json 매니페스트를 따로 가진다.
        // 덱 목록 자체는 assets/decks.json. 그 외 경로는 전부 거부한다.
        const file = typeof parsed.file === "string" ? parsed.file : "assets/deck.json";
        if (!/^assets\/decks?[a-z0-9-]*\.json$/.test(file) || file.includes("..")) {
          return send(res, 400, JSON.stringify({ ok: false, error: "invalid manifest path" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        const manifestPath = safeJoin(ROOT, file);
        if (!manifestPath) {
          return send(res, 400, JSON.stringify({ ok: false, error: "invalid manifest path" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        fs.writeFileSync(manifestPath, JSON.stringify(deck, null, 2), "utf8");
        console.log(`매니페스트 저장됨: ${file}`);
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

  if (req.method === "POST" && url === "/api/ai/agent-turn") {
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
      // 도구 호출 루프의 messages는 단순 문자열이 아니라 Anthropic 메시지 형식
      // 그대로(문자열 또는 tool_use/tool_result 블록 배열)라서, role만 최소
      // 검증하고 content는 그대로 전달한다. 실제 슬라이드/맥락 주입, 히스토리
      // 길이 관리는 index.html(브라우저) 쪽에서 이미 끝내고 보낸다.
      const messages = (Array.isArray(parsed.messages) ? parsed.messages : []).filter(
        (m) => m && (m.role === "user" || m.role === "assistant") && m.content != null
      );
      if (!messages.length) {
        return send(res, 400, JSON.stringify({ ok: false, error: "messages가 필요합니다" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      callAnthropicOnce(messages, AI_AGENT_SYSTEM_PROMPT, AGENT_TOOLS, 2048)
        .then((data) => {
          const content = Array.isArray(data.content) ? data.content : [];
          const toolNames = content.filter((b) => b.type === "tool_use").map((b) => b.name);
          console.log("AI 에이전트 턴:", toolNames.length ? "tool_use(" + toolNames.join(", ") + ")" : "텍스트 응답");
          send(res, 200, JSON.stringify({ ok: true, content: content, stopReason: data.stop_reason || null }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        })
        .catch((e) => {
          console.error("AI 에이전트 턴 실패:", e.message || e);
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
      const html = capHtmlContext(parsed.html || "");
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
      callAnthropicStream(userText, AI_SLIDE_SYSTEM_PROMPT, 16000, (delta) => {
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
      // 클라이언트가 최근 생성한 이미지 개수만 알려준다(실제 base64는 절대 여기로
      // 오지 않는다). Claude는 {{IMAGE_n}} 플레이스홀더만 쓰고, 실제 데이터
      // 치환은 브라우저 쪽에서 이뤄진다.
      const imageCount = Math.max(0, Math.min(9, parseInt(parsed.imageCount, 10) || 0));
      let imageNote = "";
      if (imageCount > 0) {
        const placeholders = Array.from({ length: imageCount }, (_, i) => `{{IMAGE_${i + 1}}}`).join(", ");
        imageNote = `\n\n사용 가능한 이미지: ${placeholders} (총 ${imageCount}장, 방금 AI가 그려준 그림입니다). 어울리면 이 데모 안에서 리소스로 활용하세요.`;
      }
      // 이 발표의 주제/구성을 알려줘야 데모의 소재·톤이 슬라이드와 어울리게
      // 나온다(예: 어떤 발표인지 전혀 모르는 채로 엉뚱한 데모가 나오는 문제 방지).
      const deckContextText = formatDeckContext(parsed.deckContext);
      // 사용자가 채팅으로 계속 이어서 요청하면("배경 바꿔줘" 등), 처음부터 새로
      // 만드는 게 아니라 지금 슬라이드에 있는 데모의 실제 코드를 그대로 주고
      // 그 위에서 고치게 한다 — 이게 없으면 매번 완전히 새로운 데모가 나온다.
      const existingAppHtml = capHtmlContext(parsed.existingAppHtml || "");
      const existingSection = existingAppHtml
        ? `\n\n지금 있는 데모의 코드:\n---\n${existingAppHtml}\n---`
        : "";
      const userText =
        (deckContextText ? deckContextText + "\n\n" : "") +
        "요청: " + prompt + imageNote + existingSection +
        "\n\n위 요청에 맞는 완전한 HTML 문서 하나를 작성해서 출력하세요.";
      let headerSent = false;
      callAnthropicStream(userText, AI_APP_SYSTEM_PROMPT, 20000, (delta) => {
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

  // "슬라이드 마스터" — assets/styles.css의 :root 변수 블록을 통째로 바꿔써서,
  // 이 스타일시트를 함께 쓰는 모든 슬라이드의 테마(배경/텍스트/포인트색/글꼴)를
  // 한 번에 바꾼다. 색상은 반드시 #rrggbb 형태만, 글꼴은 허용 목록의 키만 받아서
  // CSS에 임의 문자열이 그대로 꽂히는 걸 막는다.
  if (req.method === "POST" && url === "/api/save-theme") {
    let thbody = "";
    req.on("data", (chunk) => (thbody += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(thbody);
        const v = (parsed && parsed.vars) || {};
        for (const key of Object.keys(THEME_CSS_VAR)) {
          if (!isHexColor(v[key])) {
            return send(res, 400, JSON.stringify({ ok: false, error: `잘못된 색상 값: ${key}` }), {
              "Content-Type": "application/json; charset=utf-8",
            });
          }
        }
        const fontKey = THEME_FONT_STACKS[v.font] ? v.font : "default";
        const cssPath = path.join(ROOT, "assets", "styles.css");
        const original = fs.readFileSync(cssPath, "utf8");
        if (!/:root\s*\{[^}]*\}/.test(original)) {
          return send(res, 500, JSON.stringify({ ok: false, error: "styles.css에서 :root 블록을 찾지 못했습니다" }), {
            "Content-Type": "application/json; charset=utf-8",
          });
        }
        const decls = Object.keys(THEME_CSS_VAR)
          .map((key) => `  ${THEME_CSS_VAR[key]}: ${v[key]};`)
          .join("\n");
        const newRoot = `:root {\n${decls}\n  --font: ${THEME_FONT_STACKS[fontKey]};\n}`;
        const updated = original.replace(/:root\s*\{[^}]*\}/, newRoot);
        fs.writeFileSync(cssPath, updated, "utf8");
        console.log("슬라이드 마스터(테마) 저장됨 — 모든 슬라이드에 적용됩니다");
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
