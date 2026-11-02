#!/usr/bin/env bash
# 자동 재배포 — 서버의 사용자 타이머가 실행한다: demomo(momo-dev-autodeploy.timer, 2분), momo(momo-autodeploy.timer, 5분).
# 1) 클론이 따라가는 브랜치에 새 커밋이 있으면 fast-forward로 받는다(compose·nginx 설정 반영)
# 2) CI가 GHCR에 올린 이미지를 pull한다
# 3) 둘 중 하나라도 바뀌었으면 `up -d` — 바뀐 컨테이너만 다시 뜬다. 빌드는 하지 않는다
# 사용: autodeploy.sh <클론 폴더>   (demomo는 deploy/.env의 IMAGE_TAG=dev, momo는 없으면 latest)
set -euo pipefail

main() {
  local repo="${1:?클론 폴더를 인자로 주세요}"
  cd "$repo"

  # 이전 실행이 아직 끝나지 않았으면 건너뛴다
  exec 9>"/tmp/momo-autodeploy-$(id -u)-$(basename "$repo").lock"
  flock -n 9 || { echo "이전 실행 진행 중 — 건너뜀"; return 0; }

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git fetch -q origin "$branch"

  local changed=0
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$branch")" ]; then
    git merge -q --ff-only "origin/$branch"
    echo "코드 갱신: $(git log --oneline -1)"
    changed=1
  fi

  cd deploy
  local images before after
  images="$(docker compose config --images)"
  before="$(image_ids "$images")"
  # 진행 표시는 바뀐 게 없어도 매번 찍히므로 실패할 때만 남긴다
  local out
  out="$(docker compose pull -q 2>&1)" || { echo "$out"; return 1; }
  after="$(image_ids "$images")"
  if [ "$before" != "$after" ]; then
    echo "이미지 갱신: $(echo "$images" | tr '\n' ' ')"
    changed=1
  fi

  if [ "$changed" = 1 ]; then
    docker compose up -d --no-build
    docker image prune -f >/dev/null  # 태그가 빠진 옛 이미지만 지운다
    echo "재배포 완료"
  fi
}

image_ids() {
  local img
  for img in $1; do
    docker image inspect -f '{{.Id}}' "$img" 2>/dev/null || echo "none:$img"
  done
}

# 함수로 감싸 끝까지 읽은 뒤 실행한다 — git merge가 이 파일을 바꿔도 실행 중인 내용은 그대로다
main "$@"
