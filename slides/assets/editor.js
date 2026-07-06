// PPT 수준의 슬라이드 편집기.
// index.html이 postMessage로 편집 모드를 켜면, 이 슬라이드 문서 자체가
// contenteditable이 되고 상단에 서식 툴바가 나타납니다.
//
// 자유 배치 요소(.free-el)는 이미지 / 텍스트 상자 / 도형 세 종류이며
// 드래그 이동, 모서리 리사이즈, 레이어 순서, 복제, 삭제, 방향키 이동을
// 모두 지원합니다. 위치·크기는 슬라이드 기준 %로 저장되어 화면 크기가
// 달라져도 항상 같은 비율을 유지합니다.
//
// "저장"을 누르면 현재 문서를 /api/save로 보내 같은 파일에 그대로 덮어씁니다.
// (반드시 node server.js로 로컬 서버를 켜고 http://localhost:5500 으로 접속했을 때만 저장됩니다.)
(function () {
  var ROOT_SELECTOR = ".slide";
  var UI_ID = "__cursor_editor_ui";
  var AI_PANEL_ID = "__cursor_ai_panel";
  // AI 챗봇은 버튼을 여러 개로 나누지 않고, 자연어 요청 하나를 받아서
  // 서버(/api/ai/route)가 text/image/app 중 뭘 할지 알아서 판단하게 한다.
  var deckContext = null; // index.html이 postMessage로 보내주는 전체 발표 맥락 정보
  var dragState = null;
  var history = [];
  var historyIndex = -1;
  var isRestoring = false;
  var snapshotTimer = null;
  // 전체 편집 모드 on/off 여부. 슬라이드 루트(.slide)의 contenteditable 속성과는
  // 별개로 관리한다 — 텍스트 상자를 편집하는 동안에는 중첩 contenteditable로 인한
  // 브라우저 버그(입력 중 커서가 밖으로 튕겨나가는 현상)를 피하기 위해 루트의
  // contenteditable을 잠시 꺼두는데, 그 사이에도 "편집 모드 자체는 켜져 있다"는
  // 사실은 유지되어야 붙여넣기/단축키 등이 계속 정상 동작한다.
  var editModeOn = false;

  function relFilePath() {
    return window.location.pathname.replace(/^\//, "");
  }

  function getRoot() {
    return document.querySelector(ROOT_SELECTOR);
  }

  function isEditing() {
    return editModeOn;
  }

  function getSelectedFreeEl() {
    var active = document.activeElement;
    return active && active.classList && active.classList.contains("free-el") ? active : null;
  }

  /* ------------------------------------------------------------------ */
  /* 툴바 UI                                                              */
  /* ------------------------------------------------------------------ */

  function buildToolbar() {
    var existing = document.getElementById(UI_ID);
    if (existing) return existing;

    var style = document.createElement("style");
    style.id = UI_ID + "_style";
    style.textContent =
      "#" + UI_ID + " .cebar{position:fixed;top:0;left:0;right:0;z-index:999999;" +
      "display:flex;flex-wrap:wrap;align-items:center;gap:5px;background:#1b1c20;" +
      "border-bottom:1px solid #34363d;padding:6px 10px;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;font-size:12px;}" +
      "#" + UI_ID + " button{font-family:inherit;font-size:12px;color:#eceded;background:#2a2c33;" +
      "border:1px solid #3c3e46;border-radius:4px;padding:5px 9px;cursor:pointer;line-height:1.2;white-space:nowrap;}" +
      "#" + UI_ID + " button:hover{border-color:#ff6b4a;color:#ff6b4a;}" +
      "#" + UI_ID + " button:disabled{opacity:.35;cursor:default;}" +
      "#" + UI_ID + " button:disabled:hover{border-color:#3c3e46;color:#eceded;}" +
      "#" + UI_ID + " .cesep{width:1px;height:18px;background:#3c3e46;margin:0 3px;}" +
      "#" + UI_ID + " .celabel{color:#71747c;padding:0 1px;}" +
      "#" + UI_ID + " .cestatus{margin-left:auto;color:#8a8d95;white-space:nowrap;}" +
      "#" + UI_ID + " .ceswatch{width:18px;height:18px;border-radius:4px;border:1px solid #45474f;padding:0;cursor:pointer;}" +
      "#" + UI_ID + " input[type=color]{width:24px;height:24px;padding:0;border:1px solid #45474f;" +
      "border-radius:4px;background:none;cursor:pointer;}" +
      "#" + UI_ID + " select{font-family:inherit;font-size:12px;color:#eceded;background:#2a2c33;" +
      "border:1px solid #3c3e46;border-radius:4px;padding:5px 6px;cursor:pointer;max-width:108px;}" +
      "#" + UI_ID + " button.ai-btn{border-color:#5a4a8f;color:#c9b8ff;}" +
      "#" + UI_ID + " button.ai-btn:hover{border-color:#a78bfa;color:#a78bfa;}" +
      "#" + AI_PANEL_ID + "{position:fixed;top:41px;left:0;right:0;z-index:999998;display:none;" +
      "flex-direction:column;gap:6px;background:#1b1c20;border-bottom:1px solid #34363d;" +
      "padding:10px 12px;font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;}" +
      "#" + AI_PANEL_ID + " .ai-title{font-size:12px;font-weight:700;color:#c9b8ff;}" +
      "#" + AI_PANEL_ID + " .ai-context{font-size:11px;color:#8a8d95;}" +
      "#" + AI_PANEL_ID + " textarea{width:100%;min-height:52px;resize:vertical;font-family:inherit;" +
      "font-size:12.5px;color:#eceded;background:#111217;border:1px solid #3c3e46;border-radius:6px;" +
      "padding:8px 10px;box-sizing:border-box;}" +
      "#" + AI_PANEL_ID + " .ai-actions{display:flex;align-items:center;gap:8px;}" +
      "#" + AI_PANEL_ID + " .ai-actions button{font-family:inherit;font-size:12px;color:#eceded;" +
      "background:#2a2c33;border:1px solid #3c3e46;border-radius:4px;padding:6px 12px;cursor:pointer;}" +
      "#" + AI_PANEL_ID + " .ai-actions button[data-cmd='ai-run']{background:#5a4a8f;border-color:#5a4a8f;" +
      "color:#fff;font-weight:700;}" +
      "#" + AI_PANEL_ID + " .ai-actions button:disabled{opacity:.5;cursor:default;}" +
      "#" + AI_PANEL_ID + " .ai-status{font-size:11.5px;color:#8a8d95;}" +
      // 챗봇처럼 지난 요청/결과를 말풍선으로 쌓아 보여주는 대화 로그.
      // 내용이 없으면 flex 컨테이너가 그냥 0높이로 접혀서 평소엔 자리를 차지하지 않는다.
      "#" + AI_PANEL_ID + " .ai-chat-log{display:flex;flex-direction:column;gap:6px;" +
      "max-height:160px;overflow-y:auto;}" +
      "#" + AI_PANEL_ID + " .ai-msg{max-width:85%;padding:6px 10px;border-radius:10px;font-size:12px;" +
      "line-height:1.45;word-break:break-word;}" +
      "#" + AI_PANEL_ID + " .ai-msg.user{align-self:flex-end;background:#3a2f57;color:#eceded;" +
      "border:1px solid #5a4a8f;}" +
      "#" + AI_PANEL_ID + " .ai-msg.assistant{align-self:flex-start;background:#20222a;color:#c7cad1;" +
      "border:1px solid #34363d;}" +
      "#" + AI_PANEL_ID + " .ai-msg.error{border-color:#a33a3a;color:#ff9a8a;}" +
      "#" + AI_PANEL_ID + " .ai-msg img{display:block;max-width:160px;max-height:110px;border-radius:6px;" +
      "margin-top:4px;}" +
      "." + ROOT_SELECTOR.replace(".", "") + "[contenteditable='true']{outline:2px dashed #ff6b4a55;outline-offset:-2px;}" +
      ".free-el{cursor:move;outline:1px dashed transparent;}" +
      ".free-el:hover{outline-color:#ff6b4a88;}" +
      ".free-el:focus{outline:1px dashed #ff6b4a;}" +
      ".free-el--text[contenteditable='true']{cursor:text;outline:1px solid #ff6b4a;}" +
      ".free-el-handle{position:absolute;right:-8px;bottom:-8px;width:16px;height:16px;" +
      "background:#ff6b4a;border:2px solid #1b1c20;border-radius:3px;cursor:nwse-resize;" +
      "z-index:2;opacity:.65;}" +
      ".free-el:hover .free-el-handle,.free-el:focus .free-el-handle{opacity:1;}" +
      ".free-el-del{position:absolute;top:-12px;right:-12px;width:20px;height:20px;border-radius:50%;" +
      "border:1px solid #34363d;background:#1b1c20;color:#fff;font-size:12px;line-height:18px;" +
      "padding:0;cursor:pointer;z-index:2;opacity:.65;}" +
      ".free-el:hover .free-el-del,.free-el:focus .free-el-del{opacity:1;}" +
      // 유튜브/임베드는 실제로 다른 사이트를 담은 iframe이라, 드래그 중 마우스가
      // 그 위를 지나가면 이벤트를 그쪽 문서가 가로채서 리사이즈가 끊길 수 있다.
      // 편집 중에는 iframe 자체를 pointer-events:none으로 비활성화하고,
      // 그 위에 투명한 "방패" 레이어(.free-el-shield)를 깔아서 모든 마우스
      // 이벤트가 항상 우리 코드로만 들어오게 한다. (편집 모드가 꺼지면 방패도
      // 사라지고 iframe이 다시 살아나서 발표 중엔 영상 재생·임베드 조작이 된다.)
      "." + ROOT_SELECTOR.replace(".", "") + "[contenteditable='true'] .free-el--video iframe," +
      "." + ROOT_SELECTOR.replace(".", "") + "[contenteditable='true'] .free-el--video video," +
      "." + ROOT_SELECTOR.replace(".", "") + "[contenteditable='true'] .free-el--embed iframe," +
      "." + ROOT_SELECTOR.replace(".", "") + "[contenteditable='true'] .free-el--app iframe{pointer-events:none;}" +
      ".free-el-shield{position:absolute;inset:0;z-index:1;background:transparent;display:none;}" +
      "." + ROOT_SELECTOR.replace(".", "") + "[contenteditable='true'] .free-el-shield{display:block;}" +
      "#" + AI_PANEL_ID + " .ai-stream{display:none;max-height:160px;overflow:auto;margin:0;" +
      "font-family:'SF Mono',Consolas,'Courier New',monospace;font-size:11px;line-height:1.5;" +
      "color:#9fe6a0;background:#0c0d10;border:1px solid #2b2d33;border-radius:6px;padding:8px 10px;" +
      "white-space:pre-wrap;word-break:break-all;}" +
      // 이미지는 부분 결과(partial_images)가 실제로 도착하는 대로 그대로 보여주되,
      // 그 위에 오렌지 스캔 라인을 계속 흘려서 "지금 생성되고 있다"는 느낌을 강조한다.
      "#" + AI_PANEL_ID + " .ai-image-preview-wrap{display:none;position:relative;width:220px;" +
      "height:140px;overflow:hidden;border:1px solid #2b2d33;border-radius:6px;background:#0c0d10;}" +
      "#" + AI_PANEL_ID + " .ai-image-preview{display:block;width:100%;height:100%;object-fit:contain;" +
      "background:#0c0d10;}" +
      "#" + AI_PANEL_ID + " .ai-scanline{position:absolute;left:0;right:0;top:0;height:3px;" +
      "background:linear-gradient(90deg,transparent,#ff6b4a,transparent);" +
      "box-shadow:0 0 10px 2px #ff6b4a99;animation:__cursor_ai_scan 1.6s linear infinite;}" +
      "@keyframes __cursor_ai_scan{0%{top:0;}100%{top:100%;}}";
    document.head.appendChild(style);

    var wrap = document.createElement("div");
    wrap.id = UI_ID;
    wrap.innerHTML =
      '<div class="cebar">' +
      '<button data-cmd="undo" title="실행 취소 (Ctrl+Z)">↶</button>' +
      '<button data-cmd="redo" title="다시 실행 (Ctrl+Shift+Z)">↷</button>' +
      '<span class="cesep"></span>' +
      '<button data-cmd="bold" title="굵게"><b>B</b></button>' +
      '<button data-cmd="underline" title="밑줄"><u>U</u></button>' +
      '<button data-cmd="hl" title="선택한 텍스트를 검정 박스로 강조">강조</button>' +
      '<button data-cmd="unhl" title="강조 해제">강조 해제</button>' +
      '<button data-cmd="clear-fmt" title="붙여넣기 등으로 섞여 들어온 폰트/색상 서식을 제거하고 순수 텍스트로">서식 지우기</button>' +
      '<span class="cesep"></span>' +
      '<span class="celabel">글자</span>' +
      '<select data-cmd="font-family" title="글꼴 바꾸기">' +
      '<option value="">기본 폰트</option>' +
      '<option value="\'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif">고딕</option>' +
      '<option value="\'Dotum\',\'돋움\',sans-serif">돋움</option>' +
      '<option value="\'Batang\',\'바탕\',serif">명조(바탕)</option>' +
      '<option value="\'Gungsuh\',\'궁서\',serif">궁서체</option>' +
      '</select>' +
      '<button data-cmd="font-minus" title="글자 작게">가-</button>' +
      '<button data-cmd="font-plus" title="글자 크게">가+</button>' +
      '<button class="ceswatch" data-color="#f2f3f5" style="background:#f2f3f5" title="흰색 텍스트"></button>' +
      '<button class="ceswatch" data-color="#ff6b4a" style="background:#ff6b4a" title="포인트 색 텍스트"></button>' +
      '<button class="ceswatch" data-color="#999da5" style="background:#999da5" title="회색 텍스트"></button>' +
      '<input type="color" data-cmd="color-picker" title="색상 직접 선택 (텍스트/도형)" value="#ff6b4a" />' +
      '<span class="cesep"></span>' +
      '<span class="celabel">삽입</span>' +
      '<button data-cmd="add-text" title="자유롭게 배치되는 텍스트 상자 추가">텍스트 상자</button>' +
      '<button data-cmd="add-rect" title="사각형 도형 추가">사각형</button>' +
      '<button data-cmd="add-line" title="선 도형 추가">선</button>' +
      '<button data-cmd="image" title="이미지 삽입 (자유 배치)">이미지</button>' +
      '<button data-cmd="youtube" title="유튜브 링크 또는 .mp4/.webm 영상 파일 링크 삽입">동영상</button>' +
      '<button data-cmd="embed" title="dbdiagram·Figma·구글지도 등 &lt;iframe&gt; 임베드 코드/링크 삽입">임베드</button>' +
      '<span class="cesep"></span>' +
      '<button class="ai-btn" data-cmd="ai-chat" title="자연어로 요청하면 알아서 슬라이드 내용을 고치거나, 이미지를 그리거나, 인터랙티브 데모를 만듭니다">AI 챗봇</button>' +
      '<span class="cesep"></span>' +
      '<span class="celabel">선택 요소</span>' +
      '<button data-cmd="front" title="맨 앞으로">앞으로</button>' +
      '<button data-cmd="back" title="맨 뒤로 (겹친 요소는 Alt+클릭으로도 한 칸씩 선택할 수 있어요)">뒤로</button>' +
      '<button data-cmd="dup" title="복제 (Ctrl+D)">복제</button>' +
      '<button data-cmd="del-selected" title="삭제 (Delete)">삭제</button>' +
      '<span class="cesep"></span>' +
      '<span class="celabel">배경</span>' +
      '<button class="ceswatch" data-bg="#0c0d10" style="background:#0c0d10" title="기본 배경"></button>' +
      '<button class="ceswatch" data-bg="#0e2438" style="background:#0e2438" title="네이비 배경"></button>' +
      '<button class="ceswatch" data-bg="#000000" style="background:#000000" title="완전 검정"></button>' +
      '<button class="ceswatch" data-bg="#161616" style="background:#161616" title="차콜"></button>' +
      '<span class="cesep"></span>' +
      '<button data-cmd="save" style="font-weight:700;">저장</button>' +
      '<span class="cestatus"></span>' +
      "</div>" +
      '<div id="' + AI_PANEL_ID + '">' +
      '<div class="ai-title">AI 챗봇 · 텍스트 수정 · 이미지 생성 · 인터랙티브 데모를 한 곳에서</div>' +
      '<div class="ai-context"></div>' +
      '<div class="ai-chat-log"></div>' +
      '<pre class="ai-stream"></pre>' +
      '<div class="ai-image-preview-wrap"><img class="ai-image-preview" alt="생성 중인 이미지 미리보기" /><div class="ai-scanline"></div></div>' +
      '<textarea class="ai-input" rows="2" placeholder="예: 이 슬라이드 제목을 더 강하게 바꿔줘 / 오렌지톤 아이콘 그려줘 / 방향키로 조작하는 팩맨 게임 만들어줘"></textarea>' +
      '<div class="ai-actions">' +
      '<button data-cmd="ai-run" title="Ctrl+Enter">전송</button>' +
      '<button data-cmd="ai-cancel">닫기</button>' +
      '<span class="ai-status"></span>' +
      "</div>" +
      "</div>";
    document.body.appendChild(wrap);
    wireToolbar(wrap);
    return wrap;
  }

  function wireToolbar(wrap) {
    wrap.addEventListener("mousedown", function (e) {
      if (e.target.closest("button")) e.preventDefault();
    });
    wrap.addEventListener("input", function (e) {
      if (e.target.matches('input[type=color]')) applyColor(e.target.value);
    });
    wrap.addEventListener("change", function (e) {
      if (e.target.matches('select[data-cmd="font-family"]')) applyFontFamily(e.target.value);
    });
    wrap.addEventListener("keydown", function (e) {
      if (e.target.matches(".ai-input") && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runAi();
      }
    });
    wrap.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var cmd = btn.getAttribute("data-cmd");
      if (cmd === "bold") { document.execCommand("bold"); commitSoon(); }
      else if (cmd === "underline") { document.execCommand("underline"); commitSoon(); }
      else if (cmd === "hl") { wrapSelection("hl-box"); commitSoon(); }
      else if (cmd === "unhl") { unwrapHighlight(); commitSoon(); }
      else if (cmd === "clear-fmt") clearFormatting();
      else if (cmd === "font-minus") adjustFontSize(-0.2);
      else if (cmd === "font-plus") adjustFontSize(0.2);
      else if (cmd === "add-text") insertTextBox();
      else if (cmd === "add-rect") insertShape("rect");
      else if (cmd === "add-line") insertShape("line");
      else if (cmd === "image") insertImage();
      else if (cmd === "youtube") insertYoutube();
      else if (cmd === "embed") insertEmbed();
      else if (cmd === "ai-chat") toggleAiPanel();
      else if (cmd === "ai-run") runAi();
      else if (cmd === "ai-cancel") closeAiPanel();
      else if (cmd === "front") { var s1 = getSelectedFreeEl(); if (s1) bringToFront(s1); }
      else if (cmd === "back") { var s2 = getSelectedFreeEl(); if (s2) sendToBack(s2); }
      else if (cmd === "dup") duplicateSelected();
      else if (cmd === "del-selected") { var s3 = getSelectedFreeEl(); if (s3) { s3.remove(); snapshot(); } }
      else if (cmd === "undo") undo();
      else if (cmd === "redo") redo();
      else if (cmd === "save") save(wrap);
      else if (btn.hasAttribute("data-color")) applyColor(btn.getAttribute("data-color"));
      else if (btn.hasAttribute("data-bg")) {
        var root = getRoot();
        if (root) { root.style.background = btn.getAttribute("data-bg"); snapshot(); }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* AI로 작성 (Claude) / AI 이미지 생성 (OpenAI)                              */
  /* 실제 API 키는 서버(server.js)의 .env에서만 읽고 사용하며,                    */
  /* 브라우저에는 절대 전달되지 않는다. 이 파일은 로컬 서버로 프록시 요청만 보낸다.      */
  /* ------------------------------------------------------------------ */

  function getCleanRootHtml() {
    var root = getRoot();
    if (!root) return "";
    var clone = root.cloneNode(true);
    stripFreeElChrome(clone);
    return clone.innerHTML;
  }

  // AI 패널에 "지금 AI에게 어떤 맥락이 전달되는지"를 눈에 보이게 표시해서,
  // 맥락이 비어있다면(= 아직 부모 창에서 정보를 못 받았다면) 사용자가 바로 알 수 있게 한다.
  function updateAiContextLine() {
    var panel = document.getElementById(AI_PANEL_ID);
    if (!panel) return;
    var line = panel.querySelector(".ai-context");
    if (!line) return;
    if (!deckContext) {
      line.textContent = "";
      return;
    }
    var pos = (deckContext.currentIndex + 1) + "/" + deckContext.total;
    var parts = ["컨텍스트: " + pos];
    if (deckContext.currentAct) parts.push(deckContext.currentAct);
    if (deckContext.deckTitle) parts.push(deckContext.deckTitle);
    line.textContent = parts.join(" · ");
  }

  function toggleAiPanel() {
    var panel = document.getElementById(AI_PANEL_ID);
    if (!panel) return;
    if (panel.style.display === "flex") {
      closeAiPanel();
      return;
    }
    panel.style.display = "flex";
    updateAiContextLine();
    panel.querySelector(".ai-input").focus();
  }

  function closeAiPanel() {
    var panel = document.getElementById(AI_PANEL_ID);
    if (panel) panel.style.display = "none";
  }

  // 대화 로그에 말풍선 하나를 추가한다. role은 "user" 또는 "assistant"(에러면
  // "assistant error")이고, imgSrc를 주면 그 이미지도 말풍선 안에 함께 보여준다.
  // 사용자가 입력한 프롬프트를 그대로 담을 수 있어서 textContent로만 채워
  // 마크업 삽입(HTML 인젝션) 위험 없이 안전하게 렌더링한다.
  function appendChatMsg(panel, role, text, imgSrc) {
    var log = panel.querySelector(".ai-chat-log");
    if (!log) return null;
    var msg = document.createElement("div");
    msg.className = "ai-msg " + role;
    if (text) {
      var p = document.createElement("div");
      p.textContent = text;
      msg.appendChild(p);
    }
    if (imgSrc) {
      var img = document.createElement("img");
      img.src = imgSrc;
      msg.appendChild(img);
    }
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
    return msg;
  }

  // Claude가 응답 맨 앞에 <!-- root-class: hook --> 같은 주석을 남기면
  // 슬라이드 루트(.slide)에 그 보조 클래스를 적용해준다 (hook/section 처럼
  // 중앙 정렬 등 루트 레벨 스타일이 필요한 레이아웃을 쓸 수 있게 하기 위함).
  function applyRootClassDirective(html) {
    var m = html.match(/^\s*<!--\s*root-class:\s*([\w\s-]+?)\s*-->\s*/i);
    if (!m) return html;
    var directive = m[1].trim();
    var allowed = { hook: 1, section: 1 };
    var root = getRoot();
    if (root && allowed[directive]) {
      root.className = "slide " + directive;
    }
    return html.slice(m[0].length);
  }

  // 서버가 붙여줄 수 있는 ```html 코드펜스만 제거한다 (실제 정리는
  // 서버에서 하지 않고, 스트리밍이 끝난 뒤 여기서 한 번만 처리한다).
  function cleanAiHtmlClient(raw) {
    var s = String(raw || "").trim();
    s = s.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "");
    return s.trim();
  }

  // /api/ai/text, /api/ai/app 둘 다 text/plain 스트림으로 응답한다.
  // 델타가 도착할 때마다 onChunk(누적된 전체 텍스트)를 호출해서 AI 패널에
  // "타이핑되듯" 생성 과정을 그대로 보여줄 수 있게 하고, 스트림이 끝나면
  // 최종 텍스트로 resolve한다. 서버가 스트림을 시작하기 전에 실패하면
  // (예: API 키 없음) application/json 에러 응답이 오므로 그 경우엔 reject한다.
  function streamAiText(url, body, onChunk) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      var contentType = res.headers.get("content-type") || "";
      if (!res.ok || contentType.indexOf("application/json") === 0) {
        return res.json().then(function (data) {
          throw new Error((data && data.error) || "HTTP " + res.status);
        });
      }
      if (!res.body || !res.body.getReader) {
        return res.text().then(function (full) {
          onChunk(full);
          return full;
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var full = "";
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) return full;
          full += decoder.decode(result.value, { stream: true });
          onChunk(full);
          return pump();
        });
      }
      return pump();
    });
  }

  // 서버가 이미지 생성 이벤트를 한 줄에 하나씩 완결된 JSON으로 흘려보내는
  // NDJSON 스트림을 읽는다(줄바꿈으로 이벤트 구분). 청크가 줄 중간에서 끊겨도
  // 되도록 마지막 미완성 줄은 버퍼에 남겨뒀다가 다음 청크와 합쳐서 파싱한다.
  function streamNdjson(url, body, onEvent) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      var contentType = res.headers.get("content-type") || "";
      if (!res.ok || contentType.indexOf("application/json") === 0) {
        return res.json().then(function (data) {
          throw new Error((data && data.error) || "HTTP " + res.status);
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      function handleLine(line) {
        if (!line.trim()) return;
        try {
          onEvent(JSON.parse(line));
        } catch (e) {
          // 불완전한 줄은 조용히 무시
        }
      }
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            handleLine(buffer);
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split("\n");
          buffer = lines.pop();
          lines.forEach(handleLine);
          return pump();
        });
      }
      return pump();
    });
  }

  // 버튼 하나로 들어온 자연어 요청을 실제로 처리한다. action은 /api/ai/route가
  // 판단해서 넘겨준 "text" | "image" | "app" 중 하나. 세 경우 모두 기존에 쓰던
  // 스트리밍 파이프라인을 그대로 재사용하고, 끝나면 대화 로그에 결과를 남긴다.
  // detail은 /api/ai/route가 미리 구체화해준 설명으로, "image" 단계에서는
  // 사용자의 (보통 모호한) 문장 대신 이 detail을 실제 이미지 프롬프트로 쓴다.
  function runAiAction(panel, action, prompt, detail) {
    var status = panel.querySelector(".ai-status");
    var streamEl = panel.querySelector(".ai-stream");
    var previewWrap = panel.querySelector(".ai-image-preview-wrap");
    var previewImg = panel.querySelector(".ai-image-preview");

    if (action === "image") {
      var imagePrompt = detail && detail.trim() ? detail.trim() : prompt;
      // gpt-image 계열은 실제로 완성 전 흐릿한 중간 결과 이미지를 몇 장 먼저
      // 보내준다(partial_images). 그걸 그대로 미리보기에 반영해서, 점점 선명한
      // 이미지로 "스캔되어 나타나는" 효과를 진짜 생성 과정으로 보여준다.
      status.textContent = "이미지 생성 중…";
      previewImg.removeAttribute("src");
      previewWrap.style.display = "block";
      return streamNdjson("/api/ai/image", { prompt: imagePrompt, deckContext: deckContext }, function (evt) {
        if (!evt || !evt.b64) return;
        previewImg.src = "data:image/png;base64," + evt.b64;
        status.textContent =
          evt.phase === "done" ? "마무리 중…" : "이미지 생성 중… (미리보기 " + ((evt.index || 0) + 1) + ")";
      })
        .then(function () {
          previewWrap.style.display = "none";
          var finalSrc = previewImg.getAttribute("src");
          if (!finalSrc) {
            status.textContent = "실패: 이미지를 받지 못했습니다";
            appendChatMsg(panel, "assistant error", "이미지를 받지 못했습니다.", null);
            return;
          }
          addFreeImage(finalSrc);
          status.textContent = "완료 · 이미지가 삽입되었습니다";
          var note = imagePrompt !== prompt ? "이미지를 만들어 슬라이드에 넣었습니다. (" + imagePrompt + ")" : "이미지를 만들어 슬라이드에 넣었습니다.";
          appendChatMsg(panel, "assistant", note, finalSrc);
        })
        .catch(function (err) {
          previewWrap.style.display = "none";
          throw err;
        });
    }

    // "text"(슬라이드 작성/수정)와 "app"(인터랙티브 데모/게임)은 둘 다 Claude가
    // 생성하는 과정을 실시간 스트리밍으로 보여준다. 완성되기 전까지는 아직
    // 유효한 HTML이 아닐 수 있어서 실제 슬라이드에는 적용하지 않고, 패널 안의
    // 코드 미리보기 창에만 그대로 흘려보낸 뒤 끝났을 때 한 번에 적용한다.
    var isApp = action === "app";
    status.textContent = isApp ? "인터랙티브 데모를 만들고 있어요…" : "AI가 작성 중…";
    streamEl.style.display = "block";
    streamEl.textContent = "";

    var endpoint = isApp ? "/api/ai/app" : "/api/ai/text";
    var requestBody = isApp
      ? { prompt: prompt, deckContext: deckContext }
      : { prompt: prompt, html: getCleanRootHtml(), deckContext: deckContext };

    return streamAiText(endpoint, requestBody, function (full) {
      streamEl.textContent = full;
      streamEl.scrollTop = streamEl.scrollHeight;
    })
      .then(function (full) {
        streamEl.style.display = "none";
        var cleaned = cleanAiHtmlClient(full);
        if (!cleaned) {
          status.textContent = "실패: AI가 빈 응답을 반환했습니다";
          appendChatMsg(panel, "assistant error", "AI가 빈 응답을 반환했습니다.", null);
          return;
        }
        if (isApp) {
          addFreeApp(cleaned);
          status.textContent = "완료 · 데모가 슬라이드에 삽입되었습니다 (발표 모드에서 바로 조작할 수 있어요)";
          appendChatMsg(panel, "assistant", "인터랙티브 데모를 만들어 슬라이드에 넣었습니다.", null);
        } else {
          restore(applyRootClassDirective(cleaned));
          status.textContent = "완료 · 결과가 마음에 들지 않으면 Ctrl+Z로 되돌릴 수 있어요";
          appendChatMsg(panel, "assistant", "슬라이드 내용을 수정했습니다.", null);
        }
        snapshot();
      })
      .catch(function (err) {
        streamEl.style.display = "none";
        throw err;
      });
  }

  // steps를 순서대로(앞 단계가 끝나야 다음 단계 시작) 실행한다. "정리해주고
  // 이미지로도 보충해줘"처럼 한 요청에 여러 작업이 섞여 있을 때 쓰인다.
  function runAiSteps(panel, steps, prompt) {
    var status = panel.querySelector(".ai-status");
    return steps.reduce(function (chain, step, idx) {
      return chain.then(function () {
        if (steps.length > 1) {
          status.textContent = "(" + (idx + 1) + "/" + steps.length + ") 처리 중…";
        }
        return runAiAction(panel, step.action, prompt, step.detail);
      });
    }, Promise.resolve());
  }

  function runAi() {
    var panel = document.getElementById(AI_PANEL_ID);
    if (!panel) return;
    var input = panel.querySelector(".ai-input");
    var status = panel.querySelector(".ai-status");
    var runBtn = panel.querySelector('[data-cmd="ai-run"]');
    if (runBtn.disabled) return;
    var prompt = input.value.trim();
    if (!prompt) {
      status.textContent = "프롬프트를 입력해주세요";
      return;
    }
    runBtn.disabled = true;
    input.value = "";
    appendChatMsg(panel, "user", prompt, null);
    status.textContent = "무엇을 만들지 판단하고 있어요…";

    // 텍스트/이미지/앱 버튼을 따로 두지 않고, 이 짧은 분류 호출로 Claude가
    // 요청을 몇 개의 단계로 쪼갤지 먼저 판단하게 한 다음(예: 텍스트 정리 +
    // 보충 이미지) 각 단계를 해당 파이프라인으로 순서대로 이어간다. 분류
    // 자체가 실패해도(네트워크 문제 등) 가장 무난한 "text" 한 단계로 시도한다.
    fetch("/api/ai/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt, html: getCleanRootHtml(), deckContext: deckContext }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        return (data && data.ok && Array.isArray(data.steps) && data.steps.length) ? data.steps : [{ action: "text", detail: "" }];
      })
      .catch(function () { return [{ action: "text", detail: "" }]; })
      .then(function (steps) { return runAiSteps(panel, steps, prompt); })
      .then(function () {
        runBtn.disabled = false;
      })
      .catch(function (err) {
        runBtn.disabled = false;
        var msg = (err && err.message) || "서버가 켜져 있는지 확인하세요";
        status.textContent = "실패: " + msg;
        appendChatMsg(panel, "assistant error", "실패: " + msg, null);
      });
  }

  function applyColor(hex) {
    var el = getSelectedFreeEl();
    if (el && el.classList.contains("free-el--shape")) {
      el.style.background = hex;
    } else if (el && el.classList.contains("free-el--text")) {
      el.style.color = hex;
    } else {
      document.execCommand("foreColor", false, hex);
    }
    commitSoon();
  }

  // 글꼴 바꾸기. value가 빈 문자열이면 "기본 폰트"(디자인 시스템 폰트)로 되돌린다.
  // 파워포인트 등에서 붙여넣을 때 딸려온 폰트 지정(예: 궁서체)이 선택 영역 안
  // 깊숙히 span으로 남아있을 수 있으므로, 그 인라인 font-family도 같이 지운다.
  function applyFontFamily(value) {
    var el = getSelectedFreeEl();
    if (el && el.classList.contains("free-el--text")) {
      if (value) el.style.fontFamily = value;
      else el.style.removeProperty("font-family");
      el.querySelectorAll("[style]").forEach(function (node) {
        node.style.removeProperty("font-family");
      });
      snapshot();
      return;
    }

    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    var frag = range.extractContents();
    frag.querySelectorAll("[style]").forEach(function (node) {
      node.style.removeProperty("font-family");
    });
    var span = document.createElement("span");
    if (value) span.style.fontFamily = value;
    span.appendChild(frag);
    range.insertNode(span);
    sel.removeAllRanges();
    commitSoon();
  }

  /* ------------------------------------------------------------------ */
  /* 텍스트 서식 (구조 텍스트 선택 영역에 적용)                                */
  /* ------------------------------------------------------------------ */

  function wrapSelection(className) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    var span = document.createElement("span");
    span.className = className;
    try {
      range.surroundContents(span);
    } catch (e) {
      var contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }
    sel.removeAllRanges();
  }

  function unwrapHighlight() {
    var sel = window.getSelection();
    if (!sel || !sel.anchorNode) return;
    var node = sel.anchorNode;
    while (node && node !== document.body) {
      if (node.nodeType === 1 && node.classList && node.classList.contains("hl-box")) {
        var parent = node.parentNode;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
        return;
      }
      node = node.parentNode;
    }
  }

  function adjustFontSize(delta) {
    var el = getSelectedFreeEl();
    if (el && el.classList.contains("free-el--text")) {
      var current = parseFloat(el.style.fontSize) || 1.6;
      el.style.fontSize = Math.max(0.5, +(current + delta).toFixed(2)) + "vw";
      snapshot();
      return;
    }
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    var span = document.createElement("span");
    span.style.fontSize = delta > 0 ? "1.15em" : "0.87em";
    try {
      range.surroundContents(span);
    } catch (e) {
      var contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    snapshot();
  }

  /* ------------------------------------------------------------------ */
  /* 자유 배치 요소: 이미지 / 텍스트 상자 / 도형                               */
  /* ------------------------------------------------------------------ */

  function nextZIndex() {
    var root = getRoot();
    var max = 9;
    if (root) {
      root.querySelectorAll(".free-el").forEach(function (el) {
        var z = parseInt(el.style.zIndex || "0", 10);
        if (!isNaN(z) && z > max) max = z;
      });
    }
    return max + 1;
  }

  function addFreeImage(dataUrl) {
    var root = getRoot();
    if (!root) return;
    var wrap = document.createElement("div");
    wrap.className = "free-el free-el--image";
    wrap.style.position = "absolute";
    wrap.style.left = "32%";
    wrap.style.top = "32%";
    wrap.style.width = "30%";
    wrap.style.zIndex = String(nextZIndex());
    var img = document.createElement("img");
    img.src = dataUrl;
    img.draggable = false;
    wrap.appendChild(img);
    root.appendChild(wrap);
    enhanceFreeEls();
    wrap.focus();
    snapshot();
  }

  function insertImage() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        addFreeImage(reader.result);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function youtubeEmbedUrl(rawUrl) {
    var m = rawUrl.match(
      /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
    );
    if (!m) return null;
    var id = m[1];
    var t = rawUrl.match(/[?&]t=(\d+)s?/);
    return "https://www.youtube.com/embed/" + id + (t ? "?start=" + t[1] : "");
  }

  // opts.className으로 유튜브(.free-el--video, 16:9 고정)와 일반 임베드
  // (.free-el--embed, 가로/세로 자유 리사이즈)를 구분해서 만든다.
  function addFreeEmbed(embedUrl, opts) {
    opts = opts || {};
    var root = getRoot();
    if (!root) return;
    var wrap = document.createElement("div");
    wrap.className = "free-el " + (opts.className || "free-el--video");
    wrap.style.position = "absolute";
    wrap.style.left = opts.left || "22%";
    wrap.style.top = opts.top || "22%";
    wrap.style.width = opts.width || "56%";
    if (opts.height) wrap.style.height = opts.height;
    wrap.style.zIndex = String(nextZIndex());
    var iframe = document.createElement("iframe");
    iframe.src = embedUrl;
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    );
    iframe.setAttribute("allowfullscreen", "");
    wrap.appendChild(iframe);
    root.appendChild(wrap);
    enhanceFreeEls();
    wrap.focus();
    snapshot();
  }

  function addFreeVideo(embedUrl) {
    addFreeEmbed(embedUrl, { className: "free-el--video" });
  }

  // 유튜브처럼 "페이지"가 아니라 .mp4/.webm 같은 실제 영상 파일을 직접
  // 가리키는 링크는 iframe이 아니라 <video> 태그로 넣어야 재생된다.
  function isDirectVideoUrl(url) {
    return /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?(#.*)?$/i.test(url);
  }

  function addFreeVideoFile(src) {
    var root = getRoot();
    if (!root) return;
    var wrap = document.createElement("div");
    wrap.className = "free-el free-el--video";
    wrap.style.position = "absolute";
    wrap.style.left = "22%";
    wrap.style.top = "22%";
    wrap.style.width = "56%";
    wrap.style.zIndex = String(nextZIndex());
    var video = document.createElement("video");
    video.src = src;
    video.controls = true;
    video.setAttribute("playsinline", "");
    wrap.appendChild(video);
    root.appendChild(wrap);
    enhanceFreeEls();
    wrap.focus();
    snapshot();
  }

  // AI가 만들어준 완전히 독립적인 HTML 문서(팩맨 같은 미니게임, 카운터, 인터랙티브
  // 데모 등)를 sandbox iframe으로 슬라이드에 심는다. srcdoc을 쓰면 별도 파일 없이
  // 이 슬라이드 문서 자체 안에 통째로 저장/배포(GitHub Pages 포함)되고, sandbox
  // 속성으로 top-level 네비게이션이나 부모 문서 접근 같은 위험한 동작은 막아둔다.
  function addFreeApp(html) {
    var root = getRoot();
    if (!root) return;
    var wrap = document.createElement("div");
    wrap.className = "free-el free-el--app";
    wrap.style.position = "absolute";
    wrap.style.left = "20%";
    wrap.style.top = "14%";
    wrap.style.width = "60%";
    wrap.style.height = "72%";
    wrap.style.zIndex = String(nextZIndex());
    var iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-pointer-lock allow-popups");
    iframe.setAttribute("frameborder", "0");
    iframe.srcdoc = html;
    wrap.appendChild(iframe);
    root.appendChild(wrap);
    enhanceFreeEls();
    wrap.focus();
    snapshot();
  }

  function insertYoutube() {
    var url = window.prompt(
      "영상 링크를 붙여넣으세요.\n" +
        "- 유튜브: watch/youtu.be/shorts 링크 모두 가능\n" +
        "- 영상 파일 직링크: .mp4 / .webm 등으로 끝나는 링크"
    );
    if (!url) return;
    var trimmed = url.trim();
    var embed = youtubeEmbedUrl(trimmed);
    if (embed) {
      addFreeVideo(embed);
      return;
    }
    if (/^https?:\/\//i.test(trimmed) && isDirectVideoUrl(trimmed)) {
      addFreeVideoFile(trimmed);
      return;
    }
    window.alert("유튜브 링크나 .mp4/.webm 등 영상 파일 링크를 인식하지 못했습니다. 링크를 다시 확인해주세요.");
  }

  // dbdiagram.io, Figma, 구글 지도, CodePen 등 "공유 > 퍼가기"로 주는
  // <iframe ...>...</iframe> 코드 전체, 혹은 그 안의 src 링크만 붙여넣어도
  // 동작하도록 둘 다 받아준다.
  function extractIframeSrc(codeOrUrl) {
    var trimmed = (codeOrUrl || "").trim();
    var m = trimmed.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
    var src = (m ? m[1] : trimmed).trim();
    if (src.indexOf("//") === 0) src = "https:" + src;
    if (!/^https?:\/\//i.test(src)) return null;
    return src;
  }

  function insertEmbed() {
    var code = window.prompt(
      "임베드할 <iframe> 코드 전체를 붙여넣거나, 링크만 붙여넣으세요.\n" +
        "(dbdiagram.io / Figma / 구글 지도 / CodePen 등의 '공유 · 퍼가기' 코드)"
    );
    if (!code) return;
    var src = extractIframeSrc(code);
    if (!src) {
      window.alert("iframe 코드나 http(s) 링크를 인식하지 못했습니다. 다시 확인해주세요.");
      return;
    }
    addFreeEmbed(src, { className: "free-el--embed", width: "50%", height: "45%" });
  }

  // 파워포인트 등에서 그림을 복사하면 실제 이미지 파일이 아니라
  // "text/html 안에 <img src='data:image/...'>" 형태로만 클립보드에 담기는
  // 경우가 많다. 이럴 때를 위해 html에서 base64 이미지를 직접 뽑아낸다.
  function extractImageFromHtml(html) {
    if (!html) return null;
    // data URI를 우선 찾고, 없으면 일반 src URL이라도 잡아서 반환한다
    // (움짤 원본이 URL로만 들어오는 경우 fetch로 다시 받아오기 위함).
    var dataMatch = html.match(/<img[^>]+src=["'](data:image\/[^"']+)["']/i);
    if (dataMatch) return dataMatch[1];
    var urlMatch = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    return urlMatch ? urlMatch[1] : null;
  }

  // 붙여넣기는 항상 "정리해서" 받는다.
  // - 이미지가 있으면: 자유 배치 요소(드래그/크기조절 가능)로 삽입
  // - 텍스트면: 파워포인트/워드 등에서 딸려오는 폰트·색상 등 원본 서식을
  //   전부 걷어내고 순수 텍스트만 삽입해, 슬라이드 고유 폰트를 그대로 따르게 한다.
  // 클립보드에 이미지 타입이 여러 개 들어있을 때(예: gif 원본 + 미리보기용 png가
  // 함께 담기는 경우) 정지 프레임(png)이 먼저 잡혀서 움짤이 깨지는 일이 없도록,
  // gif가 있으면 항상 gif를 우선한다.
  function pickImageFile(list, getFile) {
    var first = null;
    var gif = null;
    for (var i = 0; i < list.length; i++) {
      var type = list[i].type;
      if (!type || type.indexOf("image/") !== 0) continue;
      if (type === "image/gif") {
        gif = getFile(list[i]);
      } else if (!first) {
        first = getFile(list[i]);
      }
    }
    return gif || first;
  }

  document.addEventListener("paste", function (e) {
    if (!isEditing()) return;
    var cd = e.clipboardData || window.clipboardData;
    if (!cd) return;

    var file = null;
    if (cd.items) {
      file = pickImageFile(cd.items, function (it) { return it.getAsFile(); });
    }
    if (!file && cd.files && cd.files.length) {
      file = pickImageFile(cd.files, function (f) { return f; });
    }
    if (file) {
      e.preventDefault();
      var reader = new FileReader();
      reader.onload = function () {
        addFreeImage(reader.result);
      };
      reader.readAsDataURL(file);
      return;
    }

    // 브라우저에서 "이미지 복사"를 하면 클립보드의 text/html에는 원본 데이터가
    // 아니라 <img src="..."> 형태로만 들어오는 경우가 많다. src가 data: URI면
    // 그대로 쓰고, 일반 URL이면 fetch로 원본 파일(gif 애니메이션 포함)을 그대로
    // 받아와서 data URI로 바꿔 넣는다 (움짤이 정지 이미지로 굳는 것을 방지).
    var html = cd.getData("text/html");
    var imgSrc = extractImageFromHtml(html);
    if (imgSrc) {
      e.preventDefault();
      if (imgSrc.indexOf("data:image/") === 0) {
        addFreeImage(imgSrc);
      } else {
        fetch(imgSrc)
          .then(function (r) {
            if (!r.ok) throw new Error("fetch failed");
            return r.blob();
          })
          .then(function (blob) {
            var reader2 = new FileReader();
            reader2.onload = function () {
              addFreeImage(reader2.result);
            };
            reader2.readAsDataURL(blob);
          })
          .catch(function () {
            // CORS 등으로 원본을 받아오지 못하면 최소한 원래 URL로라도 삽입한다
            // (움짤 원본 URL이면 브라우저가 계속 애니메이션으로 표시해준다).
            addFreeImage(imgSrc);
          });
      }
      return;
    }

    var text = cd.getData("text/plain");
    if (text !== null && text !== undefined) {
      e.preventDefault();
      document.execCommand("insertText", false, text);
      commitSoon();
    }
  });

  // 이미 서식이 섞여 들어온 텍스트를 고를 때 쓰는 "서식 지우기".
  // 폰트/색상/굵기 등 인라인 스타일을 전부 없애고 순수 텍스트로 되돌린다.
  function clearFormatting() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return;
    var text = range.toString();
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    sel.removeAllRanges();
    commitSoon();
  }

  function insertTextBox() {
    var root = getRoot();
    if (!root) return;
    var wrap = document.createElement("div");
    wrap.className = "free-el free-el--text";
    wrap.style.position = "absolute";
    wrap.style.left = "28%";
    wrap.style.top = "42%";
    wrap.style.width = "44%";
    wrap.style.fontSize = "1.6vw";
    wrap.style.color = "#f2f3f5";
    wrap.style.fontWeight = "700";
    wrap.style.lineHeight = "1.4";
    wrap.style.zIndex = String(nextZIndex());
    wrap.textContent = "텍스트를 입력하세요";
    root.appendChild(wrap);
    enhanceFreeEls();
    wrap.focus();
    snapshot();
  }

  function insertShape(kind) {
    var root = getRoot();
    if (!root) return;
    var wrap = document.createElement("div");
    wrap.className = "free-el free-el--shape";
    wrap.setAttribute("data-shape", kind);
    wrap.style.position = "absolute";
    wrap.style.left = "35%";
    wrap.style.top = "45%";
    wrap.style.zIndex = String(nextZIndex());
    if (kind === "line") {
      wrap.style.width = "22%";
      wrap.style.height = "0.6%";
      wrap.style.background = "#ff6b4a";
    } else {
      wrap.style.width = "20%";
      wrap.style.height = "14%";
      wrap.style.background = "#ff6b4a";
      wrap.style.borderRadius = "4px";
    }
    root.appendChild(wrap);
    enhanceFreeEls();
    wrap.focus();
    snapshot();
  }

  function bringToFront(el) {
    el.style.zIndex = String(nextZIndex());
    snapshot();
  }

  function sendToBack(el) {
    var root = getRoot();
    var min = 10;
    if (root) {
      root.querySelectorAll(".free-el").forEach(function (other) {
        var z = parseInt(other.style.zIndex || "10", 10);
        if (!isNaN(z) && z < min) min = z;
      });
    }
    el.style.zIndex = String(min - 1);
    snapshot();
  }

  function duplicateSelected() {
    var el = getSelectedFreeEl();
    if (!el) return;
    var clone = el.cloneNode(true);
    clone.querySelectorAll(".free-el-handle, .free-el-del, .free-el-shield").forEach(function (n) {
      n.remove();
    });
    var left = parseFloat(el.style.left) || 0;
    var top = parseFloat(el.style.top) || 0;
    clone.style.left = left + 3 + "%";
    clone.style.top = top + 3 + "%";
    clone.style.zIndex = String(nextZIndex());
    clone.setAttribute("contenteditable", "false");
    getRoot().appendChild(clone);
    enhanceFreeEls();
    clone.focus();
    snapshot();
  }

  function enhanceFreeEls() {
    document.querySelectorAll(".free-el").forEach(function (fi) {
      if (!fi.hasAttribute("tabindex")) fi.setAttribute("tabindex", "0");
      if (!fi.classList.contains("free-el--text") || !fi.hasAttribute("contenteditable")) {
        fi.setAttribute("contenteditable", "false");
      }
      // 유튜브/일반 임베드는 실제로는 완전히 다른 웹사이트를 담은 <iframe>이다.
      // CSS pointer-events:none만 믿고 있으면 브라우저/사이트에 따라 드래그
      // 도중 마우스가 그 iframe 위로 지나가는 순간 이벤트가 그쪽 문서로
      // 먹혀버려서 리사이즈가 뚝뚝 끊기거나 안 되는 것처럼 느껴질 수 있다.
      // 그래서 iframe/video 위에 투명한 "방패" 레이어를 하나 더 깔아서,
      // 편집 중에는 모든 마우스 이벤트가 무조건 우리 쪽(this 문서)에서만
      // 처리되도록 확실히 막는다.
      if (
        (fi.classList.contains("free-el--video") ||
          fi.classList.contains("free-el--embed") ||
          fi.classList.contains("free-el--app")) &&
        !fi.querySelector(".free-el-shield")
      ) {
        var shield = document.createElement("div");
        shield.className = "free-el-shield";
        fi.insertBefore(shield, fi.firstChild ? fi.firstChild.nextSibling : null);
      }
      if (!fi.querySelector(".free-el-handle")) {
        var h = document.createElement("div");
        h.className = "free-el-handle";
        h.title = "드래그해서 크기 조절";
        h.setAttribute("contenteditable", "false");
        fi.appendChild(h);
      }
      if (!fi.querySelector(".free-el-del")) {
        var d = document.createElement("button");
        d.type = "button";
        d.className = "free-el-del";
        d.title = "삭제";
        d.textContent = "×";
        d.setAttribute("contenteditable", "false");
        fi.appendChild(d);
      }
    });
  }

  function stripFreeElChrome(scopeEl) {
    scopeEl.querySelectorAll(".free-el-handle, .free-el-del, .free-el-shield").forEach(function (el) {
      el.remove();
    });
    scopeEl.querySelectorAll(".free-el").forEach(function (fi) {
      fi.removeAttribute("tabindex");
      fi.setAttribute("contenteditable", "false");
    });
  }

  // 텍스트 상자(.free-el--text)를 편집하는 동안에는 슬라이드 루트의
  // contenteditable을 잠시 꺼서, "부모도 편집 가능 + 자식도 편집 가능"인
  // 중첩 contenteditable 상태를 피한다. 이 중첩 상태에서는 크롬이 타이핑
  // 도중 커서를 엉뚱한 곳(부모)으로 튕겨내는 경우가 있어, 한 글자 치면
  // 바로 편집이 풀려버리는 것처럼 보이는 버그가 생긴다.
  document.addEventListener("dblclick", function (e) {
    if (!isEditing()) return;
    var textEl = e.target.closest(".free-el--text");
    if (!textEl) return;
    e.preventDefault();
    var root = getRoot();
    if (root) root.setAttribute("contenteditable", "false");
    textEl.setAttribute("contenteditable", "true");
    textEl.focus();
  });

  document.addEventListener(
    "focusout",
    function (e) {
      var textEl = e.target && e.target.closest && e.target.closest(".free-el--text");
      if (textEl && textEl.getAttribute("contenteditable") === "true") {
        textEl.setAttribute("contenteditable", "false");
        if (editModeOn) {
          var root = getRoot();
          if (root) root.setAttribute("contenteditable", "true");
        }
        snapshot();
      }
    },
    true
  );

  // 텍스트 상자 안의 크기조절 핸들(.free-el-handle)/삭제 버튼(.free-el-del)은
  // 텍스트와 같은 편집 영역 안에 놓여 있어서, 전체 선택(Ctrl+A) 후 타이핑하는 것
  // 처럼 콘텐츠 전체를 갈아치우는 편집을 하면 함께 지워져 버릴 수 있다.
  // 그렇게 되면 핸들이 사라져서 "텍스트 입력 후 크기조절이 안 되는" 것처럼 보이므로,
  // 타이핑할 때마다 즉시 다시 붙여넣어 항상 남아있도록 한다.
  document.addEventListener("input", function (e) {
    var textEl = e.target && e.target.closest && e.target.closest(".free-el--text");
    if (!textEl || textEl.getAttribute("contenteditable") !== "true") return;
    if (!textEl.querySelector(".free-el-handle") || !textEl.querySelector(".free-el-del")) {
      enhanceFreeEls();
    }
  });

  // 클릭 지점에 겹쳐 있는 .free-el들을 z-index가 높은(맨 앞) 순서로 반환한다.
  // 이미지/도형이 다른 텍스트 상자 위에 겹쳐 놓이면, 보통 클릭은 항상 맨 위
  // 요소만 잡기 때문에 뒤에 깔린 요소는 영원히 드래그할 방법이 없어진다.
  // Alt+클릭으로 이 목록을 한 칸씩 순환하며 뒤에 있는 요소를 선택할 수 있게 한다.
  function freeElsAtPoint(x, y) {
    var root = getRoot();
    if (!root) return [];
    var hits = [];
    root.querySelectorAll(".free-el").forEach(function (fi) {
      var r = fi.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hits.push(fi);
    });
    hits.sort(function (a, b) {
      return parseInt(b.style.zIndex || "0", 10) - parseInt(a.style.zIndex || "0", 10);
    });
    return hits;
  }

  document.addEventListener("mousedown", function (e) {
    if (!isEditing()) return;
    var delBtn = e.target.closest(".free-el-del");
    if (delBtn) {
      e.preventDefault();
      var toRemove = delBtn.closest(".free-el");
      if (toRemove) toRemove.remove();
      snapshot();
      return;
    }
    var handle = e.target.closest(".free-el-handle");
    var el = e.target.closest(".free-el");

    // Alt+클릭: 겹쳐 있는 요소들 중 맨 위 것만 계속 선택되는 문제를 피하려고,
    // 클릭 지점에 겹친 요소들을 앞→뒤 순서로 한 칸씩 순환 선택한다
    // (파워포인트의 Alt+클릭으로 겹친 도형 선택하기와 같은 동작).
    if (e.altKey && !handle) {
      var stack = freeElsAtPoint(e.clientX, e.clientY);
      if (stack.length) {
        var curIdx = el ? stack.indexOf(el) : -1;
        el = stack[(curIdx + 1) % stack.length];
      }
    }

    if (!el) return;
    if (!handle && el.classList.contains("free-el--text") && el.getAttribute("contenteditable") === "true") {
      return; // 텍스트 편집 중에는 커서 배치를 그대로 둔다
    }
    e.preventDefault();
    el.focus();
    var root = getRoot();
    var rect = root.getBoundingClientRect();
    dragState = {
      type: handle ? "resize" : "move",
      el: el,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: parseFloat(el.style.left) || 0,
      startTop: parseFloat(el.style.top) || 0,
      startWidth: parseFloat(el.style.width) || 20,
      startHeight: el.style.height ? parseFloat(el.style.height) : null,
      rectW: rect.width,
      rectH: rect.height,
    };
  });

  document.addEventListener("mousemove", function (e) {
    if (!dragState) return;
    var dxPct = ((e.clientX - dragState.startX) / dragState.rectW) * 100;
    var dyPct = ((e.clientY - dragState.startY) / dragState.rectH) * 100;
    if (dragState.type === "move") {
      dragState.el.style.left = dragState.startLeft + dxPct + "%";
      dragState.el.style.top = dragState.startTop + dyPct + "%";
    } else {
      var newWidth = Math.max(3, dragState.startWidth + dxPct);
      dragState.el.style.width = newWidth + "%";
      if (dragState.startHeight !== null) {
        var newHeight = Math.max(0.4, dragState.startHeight + dyPct);
        dragState.el.style.height = newHeight + "%";
      }
    }
  });

  document.addEventListener("mouseup", function () {
    if (dragState) snapshot();
    dragState = null;
  });

  document.addEventListener("keydown", function (e) {
    if (!isEditing()) return;
    var active = document.activeElement;
    var isFreeEl = active && active.classList && active.classList.contains("free-el");
    var isTextEditing = !!isFreeEl && active.getAttribute("contenteditable") === "true";

    if ((e.ctrlKey || e.metaKey) && !isTextEditing && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === ">" || e.key === "." || e.key === "+" || e.key === "=")) {
      e.preventDefault();
      adjustFontSize(0.2);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "<" || e.key === "," || e.key === "-" || e.key === "_")) {
      e.preventDefault();
      adjustFontSize(-0.2);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && isTextEditing) {
      // 브라우저 기본 전체 선택은 크기조절 핸들/삭제 버튼까지 선택 범위에 포함시켜
      // 뒤이은 타이핑에 함께 지워지게 만든다. 텍스트 내용만 선택되도록 직접 처리한다.
      e.preventDefault();
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(active);
      var chrome = active.querySelector(".free-el-handle, .free-el-del");
      if (chrome) range.setEndBefore(chrome);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    if (!isFreeEl || isTextEditing) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      active.remove();
      snapshot();
      return;
    }
    if (e.key.indexOf("Arrow") === 0) {
      e.preventDefault();
      var step = e.shiftKey ? 1.5 : 0.4;
      var left = parseFloat(active.style.left) || 0;
      var top = parseFloat(active.style.top) || 0;
      if (e.key === "ArrowLeft") left -= step;
      if (e.key === "ArrowRight") left += step;
      if (e.key === "ArrowUp") top -= step;
      if (e.key === "ArrowDown") top += step;
      active.style.left = left + "%";
      active.style.top = top + "%";
    }
  });

  document.addEventListener("keyup", function (e) {
    if (isEditing() && e.key.indexOf("Arrow") === 0) snapshot();
  });

  /* ------------------------------------------------------------------ */
  /* 실행취소 / 다시실행 (스냅샷 방식)                                        */
  /* ------------------------------------------------------------------ */

  function updateHistoryButtons() {
    var wrap = document.getElementById(UI_ID);
    if (!wrap) return;
    var undoBtn = wrap.querySelector('[data-cmd="undo"]');
    var redoBtn = wrap.querySelector('[data-cmd="redo"]');
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
  }

  function snapshot() {
    if (isRestoring) return;
    var root = getRoot();
    if (!root) return;
    var clone = root.cloneNode(true);
    stripFreeElChrome(clone);
    var htmlStr = clone.innerHTML;
    if (history[historyIndex] === htmlStr) return;
    history = history.slice(0, historyIndex + 1);
    history.push(htmlStr);
    if (history.length > 60) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function commitSoon() {
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(snapshot, 500);
  }

  function restore(htmlStr) {
    var root = getRoot();
    if (!root) return;
    isRestoring = true;
    root.innerHTML = htmlStr;
    enhanceFreeEls();
    isRestoring = false;
    updateHistoryButtons();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    restore(history[historyIndex]);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    restore(history[historyIndex]);
  }

  /* ------------------------------------------------------------------ */
  /* 저장                                                                 */
  /* ------------------------------------------------------------------ */

  function setStatus(text) {
    var wrap = document.getElementById(UI_ID);
    var el = wrap && wrap.querySelector(".cestatus");
    if (el) el.textContent = text;
  }

  function save(wrap) {
    setStatus("저장 중…");
    var clone = document.documentElement.cloneNode(true);
    var ui = clone.querySelector("#" + UI_ID);
    if (ui) ui.remove();
    var uiStyle = clone.querySelector("#" + UI_ID + "_style");
    if (uiStyle) uiStyle.remove();
    var root = clone.querySelector(ROOT_SELECTOR);
    if (root) root.removeAttribute("contenteditable");
    stripFreeElChrome(clone);
    // "클릭하면 펼쳐지는" 버블 연출 등은 편집하면서 미리 펼쳐본 상태 그대로
    // 저장되면 안 되므로, 저장 전에 항상 처음(안 펼쳐진) 상태로 되돌린다.
    clone.querySelectorAll(".bubble-cell.is-open").forEach(function (el) {
      el.classList.remove("is-open");
    });
    var html = "<!DOCTYPE html>\n" + clone.outerHTML;

    fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: relFilePath(), html: html }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        setStatus(data.ok ? "저장됨 · " + new Date().toLocaleTimeString() : "저장 실패: " + data.error);
      })
      .catch(function () {
        setStatus("저장 실패 (서버가 켜져 있는지 확인하세요)");
      });
  }

  /* ------------------------------------------------------------------ */
  /* 편집 모드 on/off                                                     */
  /* ------------------------------------------------------------------ */

  function setEditing(on) {
    var root = getRoot();
    if (!root) return;
    editModeOn = !!on;
    if (on) {
      root.setAttribute("contenteditable", "true");
      buildToolbar();
      enhanceFreeEls();
      root.addEventListener("input", commitSoon);
      history = [];
      historyIndex = -1;
      snapshot();
    } else {
      root.removeAttribute("contenteditable");
      stripFreeElChrome(document);
      root.removeEventListener("input", commitSoon);
      var ui = document.getElementById(UI_ID);
      if (ui) ui.remove();
      var uiStyle = document.getElementById(UI_ID + "_style");
      if (uiStyle) uiStyle.remove();
    }
  }

  window.addEventListener("message", function (e) {
    var data = e.data || {};
    if (data.type === "cursor-editor:set-mode") {
      setEditing(!!data.editing);
    }
    if (data.type === "cursor-editor:deck-context") {
      deckContext = data.context || null;
      updateAiContextLine();
    }
  });

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "cursor-editor:ready" }, "*");
  }
})();
