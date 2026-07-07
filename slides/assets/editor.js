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
  var STYLE_PANEL_ID = "__cursor_style_panel";
  var PICK_INDICATOR_ID = "__cursor_pick_indicator";
  var LOCAL_DRAFT_BAR_ID = "__cursor_local_draft_bar";
  var THEME_PANEL_ID = "__cursor_theme_panel";
  var THEME_BACKDROP_ID = "__cursor_theme_backdrop";
  var THEME_OVERRIDE_STYLE_ID = "__cursor_theme_override";
  // GitHub Pages 같은 정적 호스팅에는 /api/save를 받아줄 서버가 없다. 그런
  // 곳에서도 "저장"이 완전히 헛수고가 되지 않도록, 실패하면 이 브라우저의
  // localStorage에 임시로 담아두고(새로고침해도 남아있게) 파일로도 다운로드해서
  // 사용자가 직접 원본 파일을 덮어쓸 수 있게 한다. (index.html의 AI 에이전트가
  // 문자열 파이프라인으로 슬라이드를 고칠 때도 정확히 같은 키 규칙을 쓴다.)
  var LOCAL_SAVE_PREFIX = "cursorEditorLocalSave:";
  // index.html(부모, AI 에이전트)이 postMessage로 보내주는 전체 발표 맥락
  // 정보 — 지금은 참고용으로만 저장해두고 별도로 읽는 곳은 없다.
  var deckContext = null;
  var dragState = null;
  // 파워포인트의 "도형 서식" 패널처럼, 지금 선택된 요소를 별도로 기억해둔다.
  // document.activeElement만 보면 서식 패널의 색상/슬라이더를 조작하는 순간
  // 포커스가 그 컨트롤로 넘어가서 "선택이 풀린 것"처럼 보이는 문제가 생긴다.
  var selectedFreeEl = null;
  // AI가 만든 인포그래픽(도넛 차트, 버블 클러스터 등)처럼 자유배치 요소가 아닌
  // "구조 콘텐츠"는 원래 클릭해도 아무 반응이 없었다. Alt+클릭으로 그런 요소도
  // (드래그는 안 되지만) 서식 패널로 배경/테두리/모서리/그림자만큼은 만질 수 있게
  // 별도로 추적한다. free-el 선택과는 서로 배타적이다.
  var selectedStructEl = null;
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

  function localSaveKey() {
    return LOCAL_SAVE_PREFIX + relFilePath();
  }

  function fileBaseName() {
    var parts = relFilePath().split("/");
    return parts[parts.length - 1] || "slide.html";
  }

  // 파일로 다운로드해서 "진짜 로컬 저장"을 흉내낸다 — 서버가 없어도 사용자가
  // 이 파일을 받아서 직접 deck 폴더의 원본에 덮어쓸 수 있다.
  function downloadHtml(html) {
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileBaseName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // /api/save가 없는 환경(GitHub Pages 등)에서 저장이 실패하면 이 브라우저의
  // localStorage에 최신 내용을 남겨서, 같은 브라우저로 같은 슬라이드를 다시
  // 열었을 때 방금 만진 내용이 자동으로 복원되게 한다. 실제 파일이 바뀌는 건
  // 아니라서 "임시" 저장이라는 걸 항상 눈에 보이는 안내 바로 알려준다.
  function saveLocalDraft(html) {
    try {
      localStorage.setItem(localSaveKey(), JSON.stringify({ html: html, savedAt: Date.now() }));
    } catch (e) {
      // 저장 공간이 꽉 찼거나 localStorage를 못 쓰는 환경이면 그냥 다운로드만으로 대신한다
    }
  }

  function clearLocalDraft() {
    try {
      localStorage.removeItem(localSaveKey());
    } catch (e) {
      // 무시
    }
  }

  function getLocalDraft() {
    try {
      var raw = localStorage.getItem(localSaveKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // 페이지를 열 때 이 브라우저에 남겨진 임시 저장본이 있으면, 지금 로드된
  // (서버/GitHub Pages의) 원본 위에 그 내용을 덮어 씌워서 보여준다. innerHTML과
  // 루트 class(hook/section 등)만 옮기고 <head>/스크립트는 그대로 둬서, 지금
  // 실행 중인 이 스크립트 자신을 건드리지 않는다.
  function restoreLocalDraftIfAny() {
    var draft = getLocalDraft();
    if (!draft || !draft.html) return;
    var root = getRoot();
    if (!root) return;
    var parsed;
    try {
      parsed = new DOMParser().parseFromString(draft.html, "text/html");
    } catch (e) {
      return;
    }
    var draftRoot = parsed.querySelector(ROOT_SELECTOR);
    if (!draftRoot) return;
    root.innerHTML = draftRoot.innerHTML;
    root.className = draftRoot.className;
    // free-el 크롬(리사이즈 핸들/삭제 버튼/방패)은 편집 모드로 들어갈 때
    // setEditing()이 enhanceFreeEls()를 불러서 붙여준다 — 여기서는 안 붙여야
    // 발표/미리보기 중에 호버만 해도 삭제 버튼이 보이는 일이 없다.
    showLocalDraftBar(draft.savedAt);
  }

  // "이건 실제 파일이 아니라 이 브라우저에만 있는 임시본" 이라는 걸 항상 보이는
  // 배너로 알려주고, 원할 때 원본으로 되돌리거나 다시 파일로 받을 수 있게 한다.
  function showLocalDraftBar(savedAt) {
    if (document.getElementById(LOCAL_DRAFT_BAR_ID)) return;
    var bar = document.createElement("div");
    bar.id = LOCAL_DRAFT_BAR_ID;
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:999990;display:flex;align-items:center;" +
      "gap:10px;flex-wrap:wrap;padding:8px 14px;background:#2a1f14;color:#e8b988;" +
      "border-top:1px solid #4a3520;font-size:12.5px;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;";
    var when = savedAt ? new Date(savedAt).toLocaleString() : "";
    bar.innerHTML =
      "<span>⚠ 이 브라우저에만 저장된 임시 편집본을 보고 있습니다(" + when +
      ") — 실제 파일은 바뀌지 않았어요.</span>" +
      '<button type="button" data-draft="discard" style="font-family:inherit;font-size:12px;color:#eceded;' +
      "background:#2a2c33;border:1px solid #3c3e46;border-radius:4px;padding:4px 10px;cursor:pointer;\">원본으로 되돌리기</button>" +
      '<button type="button" data-draft="download" style="font-family:inherit;font-size:12px;color:#eceded;' +
      "background:#2a2c33;border:1px solid #3c3e46;border-radius:4px;padding:4px 10px;cursor:pointer;\">파일로 다운로드</button>" +
      '<button type="button" data-draft="dismiss" style="margin-left:auto;font-family:inherit;font-size:16px;' +
      "line-height:1;color:#e8b988;background:none;border:none;cursor:pointer;padding:2px 6px;\">✕</button>";
    bar.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var action = btn.getAttribute("data-draft");
      if (action === "discard") {
        clearLocalDraft();
        window.location.reload();
      } else if (action === "download") {
        downloadHtml(buildSaveHtml());
      } else if (action === "dismiss") {
        bar.remove();
      }
    });
    document.body.appendChild(bar);
  }

  function getRoot() {
    return document.querySelector(ROOT_SELECTOR);
  }

  function isEditing() {
    return editModeOn;
  }

  function getSelectedFreeEl() {
    if (selectedFreeEl && document.contains(selectedFreeEl)) return selectedFreeEl;
    var active = document.activeElement;
    return active && active.classList && active.classList.contains("free-el") ? active : null;
  }

  function selectFreeEl(el) {
    selectedFreeEl = el || null;
    if (el) selectedStructEl = null;
    updateStylePanel();
    updatePickIndicator();
    updateAlignButtons();
  }

  function selectStructEl(el) {
    selectedStructEl = el || null;
    if (el) selectedFreeEl = null;
    updateStylePanel();
    updateAlignButtons();
    updatePickIndicator();
  }

  // 서식 패널이 지금 실제로 조작해야 할 대상 하나를 돌려준다(자유배치 요소
  // 또는 Alt+클릭으로 고른 구조 콘텐츠 중 살아있는 쪽).
  function getStyleTarget() {
    if (selectedFreeEl && document.contains(selectedFreeEl)) return selectedFreeEl;
    if (selectedStructEl && document.contains(selectedStructEl)) return selectedStructEl;
    return null;
  }

  function getPickIndicator() {
    return document.getElementById(PICK_INDICATOR_ID);
  }

  // "지금 정확히 뭘 잡았는지" 눈으로 바로 확인할 수 있도록, 선택된 요소의
  // 실제 화면 좌표에 맞춰 점선 박스를 그려 겹쳐 보여준다. 드래그 중이거나
  // 창 크기가 바뀔 때도 계속 따라가도록 여러 곳에서 이 함수를 호출한다.
  function updatePickIndicator() {
    var indicator = getPickIndicator();
    if (!indicator) return;
    var el = getStyleTarget();
    if (!isEditing() || !el) {
      indicator.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    indicator.style.display = "block";
    indicator.style.left = r.left - 3 + "px";
    indicator.style.top = r.top - 3 + "px";
    indicator.style.width = Math.max(0, r.width + 6) + "px";
    indicator.style.height = Math.max(0, r.height + 6) + "px";
    var tag = indicator.querySelector(".pick-tag");
    if (tag) tag.textContent = describeStyleTarget(el);
  }

  function describeStyleTarget(el) {
    if (isSvgShape(el)) return "SVG · " + el.tagName.toLowerCase();
    var label = null;
    Object.keys(FREE_EL_TYPE_LABEL).forEach(function (cls) {
      if (el.classList.contains(cls)) label = FREE_EL_TYPE_LABEL[cls];
    });
    if (label) return label;
    return el.classList.contains("free-el") ? "요소" : "구조 요소";
  }

  var SVG_SHAPE_TAGS = { circle: 1, path: 1, rect: 1, ellipse: 1, polygon: 1, polyline: 1, line: 1, text: 1 };

  function isSvgShape(el) {
    return !!(el && el.namespaceURI === "http://www.w3.org/2000/svg" && SVG_SHAPE_TAGS[el.tagName.toLowerCase()]);
  }

  // AI가 인포그래픽을 만들 때 클래스 없이 인라인 style만 잔뜩 써서 라벨
  // 박스/도넛 조각을 그리는 경우가 많다("class로 찾기"만으로는 라벨 박스+도넛
  // 전체를 감싼 바깥 컨테이너 하나로 다 잡혀버린다). 그래서 target에서부터
  // 위로 올라가며, 가장 먼저 만나는 "그 자체로 의미 있는" 요소를 고른다:
  // 1) background/border/box-shadow 인라인 스타일이 있는 요소("카드"처럼 보이는 것)
  // 2) SVG 도형/텍스트 자체(도넛 한 조각, 연결선 하나 등 — 그 자체가 이미 최소 단위)
  // 3) class가 붙은 요소
  // 이렇게 하면 라벨 박스 안의 숫자 텍스트를 클릭해도 그 숫자만 잡히는 게
  // 아니라 감싸고 있는 라벨 박스 전체가 잡히고, 도넛 조각을 클릭하면 그
  // 조각 하나만(전체 차트가 아니라) 잡힌다.
  function looksLikeVisualBox(node) {
    var style = node.getAttribute && node.getAttribute("style");
    return !!(style && /background|border|box-shadow/i.test(style));
  }

  function nearestStyleableEl(target) {
    var root = getRoot();
    if (!root) return null;
    var node = target;
    while (node && node !== root && node.nodeType === 1) {
      if (looksLikeVisualBox(node) || isSvgShape(node) || (node.classList && node.classList.length)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  // 구조 콘텐츠/SVG 도형은 left/top(%)이 아니라 transform:translate(vw, vh)로
  // 옮긴다 — vw/vh는 이 슬라이드 문서 자체의 뷰포트(=iframe 크기) 기준이라,
  // 썸네일/본편집/발표 전체화면처럼 실제 렌더링 크기가 달라져도 항상 같은
  // 비율로 위치가 유지된다(px를 쓰면 컨텍스트마다 위치가 어긋난다).
  // 이미 다른 transform(예: 도넛의 rotate(-90deg))이 있으면 그대로 보존하고,
  // 새 translate는 항상 맨 앞에 둬서 화면 기준 방향으로 이동하게 한다.
  function parseTranslateVw(transformStr) {
    var m = /^translate\(\s*(-?[\d.]+)vw\s*,\s*(-?[\d.]+)vh\s*\)\s*/.exec(transformStr || "");
    if (!m) return { tx: 0, ty: 0, rest: transformStr || "" };
    return { tx: parseFloat(m[1]), ty: parseFloat(m[2]), rest: transformStr.slice(m[0].length).trim() };
  }

  function startStructDrag(el, e) {
    var root = getRoot();
    if (!root) return;
    var rect = root.getBoundingClientRect();
    var parsed = parseTranslateVw(el.style.transform);
    dragState = {
      mode: "transform",
      el: el,
      startX: e.clientX,
      startY: e.clientY,
      baseTx: parsed.tx,
      baseTy: parsed.ty,
      restTransform: parsed.rest,
      rectW: rect.width,
      rectH: rect.height,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 툴바 아이콘 — Lucide(ISC 라이선스, 시중에서 널리 쓰이는 라인 아이콘 세트)의   */
  /* 원본 path 데이터를 그대로 인라인 SVG로 사용한다. 외부 CDN을 불러오지 않으므로 */
  /* 오프라인/GitHub Pages에서도 동일하게 보인다.                              */
  /* ------------------------------------------------------------------ */

  var ICONS = {
    "undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    "redo-2": '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
    bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
    italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
    underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
    highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    eraser: '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
    "remove-formatting": '<path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5"/><path d="m20 15-5 5"/>',
    "align-left": '<path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/>',
    "align-center": '<path d="M21 5H3"/><path d="M17 12H7"/><path d="M19 19H5"/>',
    "align-right": '<path d="M21 5H3"/><path d="M21 12H9"/><path d="M21 19H7"/>',
    "align-justify": '<path d="M3 5h18"/><path d="M3 12h18"/><path d="M3 19h18"/>',
    "align-h-start": '<rect width="6" height="14" x="6" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M2 2v20"/>',
    "align-h-center": '<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M12 2v20"/>',
    "align-h-end": '<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="12" y="7" rx="2"/><path d="M22 2v20"/>',
    "align-v-start": '<rect width="14" height="6" x="5" y="16" rx="2"/><rect width="10" height="6" x="7" y="6" rx="2"/><path d="M2 2h20"/>',
    "align-v-center": '<rect width="14" height="6" x="5" y="16" rx="2"/><rect width="10" height="6" x="7" y="2" rx="2"/><path d="M2 12h20"/>',
    "align-v-end": '<rect width="14" height="6" x="5" y="12" rx="2"/><rect width="10" height="6" x="7" y="2" rx="2"/><path d="M2 22h20"/>',
    "case-sensitive": '<path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M22 9v7"/><path d="M3.304 13h6.392"/><circle cx="18.5" cy="12.5" r="3.5"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    type: '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
    square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    "line-diagonal": '<line x1="19" y1="5" x2="5" y2="19"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    "code-2": '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
    "bring-to-front": '<rect x="8" y="8" width="8" height="8" rx="2"/><path d="M4 10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2"/><path d="M14 20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2"/>',
    "send-to-back": '<rect x="14" y="14" width="8" height="8" rx="2"/><rect x="2" y="2" width="8" height="8" rx="2"/><path d="M7 14v1a2 2 0 0 0 2 2h1"/><path d="M14 7h1a2 2 0 0 1 2 2v1"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    "trash-2": '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
  };

  function icon(name, size) {
    var body = ICONS[name] || "";
    return (
      '<svg class="ce-icon" width="' + (size || 15) + '" height="' + (size || 15) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>"
    );
  }

  /* ------------------------------------------------------------------ */
  /* 슬라이드 마스터(테마) — 지금은 다크 톤 하나뿐이라, 배경/텍스트/포인트색/     */
  /* 글꼴을 여기서 바꾸면 assets/styles.css의 :root 변수가 바뀌어서 전체       */
  /* 슬라이드(이 파일 하나를 공유해서 쓰는 모든 슬라이드)에 한 번에 적용된다.    */
  /* 슬라이드별로 지정한 배경색 등 개별 설정은 인라인 스타일이라 항상 이보다     */
  /* 우선한다 — 파워포인트의 "슬라이드 마스터 vs 개별 슬라이드 오버라이드"와    */
  /* 같은 관계.                                                          */
  /* ------------------------------------------------------------------ */

  var THEME_VAR_KEYS = ["bg", "bgPanel", "text", "muted", "muted2", "accent", "line"];
  var THEME_CSS_VAR = {
    bg: "--bg", bgPanel: "--bg-panel", text: "--text", muted: "--muted",
    muted2: "--muted-2", accent: "--accent", line: "--line",
  };
  // 폰트는 색상과 달리 임의 문자열을 그대로 CSS에 꽂으면 위험할 수 있어서,
  // 항상 이 허용 목록 중 하나의 키만 서버로 보내고 실제 font-stack 문자열은
  // 서버도 클라이언트도 이 표에서만 가져온다(에디터 툴바의 글꼴 선택과 동일한 구성).
  var THEME_FONT_STACKS = {
    default: "'Pretendard','Apple SD Gothic Neo','Malgun Gothic',-apple-system,BlinkMacSystemFont,sans-serif",
    gothic: "'Malgun Gothic','Apple SD Gothic Neo',sans-serif",
    dotum: "'Dotum','돋움',sans-serif",
    batang: "'Batang','바탕',serif",
    gungseo: "'Gungsuh','궁서',serif",
  };
  var THEME_PRESETS = {
    dark: { name: "다크 (기본)", bg: "#0c0d10", bgPanel: "#16171b", text: "#f2f3f5", muted: "#999da5", muted2: "#6b6e75", accent: "#ff6b4a", line: "#26282e", font: "default" },
    light: { name: "화이트", bg: "#f7f7f5", bgPanel: "#ffffff", text: "#1c1d21", muted: "#6b6e75", muted2: "#9a9da5", accent: "#e05a3a", line: "#e2e2e0", font: "default" },
    navy: { name: "네이비", bg: "#0b1526", bgPanel: "#111f36", text: "#f2f4f8", muted: "#93a1bd", muted2: "#5b6a86", accent: "#4fa8ff", line: "#1d2c47", font: "default" },
    warm: { name: "웜/베이지", bg: "#181410", bgPanel: "#231d16", text: "#f6efe6", muted: "#c2ab8e", muted2: "#8a7863", accent: "#e8a33d", line: "#332a20", font: "default" },
    mono: { name: "모노 그레이", bg: "#111214", bgPanel: "#1a1b1e", text: "#eceded", muted: "#9a9da5", muted2: "#63656b", accent: "#eceded", line: "#2c2e33", font: "default" },
  };

  function fontStackToKey(stack) {
    var norm = String(stack || "").replace(/\s+/g, "");
    var found = Object.keys(THEME_FONT_STACKS).find(function (k) {
      return THEME_FONT_STACKS[k].replace(/\s+/g, "") === norm;
    });
    return found || "default";
  }

  // 지금 이 문서에 실제로 적용돼 있는 테마 변수 값(:root에서 계산된 값)을
  // 읽어온다 — 패널을 열 때 폼에 "지금 값"을 채워주기 위해 쓴다.
  function getCurrentThemeVars() {
    var cs = getComputedStyle(document.documentElement);
    var vars = {};
    THEME_VAR_KEYS.forEach(function (key) {
      vars[key] = rgbToHex(cs.getPropertyValue(THEME_CSS_VAR[key]).trim()) || cs.getPropertyValue(THEME_CSS_VAR[key]).trim();
    });
    vars.font = fontStackToKey(cs.getPropertyValue("--font"));
    return vars;
  }

  // 저장 전에도 바로바로 결과가 보이도록, styles.css를 직접 고치는 대신
  // <head> 맨 끝에 :root 변수를 다시 선언하는 <style>을 하나 얹어서 덮어쓴다
  // (원본 스타일시트 뒤에 위치하므로 동일 우선순위에서 나중 선언이 이긴다).
  function applyThemeLive(vars) {
    var styleEl = document.getElementById(THEME_OVERRIDE_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = THEME_OVERRIDE_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    var decls = THEME_VAR_KEYS.map(function (key) {
      return THEME_CSS_VAR[key] + ":" + (vars[key] || "") + ";";
    }).join("");
    var fontStack = THEME_FONT_STACKS[vars.font] || THEME_FONT_STACKS.default;
    styleEl.textContent = ":root{" + decls + "--font:" + fontStack + ";}";
  }

  var themePanelSnapshot = null; // 패널을 열었을 때의 값 — "되돌리기"에서 이 값으로 복구한다

  function getThemePanel() {
    return document.getElementById(THEME_PANEL_ID);
  }

  function writeThemeForm(vars) {
    var panel = getThemePanel();
    if (!panel) return;
    THEME_VAR_KEYS.forEach(function (key) {
      var input = panel.querySelector('[data-theme="' + key + '"]');
      if (input) input.value = vars[key];
    });
    var fontSel = panel.querySelector('[data-theme="font"]');
    if (fontSel) fontSel.value = vars.font;
  }

  function readThemeForm() {
    var panel = getThemePanel();
    var vars = {};
    if (!panel) return vars;
    THEME_VAR_KEYS.forEach(function (key) {
      var input = panel.querySelector('[data-theme="' + key + '"]');
      if (input) vars[key] = input.value;
    });
    var fontSel = panel.querySelector('[data-theme="font"]');
    vars.font = fontSel ? fontSel.value : "default";
    return vars;
  }

  function renderThemePresets() {
    var panel = getThemePanel();
    if (!panel) return;
    var wrap = panel.querySelector(".th-presets");
    if (!wrap || wrap.childElementCount) return; // 한 번만 그린다
    Object.keys(THEME_PRESETS).forEach(function (key) {
      var preset = THEME_PRESETS[key];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "th-preset";
      btn.setAttribute("data-preset", key);
      btn.innerHTML = '<span class="th-preset-dot" style="background:' + preset.bg + '"></span>' + preset.name;
      wrap.appendChild(btn);
    });
  }

  function applyThemePresetByKey(key) {
    var preset = THEME_PRESETS[key];
    if (!preset) return;
    writeThemeForm(preset);
    applyThemeLive(preset);
  }

  function openThemePanel() {
    var panel = getThemePanel();
    var backdrop = document.getElementById(THEME_BACKDROP_ID);
    if (!panel) return;
    renderThemePresets();
    themePanelSnapshot = getCurrentThemeVars();
    writeThemeForm(themePanelSnapshot);
    panel.style.display = "flex";
    if (backdrop) backdrop.style.display = "block";
    panel.querySelector(".th-status").textContent = "";
  }

  function closeThemePanel() {
    var panel = getThemePanel();
    var backdrop = document.getElementById(THEME_BACKDROP_ID);
    if (panel) panel.style.display = "none";
    if (backdrop) backdrop.style.display = "none";
    // 저장하지 않고 닫으면(취소하는 것과 같음) 미리보기 중이던 값을 패널을 열기
    // 전 상태로 되돌린다. 저장을 눌렀다면 themePanelSnapshot이 이미 그 값으로
    // 갱신돼 있어서 여기선 그대로 유지된다.
    if (themePanelSnapshot) applyThemeLive(themePanelSnapshot);
  }

  function toggleThemePanel() {
    var panel = getThemePanel();
    if (panel && panel.style.display === "flex") {
      closeThemePanel();
      return;
    }
    openThemePanel();
  }

  function resetThemeForm() {
    if (!themePanelSnapshot) return;
    writeThemeForm(themePanelSnapshot);
    applyThemeLive(themePanelSnapshot);
    var panel = getThemePanel();
    if (panel) panel.querySelector(".th-status").textContent = "되돌렸습니다";
  }

  // 서버(로컬 개발 서버)가 있으면 styles.css의 :root 블록을 실제로 고쳐서
  // 전체 슬라이드에 영구 반영한다. GitHub Pages 같은 정적 호스팅이라 서버가
  // 없으면(/api/save-theme 실패) 지금 배포된 styles.css를 받아와서 클라이언트가
  // 직접 :root 블록만 새 값으로 바꾼 뒤 파일로 다운로드해준다 — 사용자가 그
  // 파일을 assets/styles.css 자리에 직접 덮어쓰면 된다(일반 슬라이드 저장의
  // 로컬 다운로드 대안과 같은 패턴).
  function saveTheme() {
    var panel = getThemePanel();
    if (!panel) return;
    var status = panel.querySelector(".th-status");
    var vars = readThemeForm();
    status.textContent = "저장 중…";
    fetch("/api/save-theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vars: vars }),
    })
      .then(function (r) {
        var contentType = r.headers.get("content-type") || "";
        if (!r.ok || contentType.indexOf("application/json") !== 0) throw new Error("no-backend");
        return r.json();
      })
      .then(function (data) {
        if (data.ok) {
          themePanelSnapshot = vars;
          status.textContent = "저장됨 · 모든 슬라이드에 적용됩니다";
        } else {
          status.textContent = "저장 실패: " + data.error;
        }
      })
      .catch(function () {
        downloadUpdatedStylesCss(vars, status);
      });
  }

  function downloadUpdatedStylesCss(vars, status) {
    var link = document.querySelector('link[rel="stylesheet"][href*="styles.css"]');
    var cssUrl = link ? link.href : "../assets/styles.css";
    fetch(cssUrl)
      .then(function (r) {
        if (!r.ok) throw new Error("styles.css를 불러오지 못했습니다");
        return r.text();
      })
      .then(function (original) {
        var decls = THEME_VAR_KEYS.map(function (key) {
          return "  " + THEME_CSS_VAR[key] + ": " + vars[key] + ";";
        }).join("\n");
        var fontStack = THEME_FONT_STACKS[vars.font] || THEME_FONT_STACKS.default;
        var newRoot = ":root {\n" + decls + "\n  --font: " + fontStack + ";\n}";
        var updated = /:root\s*\{[^}]*\}/.test(original)
          ? original.replace(/:root\s*\{[^}]*\}/, newRoot)
          : newRoot + "\n\n" + original;
        var blob = new Blob([updated], { type: "text/css" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "styles.css";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        status.textContent = "서버 없음 → styles.css를 다운로드했어요 (slides/assets/styles.css 자리에 덮어써주세요)";
      })
      .catch(function (e) {
        status.textContent = "실패: " + (e && e.message ? e.message : e);
      });
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
      "display:flex;flex-wrap:wrap;align-items:center;gap:6px;background:#1b1c20;" +
      "border-bottom:1px solid #34363d;padding:7px 10px;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;font-size:12px;}" +
      // 관련된 버튼들을 옅은 배경의 "그룹" 안에 모아서, 파워포인트/피그마 리본
      // 툴바처럼 어디까지가 한 기능 묶음인지 한눈에 들어오게 한다.
      "#" + UI_ID + " .cegroup{display:flex;align-items:center;gap:1px;background:#20222a;" +
      "border:1px solid #2c2e36;border-radius:8px;padding:2px;}" +
      "#" + UI_ID + " button{font-family:inherit;font-size:12px;color:#dcdee3;background:transparent;" +
      "border:1px solid transparent;border-radius:6px;padding:6px 8px;cursor:pointer;line-height:1;" +
      "white-space:nowrap;display:inline-flex;align-items:center;gap:5px;}" +
      "#" + UI_ID + " .cegroup button{padding:6px;}" +
      "#" + UI_ID + " .cegroup button.has-label{padding:6px 9px 6px 7px;}" +
      "#" + UI_ID + " button:hover{background:#33353e;color:#fff;}" +
      "#" + UI_ID + " button:active{background:#3c3e48;}" +
      "#" + UI_ID + " button.is-active{background:#3a2c26;color:#ff8b6b;box-shadow:inset 0 0 0 1px #ff6b4a55;}" +
      "#" + UI_ID + " button:disabled{opacity:.32;cursor:default;}" +
      "#" + UI_ID + " button:disabled:hover{background:transparent;color:#dcdee3;}" +
      "#" + UI_ID + " .cesep{width:1px;height:22px;background:#34363d;margin:0 2px;flex:none;}" +
      "#" + UI_ID + " .cestatus{margin-left:auto;color:#8a8d95;white-space:nowrap;font-size:11.5px;}" +
      "#" + UI_ID + " .ceswatch{width:19px;height:19px;border-radius:50%;border:1.5px solid #3c3e46;" +
      "padding:0;cursor:pointer;box-shadow:0 0 0 1px #0000;}" +
      "#" + UI_ID + " .ceswatch:hover{border-color:#ff6b4a;transform:scale(1.08);}" +
      "#" + UI_ID + " .ceswatch[data-bg]{border-radius:6px;}" +
      "#" + UI_ID + " input[type=color]{width:23px;height:23px;padding:0;border:1.5px solid #3c3e46;" +
      "border-radius:50%;background:none;cursor:pointer;}" +
      "#" + UI_ID + " select{font-family:inherit;font-size:11.5px;color:#dcdee3;background:#20222a;" +
      "border:1px solid #34363d;border-radius:6px;padding:6px 7px;cursor:pointer;max-width:100px;height:31px;" +
      "box-sizing:border-box;}" +
      "#" + UI_ID + " .cestepper{display:flex;align-items:center;gap:0;}" +
      "#" + UI_ID + " .cestepper > .ce-icon{opacity:.7;margin:0 5px 0 3px;}" +
      // 드래그 중 다른 요소/슬라이드 중앙과 정렬되는 순간 표시되는 스냅 가이드선.
      ".snap-guide{position:absolute;z-index:999997;pointer-events:none;background:#ff6b4a;opacity:.9;}" +
      ".snap-guide--v{width:1px;top:0;bottom:0;}" +
      ".snap-guide--h{height:1px;left:0;right:0;}" +
      "#" + UI_ID + " button.save-btn{color:#1b1c20;background:#ff6b4a;border-color:#ff6b4a;font-weight:700;}" +
      "#" + UI_ID + " button.save-btn:hover{background:#ff7f61;border-color:#ff7f61;color:#1b1c20;}" +
      "#" + UI_ID + " .ce-icon{display:block;flex:none;}" +
      // 슬라이드 마스터(테마) 패널 — 중앙 모달 패턴.
      "#" + THEME_BACKDROP_ID + "{position:fixed;inset:0;z-index:999998;display:none;" +
      "background:rgba(6,7,10,.6);}" +
      "#" + THEME_PANEL_ID + "{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);" +
      "z-index:999998;display:none;flex-direction:column;width:340px;max-width:92vw;" +
      "max-height:82vh;background:#1b1c20;border:1px solid #34363d;border-radius:14px;" +
      "box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;}" +
      "#" + THEME_PANEL_ID + " .th-panel-header{display:flex;align-items:center;gap:8px;" +
      "padding:12px 14px;border-bottom:1px solid #2b2d33;flex:none;}" +
      "#" + THEME_PANEL_ID + " .th-title{display:flex;align-items:center;gap:6px;font-size:12px;" +
      "font-weight:700;color:#ffb99e;flex:1;}" +
      "#" + THEME_PANEL_ID + " .th-close{font-family:inherit;line-height:1;color:#9a9da5;" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "background:none;border:none;cursor:pointer;padding:4px;border-radius:4px;}" +
      "#" + THEME_PANEL_ID + " .th-close:hover{color:#ff6b4a;background:#2a2c33;}" +
      "#" + THEME_PANEL_ID + " .th-body{display:flex;flex-direction:column;gap:11px;padding:12px 14px;" +
      "overflow-y:auto;flex:1;min-height:0;}" +
      "#" + THEME_PANEL_ID + " .th-desc{font-size:11px;color:#8a8d95;line-height:1.5;margin:0;}" +
      "#" + THEME_PANEL_ID + " .th-label{font-size:11px;color:#9a9da5;margin-bottom:5px;}" +
      "#" + THEME_PANEL_ID + " .th-presets{display:flex;flex-wrap:wrap;gap:6px;}" +
      "#" + THEME_PANEL_ID + " .th-preset{display:flex;align-items:center;gap:5px;font-family:inherit;" +
      "font-size:11px;color:#dcdee3;background:#20222a;border:1px solid #34363d;border-radius:6px;" +
      "padding:5px 8px;cursor:pointer;}" +
      "#" + THEME_PANEL_ID + " .th-preset:hover{border-color:#ff6b4a;color:#fff;}" +
      "#" + THEME_PANEL_ID + " .th-preset-dot{width:12px;height:12px;border-radius:50%;flex:none;" +
      "border:1px solid rgba(255,255,255,.25);}" +
      "#" + THEME_PANEL_ID + " .th-color-row{display:flex;align-items:center;justify-content:space-between;" +
      "gap:8px;font-size:12px;color:#c7cad1;cursor:default;}" +
      "#" + THEME_PANEL_ID + " .th-color-row input[type=color]{width:28px;height:24px;padding:0;" +
      "border:1px solid #3c3e46;border-radius:4px;background:#0c0d10;cursor:pointer;}" +
      "#" + THEME_PANEL_ID + " .th-color-row select{font-family:inherit;font-size:11.5px;color:#dcdee3;" +
      "background:#20222a;border:1px solid #34363d;border-radius:6px;padding:5px 6px;cursor:pointer;}" +
      "#" + THEME_PANEL_ID + " .th-footer{flex:none;padding:10px 14px 14px;border-top:1px solid #2b2d33;" +
      "display:flex;align-items:center;flex-wrap:wrap;gap:8px;}" +
      "#" + THEME_PANEL_ID + " .th-footer button{font-family:inherit;font-size:12px;color:#eceded;" +
      "background:#2a2c33;border:1px solid #3c3e46;border-radius:4px;padding:6px 12px;cursor:pointer;}" +
      "#" + THEME_PANEL_ID + " .th-footer button:hover{border-color:#ff6b4a;color:#ff6b4a;}" +
      "#" + THEME_PANEL_ID + " .th-footer button.save-btn:hover{color:#1b1c20;}" +
      "#" + THEME_PANEL_ID + " .th-status{font-size:11px;color:#8a8d95;flex:1;text-align:right;}" +
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
      // 파워포인트의 "도형 서식" 패널처럼, 선택된 요소(도형/텍스트 상자/이미지 등)의
      // 배경·테두리·모서리·투명도·그림자를 직접 슬라이더/색상 선택으로 만질 수 있게
      // 화면 오른쪽에 떠 있는 패널. 선택된 요소가 없으면 자리를 차지하지 않는다.
      "#" + STYLE_PANEL_ID + "{position:fixed;top:41px;right:0;z-index:999997;display:none;" +
      "width:196px;max-height:calc(100vh - 51px);overflow-y:auto;background:#1b1c20;" +
      "border-left:1px solid #2b2d33;border-bottom:1px solid #2b2d33;border-bottom-left-radius:8px;" +
      "padding:12px;box-sizing:border-box;font-family:'Malgun Gothic',sans-serif;}" +
      "#" + STYLE_PANEL_ID + " .sp-title{font-size:12px;font-weight:700;color:#eceded;margin-bottom:10px;}" +
      "#" + STYLE_PANEL_ID + " .sp-row{margin-bottom:12px;}" +
      "#" + STYLE_PANEL_ID + " .sp-label{display:flex;align-items:center;justify-content:space-between;" +
      "font-size:11px;color:#9a9da5;margin-bottom:5px;}" +
      "#" + STYLE_PANEL_ID + " .sp-row input[type=range]{width:100%;}" +
      "#" + STYLE_PANEL_ID + " .sp-color-row{display:flex;align-items:center;gap:6px;}" +
      "#" + STYLE_PANEL_ID + " .sp-color-row input[type=color]{width:28px;height:24px;padding:0;" +
      "border:1px solid #3c3e46;border-radius:4px;background:#0c0d10;cursor:pointer;}" +
      "#" + STYLE_PANEL_ID + " .sp-clear{font-size:10.5px;color:#9a9da5;background:#2a2c33;" +
      "border:1px solid #3c3e46;border-radius:4px;padding:4px 7px;cursor:pointer;}" +
      "#" + STYLE_PANEL_ID + " .sp-border-row{display:flex;align-items:center;gap:6px;}" +
      "#" + STYLE_PANEL_ID + " .sp-border-row input[type=range]{flex:1;}" +
      "#" + STYLE_PANEL_ID + " .sp-toggle{display:flex;align-items:center;gap:6px;font-size:11px;" +
      "color:#c7cad1;}" +
      // 지금 뭘 선택했는지("피킹 영역") 한눈에 보이도록, 선택된 요소의 실제
      // 화면 좌표(getBoundingClientRect)에 맞춰 오렌지 점선 박스를 겹쳐 그린다.
      // free-el의 기존 얇은 outline보다 훨씬 눈에 잘 띄고, class가 없는 구조
      // 콘텐츠/SVG 도형에도 똑같이 적용된다.
      "#" + PICK_INDICATOR_ID + "{position:fixed;z-index:999996;display:none;pointer-events:none;" +
      "border:2px dashed #ff6b4a;border-radius:4px;box-shadow:0 0 0 3px rgba(255,107,74,.18),0 0 14px rgba(255,107,74,.35);}" +
      "#" + PICK_INDICATOR_ID + " .pick-tag{position:absolute;left:-2px;top:-20px;background:#ff6b4a;" +
      "color:#fff;font-size:10px;font-weight:700;line-height:1;padding:3px 6px;border-radius:3px 3px 0 0;" +
      "white-space:nowrap;font-family:'Malgun Gothic',sans-serif;}";
    document.head.appendChild(style);

    var wrap = document.createElement("div");
    wrap.id = UI_ID;
    wrap.innerHTML =
      '<div class="cebar">' +
      '<div class="cegroup">' +
      '<button data-cmd="undo" title="실행 취소 (Ctrl+Z)">' + icon("undo-2") + "</button>" +
      '<button data-cmd="redo" title="다시 실행 (Ctrl+Shift+Z)">' + icon("redo-2") + "</button>" +
      "</div>" +
      '<div class="cegroup">' +
      '<button data-cmd="bold" title="굵게 (Ctrl+B)">' + icon("bold") + "</button>" +
      '<button data-cmd="italic" title="기울임 (Ctrl+I)">' + icon("italic") + "</button>" +
      '<button data-cmd="underline" title="밑줄 (Ctrl+U)">' + icon("underline") + "</button>" +
      '<button data-cmd="hl" title="선택한 텍스트를 검정 박스로 강조">' + icon("highlighter") + "</button>" +
      '<button data-cmd="unhl" title="강조 해제">' + icon("eraser") + "</button>" +
      '<button data-cmd="clear-fmt" title="붙여넣기 등으로 섞여 들어온 폰트/색상 서식을 제거하고 순수 텍스트로">' + icon("remove-formatting") + "</button>" +
      "</div>" +
      '<div class="cegroup" title="텍스트 정렬">' +
      '<button data-cmd="justify-left" data-align="left" title="텍스트 왼쪽 정렬">' + icon("align-left") + "</button>" +
      '<button data-cmd="justify-center" data-align="center" title="텍스트 가운데 정렬">' + icon("align-center") + "</button>" +
      '<button data-cmd="justify-right" data-align="right" title="텍스트 오른쪽 정렬">' + icon("align-right") + "</button>" +
      '<button data-cmd="justify-full" data-align="justify" title="텍스트 양쪽 정렬">' + icon("align-justify") + "</button>" +
      "</div>" +
      '<div class="cegroup" title="선택한 개체를 슬라이드 기준으로 맞춤">' +
      '<button data-cmd="obj-align-left" title="개체를 슬라이드 왼쪽에 맞춤">' + icon("align-h-start") + "</button>" +
      '<button data-cmd="obj-align-center-h" title="개체를 슬라이드 가로 가운데에 맞춤">' + icon("align-h-center") + "</button>" +
      '<button data-cmd="obj-align-right" title="개체를 슬라이드 오른쪽에 맞춤">' + icon("align-h-end") + "</button>" +
      '<span class="cesep"></span>' +
      '<button data-cmd="obj-align-top" title="개체를 슬라이드 위쪽에 맞춤">' + icon("align-v-start") + "</button>" +
      '<button data-cmd="obj-align-center-v" title="개체를 슬라이드 세로 가운데에 맞춤">' + icon("align-v-center") + "</button>" +
      '<button data-cmd="obj-align-bottom" title="개체를 슬라이드 아래쪽에 맞춤">' + icon("align-v-end") + "</button>" +
      "</div>" +
      '<div class="cegroup">' +
      '<select data-cmd="font-family" title="글꼴 바꾸기">' +
      '<option value="">기본 폰트</option>' +
      '<option value="\'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif">고딕</option>' +
      '<option value="\'Dotum\',\'돋움\',sans-serif">돋움</option>' +
      '<option value="\'Batang\',\'바탕\',serif">명조(바탕)</option>' +
      '<option value="\'Gungsuh\',\'궁서\',serif">궁서체</option>' +
      "</select>" +
      '<span class="cestepper">' + icon("case-sensitive") +
      '<button data-cmd="font-minus" title="글자 작게 (Ctrl+Shift+,)">' + icon("minus", 13) + "</button>" +
      '<button data-cmd="font-plus" title="글자 크게 (Ctrl+Shift+.)">' + icon("plus", 13) + "</button>" +
      "</span>" +
      '<button class="ceswatch" data-color="#f2f3f5" style="background:#f2f3f5" title="흰색 텍스트"></button>' +
      '<button class="ceswatch" data-color="#ff6b4a" style="background:#ff6b4a" title="포인트 색 텍스트"></button>' +
      '<button class="ceswatch" data-color="#999da5" style="background:#999da5" title="회색 텍스트"></button>' +
      '<input type="color" data-cmd="color-picker" title="색상 직접 선택 (텍스트/도형)" value="#ff6b4a" />' +
      "</div>" +
      '<div class="cegroup">' +
      '<button class="has-label" data-cmd="add-text" title="자유롭게 배치되는 텍스트 상자 추가">' + icon("type") + "텍스트</button>" +
      '<button class="has-label" data-cmd="add-rect" title="사각형 도형 추가">' + icon("square") + "사각형</button>" +
      '<button class="has-label" data-cmd="add-line" title="선 도형 추가">' + icon("line-diagonal") + "선</button>" +
      '<button class="has-label" data-cmd="image" title="이미지 삽입 (자유 배치)">' + icon("image") + "이미지</button>" +
      '<button class="has-label" data-cmd="youtube" title="유튜브 링크 또는 .mp4/.webm 영상 파일 링크 삽입">' + icon("video") + "동영상</button>" +
      '<button class="has-label" data-cmd="embed" title="dbdiagram·Figma·구글지도 등 &lt;iframe&gt; 임베드 코드/링크 삽입">' + icon("code-2") + "임베드</button>" +
      "</div>" +
      '<div class="cegroup" title="선택한 요소">' +
      '<button data-cmd="front" title="맨 앞으로">' + icon("bring-to-front") + "</button>" +
      '<button data-cmd="back" title="맨 뒤로 (겹친 요소는 Alt+클릭으로도 한 칸씩 선택할 수 있어요)">' + icon("send-to-back") + "</button>" +
      '<button data-cmd="dup" title="복제 (Ctrl+D)">' + icon("copy") + "</button>" +
      '<button data-cmd="del-selected" title="삭제 (Delete)">' + icon("trash-2") + "</button>" +
      "</div>" +
      '<div class="cegroup" title="이 슬라이드만의 배경색 (슬라이드 마스터보다 우선함)">' +
      '<button class="ceswatch" data-bg="#0c0d10" style="background:#0c0d10" title="기본 배경"></button>' +
      '<button class="ceswatch" data-bg="#0e2438" style="background:#0e2438" title="네이비 배경"></button>' +
      '<button class="ceswatch" data-bg="#000000" style="background:#000000" title="완전 검정"></button>' +
      '<button class="ceswatch" data-bg="#161616" style="background:#161616" title="차콜"></button>' +
      "</div>" +
      '<button class="has-label" data-cmd="theme" title="배경/텍스트/포인트 색상·글꼴 등 테마를 전체 슬라이드에 한 번에 적용합니다 (파워포인트의 슬라이드 마스터와 비슷해요)">' + icon("palette") + "슬라이드 마스터</button>" +
      '<button class="save-btn has-label" data-cmd="save" title="저장 (Ctrl+S)">' + icon("save") + "저장</button>" +
      '<span class="cestatus"></span>' +
      "</div>" +
      '<div id="' + THEME_BACKDROP_ID + '"></div>' +
      '<div id="' + THEME_PANEL_ID + '">' +
      '<div class="th-panel-header">' +
      '<span class="th-title">' + icon("palette", 14) + "슬라이드 마스터 · 전체 테마</span>" +
      '<button type="button" class="th-close" data-cmd="theme-close" title="닫기 (Esc)">' + icon("x", 16) + "</button>" +
      "</div>" +
      '<div class="th-body">' +
      '<p class="th-desc">여기서 바꾸면 이 파일(styles.css)을 함께 쓰는 모든 슬라이드에 한 번에 적용됩니다. 슬라이드별로 직접 지정한 배경색 등은 항상 이보다 우선해요.</p>' +
      '<div class="th-row">' +
      '<div class="th-label">프리셋</div>' +
      '<div class="th-presets"></div>' +
      "</div>" +
      '<div class="th-row"><label class="th-color-row"><span>배경</span><input type="color" data-theme="bg" /></label></div>' +
      '<div class="th-row"><label class="th-color-row"><span>카드/패널 배경</span><input type="color" data-theme="bgPanel" /></label></div>' +
      '<div class="th-row"><label class="th-color-row"><span>기본 텍스트</span><input type="color" data-theme="text" /></label></div>' +
      '<div class="th-row"><label class="th-color-row"><span>보조 텍스트</span><input type="color" data-theme="muted" /></label></div>' +
      '<div class="th-row"><label class="th-color-row"><span>연한 보조 텍스트</span><input type="color" data-theme="muted2" /></label></div>' +
      '<div class="th-row"><label class="th-color-row"><span>포인트 색상</span><input type="color" data-theme="accent" /></label></div>' +
      '<div class="th-row"><label class="th-color-row"><span>구분선</span><input type="color" data-theme="line" /></label></div>' +
      '<div class="th-row">' +
      '<label class="th-color-row"><span>글꼴</span>' +
      '<select data-theme="font">' +
      '<option value="default">기본 (Pretendard)</option>' +
      '<option value="gothic">고딕</option>' +
      '<option value="dotum">돋움</option>' +
      '<option value="batang">명조(바탕)</option>' +
      '<option value="gungseo">궁서체</option>' +
      "</select>" +
      "</label>" +
      "</div>" +
      "</div>" +
      '<div class="th-footer">' +
      '<button type="button" data-cmd="theme-reset" title="마지막으로 저장된 테마로 되돌리기">되돌리기</button>' +
      '<button type="button" class="save-btn" data-cmd="theme-save" title="모든 슬라이드에 저장">전체 슬라이드에 저장</button>' +
      '<span class="th-status"></span>' +
      "</div>" +
      "</div>" +
      '<div id="' + STYLE_PANEL_ID + '" title="Alt+클릭: 겹친 요소나 그림/차트 같은 장식 요소도 부분별로 선택해서 서식을 바꿀 수 있어요. Alt+드래그로 이동도 가능해요.">' +
      '<div class="sp-title">서식 · <span class="sp-type"></span></div>' +
      '<div class="sp-row">' +
      '<div class="sp-label"><span data-label-for="bg">배경색</span></div>' +
      '<div class="sp-color-row">' +
      '<input type="color" data-style="bg" value="#ff6b4a" />' +
      '<button type="button" class="sp-clear" data-style-clear="bg">없음</button>' +
      "</div>" +
      "</div>" +
      '<div class="sp-row" data-row-for="border">' +
      '<div class="sp-label"><span data-label-for="border">테두리</span></div>' +
      '<div class="sp-border-row">' +
      '<input type="color" data-style="border-color" value="#ffffff" />' +
      '<input type="range" min="0" max="60" step="1" data-style="border-width" />' +
      "</div>" +
      "</div>" +
      '<div class="sp-row" data-row-for="radius">' +
      '<div class="sp-label"><span>모서리 둥글기</span><span class="sp-val" data-val-for="radius">0</span></div>' +
      '<input type="range" min="0" max="40" step="1" data-style="radius" />' +
      "</div>" +
      '<div class="sp-row">' +
      '<div class="sp-label"><span>투명도</span><span class="sp-val" data-val-for="opacity">100%</span></div>' +
      '<input type="range" min="10" max="100" step="5" data-style="opacity" />' +
      "</div>" +
      '<div class="sp-row">' +
      '<label class="sp-toggle"><input type="checkbox" data-style="shadow" /> 그림자</label>' +
      "</div>" +
      '<div class="sp-row" data-shadow-blur-row>' +
      '<div class="sp-label"><span>그림자 번짐</span><span class="sp-val" data-val-for="shadow-blur">24</span></div>' +
      '<input type="range" min="4" max="60" step="2" data-style="shadow-blur" />' +
      "</div>" +
      "</div>" +
      '<div id="' + PICK_INDICATOR_ID + '"><span class="pick-tag"></span></div>';
    document.body.appendChild(wrap);
    wireToolbar(wrap);
    return wrap;
  }

  function wireToolbar(wrap) {
    wrap.addEventListener("mousedown", function (e) {
      if (e.target.closest("button")) e.preventDefault();
    });
    wrap.addEventListener("input", function (e) {
      if (e.target.hasAttribute("data-style")) {
        applyStyleProp(e.target.getAttribute("data-style"));
        return;
      }
      if (e.target.hasAttribute("data-theme")) {
        applyThemeLive(readThemeForm());
        return;
      }
      if (e.target.matches('input[type=color]')) applyColor(e.target.value);
    });
    wrap.addEventListener("change", function (e) {
      if (e.target.matches('select[data-cmd="font-family"]')) applyFontFamily(e.target.value);
      if (e.target.hasAttribute("data-style")) applyStyleProp(e.target.getAttribute("data-style"));
      if (e.target.hasAttribute("data-theme")) applyThemeLive(readThemeForm());
    });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var themePanel = document.getElementById(THEME_PANEL_ID);
        if (themePanel && themePanel.style.display === "flex") closeThemePanel();
      }
    });
    wrap.addEventListener("click", function (e) {
      // 테마(슬라이드 마스터) 패널은 진짜 모달이라, 바깥 반투명 배경을 클릭하면 닫힌다.
      if (e.target.id === THEME_BACKDROP_ID) {
        closeThemePanel();
        return;
      }
      var presetBtn = e.target.closest(".th-preset");
      if (presetBtn) {
        applyThemePresetByKey(presetBtn.getAttribute("data-preset"));
        return;
      }
      var btn = e.target.closest("button");
      if (!btn) return;
      var cmd = btn.getAttribute("data-cmd");
      if (cmd === "bold") { document.execCommand("bold"); commitSoon(); }
      else if (cmd === "italic") { document.execCommand("italic"); commitSoon(); }
      else if (cmd === "underline") { document.execCommand("underline"); commitSoon(); }
      else if (cmd === "justify-left") { document.execCommand("justifyLeft"); commitSoon(); updateAlignButtons(); }
      else if (cmd === "justify-center") { document.execCommand("justifyCenter"); commitSoon(); updateAlignButtons(); }
      else if (cmd === "justify-right") { document.execCommand("justifyRight"); commitSoon(); updateAlignButtons(); }
      else if (cmd === "justify-full") { document.execCommand("justifyFull"); commitSoon(); updateAlignButtons(); }
      else if (cmd === "obj-align-left") alignSelectedFreeEl("left");
      else if (cmd === "obj-align-center-h") alignSelectedFreeEl("center-h");
      else if (cmd === "obj-align-right") alignSelectedFreeEl("right");
      else if (cmd === "obj-align-top") alignSelectedFreeEl("top");
      else if (cmd === "obj-align-center-v") alignSelectedFreeEl("center-v");
      else if (cmd === "obj-align-bottom") alignSelectedFreeEl("bottom");
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
      else if (cmd === "theme") toggleThemePanel();
      else if (cmd === "theme-close") closeThemePanel();
      else if (cmd === "theme-reset") resetThemeForm();
      else if (cmd === "theme-save") saveTheme();
      else if (cmd === "front") { var s1 = getSelectedFreeEl(); if (s1) bringToFront(s1); }
      else if (cmd === "back") { var s2 = getSelectedFreeEl(); if (s2) sendToBack(s2); }
      else if (cmd === "dup") duplicateSelected();
      else if (cmd === "del-selected") { var s3 = getSelectedFreeEl(); if (s3) { selectFreeEl(null); s3.remove(); snapshot(); } }
      else if (cmd === "undo") undo();
      else if (cmd === "redo") redo();
      else if (cmd === "save") save(wrap);
      else if (btn.hasAttribute("data-color")) applyColor(btn.getAttribute("data-color"));
      else if (btn.hasAttribute("data-style-clear")) clearStyleProp(btn.getAttribute("data-style-clear"));
      else if (btn.hasAttribute("data-bg")) {
        var root = getRoot();
        if (root) { root.style.background = btn.getAttribute("data-bg"); snapshot(); }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* AI로 작성 (Claude) / AI 이미지 생성 (OpenAI)                              */
  /* 기본적으로는 로컬 서버(server.js)의 .env에 있는 키를 쓰고, 브라우저에는     */
  /* 전달되지 않는다. 다만 사용자가 "API 키" 패널에 자기 키를 직접 입력해두면    */
  /* (예: 서버를 못 띄우는 발표장/깃허브 페이지) 그 요청에 한해서는 서버를 거치지 */
  /* 않고 이 파일 안의 다이렉트 API 모드가 브라우저에서 바로 호출한다.          */
  /* ------------------------------------------------------------------ */

  function getCleanRootHtml() {
    var root = getRoot();
    if (!root) return "";
    var clone = root.cloneNode(true);
    stripFreeElChrome(clone);
    return clone.innerHTML;
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

  // 지금 캐럿/선택이 어느 정렬 상태인지 툴바 버튼에 눌림 표시로 반영한다.
  // (파워포인트에서 "왼쪽 정렬" 버튼이 활성화된 채로 유지되는 것과 같은 느낌.)
  function updateAlignButtons() {
    var wrap = document.getElementById(UI_ID);
    if (!wrap) return;
    var buttons = wrap.querySelectorAll("button[data-align]");
    if (!buttons.length) return;
    var states = {};
    try {
      states.left = document.queryCommandState("justifyLeft");
      states.center = document.queryCommandState("justifyCenter");
      states.right = document.queryCommandState("justifyRight");
      states.justify = document.queryCommandState("justifyFull");
    } catch (e) {
      return;
    }
    buttons.forEach(function (btn) {
      var key = btn.getAttribute("data-align");
      btn.classList.toggle("is-active", !!states[key]);
    });
  }

  /* ------------------------------------------------------------------ */
  /* 개체 정렬 — 파워포인트의 "맞춤"처럼, 자유 배치 요소를 슬라이드 기준으로       */
  /* 좌/중/우, 상/중/하로 한 번에 맞춘다. free-el은 항상 left/top을 %로만       */
  /* 다루므로(드래그 로직과 동일), 현재 화면 위치와 목표 위치의 차이(px)를 구해   */
  /* %로 환산해서 더해준다 — 기존에 transform 등이 걸려 있어도 안전하다.        */
  /* ------------------------------------------------------------------ */

  function alignFreeEl(el, mode) {
    var root = getRoot();
    if (!root || !el) return;
    var rootRect = root.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    if (!rootRect.width || !rootRect.height) return;
    var curLeft = parseFloat(el.style.left) || 0;
    var curTop = parseFloat(el.style.top) || 0;
    var dxPx = 0;
    var dyPx = 0;
    if (mode === "left") dxPx = -(elRect.left - rootRect.left);
    else if (mode === "center-h") dxPx = (rootRect.width - elRect.width) / 2 - (elRect.left - rootRect.left);
    else if (mode === "right") dxPx = rootRect.width - elRect.width - (elRect.left - rootRect.left);
    else if (mode === "top") dyPx = -(elRect.top - rootRect.top);
    else if (mode === "center-v") dyPx = (rootRect.height - elRect.height) / 2 - (elRect.top - rootRect.top);
    else if (mode === "bottom") dyPx = rootRect.height - elRect.height - (elRect.top - rootRect.top);
    el.style.left = curLeft + (dxPx / rootRect.width) * 100 + "%";
    el.style.top = curTop + (dyPx / rootRect.height) * 100 + "%";
  }

  function alignSelectedFreeEl(mode) {
    var el = getSelectedFreeEl();
    if (!el) {
      setStatus("먼저 정렬할 요소를 선택하세요");
      return;
    }
    alignFreeEl(el, mode);
    snapshot();
  }

  /* ------------------------------------------------------------------ */
  /* 서식 패널 — 파워포인트 "도형 서식"처럼 선택된 요소의 배경/테두리/모서리/       */
  /* 투명도/그림자를 직접 슬라이더·색상 선택으로 조작한다.                       */
  /* ------------------------------------------------------------------ */

  var FREE_EL_TYPE_LABEL = {
    "free-el--text": "텍스트 상자",
    "free-el--shape": "도형",
    "free-el--image": "이미지",
    "free-el--video": "동영상",
    "free-el--embed": "임베드",
    "free-el--app": "인터랙티브 데모",
  };

  function getStylePanel() {
    return document.getElementById(STYLE_PANEL_ID);
  }

  function rgbToHex(value) {
    if (!value) return null;
    value = value.trim();
    if (value[0] === "#") return value.length === 7 ? value.toLowerCase() : null;
    var m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map(function (n) {
          var h = parseInt(n, 10).toString(16);
          return h.length === 1 ? "0" + h : h;
        })
        .join("")
    );
  }

  // 선택된 요소가 바뀔 때마다, 지금 그 요소의 실제 배경/테두리/모서리/투명도/
  // 그림자 값을 읽어와 패널 컨트롤에 그대로 반영한다. 편집 모드가 꺼져 있거나
  // 선택된 요소가 없으면 패널 자체를 숨긴다.
  function updateStylePanel() {
    var panel = getStylePanel();
    if (!panel) return;
    var el = getStyleTarget();
    if (!isEditing() || !el) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";

    // 도넛 조각/연결선 같은 SVG 도형은 CSS background/border가 아니라
    // fill/stroke로 색이 정해진다. 그래서 이 패널의 "배경색"/"테두리"는
    // SVG 도형일 때는 fill/stroke를 대신 읽고 쓴다(라벨도 그에 맞게 바꿔준다).
    // border-radius는 SVG 도형에는 의미가 없어서 그 줄은 통째로 숨긴다.
    var svg = isSvgShape(el);
    var typeLabel = svg ? "도형 조각 (SVG: " + el.tagName.toLowerCase() + ")" : el.classList.contains("free-el") ? "요소" : "구조 요소 (Alt+드래그로 이동)";
    Object.keys(FREE_EL_TYPE_LABEL).forEach(function (cls) {
      if (el.classList.contains(cls)) typeLabel = FREE_EL_TYPE_LABEL[cls];
    });
    panel.querySelector(".sp-type").textContent = typeLabel;

    var cs = getComputedStyle(el);

    panel.querySelector('[data-label-for="bg"]').textContent = svg ? "색상" : "배경색";
    panel.querySelector('[data-style="bg"]').value = rgbToHex(svg ? cs.fill : cs.backgroundColor) || "#ff6b4a";

    panel.querySelector('[data-label-for="border"]').textContent = svg ? "외곽선" : "테두리";
    var borderWidth = Math.round(parseFloat(svg ? cs.strokeWidth : cs.borderTopWidth) || 0);
    panel.querySelector('[data-style="border-width"]').value = Math.min(60, borderWidth);
    panel.querySelector('[data-style="border-color"]').value = rgbToHex(svg ? cs.stroke : cs.borderTopColor) || "#ffffff";

    panel.querySelector('[data-row-for="radius"]').style.display = svg ? "none" : "block";
    var radius = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
    panel.querySelector('[data-style="radius"]').value = Math.min(40, radius);
    panel.querySelector('[data-val-for="radius"]').textContent = String(radius);

    var opacityPct = Math.round((parseFloat(cs.opacity) || 1) * 100);
    panel.querySelector('[data-style="opacity"]').value = opacityPct;
    panel.querySelector('[data-val-for="opacity"]').textContent = opacityPct + "%";

    // SVG는 그림자를 box-shadow가 아니라 filter:drop-shadow로 표현한다(AI가
    // 만든 도넛 차트의 포인트 세그먼트도 이미 이 방식으로 은은하게 빛난다).
    var shadowStyle = svg ? el.style.filter : el.style.boxShadow;
    var hasShadow = svg ? !!cs.filter && cs.filter !== "none" : !!cs.boxShadow && cs.boxShadow !== "none";
    panel.querySelector('[data-style="shadow"]').checked = hasShadow;
    var blurMatch = shadowStyle && shadowStyle.match(/(\d+)px\s+rgba/);
    var blur = blurMatch ? parseInt(blurMatch[1], 10) : 24;
    panel.querySelector('[data-style="shadow-blur"]').value = blur;
    panel.querySelector('[data-val-for="shadow-blur"]').textContent = String(blur);
    panel.querySelector("[data-shadow-blur-row]").style.display = hasShadow ? "block" : "none";
  }

  // 이미지/영상/임베드는 실제 내용이 <img>/<video>/<iframe> 등 꽉 찬 자식
  // 요소라서, 래퍼에만 border-radius를 줘서는 시각적으로 모서리가 잘리지
  // 않는다(overflow:hidden을 래퍼에 주면 리사이즈 핸들까지 잘려버려서 그 방식은
  // 피한다). 그래서 모서리 둥글기는 래퍼와 그 안의 미디어 요소에 함께 적용한다.
  function applyStyleProp(prop) {
    var el = getStyleTarget();
    var panel = getStylePanel();
    if (!el || !panel) return;
    var svg = isSvgShape(el);
    var media = el.querySelector && el.querySelector("img, video, iframe");

    if (prop === "bg") {
      var bgValue = panel.querySelector('[data-style="bg"]').value;
      if (svg) el.style.fill = bgValue;
      else el.style.background = bgValue;
    } else if (prop === "border-color" || prop === "border-width") {
      var color = panel.querySelector('[data-style="border-color"]').value;
      var width = parseFloat(panel.querySelector('[data-style="border-width"]').value) || 0;
      if (svg) {
        el.style.stroke = color;
        el.style.strokeWidth = width > 0 ? String(width) : "0";
      } else {
        el.style.border = width > 0 ? width + "px solid " + color : "none";
      }
    } else if (prop === "radius") {
      if (svg) return; // SVG 도형에는 모서리 둥글기 개념이 없다
      var radius = parseFloat(panel.querySelector('[data-style="radius"]').value) || 0;
      el.style.borderRadius = radius + "px";
      if (media) media.style.borderRadius = radius + "px";
      panel.querySelector('[data-val-for="radius"]').textContent = String(radius);
    } else if (prop === "opacity") {
      var opacityPct = parseFloat(panel.querySelector('[data-style="opacity"]').value);
      el.style.opacity = String(opacityPct / 100);
      panel.querySelector('[data-val-for="opacity"]').textContent = opacityPct + "%";
    } else if (prop === "shadow" || prop === "shadow-blur") {
      var on = panel.querySelector('[data-style="shadow"]').checked;
      var blur = parseFloat(panel.querySelector('[data-style="shadow-blur"]').value) || 24;
      if (svg) {
        el.style.filter = on ? "drop-shadow(0 0 " + blur + "px rgba(0,0,0,.6))" : "none";
      } else {
        el.style.boxShadow = on ? "0 " + Math.round(blur / 2) + "px " + blur + "px rgba(0,0,0,.45)" : "none";
      }
      panel.querySelector('[data-val-for="shadow-blur"]').textContent = String(blur);
      panel.querySelector("[data-shadow-blur-row]").style.display = on ? "block" : "none";
    }
    commitSoon();
  }

  function clearStyleProp(prop) {
    var el = getStyleTarget();
    var panel = getStylePanel();
    if (!el || !panel) return;
    if (prop === "bg") {
      if (isSvgShape(el)) el.style.fill = "none";
      else el.style.background = "transparent";
      panel.querySelector('[data-style="bg"]').value = "#000000";
    }
    commitSoon();
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

  // 맨앞/맨뒤가 아니라 딱 한 칸만 앞/뒤로 — 바로 위(아래)에 있는 요소와
  // z-index를 맞바꾸는 방식이라 겹침 순서를 세밀하게 조정할 수 있다.
  function stepZOrder(el, dir) {
    var root = getRoot();
    if (!root) return;
    var mine = parseInt(el.style.zIndex || "10", 10);
    var target = null;
    var targetZ = null;
    root.querySelectorAll(".free-el").forEach(function (other) {
      if (other === el) return;
      var z = parseInt(other.style.zIndex || "10", 10);
      if (isNaN(z)) return;
      if (dir > 0 && z > mine && (targetZ === null || z < targetZ)) { target = other; targetZ = z; }
      if (dir < 0 && z < mine && (targetZ === null || z > targetZ)) { target = other; targetZ = z; }
    });
    if (!target) return; // 이미 맨앞/맨뒤
    target.style.zIndex = String(mine);
    el.style.zIndex = String(targetZ);
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

  // Ctrl+C/X로 복사한 자유배치 요소의 HTML (세션 내부 클립보드).
  var freeElClipboard = null;

  function pasteFreeElFromClipboard() {
    if (!freeElClipboard) return;
    var root = getRoot();
    if (!root) return;
    var tmp = document.createElement("div");
    tmp.innerHTML = freeElClipboard;
    var clone = tmp.firstElementChild;
    if (!clone || !clone.classList.contains("free-el")) return;
    var left = parseFloat(clone.style.left) || 0;
    var top = parseFloat(clone.style.top) || 0;
    clone.style.left = left + 3 + "%";
    clone.style.top = top + 3 + "%";
    clone.style.zIndex = String(nextZIndex());
    clone.setAttribute("contenteditable", "false");
    root.appendChild(clone);
    enhanceFreeEls();
    clone.focus();
    snapshot();
    // 같은 자리에 계속 겹쳐 붙지 않도록, 다음 붙여넣기는 한 칸 더 어긋나게 한다.
    tmp.innerHTML = freeElClipboard;
    var next = tmp.firstElementChild;
    next.style.left = left + 3 + "%";
    next.style.top = top + 3 + "%";
    freeElClipboard = next.outerHTML;
  }

  // 다른 앱에서 이미지를 복사해 돌아오는 경우와 충돌하지 않도록, 창을 벗어나면
  // 내부 요소 클립보드를 비운다 (밖에서 복사한 것이 항상 우선하게).
  window.addEventListener("blur", function () {
    freeElClipboard = null;
  });

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
    scopeEl.querySelectorAll(".free-el-handle, .free-el-del, .free-el-shield, .snap-guide").forEach(function (el) {
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
    if (e.target.closest("#" + UI_ID)) return; // 툴바/AI 패널/서식 패널 클릭은 여기서 다루지 않는다
    var delBtn = e.target.closest(".free-el-del");
    if (delBtn) {
      e.preventDefault();
      var toRemove = delBtn.closest(".free-el");
      if (toRemove) {
        if (toRemove === selectedFreeEl) selectFreeEl(null);
        toRemove.remove();
      }
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

    if (!el) {
      // 자유배치 요소가 하나도 없는 지점에서 Alt+클릭(+드래그)하면, 도넛 차트/
      // 버블 클러스터 같은 "구조 콘텐츠"라도 class가 붙은 가장 안쪽 요소를
      // 짚어서 서식 패널로 배경/테두리/모서리/그림자를 만질 수 있게 해주고,
      // 그 자리에서 바로 이동(transform:translate)까지 시작한다.
      if (e.altKey) {
        var structEl = nearestStyleableEl(e.target);
        if (structEl) {
          e.preventDefault();
          selectStructEl(structEl);
          startStructDrag(structEl, e);
          return;
        }
      }
      selectFreeEl(null); // 빈 배경/구조 텍스트를 그냥 클릭하면 서식 패널을 닫는다
      selectStructEl(null);
      return;
    }
    if (!handle && el.classList.contains("free-el--text") && el.getAttribute("contenteditable") === "true") {
      return; // 텍스트 편집 중에는 커서 배치를 그대로 둔다
    }
    e.preventDefault();
    el.focus();
    selectFreeEl(el);
    var root = getRoot();
    var rect = root.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    dragState = {
      mode: "percent",
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
      // 스냅용: 드래그하는 요소의 실제 렌더 크기(슬라이드 % 기준)와,
      // 다른 요소들의 가장자리/중앙에서 뽑은 정렬 후보선들.
      elWPct: (elRect.width / rect.width) * 100,
      elHPct: (elRect.height / rect.height) * 100,
      snap: handle ? null : buildSnapCandidates(el, root, rect),
    };
  });

  // 슬라이드 중앙(50%)과 다른 자유배치 요소들의 좌/중/우, 상/중/하 위치를
  // 스냅 후보선으로 수집한다. 드래그 중 이 선들과 0.7% 이내로 가까워지면
  // 자석처럼 달라붙고 가이드선이 표시된다 (파워포인트의 스마트 가이드).
  function buildSnapCandidates(movingEl, root, rootRect) {
    var xs = [50];
    var ys = [50];
    root.querySelectorAll(".free-el").forEach(function (other) {
      if (other === movingEl) return;
      var r = other.getBoundingClientRect();
      var l = ((r.left - rootRect.left) / rootRect.width) * 100;
      var t = ((r.top - rootRect.top) / rootRect.height) * 100;
      var w = (r.width / rootRect.width) * 100;
      var h = (r.height / rootRect.height) * 100;
      xs.push(l, l + w / 2, l + w);
      ys.push(t, t + h / 2, t + h);
    });
    return { xs: xs, ys: ys };
  }

  var SNAP_THRESHOLD_PCT = 0.7;

  function applySnap(value, size, candidates) {
    // 요소의 시작점 / 중앙 / 끝점 각각이 후보선에 닿는지 순서대로 확인한다.
    var anchors = [0, size / 2, size];
    for (var a = 0; a < anchors.length; a++) {
      for (var c = 0; c < candidates.length; c++) {
        if (Math.abs(value + anchors[a] - candidates[c]) < SNAP_THRESHOLD_PCT) {
          return { value: candidates[c] - anchors[a], line: candidates[c] };
        }
      }
    }
    return { value: value, line: null };
  }

  function updateSnapGuides(vLine, hLine) {
    var root = getRoot();
    if (!root) return;
    var v = root.querySelector(".snap-guide--v");
    var h = root.querySelector(".snap-guide--h");
    if (vLine !== null) {
      if (!v) {
        v = document.createElement("div");
        v.className = "snap-guide snap-guide--v";
        root.appendChild(v);
      }
      v.style.left = vLine + "%";
    } else if (v) {
      v.remove();
    }
    if (hLine !== null) {
      if (!h) {
        h = document.createElement("div");
        h.className = "snap-guide snap-guide--h";
        root.appendChild(h);
      }
      h.style.top = hLine + "%";
    } else if (h) {
      h.remove();
    }
  }

  function clearSnapGuides() {
    document.querySelectorAll(".snap-guide").forEach(function (g) { g.remove(); });
  }

  document.addEventListener("mousemove", function (e) {
    if (!dragState) return;
    var dxPct = ((e.clientX - dragState.startX) / dragState.rectW) * 100;
    var dyPct = ((e.clientY - dragState.startY) / dragState.rectH) * 100;
    if (dragState.mode === "transform") {
      // vw/vh는 항상 "지금 이 문서의 뷰포트" 기준이라 어디서 렌더링되든
      // (썸네일/본편집/전체화면) 같은 비율로 이동한다.
      var tx = dragState.baseTx + dxPct;
      var ty = dragState.baseTy + dyPct;
      dragState.el.style.transform =
        "translate(" + tx.toFixed(2) + "vw, " + ty.toFixed(2) + "vh)" + (dragState.restTransform ? " " + dragState.restTransform : "");
    } else if (dragState.type === "move") {
      var newLeft = dragState.startLeft + dxPct;
      var newTop = dragState.startTop + dyPct;
      var vLine = null;
      var hLine = null;
      // Alt를 누른 채 드래그하면 스냅 없이 자유롭게 놓을 수 있다.
      if (dragState.snap && !e.altKey) {
        var sx = applySnap(newLeft, dragState.elWPct, dragState.snap.xs);
        var sy = applySnap(newTop, dragState.elHPct, dragState.snap.ys);
        newLeft = sx.value;
        newTop = sy.value;
        vLine = sx.line;
        hLine = sy.line;
      }
      dragState.el.style.left = newLeft + "%";
      dragState.el.style.top = newTop + "%";
      updateSnapGuides(vLine, hLine);
    } else {
      var newWidth = Math.max(3, dragState.startWidth + dxPct);
      dragState.el.style.width = newWidth + "%";
      if (dragState.startHeight !== null) {
        var newHeight = Math.max(0.4, dragState.startHeight + dyPct);
        dragState.el.style.height = newHeight + "%";
      }
    }
    updatePickIndicator(); // 드래그/리사이즈하는 동안에도 피킹 박스가 그대로 따라가게
  });

  // 창 크기가 바뀌면 자유배치 요소의 %기반 좌표는 CSS가 알아서 다시 계산해
  // 주지만, 피킹 박스는 fixed 좌표(px)로 그려둔 것이라 직접 다시 맞춰줘야 한다.
  window.addEventListener("resize", updatePickIndicator);

  document.addEventListener("mouseup", function () {
    if (dragState) {
      clearSnapGuides();
      snapshot();
    }
    dragState = null;
    updateAlignButtons();
  });

  document.addEventListener("keyup", function () {
    if (isEditing()) updateAlignButtons();
  });

  // 새 요소를 삽입하거나 복제할 때(wrap.focus() 호출)도 서식 패널이 그 요소를
  // 바로 따라가도록, 포커스가 들어오는 모든 경로를 여기 한 곳에서 잡는다.
  document.addEventListener("focusin", function (e) {
    if (!isEditing()) return;
    var el = e.target && e.target.closest && e.target.closest(".free-el");
    if (el) selectFreeEl(el);
  });

  document.addEventListener("keydown", function (e) {
    if (!isEditing()) return;
    var active = document.activeElement;
    var isFreeEl = active && active.classList && active.classList.contains("free-el");
    var isTextEditing = !!isFreeEl && active.getAttribute("contenteditable") === "true";

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && isTextEditing && !e.shiftKey) {
      // contenteditable의 기본 B/I/U도 대체로 동작하지만, 명시적으로 처리해서
      // 실행취소 히스토리(commitSoon)에 확실히 기록되게 한다.
      var fmtKey = e.key.toLowerCase();
      if (fmtKey === "b" || fmtKey === "i" || fmtKey === "u") {
        e.preventDefault();
        document.execCommand(fmtKey === "b" ? "bold" : fmtKey === "i" ? "italic" : "underline");
        commitSoon();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && !isTextEditing && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && isFreeEl && !isTextEditing && (e.key === "]" || e.key === "[")) {
      e.preventDefault();
      if (e.shiftKey) {
        e.key === "]" ? bringToFront(active) : sendToBack(active);
      } else {
        stepZOrder(active, e.key === "]" ? 1 : -1);
      }
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
    // 요소 복사/잘라내기/붙여넣기 — PPT처럼 도형 단위로 동작한다.
    // OS 클립보드는 못 읽으므로 내부 변수에 담아두고, 창을 벗어나면 비워서
    // (blur 리스너 참고) 다른 앱에서 복사해온 이미지 붙여넣기와 충돌하지 않게 한다.
    if ((e.ctrlKey || e.metaKey) && !isTextEditing && isFreeEl && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
      var copyClone = active.cloneNode(true);
      copyClone.querySelectorAll(".free-el-handle, .free-el-del, .free-el-shield").forEach(function (n) { n.remove(); });
      freeElClipboard = copyClone.outerHTML;
      if (e.key.toLowerCase() === "x") {
        e.preventDefault();
        if (active === selectedFreeEl) selectFreeEl(null);
        active.remove();
        snapshot();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !isTextEditing && freeElClipboard && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteFreeElFromClipboard();
      return;
    }

    if (!isFreeEl || isTextEditing) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (active === selectedFreeEl) selectFreeEl(null);
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

  // AI "텍스트" 단계가 돌려준 결과는 구조 콘텐츠만 다시 쓴 것이다(getAiContextHtml이
  // free-el을 애초에 보여주지 않았으므로). 그걸 그냥 restore()로 통째로 덮어쓰면
  // 사용자가 클립보드로 붙여넣은 이미지 같은 free-el이 같이 사라져버리므로,
  // 덮어쓰기 전에 지금 있는 free-el들을 떼어뒀다가 새 구조 콘텐츠 위에 그대로
  // 다시 얹는다 — "꾸며줘" 같은 전체 재작성 요청에도 직접 배치한 요소는 항상 남는다.
  function applyAiStructuralHtml(cleanedHtml) {
    var root = getRoot();
    if (!root) return;
    var preserved = Array.prototype.slice.call(root.querySelectorAll(":scope > .free-el")).map(function (el) {
      return el.cloneNode(true);
    });
    restore(cleanedHtml);
    var rootAfter = getRoot();
    if (rootAfter && preserved.length) {
      preserved.forEach(function (el) { rootAfter.appendChild(el); });
      enhanceFreeEls();
    }
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

  function buildSaveHtml() {
    var clone = document.documentElement.cloneNode(true);
    var ui = clone.querySelector("#" + UI_ID);
    if (ui) ui.remove();
    var uiStyle = clone.querySelector("#" + UI_ID + "_style");
    if (uiStyle) uiStyle.remove();
    var draftBar = clone.querySelector("#" + LOCAL_DRAFT_BAR_ID);
    if (draftBar) draftBar.remove();
    var root = clone.querySelector(ROOT_SELECTOR);
    if (root) root.removeAttribute("contenteditable");
    stripFreeElChrome(clone);
    // "클릭하면 펼쳐지는" 버블 연출 등은 편집하면서 미리 펼쳐본 상태 그대로
    // 저장되면 안 되므로, 저장 전에 항상 처음(안 펼쳐진) 상태로 되돌린다.
    clone.querySelectorAll(".bubble-cell.is-open").forEach(function (el) {
      el.classList.remove("is-open");
    });
    return "<!DOCTYPE html>\n" + clone.outerHTML;
  }

  // 서버(/api/save)가 없거나 응답하지 않는 환경(GitHub Pages 등 정적 호스팅)에서
  // 쓰는 대안 저장: 이 브라우저의 localStorage에 남겨서 새로고침해도 방금 만진
  // 내용이 유지되게 하고, 동시에 실제 파일로도 다운로드해서 사용자가 직접
  // deck 폴더의 원본에 덮어쓸 수 있게 한다.
  function saveLocally(html) {
    saveLocalDraft(html);
    downloadHtml(html);
    setStatus("서버 없음 → 이 브라우저에 임시 저장 + 파일 다운로드됨 · " + new Date().toLocaleTimeString());
    showLocalDraftBar(Date.now());
  }

  function save(wrap) {
    setStatus("저장 중…");
    var html = buildSaveHtml();

    fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: relFilePath(), html: html }),
    })
      .then(function (r) {
        var contentType = r.headers.get("content-type") || "";
        if (!r.ok || contentType.indexOf("application/json") !== 0) {
          // 404 HTML 페이지 등 API가 아예 없는 응답 — 서버가 없다고 간주한다.
          throw new Error("no-backend");
        }
        return r.json();
      })
      .then(function (data) {
        if (data.ok) {
          clearLocalDraft();
          var bar = document.getElementById(LOCAL_DRAFT_BAR_ID);
          if (bar) bar.remove();
          setStatus("저장됨 · " + new Date().toLocaleTimeString());
        } else {
          setStatus("저장 실패: " + data.error);
        }
      })
      .catch(function () {
        saveLocally(html);
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
      selectedFreeEl = null;
      selectedStructEl = null;
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
    }
  });

  // 이 브라우저에 이 슬라이드의 임시 저장본이 남아있으면(서버 없이 저장했던 경우)
  // 지금 로드된 원본 위에 덮어서 보여준다. 편집 모드가 꺼져 있어도(발표/미리보기
  // 중이어도) 방금 만진 내용이 그대로 보이는 게 맞으므로 조건 없이 항상 확인한다.
  restoreLocalDraftIfAny();

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "cursor-editor:ready" }, "*");
  }
})();
