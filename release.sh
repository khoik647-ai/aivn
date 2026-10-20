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

VERSION="$(node -p "require('./package.json').version")"
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
  node --test test/

  step "Build Windows (NSIS) → dist/AIVN-Setup-$VERSION.exe + latest.yml + blockmap"
  rm -rf dist
  npx electron-builder --win nsis --x64 --publish never

  step "Build macOS arm64 + x64 (.app)"
  MAC_TARGET=dir node build/mac-build.cjs

  step "Ký ad-hoc bản macOS bằng rcodesign và nén .zip (giữ symlink)"
  for pair in "mac-arm64:arm64" "mac:x64"; do
    dir="${pair%%:*}"; arch="${pair##*:}"
    app="dist/$dir/AIVN.app"
    [[ -d "$app" ]] || die "không thấy $app"
    "$RCODESIGN" sign "$app"
    (cd "dist/$dir" && rm -f "../AIVN-$VERSION-$arch-mac.zip" && zip -qry "../AIVN-$VERSION-$arch-mac.zip" AIVN.app)
  done
  node build/gen-latest-mac.cjs "$VERSION" "dist/AIVN-$VERSION-arm64-mac.zip" "dist/AIVN-$VERSION-x64-mac.zip"
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
[[ -f site/preview-desktop.png ]] && cp site/preview-desktop.png "$SITE/"
touch "$SITE/.nojekyll"
grep -q "$BASE_URL/AIVN-Setup.exe" "$SITE/index.html" || die "không thay được link tải Windows trong trang web"
ls -la "$OUT" "$SITE"

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
  echo "Repo đã tồn tại, không đẩy lại mã nguồn."
fi

step "Tạo GitHub Release $TAG"
NOTES="AIVN $VERSION · Phát triển bởi NGUYỄN NGỌC KHÔI SINH VIÊN VLU

- Hỏi đáp với tài liệu: PDF có lớp chữ, DOCX, TXT/MD/CSV/JSON, mã nguồn (tối đa 20 MB)
- Tự động cập nhật (Windows cài tại chỗ; macOS báo có bản mới)

Tải về:
- Windows 10/11: AIVN-Setup.exe
- macOS Apple Silicon: AIVN-mac-arm64.zip · macOS Intel: AIVN-mac-x64.zip
Bản cài chưa có chữ ký số: Windows SmartScreen chọn More info → Run anyway; macOS nhấp phải → Mở."
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
