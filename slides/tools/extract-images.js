// 기존 슬라이드 HTML 안에 base64로 박혀 있는 이미지를 실제 파일(assets/img/)로
// 빼내고, HTML에는 상대 경로만 남기는 일회성 마이그레이션 스크립트.
// 실행: node tools/extract-images.js  (slides 폴더에서)
//
// - <img src="data:image/...;base64,..."> 형태만 처리한다.
// - 인터랙티브 데모(free-el--app)의 srcdoc 안에 이스케이프되어(&quot;) 들어간
//   base64는 데모가 자기 완결적으로 동작해야 하므로 건드리지 않는다.
// - 같은 이미지는 해시가 같아 파일 하나로 합쳐진다(중복 제거).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DECK_DIR = path.join(ROOT, "deck");
const IMG_DIR = path.join(ROOT, "assets", "img");

const EXT = { png: ".png", jpeg: ".jpg", jpg: ".jpg", gif: ".gif", webp: ".webp" };

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

let totalImages = 0;
let totalSavedBytes = 0;
let changedFiles = 0;

for (const file of fs.readdirSync(DECK_DIR)) {
  if (!file.endsWith(".html")) continue;
  const filePath = path.join(DECK_DIR, file);
  const original = fs.readFileSync(filePath, "utf8");
  let count = 0;

  const updated = original.replace(
    /(<img\b[^>]*?\bsrc=)(["'])data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)\2/g,
    (whole, prefix, quote, kind, b64) => {
      let buf;
      try {
        buf = Buffer.from(b64, "base64");
      } catch (e) {
        return whole;
      }
      if (!buf.length) return whole;
      const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12);
      const name = `img-${hash}${EXT[kind]}`;
      const imgPath = path.join(IMG_DIR, name);
      if (!fs.existsSync(imgPath)) fs.writeFileSync(imgPath, buf);
      count++;
      totalImages++;
      return `${prefix}${quote}../assets/img/${name}${quote}`;
    }
  );

  if (count > 0) {
    fs.writeFileSync(filePath, updated, "utf8");
    changedFiles++;
    const saved = original.length - updated.length;
    totalSavedBytes += saved;
    console.log(`${file}: 이미지 ${count}개 분리, ${(saved / 1024).toFixed(0)}KB 감소`);
  }
}

console.log(`\n완료: 파일 ${changedFiles}개에서 이미지 ${totalImages}개 분리, 총 ${(totalSavedBytes / 1024 / 1024).toFixed(1)}MB 감소`);
