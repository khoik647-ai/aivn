#!/usr/bin/env bash
# AIVN – phát hành một phiên bản lên GitHub (Releases + GitHub Pages)
# Phát triển bởi NGUYỄN NGỌC KHÔI SINH VIÊN VLU
#
# Dùng:   ./release.sh <github-owner>
#   ví dụ ./release.sh khoinguyen
# Biến môi trường tuỳ chọn:
#   DRY_RUN=1     chỉ build + chuẩn bị tệp, KHÔNG gọi GitHub (không tạo repo/release/pages)
#   SKIP_BUILD=1  dùng lại tệp đã có trong dist/ (không build lại)
#   RCODESIGN=... đường dẫn tới rcodesign (apple-codesign) để ký ad-hoc bản macOS
#   REPO=aivn     tên repo (mặc định aivn)
#   AIVN_VERSION=0.16.0-beta.3  BẢN BETA (B174): ghi phiên bản này vào gói (package.json trong git không đổi), build Windows + macOS arm64/x64,
#                 đăng PRERELEASE (không bao giờ Latest), KHÔNG đính latest*.yml (máy bản ổn định không tự cập nhật lên beta),
#                 TỪ CHỐI nếu thiếu tệp Mac. Cần BETA_NOTES=<ghi chú công khai .md> (đủ vi/en/zh + cách mở lần đầu trên Mac).
#                 Sau khi đăng: tools/publish-beta-site.sh đưa link (Windows + Mac theo hệ điều hành) lên trang web.
#
# Cần: node/npm (đã npm install), wine (để electron-builder ghi icon/metadata vào .exe), zip,
#      rcodesign, git, gh (đã chạy "gh auth login" với quyền repo + pages).
set -euo pipefail

OWNER="${1:-${OWNER:-}}"
REPO="${REPO:-aivn}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
cd "$(dirname "$0")"
ROOT="$PWD"

die() { echo "LỖI: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

[[ -n "$OWNER" ]] || die "thiếu tên tài khoản GitHub. Dùng: ./release.sh <github-owner>"
[[ "$OWNER" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$ ]] || die "tên tài khoản GitHub không hợp lệ: $OWNER"
[[ "$OWNER" != "GITHUB_OWNER_PLACEHOLDER" ]] || die "hãy truyền tên tài khoản GitHub thật"

VERSION="${AIVN_VERSION:-$(node -p "require('./package.json').version")}"
BETA=0; [[ "$VERSION" == *-* ]] && BETA=1   # có hậu tố -… (0.16.0-beta.3) = bản thử nghiệm
if [[ "$BETA" == 1 ]]; then
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta[0-9.]*$ ]] || die "phiên bản beta không hợp lệ: $VERSION"
  [[ "$DRY_RUN" == 1 || -f "${BETA_NOTES:-}" ]] || die "bản beta cần BETA_NOTES=<ghi chú công khai .md>"
fi
TAG="v$VERSION"
BASE_URL="https://github.com/$OWNER/$REPO/releases/latest/download"
OUT="$ROOT/dist/release"

for c in node npx zip git tar; do command -v "$c" >/dev/null || die "thiếu lệnh '$c'"; done
if [[ "$DRY_RUN" != "1" ]]; then
  command -v gh >/dev/null || die "thiếu GitHub CLI 'gh' (https://cli.github.com)"
  gh auth status >/dev/null 2>&1 || die "gh chưa đăng nhập. Chạy: gh auth login"
fi
RCODESIGN="${RCODESIGN:-$(command -v rcodesign || true)}"
[[ -z "$RCODESIGN" && -x /workspace/tools/apple-codesign-0.29.0-x86_64-unknown-linux-musl/rcodesign ]] && RCODESIGN=/workspace/tools/apple-codesign-0.29.0-x86_64-unknown-linux-musl/rcodesign
[[ "$SKIP_BUILD" == "1" || -n "$RCODESIGN" ]] || die "thiếu rcodesign (apple-codesign) để ký ad-hoc bản macOS. Đặt biến RCODESIGN=/đường/dẫn/rcodesign"

step "Đặt nguồn cập nhật: github.com/$OWNER/$REPO (phiên bản $VERSION)"
node -e "
const fs=require('fs');const p=require('./package.json');
p.build.publish=[{provider:'github',owner:process.argv[1],repo:process.argv[2],releaseType:'release'}];
fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');" "$OWNER" "$REPO"

if [[ "$SKIP_BUILD" != "1" ]]; then
  step "Kiểm thử trích xuất tài liệu"
  # chạy tuần tự: kiểm thử có mô hình thật cần CPU yên tĩnh (llama.cpp trên CPU quá tải không lặp lại đúng từng chữ dù cùng seed)
  node --test --test-concurrency=1 test/*.test.js

  step "Tải Node.js thuần (bộ máy suy luận chạy ngoài Electron) cho Windows/macOS, kiểm SHA-256"
  node build/fetch-node.cjs

  step "Tải llama.cpp chính thức (llama-server, MIT) cho chế độ nhìn ảnh, kiểm SHA-256"
  node build/fetch-llama.cjs win-x64 darwin-arm64 darwin-x64

  step "Đóng gói bộ nghe (chép lời âm thanh/video): transformers.js + lõi WASM onnxruntime-web"
  node build/media-bundle.cjs || die "không đóng gói được bộ nghe (npm install đủ devDependencies chưa?)"

  step "Build Windows (NSIS) → dist/AIVN-Setup-$VERSION.exe + latest.yml + blockmap"
  rm -rf dist
  npx electron-builder --win nsis --x64 --publish never ${AIVN_VERSION:+-c.extraMetadata.version=$AIVN_VERSION}
  [[ -f dist/win-unpacked/resources/llama/llama-server.exe ]] || die "bản Windows thiếu llama-server.exe"

  step "Build macOS arm64 + x64 (.app)"
  MAC_TARGET=dir AIVN_VERSION="$VERSION" node build/mac-build.cjs

  step "Ký ad-hoc bản macOS bằng rcodesign và nén .zip (giữ symlink)"
  for pair in "mac-arm64:arm64" "mac:x64"; do
    dir="${pair%%:*}"; arch="${pair##*:}"
    app="dist/$dir/AIVN.app"
    [[ -d "$app" ]] || die "không thấy $app"
    [[ -x "$app/Contents/Resources/llama/llama-server" ]] || die "$app thiếu llama-server"
    "$RCODESIGN" sign "$app"
    (cd "dist/$dir" && rm -f "../AIVN-$VERSION-$arch-mac.zip" && zip -qry "../AIVN-$VERSION-$arch-mac.zip" AIVN.app)
  done
  # bản beta: không tạo latest-mac.yml (blockmap vẫn tạo được nhưng không đính kèm)
  [[ "$BETA" == 1 ]] || node build/gen-latest-mac.cjs "$VERSION" "dist/AIVN-$VERSION-arm64-mac.zip" "dist/AIVN-$VERSION-x64-mac.zip"
fi

step "Tự kiểm tra bản đóng gói: bộ máy AI (engine-host) khởi động được từ app.asar.unpacked"
for H in dist/win-unpacked/resources/app.asar.unpacked/src/engine-host.js $(ls -d dist/mac*/AIVN.app/Contents/Resources/app.asar.unpacked/src/engine-host.js 2>/dev/null); do
  node -e '
    const { fork } = require("child_process"); const h = process.argv[1];
    const c = fork(h, [], { stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env, AIVN_GPU: "off" } }); let err = "";
    c.stderr.on("data", d => err += d);
    const t = setTimeout(() => { console.error("quá thời gian: " + h); c.kill(); process.exit(1); }, 30000);
    c.on("message", m => { if (m.type === "ready") { clearTimeout(t); console.log("OK " + h); c.kill(); process.exit(0); } });
    c.on("exit", code => { clearTimeout(t); console.error("engine-host thoát mã " + code + "\n" + err.slice(-1500)); process.exit(1); });
  ' "$H" || die "bản đóng gói hỏng: bộ máy AI không khởi động ($H)"
done
# ───────────────────────── BẢN BETA (B174): Windows + macOS arm64/x64, prerelease, không latest*.yml ─────────────────────────
if [[ "$BETA" == 1 ]]; then
  step "Bản beta $VERSION: kiểm đủ tệp Windows + Mac, không có latest*.yml"
  rm -rf "$OUT"; mkdir -p "$OUT"
  BNEED=( "dist/AIVN-Setup-$VERSION.exe" "dist/AIVN-$VERSION-arm64-mac.zip" "dist/AIVN-$VERSION-x64-mac.zip" )
  for f in "${BNEED[@]}"; do [[ -s "$f" ]] || die "bản beta thiếu $f — mọi bản beta phải có đủ Windows và Mac (arm64 + x64)"; cp "$f" "$OUT/"; done
  for pair in "mac-arm64:arm64" "mac:x64"; do   # gói Mac đúng phiên bản và có bộ máy llama.cpp
    app="dist/${pair%%:*}/AIVN.app"; [[ -x "$app/Contents/Resources/llama/llama-server" ]] || die "$app thiếu llama-server"
    python3 -c 'import plistlib,sys;v=plistlib.load(open(sys.argv[1],"rb"))["CFBundleShortVersionString"];sys.exit(0 if v==sys.argv[2] else "Info.plist "+v)' "$app/Contents/Info.plist" "$VERSION" || die "$app: Info.plist không phải $VERSION"
  done
  ls "$OUT" | grep -E '^latest.*\.yml$' && die "bản beta không được có latest*.yml"
  ( cd "$OUT" && sha256sum * ) | tee "$ROOT/dist/SHA256SUMS-beta.txt"
  [[ $DRY_RUN != 1 ]] || { echo; echo "DRY_RUN=1: dừng trước GitHub. Tệp beta: $OUT"; exit 0; }
  grep -q 'AIVN-[0-9.a-z-]*-arm64-mac.zip' "$BETA_NOTES" && grep -q 'Vẫn mở' "$BETA_NOTES" && grep -q 'Open Anyway' "$BETA_NOTES" && grep -q '仍要打开' "$BETA_NOTES" \
    || die "BETA_NOTES thiếu tệp Mac hoặc cách mở lần đầu trên Mac (Vẫn mở / Open Anyway / 仍要打开) — xem docs/mac-gatekeeper.md"
  SCAN="${SECRET_SCAN:-/workspace/aivn-evidence/secret-scan.sh}"
  if [[ -x "$SCAN" ]]; then "$SCAN" "$ROOT" || die "quét bí mật không đạt"; fi
  LATEST_BEFORE=$(gh api "repos/$OWNER/$REPO/releases/latest" --jq .tag_name)
  [[ "$LATEST_BEFORE" != "$TAG" ]] || die "$TAG đang là Latest"
  step "Đăng prerelease $TAG (KHÔNG Latest)"
  if gh release view "$TAG" -R "$OWNER/$REPO" >/dev/null 2>&1; then
    [[ $(gh release view "$TAG" -R "$OWNER/$REPO" --json isPrerelease -q .isPrerelease) == true ]] || die "$TAG đã có nhưng không phải prerelease"
    gh release upload "$TAG" "$OUT"/* -R "$OWNER/$REPO" --clobber
  else
    gh release create "$TAG" "$OUT"/* -R "$OWNER/$REPO" --prerelease --latest=false --target "$(git rev-parse HEAD)" \
      --title "AIVN $VERSION (bản thử nghiệm)" --notes-file "$BETA_NOTES"
  fi
  J=$(gh release view "$TAG" -R "$OWNER/$REPO" --json isPrerelease,isDraft,assets)
  [[ $(jq -r .isPrerelease <<<"$J") == true && $(jq -r .isDraft <<<"$J") == false ]] || die "$TAG không phải prerelease đã đăng"
  jq -e '[.assets[].name | select(test("^latest.*\\.yml$"))] | length == 0' <<<"$J" >/dev/null || die "$TAG có latest*.yml"
  for f in "${BNEED[@]}"; do jq -e --arg n "$(basename "$f")" '[.assets[] | select(.name==$n)] | length == 1' <<<"$J" >/dev/null || die "$TAG thiếu $(basename "$f")"; done
  [[ $(gh api "repos/$OWNER/$REPO/releases/latest" --jq .tag_name) == "$LATEST_BEFORE" ]] || die "Latest đã đổi khỏi $LATEST_BEFORE"
  step "Đưa link bản beta (Windows + Mac theo hệ điều hành) lên trang web"
  tools/publish-beta-site.sh "$OWNER" "$TAG"
  echo; echo "XONG (beta): https://github.com/$OWNER/$REPO/releases/tag/$TAG · Latest vẫn là $LATEST_BEFORE"
  exit 0
fi
step "Chuẩn bị tệp phát hành trong dist/release/"
rm -rf "$OUT"; mkdir -p "$OUT"
need=( "dist/AIVN-Setup-$VERSION.exe" "dist/AIVN-Setup-$VERSION.exe.blockmap" "dist/latest.yml"
       "dist/AIVN-$VERSION-arm64-mac.zip" "dist/AIVN-$VERSION-x64-mac.zip"
       "dist/AIVN-$VERSION-arm64-mac.zip.blockmap" "dist/AIVN-$VERSION-x64-mac.zip.blockmap" "dist/latest-mac.yml" )
for f in "${need[@]}"; do [[ -f "$f" ]] || die "thiếu $f"; cp "$f" "$OUT/"; done
grep -q "^version: $VERSION$" "$OUT/latest.yml" || die "latest.yml không khớp phiên bản $VERSION"
grep -q "^version: $VERSION$" "$OUT/latest-mac.yml" || die "latest-mac.yml không khớp phiên bản $VERSION"
# Tên cố định (không có số phiên bản) cho nút tải trên trang web: releases/latest/download/<tên>
cp "dist/AIVN-Setup-$VERSION.exe" "$OUT/AIVN-Setup.exe"
cp "dist/AIVN-$VERSION-arm64-mac.zip" "$OUT/AIVN-mac-arm64.zip"
cp "dist/AIVN-$VERSION-x64-mac.zip" "$OUT/AIVN-mac-x64.zip"

step "Tạo trang web (GitHub Pages) trong dist/site/"
SITE="$ROOT/dist/site"; rm -rf "$SITE"; mkdir -p "$SITE"
sed -e "s#href=\"AIVN-Setup.exe\"#href=\"$BASE_URL/AIVN-Setup.exe\"#g" \
    -e "s#href=\"AIVN-mac-arm64.zip\"#href=\"$BASE_URL/AIVN-mac-arm64.zip\"#g" \
    -e "s#href=\"AIVN-mac-x64.zip\"#href=\"$BASE_URL/AIVN-mac-x64.zip\"#g" \
    site/index.html > "$SITE/index.html"
for f in preview-desktop.png preview-mobile.png favicon.svg favicon.ico apple-touch-icon.png; do [[ -f "site/$f" ]] && cp "site/$f" "$SITE/"; done
# dung lượng tải thật của bản phát hành này (QA B10), MB thập phân, làm tròn
mb() { node -e 'const s=require("fs").statSync(process.argv[1]).size;process.stdout.write(String(Math.round(s/1e6)))' "$1"; }
MB_WIN="$(mb "$OUT/AIVN-Setup.exe")"; MB_ARM="$(mb "$OUT/AIVN-mac-arm64.zip")"; MB_X64="$(mb "$OUT/AIVN-mac-x64.zip")"
sed -i -e "s/__MB_WIN__/$MB_WIN/g" -e "s/__MB_ARM__/$MB_ARM/g" -e "s/__MB_X64__/$MB_X64/g" "$SITE/index.html"
grep -q "__MB_" "$SITE/index.html" && die "trang web còn chỗ dung lượng chưa điền"
echo "Dung lượng trên trang: Windows ~$MB_WIN MB · Mac ARM ~$MB_ARM MB · Mac Intel ~$MB_X64 MB"
# trang kết quả tự kiểm chứng (nhãn ✓ trong Khám phá trỏ tới đây; QA B8)
node build/md-page.cjs docs/verified.md "$SITE/verified.html" || die "không tạo được verified.html"
grep -q 'id="v0143-nhin-anh"' "$SITE/verified.html" || die "verified.html thiếu mục kiểm chứng"
# trang kiểm chứng ba thứ tiếng như trang chủ (vi/en/zh, nút đổi ngôn ngữ): đủ bản dịch, đủ khối, mỗi khối đủ mỏ neo của bản tiếng Việt
for L in en zh; do
  [[ -f docs/verified.$L.md ]] || die "thiếu docs/verified.$L.md (bản dịch trang kiểm chứng)"
  grep -q "data-lang-block=\"$L\"" "$SITE/verified.html" || die "verified.html thiếu khối ngôn ngữ $L"
done
node -e 'const fs=require("fs"),h=fs.readFileSync(process.argv[1],"utf8"),ids=[...fs.readFileSync("docs/verified.md","utf8").matchAll(/<a id="([\w-]+)"><\/a>/g)].map(m=>m[1]);for(const L of ["en","zh"]){const b=(h.split(`data-lang-block="${L}"`)[1]||"").split("</main>")[0];const miss=ids.filter(i=>!b.includes(`data-aid="${i}"`));if(miss.length){console.error(L+": thiếu mỏ neo "+miss.join(", "));process.exit(1)}}' "$SITE/verified.html" || die "verified.html: bản dịch thiếu mỏ neo kiểm chứng"

[[ -f "$SITE/favicon.svg" ]] || die "thiếu site/favicon.svg (logo)"
node build/merge-revoked.cjs site/revoked.json "$SITE/revoked.json" || die "thiếu revoked.json hợp lệ (chạy /workspace/aivn-admin/admin.cjs publish)"
touch "$SITE/.nojekyll"
grep -q "$BASE_URL/AIVN-Setup.exe" "$SITE/index.html" || die "không thay được link tải Windows trong trang web"
ls -la "$OUT" "$SITE"

# Bảo vệ trang thật: gh-pages bị ghi đè hoàn toàn khi phát hành — sửa nóng trên gh-pages (vd. B68) chưa chép vào site/ sẽ mất.
# So 3 chiều với lần triển khai gần nhất (tools/site_drift.py); khối beta do tools/site_beta.py quản lý không tính. Mất nội dung → DỪNG.
step "Kiểm tra trang dựng từ site/ không làm mất nội dung chỉ có trên gh-pages"
if git ls-remote --exit-code --heads "https://github.com/$OWNER/$REPO.git" gh-pages >/dev/null 2>&1; then
  LIVE="$(mktemp -d)"
  git clone -q --branch gh-pages "https://github.com/$OWNER/$REPO.git" "$LIVE" || die "không clone được gh-pages để kiểm tra"
  python3 tools/site_drift.py --rendered "$SITE" --live "$LIVE" || { rm -rf "$LIVE"; die "trang thật có nội dung chưa có trong site/ — chép vào site/index.html (site/i18n) trước khi phát hành"; }
  rm -rf "$LIVE"
else
  echo "Chưa có nhánh gh-pages — bỏ qua kiểm tra."
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo; echo "DRY_RUN=1: dừng trước các bước GitHub. Tệp phát hành: $OUT · Trang web: $SITE"
  exit 0
fi

step "Tạo/kiểm tra repo $OWNER/$REPO (public)"
if ! gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  gh repo create "$OWNER/$REPO" --public --description "AIVN – chạy mô hình AI ngay trên máy tính của bạn (NGUYỄN NGỌC KHÔI SINH VIÊN VLU)"
  # Đẩy mã nguồn lên nhánh main của repo mới (không có node_modules/dist)
  TMPSRC="$(mktemp -d)"
  # Chép mã nguồn (không node_modules/dist); .gitignore của dự án lọc tiếp khi "git add"
  tar -C "$ROOT" --exclude=./node_modules --exclude=./dist --exclude=./.git -cf - . | tar -C "$TMPSRC" -xf -
  ( cd "$TMPSRC" && git init -q -b main && git add -A && git -c user.name="AIVN release" -c user.email="release@aivn.local" commit -qm "AIVN $VERSION" \
    && git remote add origin "https://github.com/$OWNER/$REPO.git" && gh auth setup-git && git push -q origin main )
  rm -rf "$TMPSRC"
else
  # Repo đã có: cập nhật nhánh main bằng một commit mới (không ghi đè lịch sử, không force-push)
  TMPSRC="$(mktemp -d)"
  gh repo clone "$OWNER/$REPO" "$TMPSRC" -- -q --branch main
  ( cd "$TMPSRC" && git rm -rqf --ignore-unmatch . >/dev/null )
  tar -C "$ROOT" --exclude=./node_modules --exclude=./dist --exclude=./.git -cf - . | tar -C "$TMPSRC" -xf -
  ( cd "$TMPSRC" && git add -A \
    && if git diff --cached --quiet; then echo "Mã nguồn không đổi."; else
         git -c user.name="AIVN release" -c user.email="release@aivn.local" commit -qm "AIVN $VERSION" && gh auth setup-git && git push -q origin main && echo "Đã cập nhật mã nguồn trên nhánh main."; fi )
  rm -rf "$TMPSRC"
fi

step "Tạo GitHub Release $TAG"
if [ -f "$(dirname "$0")/RELEASE_NOTES.md" ]; then NOTES="AIVN $VERSION · Phát triển bởi NGUYỄN NGỌC KHÔI SINH VIÊN VLU

$(cat "$(dirname "$0")/RELEASE_NOTES.md")"; else
NOTES="AIVN $VERSION · Phát triển bởi NGUYỄN NGỌC KHÔI SINH VIÊN VLU

Mới ở 0.13.0 – Trợ lý (chạy hoàn toàn trên mô hình cục bộ):
- Trợ lý tự gọi công cụ nhiều bước: máy tính, ngày giờ, đọc/liệt kê/ghi tệp (cả PDF, DOCX) chỉ trong thư mục bạn cho phép, chạy JavaScript trong hộp cát (không đọc tệp, không vào mạng, tối đa 3 giây), Python nếu máy có. Xoá hoặc ghi đè tệp luôn hỏi bằng hộp thoại tiếng Việt; xoá là chuyển vào Thùng rác.
- Tìm kiếm web và đọc trang (DuckDuckGo, dự phòng Wikipedia) chỉ khi bạn bật “Cho phép truy cập mạng”; mọi địa chỉ đã mở được ghi dưới câu trả lời. Chặn địa chỉ nội bộ/LAN.
- Mỗi bước hiện thành thẻ thu gọn (công cụ, đầu vào, kết quả), có nút Dừng; cảnh báo khi mô hình quá nhỏ để dùng công cụ (gợi ý Qwen3 4B/8B, Gemma 3 4B trở lên). Khám phá gắn nhãn “Hợp cho Trợ lý”.
- Ghi nhớ: Trợ lý lưu điều bạn muốn nó nhớ, trang Ghi nhớ để xem/sửa/xoá; điều liên quan được đưa vào lời nhắc (theo ý nghĩa bằng BGE-M3 nếu đã tải, nếu không thì theo từ khoá).
- Lịch tự động: lời nhắc và việc định kỳ cho Trợ lý (một lần, hằng ngày, hằng tuần), thông báo của hệ điều hành, kết quả lưu thành cuộc trò chuyện; tuỳ chọn chạy nền trong khay hệ thống và mở cùng máy.
- Máy chủ API: /v1/chat/completions hỗ trợ tools / tool_choice (gọi hàm kiểu OpenAI, cả khi stream) và response_format json_schema / json_object.

Vẫn có: nhìn ảnh bằng mô hình thị giác; hỏi đáp tài liệu dài (RAG, BGE-M3); /v1/embeddings; logo rồng và giao diện đỏ–trắng; Khám phá tìm mọi GGUF trên Hugging Face, 29 gợi ý đã kiểm tra; tải có hàng đợi và tải tiếp; dán ảnh và OCR tiếng Việt; máy chủ API tương thích OpenAI; tự động cập nhật.

Tải về:
- Windows 10/11: AIVN-Setup.exe
- macOS Apple Silicon: AIVN-mac-arm64.zip · macOS Intel: AIVN-mac-x64.zip
Bản cài chưa có chữ ký số: Windows SmartScreen chọn More info → Run anyway. macOS (bản chưa được Apple công chứng): mở AIVN một lần, bấm Xong, rồi vào Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Vẫn mở (macOS 13–14 cũng có thể nhấp phải → Mở). Chi tiết: docs/mac-gatekeeper.md"
fi
if gh release view "$TAG" -R "$OWNER/$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$OUT"/* -R "$OWNER/$REPO" --clobber
else
  gh release create "$TAG" "$OUT"/* -R "$OWNER/$REPO" --title "AIVN $VERSION" --notes "$NOTES" --latest
fi

step "Đăng trang web lên GitHub Pages (nhánh gh-pages)"
( cd "$SITE" && git init -q -b gh-pages && git add -A && git -c user.name="AIVN release" -c user.email="release@aivn.local" commit -qm "Trang web AIVN $VERSION" \
  && git remote add origin "https://github.com/$OWNER/$REPO.git" && gh auth setup-git && git push -q -f origin gh-pages )
# Ghi chú: nhánh gh-pages bị ghi đè hoàn toàn mỗi lần phát hành (chỉ chứa trang web).
gh api -X POST "repos/$OWNER/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 || true

echo
echo "XONG!"
echo "  Release : https://github.com/$OWNER/$REPO/releases/tag/$TAG"
echo "  Trang web: https://$OWNER.github.io/$REPO/  (GitHub Pages có thể mất 1-2 phút để hiện)"
echo "  Link tải : $BASE_URL/AIVN-Setup.exe | AIVN-mac-arm64.zip | AIVN-mac-x64.zip"
