#!/bin/bash
# Đưa link tải bản beta (prerelease đã đăng) lên trang web AIVN (nhánh gh-pages), dưới hàng nút tải bản ổn định, đủ vi/en/zh.
# Dùng:  tools/publish-beta-site.sh OWNER TAG          vd. tools/publish-beta-site.sh khoik647-ai v0.16.0-beta.2.7
#        tools/publish-beta-site.sh OWNER --clear      gỡ khối beta khỏi trang
# Kiểm trước: release là PRERELEASE đã đăng (không nháp), KHÔNG phải Latest, không có latest*.yml; tải tài sản về khớp kích thước + SHA-256.
# Sau: đẩy gh-pages (không ghi đè lịch sử), chờ trang thật hiện khối mới. Nhớ chạy lại tools/site_beta.py trên site/index.html
# (--i18n-dir site/i18n) rồi commit, để release.sh giữ khối beta khi dựng lại trang. Không đụng khoá admin.
set -euo pipefail
OWNER="${1:?OWNER}"; TAG="${2:?TAG hoặc --clear}"; REPO=aivn; HERE="$(cd "$(dirname "$0")" && pwd)"
SITE_URL="https://$OWNER.github.io/$REPO/"
W=$(mktemp -d /tmp/beta-site-XXXX); trap 'rm -rf "$W"' EXIT
git clone -q --branch gh-pages --single-branch "https://github.com/$OWNER/$REPO.git" "$W/ghp"
if [[ "$TAG" == "--clear" ]]; then
  python3 "$HERE/site_beta.py" --html "$W/ghp/index.html" --clear; VER=""
else
  J=$(gh release view "$TAG" --repo "$OWNER/$REPO" --json isDraft,isPrerelease,tagName,assets)
  [[ $(jq -r .isDraft <<<"$J") == false && $(jq -r .isPrerelease <<<"$J") == true ]] || { echo "LỖI: $TAG phải là prerelease đã đăng (không nháp)"; exit 2; }
  LATEST=$(gh api "repos/$OWNER/$REPO/releases/latest" --jq .tag_name); [[ "$LATEST" != "$TAG" ]] || { echo "LỖI: $TAG đang là Latest"; exit 2; }
  jq -e '[.assets[].name | select(test("^latest.*\\.yml$"))] | length == 0' <<<"$J" >/dev/null || { echo "LỖI: bản beta có latest*.yml (máy bản ổn định có thể tự cập nhật lên)"; exit 2; }
  NAME=$(jq -r '[.assets[] | select(.name | test("^AIVN-Setup-.*\\.exe$"))][0].name' <<<"$J")
  SIZE=$(jq -r --arg n "$NAME" '.assets[] | select(.name==$n) | .size' <<<"$J")
  SHA=$(jq -r --arg n "$NAME" '.assets[] | select(.name==$n) | .digest' <<<"$J" | sed 's/^sha256://')
  VER="${TAG#v}"; URL="https://github.com/$OWNER/$REPO/releases/download/$TAG/$NAME"
  CODE=$(curl -sL -o "$W/a.exe" -w '%{http_code}' "$URL"); GOT=$(stat -c %s "$W/a.exe"); GSHA=$(sha256sum "$W/a.exe" | cut -d' ' -f1)
  echo "tài sản: HTTP $CODE · $GOT byte (GitHub: $SIZE) · sha256 $GSHA"
  [[ "$CODE" == 200 && "$GOT" == "$SIZE" && "$GSHA" == "$SHA" ]] || { echo "LỖI: tải tài sản không khớp"; exit 3; }
  python3 "$HERE/site_beta.py" --html "$W/ghp/index.html" --version "$VER" --url "$URL" --sha256 "$SHA" --size "$SIZE"
fi
cd "$W/ghp"
if git diff --quiet; then echo "trang không đổi"; else
  git -c user.name="AIVN release" -c user.email="release@aivn.local" commit -qam "Trang web: ${VER:+link bản beta $VER}${VER:-gỡ link bản beta}"
  gh auth setup-git >/dev/null 2>&1 || true; git push -q origin gh-pages; echo "đã đẩy gh-pages $(git rev-parse --short HEAD)"
fi
# chờ trang thật (GitHub Pages dựng lại 1–3 phút)
for i in $(seq 1 40); do
  P=$(curl -s "$SITE_URL?nocache=$RANDOM")
  if [[ -n "$VER" ]]; then grep -q "data-beta-version=\"$VER\"" <<<"$P" && grep -q "$SHA" <<<"$P" && grep -q "$URL" <<<"$P" && { echo "TRANG THẬT OK: $SITE_URL có link beta $VER + SHA-256"; exit 0; }
  else grep -q 'AIVN-BETA' <<<"$P" || { echo "TRANG THẬT OK: đã gỡ khối beta"; exit 0; }; fi
  sleep 15
done
echo "LỖI: sau 10 phút trang thật chưa đổi"; exit 4
