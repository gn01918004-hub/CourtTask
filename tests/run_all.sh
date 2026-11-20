#!/usr/bin/env bash
# 一次跑完所有測試。
#   bash tests/run_all.sh                      # 用 Playwright 內建的 Chromium
#   CHROME_PATH=/path/to/chromium147 bash tests/run_all.sh   # 用與內網相同的 Chrome 147
#   M02_DIR=/path/to/m02範例 bash tests/run_all.sh          # 另外測 .m02（含案件資料，不放在儲存庫）
#
# 取得 Chromium 147（Linux）：
#   npm install @sparticuz/chromium@147.0.2
#   node -e "import('@sparticuz/chromium').then(async m => console.log(await m.default.executablePath()))"
#   → 印出的路徑即可當 CHROME_PATH
set -u
cd "$(dirname "$0")/.."
OUT="${OUT:-tests/out}"
mkdir -p "$OUT"
fail=0
run() {
  echo "== $*"
  local out; out="$(timeout 600 node "$@" 2>&1)"; local rc=$?
  echo "$out" | grep -E "^PASS|^FAIL|errors|OK$"
  # 任何一項 FAIL、程式結束碼不是 0、或完全沒有輸出，都算失敗
  if [ $rc -ne 0 ] || echo "$out" | grep -q "^FAIL" || ! echo "$out" | grep -qE "^PASS|OK$|errors: none"; then fail=1; echo "!! 失敗：$*"; fi
}
node tests/geom.test.js | tail -1
run tests/e2e.js "$OUT"
run tests/ui.js
run tests/features.js "$OUT"
run tests/case641.js "$OUT"
run tests/overlay.js "$OUT"
run tests/fixes.js
[ -n "${M02_DIR:-}" ] && run tests/m02.js "$M02_DIR" "$OUT"
run tests/dist.js   # 會先重新打包 dist/CourtTask.html
grep -q . /dev/null
exit $fail
