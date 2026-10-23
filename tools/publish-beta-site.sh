#!/bin/bash
# Đưa link tải bản beta (prerelease đã đăng) lên trang web AIVN (nhánh gh-pages), dưới hàng nút tải bản ổn định, đủ vi/en/zh.
# Dùng:  tools/publish-beta-site.sh OWNER TAG          vd. tools/publish-beta-site.sh khoik647-ai v0.16.0-beta.2.8
#        tools/publish-beta-site.sh OWNER --clear      gỡ khối beta khỏi trang
# Kiểm trước: release là PRERELEASE đã đăng (không nháp), KHÔNG phải Latest, không có latest*.yml; tải tài sản về khớp kích thước + SHA-256.
# B174: khối beta theo hệ điều hành, dựng từ danh sách tài sản thật: Mac thấy tệp Mac của bản beta (nếu có đủ arm64 + x64), nếu không thì dòng
# “chỉ có cho Windows” + tệp Mac của bản ổn định Latest; không máy nào ngoài Windows được mời tải .exe.
# Trước khi đặt khối beta: tools/site_fixes.py (sửa chung, dung lượng thật của bản ổn định). Sau: đẩy gh-pages (không ghi đè lịch sử), chờ trang thật hiện khối mới. Nhớ chạy lại tools/site_beta.py trên site/index.html
# (--i18n-dir site/i18n) rồi commit, để release.sh giữ khối beta khi dựng lại trang. Không đụng khoá admin.
# INCLUDE_PRERELEASE=true trong site/index.html: nút tự động đã là một nguồn tải (kể cả bản thử nghiệm).
# Vẫn chạy --clear (gỡ khối beta cũ trên gh-pages) rồi thoát — không chèn khối mới.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE_HTML="${SITE_HTML:-$HERE/../site/index.html}"
CLEAR_ONLY=0
if [[ -f "$SITE_HTML" ]] && grep -qE 'var INCLUDE_PRERELEASE=true;' "$SITE_HTML"; then
  CLEAR_ONLY=1
fi
OWNER="${1:?OWNER}"; TAG="${2:?TAG hoặc --clear}"; REPO=aivn
if [[ "$CLEAR_ONLY" == 1 ]]; then
  echo "BỎ QUA chèn beta: ${SITE_HTML} có INCLUDE_PRERELEASE=true. Nút tải tự động là nguồn tải duy nhất. Chạy --clear để gỡ khối beta cũ, không chèn khối mới."
  TAG=--clear
fi
SITE_URL="https://$OWNER.github.io/$REPO/"
W=$(mktemp -d /tmp/beta-site-XXXX); trap 'rm -rf "$W"' EXIT
git clone -q --branch gh-pages --single-branch "https://github.com/$OWNER/$REPO.git" "$W/ghp"
# B143–B150, B162: sửa chung trang (nhận hệ điều hành, dung lượng THẬT của bản ổn định Latest cho mọi nút + title, chân trang en/zh, không tràn 320 px và 280 px)
LTAG=$(gh api "repos/$OWNER/$REPO/releases/latest" --jq .tag_name)
LJ=$(gh release view "$LTAG" --repo "$OWNER/$REPO" --json tagName,assets)
sz() { jq -r --arg n "$1" '[.assets[] | select(.name==$n) | .size][0]' <<<"$LJ"; }
SW=$(sz AIVN-Setup.exe); SA=$(sz AIVN-mac-arm64.zip); SX=$(sz AIVN-mac-x64.zip)
[[ "$SW" =~ ^[0-9]+$ && "$SA" =~ ^[0-9]+$ && "$SX" =~ ^[0-9]+$ ]] || { echo "LỖI: không đọc được dung lượng tài sản của bản ổn định Latest"; exit 2; }
# B174: bản ổn định (Latest) cho máy Mac khi bản beta chưa có tệp Mac — tên có số phiên bản, từ danh sách tài sản thật
jq '{version: (.tagName | ltrimstr("v")), assets}' <<<"$LJ" > "$W/stable.json"
python3 "$HERE/site_fixes.py" --html "$W/ghp/index.html" --sizes "$SW,$SA,$SX"
if [[ "$TAG" == "--clear" ]]; then
  python3 "$HERE/site_beta.py" --html "$W/ghp/index.html" --clear; VER=""
else
  J=$(gh release view "$TAG" --repo "$OWNER/$REPO" --json isDraft,isPrerelease,tagName,assets)
  [[ $(jq -r .isDraft <<<"$J") == false && $(jq -r .isPrerelease <<<"$J") == true ]] || { echo "LỖI: $TAG phải là prerelease đã đăng (không nháp)"; exit 2; }
  LATEST=$(gh api "repos/$OWNER/$REPO/releases/latest" --jq .tag_name); [[ "$LATEST" != "$TAG" ]] || { echo "LỖI: $TAG đang là Latest"; exit 2; }
  jq -e '[.assets[].name | select(test("^latest.*\\.yml$"))] | length == 0' <<<"$J" >/dev/null || { echo "LỖI: bản beta có latest*.yml (máy bản ổn định có thể tự cập nhật lên)"; exit 2; }
  NAME=$(jq -r '[.assets[] | select(.name | test("^AIVN-Setup-.*\\.exe$"))][0].name' <<<"$J")
  SHA=$(jq -r --arg n "$NAME" '.assets[] | select(.name==$n) | .digest' <<<"$J" | sed 's/^sha256://')
  VER="${TAG#v}"; URL="https://github.com/$OWNER/$REPO/releases/download/$TAG/$NAME"
  # B174: khối beta dựng từ danh sách tài sản THẬT (Windows .exe, Mac arm64/x64 .zip nếu có). Mỗi tệp được tải về, so kích thước + SHA-256 với GitHub.
  jq '{assets}' <<<"$J" > "$W/beta.json"
  MACZ=$(jq -r --arg v "$VER" '[.assets[].name | select(. == "AIVN-\($v)-arm64-mac.zip" or . == "AIVN-\($v)-x64-mac.zip")] | length' <<<"$J")
  [[ "$MACZ" == 0 || "$MACZ" == 2 ]] || { echo "LỖI: bản beta chỉ có một trong hai tệp Mac (arm64/x64)"; exit 2; }
  CHECK=("$NAME"); [[ "$MACZ" == 2 ]] && CHECK+=("AIVN-$VER-arm64-mac.zip" "AIVN-$VER-x64-mac.zip")
  for N in "${CHECK[@]}"; do
    S=$(jq -r --arg n "$N" '.assets[] | select(.name==$n) | .size' <<<"$J"); D=$(jq -r --arg n "$N" '.assets[] | select(.name==$n) | .digest' <<<"$J" | sed 's/^sha256://')
    CODE=$(curl -sL -o "$W/asset" -w '%{http_code}' "https://github.com/$OWNER/$REPO/releases/download/$TAG/$N"); GOT=$(stat -c %s "$W/asset"); GSHA=$(sha256sum "$W/asset" | cut -d' ' -f1); rm -f "$W/asset"
    echo "tài sản $N: HTTP $CODE · $GOT byte (GitHub: $S) · sha256 $GSHA"
    [[ "$CODE" == 200 && "$GOT" == "$S" && "$GSHA" == "$D" ]] || { echo "LỖI: tải tài sản $N không khớp"; exit 3; }
  done
  [[ "$MACZ" == 2 ]] && MACURL="https://github.com/$OWNER/$REPO/releases/download/$TAG/AIVN-$VER-arm64-mac.zip" || MACURL="releases/download/$LTAG/AIVN-${LTAG#v}-arm64-mac.zip"
  python3 "$HERE/site_beta.py" --html "$W/ghp/index.html" --version "$VER" --assets "$W/beta.json" --stable "$W/stable.json"
fi
cd "$W/ghp"
if git diff --quiet; then echo "trang không đổi"; else
  git -c user.name="AIVN release" -c user.email="release@aivn.local" commit -qam "Trang web: $([[ -n "$VER" ]] && echo "link bản beta $VER" || echo "gỡ link bản beta")"
  gh auth setup-git >/dev/null 2>&1 || true; git push -q origin gh-pages; echo "đã đẩy gh-pages $(git rev-parse --short HEAD)"
fi
# chờ trang thật (GitHub Pages dựng lại 1–3 phút)
for i in $(seq 1 40); do
  P=$(curl -s "$SITE_URL?nocache=$RANDOM")
  if [[ -n "$VER" ]]; then grep -q "data-beta-version=\"$VER\"" <<<"$P" && grep -q "$SHA" <<<"$P" && grep -q "$URL" <<<"$P" && grep -q 'beta-mnote' <<<"$P" && grep -q 'AIVN-BETA-HERO' <<<"$P" && grep -q 'AIVN-BETA-BADGE' <<<"$P" && grep -q 'beta-gk' <<<"$P" && grep -q "$MACURL" <<<"$P" && grep -q 'AIVN-FIX-320' <<<"$P" && grep -q 'AIVN-FIX-280' <<<"$P" && grep -q 'Hoặc thử bản thử nghiệm' <<<"$P" && { echo "TRANG THẬT OK: $SITE_URL có link beta $VER + SHA-256"; break; }
  else grep -q 'AIVN-BETA' <<<"$P" || { echo "TRANG THẬT OK: đã gỡ khối beta"; break; }; fi
  [[ $i == 40 ]] && { echo "LỖI: sau 10 phút trang thật chưa đổi"; exit 4; }
  sleep 15
done
# kiểm bố cục trang thật ở 280/320/375/1280 px × vi/en/zh (cần Python có playwright + Chrome; đặt SITE_CHECK_PY, vd. /tmp/pwv/bin/python)
if [[ -n "${SITE_CHECK_PY:-}" ]]; then "$SITE_CHECK_PY" "$HERE/site_check.py" "$SITE_URL?nocache=$RANDOM" "$W/check.json" || { echo "LỖI: trang thật chưa đạt kiểm bố cục"; exit 5; }
else echo "(bỏ qua kiểm bố cục: chưa đặt SITE_CHECK_PY)"; fi
