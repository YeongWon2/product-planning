#!/usr/bin/env bash
# release.yml의 배포 단계. 워크플로와 테스트(test/release-e2e.test.mjs)가 같은 스크립트를 돌린다.
# 입력: TAG, VERSION, NOTES — `node tools/release.mjs apply --github-output`이 계산한 값.
# 현재 디렉터리는 apply가 plugin.json·CHANGELOG.md를 고쳐 둔 저장소다.
set -euo pipefail
: "${TAG:?TAG가 필요합니다}" "${VERSION:?VERSION이 필요합니다}" "${NOTES:?NOTES가 필요합니다}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add .claude-plugin/plugin.json CHANGELOG.md
git commit -m "chore(release): product-planning v${VERSION}"
git tag -a "$TAG" -m "product-planning v${VERSION}"
# --atomic: 그사이 main이 앞서가 거절되면 태그도 함께 올리지 않는다. 태그만 남으면 다음 배포가 같은 태그로 계속 실패한다.
git push --atomic origin HEAD:main "$TAG"

notes_file="$(mktemp)"
printf '%s\n' "$NOTES" > "$notes_file"
gh release create "$TAG" --title "product-planning v${VERSION}" --notes-file "$notes_file"
