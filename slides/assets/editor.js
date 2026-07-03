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
  var aiMode = null; // "text" | "image" | null
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
      "." + ROOT_SELECTOR.replace(".", "") + "[contenteditable='true'] .free-el--embed iframe{pointer-events:none;}" +
      ".free-el-shield{position:absolute;inset:0;z-index:1;background:transparent;display:none;}" +
      "." + ROOT_SELECTOR.replace(".", "") + "[contenteditable='true'] .free-el-shield{display:block;}";
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
      '<span class="celabel">AI</span>' +
      '<button class="ai-btn" data-cmd="ai-text" title="프롬프트로 이 슬라이드 내용을 AI가 작성/수정합니다 (Claude)">✨ AI 작성</button>' +
      '<button class="ai-btn" data-cmd="ai-image" title="프롬프트로 이미지를 생성해 삽입합니다 (OpenAI)">✨ AI 이미지</button>' +
      '<span class="cesep"></span>' +
      '<span class="celabel">선택 요소</span>' +
      '<button data-cmd="front" title="맨 앞으로">앞으로</button>' +
      '<button data-cmd="back" title="맨 뒤로">뒤로</button>' +
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
      '<div class="ai-title"></div>' +
      '<div class="ai-context"></div>' +
      '<textarea class="ai-input" rows="2"></textarea>' +
      '<div class="ai-actions">' +
      '<button data-cmd="ai-run" title="Ctrl+Enter">생성</button>' +
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
      else if (cmd === "ai-text") toggleAiPanel("text");
      else if (cmd === "ai-image") toggleAiPanel("image");
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

  function toggleAiPanel(mode) {
    var panel = document.getElementById(AI_PANEL_ID);
    if (!panel) return;
    if (aiMode === mode && panel.style.display !== "none") {
      closeAiPanel();
      return;
    }
    aiMode = mode;
    panel.style.display = "flex";
    panel.querySelector(".ai-title").textContent =
      mode === "image" ? "AI 이미지 생성 (OpenAI · gpt-image-2)" : "AI로 슬라이드 작성/수정 (Claude)";
    var input = panel.querySelector(".ai-input");
    input.placeholder =
      mode === "image"
        ? "예: 어두운 배경에 어울리는 미니멀한 데이터 시각화 아이콘, 오렌지 포인트 컬러"
        : "예: 이 슬라이드를 더 임팩트있는 오프닝 훅으로 다시 써줘 / 카드 3개로 정리해줘";
    panel.querySelector(".ai-status").textContent = "";
    updateAiContextLine();
    input.focus();
  }

  function closeAiPanel() {
    var panel = document.getElementById(AI_PANEL_ID);
    if (panel) panel.style.display = "none";
    aiMode = null;
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

  function runAi() {
    var panel = document.getElementById(AI_PANEL_ID);
    if (!panel || !aiMode) return;
    var input = panel.querySelector(".ai-input");
    var status = panel.querySelector(".ai-status");
    var runBtn = panel.querySelector('[data-cmd="ai-run"]');
    var prompt = input.value.trim();
    if (!prompt) {
      status.textContent = "프롬프트를 입력해주세요";
      return;
    }
    runBtn.disabled = true;
    status.textContent = aiMode === "image" ? "이미지 생성 중… (최대 30초 정도 걸릴 수 있어요)" : "AI가 작성 중…";

    if (aiMode === "image") {
      fetch("/api/ai/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt, deckContext: deckContext }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          runBtn.disabled = false;
          if (!data.ok) {
            status.textContent = "실패: " + data.error;
            return;
          }
          addFreeImage(data.dataUrl);
          status.textContent = "완료 · 이미지가 삽입되었습니다";
          input.value = "";
        })
        .catch(function () {
          runBtn.disabled = false;
          status.textContent = "실패 (서버가 켜져 있는지 확인하세요)";
        });
    } else {
      var currentHtml = getCleanRootHtml();
      fetch("/api/ai/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt, html: currentHtml, deckContext: deckContext }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          runBtn.disabled = false;
          if (!data.ok) {
            status.textContent = "실패: " + data.error;
            return;
          }
          var html = applyRootClassDirective(data.html);
          restore(html);
          snapshot();
          status.textContent = "완료 · 결과가 마음에 들지 않으면 Ctrl+Z로 되돌릴 수 있어요";
          input.value = "";
        })
        .catch(function () {
          runBtn.disabled = false;
          status.textContent = "실패 (서버가 켜져 있는지 확인하세요)";
        });
    }
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
        (fi.classList.contains("free-el--video") || fi.classList.contains("free-el--embed")) &&
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
