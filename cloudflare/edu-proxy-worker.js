// Cloudflare Worker — suile.im/edu/* 로 들어오는 요청을 GitHub Pages에
// 배포된 슬라이드 사이트(dazelius.github.io/ai-workflow-slides)로 그대로
// 중계(proxy)한다. 이 Worker 자체는 인증을 하지 않는다 — 인증(구글 로그인 등)은
// Cloudflare Zero Trust Access가 이 Worker 앞단에서 먼저 처리하고, 통과한
// 요청만 여기로 들어온다.
//
// 배포 방법(Cloudflare 대시보드):
//   1. Workers & Pages → Create → Create Worker → 이 파일 내용을 그대로
//      붙여넣고 배포(예: 이름 edu-proxy)
//   2. suile.im 도메인의 Workers Routes에서 라우트 추가:
//      패턴: suile.im/edu*  →  방금 만든 edu-proxy Worker 연결
//   3. Zero Trust → Access → Applications에서 이 경로(suile.im, path /edu/*)를
//      보호 대상으로 지정하고 로그인 방법/허용 이메일을 설정 (README 참고)

const PREFIX = "/edu";
const ORIGIN = "https://dazelius.github.io/ai-workflow-slides";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // "/edu" (트레일링 슬래시 없이) 로 들어오면, 슬라이드 쪽 상대경로가
    // 엉뚱한 곳으로 풀리지 않도록 "/edu/"로 정리해서 리다이렉트한다.
    if (url.pathname === PREFIX) {
      url.pathname = PREFIX + "/";
      return Response.redirect(url.toString(), 302);
    }
    if (!url.pathname.startsWith(PREFIX + "/")) {
      return new Response("Not Found", { status: 404 });
    }

    const originPath = url.pathname.slice(PREFIX.length) || "/";
    const originUrl = ORIGIN + originPath + url.search;

    // 원본 요청의 메서드/헤더/바디는 그대로 유지해서 전달한다(AI 에이전트가
    // 브라우저에서 직접 api.anthropic.com/api.openai.com으로 보내는 요청은
    // 이 Worker를 거치지 않으니 영향 없음).
    const originRequest = new Request(originUrl, request);
    const originResponse = await fetch(originRequest);

    return new Response(originResponse.body, originResponse);
  },
};
