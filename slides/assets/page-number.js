// index.html이 iframe src에 ?n=<현재순번>&total=<전체수>를 붙여 넘겨주면
// 파일명이나 순서가 바뀌어도 이 스크립트가 자동으로 페이지 번호를 채워줍니다.
(function () {
  var params = new URLSearchParams(window.location.search);
  var n = params.get("n");
  var total = params.get("total");
  var el = document.getElementById("page-number");
  if (el && n) {
    el.textContent = total ? n + " / " + total : n;
  }
})();
