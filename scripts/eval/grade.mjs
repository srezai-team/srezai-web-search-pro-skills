#!/usr/bin/env node
// Second step of the eval harness: human/LLM judging of a live run.
//
//   node scripts/eval/grade.mjs --run <run-dir> --judge-sheet   # CSV for a human
//   node scripts/eval/grade.mjs --run <run-dir> --apply         # read filled CSV
//
// Rubric (total 0–10): relevance of top-5 (0–6) + specificity (0–2) + usability (0–2).
// The sheet contains one row per (position, provider) of the first repeat; failed
// attempts are excluded because availability is already reported by run.mjs.
//
// Outputs: <run>/judge-sheet.csv, <run>/grades.json, refreshed summary.json/summary.md.

import { basename, dirname, join, resolve } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  csvLine,
  fmtNum,
  parseCsv,
  readJson,
  renderSummaryMd,
  writeJson,
  writeText,
} from "./lib.mjs";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(EVAL_DIR, "runs");

const RUBRIC = { relevance_max: 6, specificity_max: 2, usability_max: 2, total_max: 10 };

const SHEET_COLUMNS = [
  "position_id",
  "language",
  "intent",
  "provider",
  "repeat",
  "query",
  "top5_titles",
  "top5_urls",
  "notes",
  "score_relevance_0_6",
  "score_specificity_0_2",
  "score_usability_0_2",
  "score_total_0_10",
  "comment",
];

const HELP = `Оценка результатов прогона (рубрика 0–10).

Использование:
  node scripts/eval/grade.mjs --run <каталог-прогона> --judge-sheet
  node scripts/eval/grade.mjs --run <каталог-прогона> --apply

Шаги:
  1. --judge-sheet пишет <run>/judge-sheet.csv: по строке на пару
     (позиция, провайдер) для первого повтора. Заполни три колонки оценок.
  2. --apply читает заполненный CSV, проверяет диапазоны, пишет <run>/grades.json
     и пересобирает <run>/summary.json и <run>/summary.md с блоком качества.

Рубрика (сумма 0–10):
  relevance_0_6     релевантность топ-5: 0 — мимо, 6 — все 5 результатов по делу
  specificity_0_2   конкретика: адреса, цены, MOQ, даты вместо общих слов
  usability_0_2     пригодность: можно ли ответить/начать действие по выдаче
  score_total_0_10  сумма; можно оставить пустой — посчитается автоматически

Опции:
  --run <dir>          каталог прогона (по умолчанию — последний в scripts/eval/runs)
  --judge-sheet [csv]  путь к листу оценок (по умолчанию <run>/judge-sheet.csv)
  --apply [csv]        путь к заполненному листу (по умолчанию <run>/judge-sheet.csv)
  --allow-partial      разрешить применять неполный лист (оценена часть строк)
  -h, --help           эта справка

Коды возврата: 0 — успех; 2 — ошибка аргументов/валидации; 1 — прогон не найден.

Подробности методики — scripts/eval/README.md.`;

const fail = (message, code = 2) => {
  console.error(`Ошибка: ${message}`);
  process.exit(code);
};

function parseArgs(argv) {
  const options = { help: false, run: null, judgeSheet: null, apply: null, allowPartial: false };
  const optionalValue = (current) => {
    const next = argv[current + 1];
    if (next !== undefined && !next.startsWith("--")) {
      return { value: next, consumed: true };
    }
    return { value: null, consumed: false };
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--run": {
        const next = argv[index + 1];
        if (next === undefined) fail("флаг --run требует значения");
        options.run = next;
        index += 1;
        break;
      }
      case "--judge-sheet": {
        const { value, consumed } = optionalValue(index);
        options.judgeSheet = value ?? "";
        if (consumed) index += 1;
        break;
      }
      case "--apply": {
        const { value, consumed } = optionalValue(index);
        options.apply = value ?? "";
        if (consumed) index += 1;
        break;
      }
      case "--allow-partial":
        options.allowPartial = true;
        break;
      default:
        fail(`неизвестный аргумент: ${arg}\nЗапусти node scripts/eval/grade.mjs --help`);
    }
  }
  return options;
}

function latestRunDir() {
  if (!existsSync(RUNS_DIR)) fail(`каталог прогонов не найден: ${RUNS_DIR}`);
  const runs = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of runs) {
    const manifestPath = join(RUNS_DIR, name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      if (readJson(manifestPath).mode === "live") return join(RUNS_DIR, name);
    } catch {
      // Ignore unreadable run directories and keep looking.
    }
  }
  fail(`в ${RUNS_DIR} нет live-прогонов: сначала node scripts/eval/run.mjs --live`);
}

function resolveRunDir(given) {
  return given ? resolve(process.cwd(), given) : latestRunDir();
}

function loadRun(runDir) {
  const manifestPath = join(runDir, "manifest.json");
  const summaryPath = join(runDir, "summary.json");
  if (!existsSync(manifestPath) || !existsSync(summaryPath)) {
    fail(`в ${runDir} нет manifest.json/summary.json — это не каталог прогона`, 1);
  }
  const manifest = readJson(manifestPath);
  const summary = readJson(summaryPath);
  if (manifest.mode !== "live") {
    fail("прогон в режиме dry-run: оценивать нечего. Нужен прогон с --live", 2);
  }
  const resultsDir = join(runDir, "results");
  if (!existsSync(resultsDir)) fail(`в ${runDir} нет results/`, 1);
  const traces = readdirSync(resultsDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readJson(join(resultsDir, file)));
  return { runDir, manifest, summary, traces };
}

// One judgeable row per (position, provider) at the first repeat.
function judgeableRows(traces) {
  const rows = [];
  for (const trace of traces) {
    const attempts = trace.attempts ?? [];
    const firstRepeat = Math.min(...attempts.map((attempt) => attempt.repeat ?? 1));
    for (const attempt of attempts.filter((item) => (item.repeat ?? 1) === firstRepeat && item.ok)) {
      rows.push({ trace, attempt });
    }
  }
  return rows;
}

const joinTop = (values) => values.map((value) => value ?? "—").join(" | ");

function writeJudgeSheet(runDir, traces, sheetPath) {
  const rows = judgeableRows(traces);
  if (rows.length === 0) fail("в прогоне нет успешных попыток — оценивать нечего", 1);
  const lines = [SHEET_COLUMNS.join(",")];
  for (const { trace, attempt } of rows) {
    const position = trace.position ?? {};
    const top = (attempt.results ?? []).slice(0, 5);
    lines.push(
      csvLine([
        position.id,
        position.language,
        position.intent,
        attempt.provider,
        attempt.repeat,
        position.query,
        joinTop(top.map((result) => result.title)),
        joinTop(top.map((result) => result.url)),
        position.notes,
        "",
        "",
        "",
        "",
        "",
      ]),
    );
  }
  writeText(sheetPath, `\uFEFF${lines.join("\r\n")}\r\n`);
  return { rows: rows.length, sheetPath };
}

const score = (raw, name, max, problems, rowLabel) => {
  if (raw === "" || raw == null) {
    problems.push(`${rowLabel}: не заполнено поле ${name}`);
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    problems.push(`${rowLabel}: ${name} = «${raw}», нужно целое 0–${max}`);
    return null;
  }
  return value;
};

function applySheet(runDir, traces, sheetPath, summary, allowPartial) {
  if (!existsSync(sheetPath)) fail(`лист оценок не найден: ${sheetPath}. Сначала --judge-sheet`);
  const rows = parseCsv(readFileSync(sheetPath, "utf8"));
  if (rows.length < 2) fail("лист оценок пуст: нет строк с оценками");
  const header = rows[0].map((cell) => cell.trim());
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  for (const column of [
    "position_id",
    "provider",
    "score_relevance_0_6",
    "score_specificity_0_2",
    "score_usability_0_2",
  ]) {
    if (!(column in index)) fail(`в CSV нет обязательной колонки ${column}`);
  }

  const positionById = new Map(traces.map((trace) => [trace.position.id, trace.position]));
  const expected = new Map();
  for (const trace of traces) {
    const attempts = trace.attempts ?? [];
    const firstRepeat = Math.min(...attempts.map((attempt) => attempt.repeat ?? 1));
    for (const attempt of attempts.filter((item) => (item.repeat ?? 1) === firstRepeat && item.ok)) {
      expected.set(`${trace.position.id}\u0000${attempt.provider}`, {
        position_id: trace.position.id,
        provider: attempt.provider,
        repeat: firstRepeat,
      });
    }
  }

  const problems = [];
  const graded = new Map();
  for (const cells of rows.slice(1)) {
    const cell = (name) => (index[name] === undefined ? "" : (cells[index[name]] ?? "").trim());
    const positionId = cell("position_id");
    const provider = cell("provider");
    if (!positionId && !provider) continue;
    const key = `${positionId}\u0000${provider}`;
    const label = `${positionId}/${provider}`;
    if (!expected.has(key)) {
      problems.push(`${label}: такой успешной попытки в прогоне нет`);
      continue;
    }
    if (graded.has(key)) {
      problems.push(`${label}: строка дублируется`);
      continue;
    }
    const relevance = score(cell("score_relevance_0_6"), "relevance", RUBRIC.relevance_max, problems, label);
    const specificity = score(cell("score_specificity_0_2"), "specificity", RUBRIC.specificity_max, problems, label);
    const usability = score(cell("score_usability_0_2"), "usability", RUBRIC.usability_max, problems, label);
    const statedTotal = cell("score_total_0_10");
    const computedTotal = [relevance, specificity, usability].every((value) => value != null)
      ? relevance + specificity + usability
      : null;
    if (statedTotal !== "" && computedTotal != null) {
      const total = Number(statedTotal);
      if (!Number.isInteger(total) || total !== computedTotal) {
        problems.push(`${label}: score_total_0_10 = «${statedTotal}», а сумма компонент ${computedTotal}`);
      }
    }
    graded.set(key, {
      position_id: positionId,
      provider,
      repeat: Number(cell("repeat")) || expected.get(key).repeat,
      scores: { relevance, specificity, usability, total: computedTotal },
      comment: cell("comment"),
    });
  }

  const missing = [...expected.keys()].filter((key) => !graded.has(key));
  if (missing.length > 0 && !allowPartial) {
    problems.push(
      `не оценено строк: ${missing.length} (например ${missing.slice(0, 5).join(", ")}). Для неполного листа добавь --allow-partial`,
    );
  }
  if (problems.length > 0) {
    fail(`лист оценок не прошёл проверку:\n  - ${problems.join("\n  - ")}`);
  }

  const grades = [...graded.values()].sort(
    (left, right) =>
      left.position_id.localeCompare(right.position_id) || left.provider.localeCompare(right.provider),
  );

  const mean = (values) =>
    values.length === 0 ? null : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;

  const providers = {};
  for (const provider of new Set(grades.map((grade) => grade.provider))) {
    const mine = grades.filter((grade) => grade.provider === provider);
    const positions = mine.map((grade) => positionById.get(grade.position_id));
    const byLanguage = {};
    for (const language of new Set(positions.map((position) => position.language))) {
      const subset = mine.filter((grade) => positionById.get(grade.position_id).language === language);
      byLanguage[language] = {
        graded: subset.length,
        mean_total: mean(subset.map((grade) => grade.scores.total)),
      };
    }
    const byIntent = {};
    for (const intent of new Set(positions.map((position) => position.intent))) {
      const subset = mine.filter((grade) => positionById.get(grade.position_id).intent === intent);
      byIntent[intent] = {
        graded: subset.length,
        mean_total: mean(subset.map((grade) => grade.scores.total)),
      };
    }
    providers[provider] = {
      graded_positions: mine.length,
      expected_positions: [...expected.keys()].filter((key) => key.endsWith(`\u0000${provider}`)).length,
      mean_relevance: mean(mine.map((grade) => grade.scores.relevance)),
      mean_specificity: mean(mine.map((grade) => grade.scores.specificity)),
      mean_usability: mean(mine.map((grade) => grade.scores.usability)),
      mean_total: mean(mine.map((grade) => grade.scores.total)),
      by_language: byLanguage,
      by_intent: byIntent,
    };
  }

  const quality = {
    rubric: RUBRIC,
    sheet: basename(sheetPath),
    applied_at: new Date().toISOString(),
    graded_rows: grades.length,
    providers,
    note: "Оценка эксперта по топ-5; при одном оценщике результат субъективен, LLM-судью сверяет человек.",
  };

  const gradesFile = {
    runId: summary.runId,
    rubric: RUBRIC,
    sheet: basename(sheetPath),
    applied_at: quality.applied_at,
    grades,
    providers,
  };
  writeJson(join(runDir, "grades.json"), gradesFile);
  summary.quality = quality;
  writeJson(join(runDir, "summary.json"), summary);
  const manifest = readJson(join(runDir, "manifest.json"));
  writeText(join(runDir, "summary.md"), renderSummaryMd(manifest, summary));
  return { gradesFile, quality, missing };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (options.judgeSheet != null && options.apply != null) {
    fail("--judge-sheet и --apply несовместимы: это два разных шага");
  }
  const runDir = resolveRunDir(options.run);
  const { manifest, summary, traces } = loadRun(runDir);
  const sheetPath = resolve(
    runDir,
    options.judgeSheet || options.apply || "judge-sheet.csv",
  );

  if (options.judgeSheet != null) {
    const { rows, sheetPath: written } = writeJudgeSheet(runDir, traces, sheetPath);
    console.log(`лист оценок: ${written} (${rows} строк)`);
    console.log(`прогон: ${summary.runId}, повторов: ${manifest.config?.repeats ?? 1}`);
    console.log("");
    console.log("Заполни в CSV три колонки: score_relevance_0_6 (0–6), score_specificity_0_2 (0–2), score_usability_0_2 (0–2).");
    console.log("score_total_0_10 можно оставить пустым — посчитается как сумма.");
    console.log(`Затем: node scripts/eval/grade.mjs --run ${runDir} --apply`);
    return 0;
  }

  if (options.apply != null) {
    const { quality, missing } = applySheet(runDir, traces, sheetPath, summary, options.allowPartial);
    console.log(`оценки применены: ${join(runDir, "grades.json")}`);
    for (const [provider, providerQuality] of Object.entries(quality.providers)) {
      console.log(
        `${provider}: итог ${fmtNum(providerQuality.mean_total)}/10 (релевантность ${fmtNum(providerQuality.mean_relevance)}/6, конкретика ${fmtNum(providerQuality.mean_specificity)}/2, пригодность ${fmtNum(providerQuality.mean_usability)}/2), оценено ${providerQuality.graded_positions}/${providerQuality.expected_positions}`,
      );
    }
    if (missing.length > 0) console.log(`не оценено строк: ${missing.length} (применено с --allow-partial)`);
    console.log(`отчёт обновлён: ${join(runDir, "summary.md")}`);
    return 0;
  }

  fail("нужен режим: --judge-sheet или --apply. Смотри node scripts/eval/grade.mjs --help");
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`Ошибка: ${error?.stack ?? String(error)}`);
    process.exit(1);
  });
