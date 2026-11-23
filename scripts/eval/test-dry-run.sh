#!/usr/bin/env bash
# Self-check for the eval harness: dry-run needs no key, writes artifacts, exits 0.
# Also checks --help, the missing-key guard, the judge-sheet help and .gitignore.
# Ничего не оставляет после себя: временный прогон удаляется через trap.
#
#   bash scripts/eval/test-dry-run.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
eval_dir="$root/scripts/eval"
run_id="selftest-$$"
out_dir="$eval_dir/runs/$run_id"
log_file="${TMPDIR:-/tmp}/srezai-eval-selftest-$$.log"
trap 'rm -rf "$out_dir" "$eval_dir/runs/$run_id-live" "$log_file"' EXIT

fail() { printf '✗ %s\n' "$1"; exit 1; }
ok() { printf '✓ %s\n' "$1"; }

# 1. --help работает без ключа и без сети.
if ! env -u SREZAI_API_KEY -u BASELINE_KEY node "$eval_dir/run.mjs" --help >"$log_file" 2>&1; then
  cat "$log_file"
  fail "run.mjs --help завершился ненулевым кодом"
fi
grep -q "dry-run" "$log_file" || fail "в --help нет упоминания dry-run"
ok "run.mjs --help работает без ключа"

if ! node "$eval_dir/grade.mjs" --help >"$log_file" 2>&1; then
  cat "$log_file"
  fail "grade.mjs --help завершился ненулевым кодом"
fi
grep -q -- "--judge-sheet" "$log_file" || fail "в справке grade.mjs нет --judge-sheet"
ok "grade.mjs --help работает без ключа"

# 2. dry-run: код 0, ключ не нужен, сеть не трогается.
if ! env -u SREZAI_API_KEY -u BASELINE_URL -u BASELINE_KEY \
  node "$eval_dir/run.mjs" --out "$eval_dir/runs" --run-id "$run_id" >"$log_file" 2>&1; then
  cat "$log_file"
  fail "dry-run завершился ненулевым кодом"
fi
ok "dry-run завершился кодом 0 без ключа"

# 3. Артефакты на месте.
for artifact in manifest.json summary.json summary.md; do
  [ -s "$out_dir/$artifact" ] || fail "dry-run не создал $artifact"
done
[ -d "$out_dir/results" ] || fail "dry-run не создал results/"
ok "manifest.json, summary.json, summary.md и results/ на месте"

# 4. В манифесте dry-run, сеть не выполнялась, ключ не записывался.
node - "$out_dir" <<'NODE'
const { readFileSync } = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
if (manifest.mode !== "dry-run") throw new Error("manifest.mode должен быть dry-run");
if (manifest.network !== "skipped") throw new Error("manifest.network должен быть skipped");
const summary = JSON.parse(readFileSync(path.join(dir, "summary.json"), "utf8"));
if (summary.mode !== "dry-run") throw new Error("summary.mode должен быть dry-run");
const markdown = readFileSync(path.join(dir, "summary.md"), "utf8");
if (!/dry-run/i.test(markdown)) throw new Error("в summary.md нет пометки dry-run");
console.log("манифест и отчёт корректно помечены dry-run");
NODE
ok "артефакты помечены dry-run, сеть не выполнялась"

# 5. В артефактах нет значения ключа и вообще секретов.
if grep -rIqE 'srz_(live|test)_[A-Za-z0-9_-]+' "$out_dir"; then
  fail "в артефактах найден похожий на ключ секрет"
fi
if grep -rIq 'Bearer [A-Za-z0-9]' "$out_dir"; then
  fail "в артефактах найден Bearer-токен"
fi
ok "в артефактах нет ключей и токенов"

# 6. --live без ключа — понятная ошибка и код 2 (сеть не трогается).
set +e
env -u SREZAI_API_KEY node "$eval_dir/run.mjs" --live --out "$eval_dir/runs" --run-id "$run_id-live" >"$log_file" 2>&1
live_code=$?
set -e
[ "$live_code" -eq 2 ] || fail "--live без ключа: ожидался код 2, получен $live_code"
grep -q "SREZAI_API_KEY" "$log_file" || fail "--live без ключа: сообщение не называет SREZAI_API_KEY"
ok "--live без ключа завершается кодом 2 и называет переменную, не значение"

# 7. runs/ исключён из git.
if git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$root" check-ignore -q "scripts/eval/runs/probe" || fail "scripts/eval/runs/ не игнорируется git"
  ok "scripts/eval/runs/ исключён из git"
else
  ok "git не найден — проверка .gitignore пропущена"
fi

# 8. Ноль внешних зависимостей: только node: и относительные импорты.
imports="$(grep -rhoE 'from "[^"]+"' "$eval_dir"/*.mjs | sed 's/^from "//; s/"$//' | sort -u)"
while IFS= read -r specifier; do
  case "$specifier" in
    node:*|./*) ;;
    *) fail "внешняя зависимость: $specifier" ;;
  esac
done <<<"$imports"
ok "импортируются только node:* и относительные модули"

printf '\ndry-run harness готов\n'
