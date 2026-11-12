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
run() { echo "== $*"; if ! timeout 600 node "$@" 2>&1 | grep -E "^PASS|^FAIL|errors|OK$"; then fail=1; fi; }
node tests/geom.test.js | tail -1
run tests/e2e.js "$OUT"
run tests/ui.js
run tests/features.js "$OUT"
run tests/case641.js "$OUT"
run tests/overlay.js "$OUT"
[ -n "${M02_DIR:-}" ] && run tests/m02.js "$M02_DIR" "$OUT"
[ -d dist ] && run tests/dist.js
grep -q . /dev/null
exit $fail
