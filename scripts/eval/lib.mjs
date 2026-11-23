// Shared helpers for the srezai web-search eval harness.
// Zero dependencies; Node 20+.
//
// Everything here is deterministic and side-effect free except writeJson/writeText,
// so run.mjs and grade.mjs render the same summary format.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";

export const HARNESS_NAME = "srezai-eval";
export const HARNESS_VERSION = "1.0.0";

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export const writeText = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
};

export const writeJson = (path, value) => writeText(path, `${JSON.stringify(value, null, 2)}\n`);

// The run directory name is an ISO-8601 UTC instant without `:` so it works on
// every filesystem and sorts lexicographically, e.g. 2026-11-20T181325Z.
export const utcRunId = (date = new Date()) =>
  date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "");

// Nearest-rank percentile on an already sorted ascending array.
// p50 of [1,2,3,4] = 2, p95 = 4: with small samples p95 is effectively the max,
// which the README calls out as a limitation.
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function latencyStats(valuesMs) {
  if (valuesMs.length === 0) {
    return { n: 0, p50_ms: null, p95_ms: null, mean_ms: null, min_ms: null, max_ms: null };
  }
  const sorted = [...valuesMs].sort((a, b) => a - b);
  const mean = Math.round(valuesMs.reduce((sum, value) => sum + value, 0) / valuesMs.length);
  return {
    n: sorted.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    mean_ms: mean,
    min_ms: sorted[0],
    max_ms: sorted[sorted.length - 1],
  };
}

// Secrets never reach stdout or artifacts. Both the exact configured values and
// the generic `srz_live_*` shape are masked, so a server error that echoes the
// key cannot leak it either.
export function maskSecrets(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    const value = String(secret ?? "");
    if (value.length < 4) continue;
    out = out.split(value).join("***");
  }
  out = out.replace(/\bsrz_live_[A-Za-z0-9_-]+/g, "srz_live_***");
  return out;
}

// Endpoint for logs/artifacts: origin + path, no query, no credentials.
export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

export function domainOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const firstString = (...values) =>
  values.find((value) => typeof value === "string" && value.trim() !== "")?.trim() ?? null;

const firstNumber = (...values) =>
  values.find((value) => typeof value === "number" && Number.isFinite(value)) ?? null;

// Provider responses differ: srezai returns { results: [...] } with title/url/content,
// baseline adapters may return data.results, data, organic, etc. Flatten to one shape.
export function normalizeResults(payload) {
  const candidates = [
    payload?.results,
    payload?.data?.results,
    payload?.data,
    payload?.web?.results,
    payload?.web,
    payload?.organic,
    payload?.items,
  ];
  const items = Array.isArray(payload) ? payload : candidates.find(Array.isArray) ?? [];
  return items.map((item) => {
    const url = firstString(item?.url, item?.link, item?.href);
    const content = firstString(
      item?.content,
      item?.snippet,
      item?.description,
      item?.text,
      item?.excerpt,
    );
    return {
      title: firstString(item?.title, item?.name, item?.heading),
      url,
      domain: domainOf(url),
      content: content ?? "",
      published_date: firstString(item?.publishedDate, item?.published_date, item?.date),
      engine: firstString(item?.engine),
      source: firstString(item?.source),
      score: firstNumber(item?.score),
      relevance: firstNumber(item?.relevance),
    };
  });
}

export const fmtInt = (value) => (value == null ? "—" : String(value));
export const fmtNum = (value, digits = 1) =>
  value == null || Number.isNaN(Number(value)) ? "—" : Number(value).toFixed(digits);
export const fmtSec = (ms, digits = 2) => (ms == null ? "—" : `${(ms / 1000).toFixed(digits)} с`);
export const fmtPct = (value, digits = 0) => (value == null ? "—" : `${(value * 100).toFixed(digits)} %`);

export function displayPath(path, base) {
  const relativePath = relative(base, path);
  if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return relativePath.split(sep).join("/");
  }
  return path;
}

export function languageDistribution(positions) {
  const counts = {};
  for (const position of positions) counts[position.language] = (counts[position.language] ?? 0) + 1;
  return counts;
}

export function intentDistribution(positions) {
  const counts = {};
  for (const position of positions) counts[position.intent] = (counts[position.intent] ?? 0) + 1;
  return counts;
}

export const distributionText = (counts) =>
  Object.keys(counts)
    .sort()
    .map((key) => `${key} ${counts[key]}`)
    .join(", ");

// --- CSV -------------------------------------------------------------------

export function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values) {
  return values.map(csvEscape).join(",");
}

// Minimal RFC-4180 reader: quoted fields, escaped quotes, CRLF, UTF-8 BOM.
export function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

// --- summary.md -------------------------------------------------------------

const providerRows = (summary, key) =>
  Object.entries(summary.providers ?? {}).flatMap(([name, metrics]) =>
    Object.entries(metrics[key] ?? {}).map(([group, groupMetrics]) => ({
      name,
      group,
      metrics: groupMetrics,
    })),
  );

function metricsTable(summary) {
  const lines = [
    "| Провайдер | Запросов | Успешно | Фейлов | Таймаутов | Результатов (ср.) | Доменов (ср.) | Сниппет (ср. симв.) | p50 | p95 | Кредитов |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const [name, metrics] of Object.entries(summary.providers ?? {})) {
    const results = metrics.results ?? {};
    lines.push(
      `| ${name} | ${fmtInt(metrics.attempts)} | ${fmtInt(metrics.ok)} | ${fmtInt(metrics.failed)} | ${fmtInt(metrics.timeouts)} | ${fmtNum(results.avg_per_query)} | ${fmtNum(results.avg_unique_domains)} | ${fmtNum(results.avg_snippet_chars)} | ${fmtSec(metrics.latency?.p50_ms)} | ${fmtSec(metrics.latency?.p95_ms)} | ${fmtInt(metrics.cost?.credits)} |`,
    );
  }
  return lines;
}

function groupTable(summary, key, title) {
  const rows = providerRows(summary, key);
  if (rows.length === 0) return [];
  const lines = [
    `### ${title}`,
    "",
    "| Провайдер | Срез | Запросов | Успешно | Результатов (ср.) | Доменов (ср.) | p50 | p95 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const { name, group, metrics } of rows) {
    lines.push(
      `| ${name} | ${group} | ${fmtInt(metrics.attempts)} | ${fmtInt(metrics.ok)} | ${fmtNum(metrics.results?.avg_per_query)} | ${fmtNum(metrics.results?.avg_unique_domains)} | ${fmtSec(metrics.latency?.p50_ms)} | ${fmtSec(metrics.latency?.p95_ms)} |`,
    );
  }
  return lines;
}

function qualitySection(summary) {
  const quality = summary.quality;
  if (!quality) {
    return [
      "## Оценка судьи",
      "",
      "Ещё не проводилась: метрики качества требуют человека или отдельного judge-шага.",
      "",
      "```bash",
      "node scripts/eval/grade.mjs --run <каталог прогона> --judge-sheet",
      "# заполнить CSV, затем:",
      "node scripts/eval/grade.mjs --run <каталог прогона> --apply",
      "```",
      "",
    ];
  }
  const rubric = quality.rubric ?? {};
  const lines = [
    "## Оценка судьи (0–10)",
    "",
    `Рубрика: релевантность топ-5 0–${rubric.relevance_max ?? 6} + конкретика 0–${rubric.specificity_max ?? 2} + пригодность 0–${rubric.usability_max ?? 2}. Оценено строк: ${quality.graded_rows ?? "—"}.`,
    "",
    "| Провайдер | Оценено | Релевантность | Конкретика | Пригодность | Итог |",
    "|---|---|---|---|---|---|",
  ];
  for (const [name, provider] of Object.entries(quality.providers ?? {})) {
    lines.push(
      `| ${name} | ${fmtInt(provider.graded_positions)} | ${fmtNum(provider.mean_relevance)} / ${rubric.relevance_max ?? 6} | ${fmtNum(provider.mean_specificity)} / ${rubric.specificity_max ?? 2} | ${fmtNum(provider.mean_usability)} / ${rubric.usability_max ?? 2} | **${fmtNum(provider.mean_total)}** |`,
    );
  }
  lines.push("", "### Качество × латентность × стоимость", "");
  lines.push("| Провайдер | Качество (ср.) | p50 | p95 | Успешных / всего | Кредитов |");
  lines.push("|---|---|---|---|---|---|");
  for (const [name, provider] of Object.entries(quality.providers ?? {})) {
    const metrics = summary.providers?.[name] ?? {};
    lines.push(
      `| ${name} | ${fmtNum(provider.mean_total)} | ${fmtSec(metrics.latency?.p50_ms)} | ${fmtSec(metrics.latency?.p95_ms)} | ${fmtInt(metrics.ok)} / ${fmtInt(metrics.attempts)} | ${fmtInt(metrics.cost?.credits)} |`,
    );
  }
  lines.push("");
  return lines;
}

function authLabel(provider) {
  if (provider.mode === "trial") return "пробный режим (без ключа)";
  if (provider.mode === "keyless") return "не настроен";
  return provider.auth_configured ? "настроен" : "не настроен";
}

export function renderSummaryMd(manifest, summary) {
  const config = manifest.config ?? {};
  const lines = [];
  const isDryRun = manifest.mode === "dry-run";
  const isTrial = manifest.mode === "live-trial";

  lines.push(`# Прогон eval — ${manifest.runId}`, "");
  lines.push(
    isDryRun
      ? "**Режим: dry-run.** Запросы не отправлялись, ключ и сеть не использовались. Ниже — план прогона, а не измерения."
      : isTrial
        ? "**Режим: live, пробный (без ключа).** Реальные анонимные вызовы srezai по суточному лимиту на IP. Сырые ответы лежат в `results/`. Это дымовой прогон интеграции, а не методическая оценка: один повтор, ограниченный датасет, лимит запросов."
        : "**Режим: live.** Реальные вызовы провайдеров; сырые ответы лежат в `results/`.",
    "",
  );
  lines.push(`- **Дата (UTC):** ${manifest.createdAt}`);
  lines.push(`- **Harness:** ${manifest.harness} v${manifest.harnessVersion} · Node ${manifest.nodeVersion}`);
  lines.push(
    `- **Датасет:** \`${manifest.dataset.path}\` v${manifest.dataset.version} — ${manifest.dataset.positions} позиций (${manifest.dataset.by_language_text})`,
  );
  lines.push(
    `- **Повторов на позицию:** ${config.repeats ?? 1}${(config.repeats ?? 1) < 3 ? " — меньше методического минимума ≥3, выводы предварительные" : ""}`,
    "",
  );

  lines.push("## Конфигурация", "", "| Параметр | Значение |", "|---|---|");
  lines.push(`| Позиций | ${fmtInt(config.positions)} |`);
  lines.push(`| Повторов | ${fmtInt(config.repeats)} |`);
  lines.push(`| num | ${fmtInt(config.num)} |`);
  lines.push(`| depth | ${config.depth} |`);
  lines.push(`| language | ${config.language} (срез отчётности — язык позиции) |`);
  lines.push(`| excerpts / chunksPerSource | ${config.excerpts ? "да" : "нет"} / ${fmtInt(config.chunksPerSource)} |`);
  lines.push(
    `| timeout / retries / concurrency | ${fmtInt(config.timeoutMs)} мс / ${fmtInt(config.retries)} / ${fmtInt(config.concurrency)} |`,
  );
  lines.push(`| Предохранитель по кредитам | ${fmtInt(config.maxCredits)} |`, "");

  lines.push("## Провайдеры", "", "| Провайдер | Endpoint | Ключ |", "|---|---|---|");
  for (const provider of manifest.providers ?? []) {
    lines.push(
      `| ${provider.name} | \`${provider.endpoint}\` | ${authLabel(provider)} |`,
    );
  }
  lines.push("");

  if (isDryRun) {
    lines.push("## План прогона", "");
    lines.push("| Провайдер | Вызовов | Кредитов (оценка) |", "|---|---|---|");
    for (const provider of manifest.providers ?? []) {
      const planned = (summary.planned ?? {})[provider.name] ?? {};
      lines.push(`| ${provider.name} | ${fmtInt(planned.calls)} | ${fmtInt(planned.credits)} |`);
    }
    lines.push(
      "",
      "> В dry-run ничего не измеряется: нет латентности, стоимости и релевантности. Запускай с `--live`, когда задан `SREZAI_API_KEY`.",
      "",
    );
  } else {
    lines.push("## Метрики по провайдерам", "", ...metricsTable(summary), "");
    lines.push(...groupTable(summary, "by_language", "По языкам запросов"), "");
    lines.push(...groupTable(summary, "by_intent", "По интентам"), "");

    lines.push("## Фейлы и таймауты", "");
    if ((summary.failures ?? []).length === 0) {
      lines.push("Инфраструктурных фейлов нет.", "");
    } else {
      lines.push("| Позиция | Провайдер | Повтор | Тип | HTTP | Сообщение |", "|---|---|---|---|---|---|");
      for (const failure of summary.failures) {
        const message = String(failure.message ?? "").replace(/\|/g, "\\|").slice(0, 140);
        lines.push(
          `| ${failure.position_id} | ${failure.provider} | ${fmtInt(failure.repeat)} | ${failure.kind} | ${fmtInt(failure.status)} | ${message || "—"} |`,
        );
      }
      lines.push("");
    }

    if ((summary.pairs ?? []).length > 0) {
      lines.push("## Пересечение выдачи", "");
      lines.push("| A | B | Общих доменов (ср.) | Jaccard (ср.) |", "|---|---|---|---|");
      for (const pair of summary.pairs) {
        lines.push(
          `| ${pair.a} | ${pair.b} | ${fmtNum(pair.shared_domains_mean)} | ${fmtNum(pair.jaccard_mean, 3)} |`,
        );
      }
      lines.push("");
    }

    lines.push(...qualitySection(summary));
  }

  lines.push("## Ограничения этого прогона", "");
  lines.push(
    "- Это не универсальный бенчмарк: датасет — 25 позиций по теме «закупки/фабрики/рынки Китая», без holdout.",
    "- Судья — экспертная оценка топ-5; при одном оценщике результат субъективен, при LLM-судье нужна ручная сверка ≥20 % строк.",
    "- p95 на десятках наблюдений — это фактически максимум; для устойчивого p95 нужно ≥100 запросов.",
    "- Провайдеры сравниваются в своих лучших настройках, а не «за одинаковые деньги»; смотри конфигурацию выше.",
    "- Латентность зависит от сети и нагрузки в момент прогона; сравнивать прогоны можно только рядом по времени.",
    "",
    "Полная методика и раздел «Ограничения метода» — [README.md](README.md).",
    "",
    "## Артефакты", "",
    "```",
    `${manifest.runId}/manifest.json    конфигурация, провайдеры, датасет — что именно запускали`,
    `${manifest.runId}/results/*.json   сырые ответы и тайминги по позициям`,
    `${manifest.runId}/summary.json    метрики в машинном виде`,
    `${manifest.runId}/summary.md      этот отчёт`,
    `${manifest.runId}/judge-sheet.csv лист оценок (после grade.mjs --judge-sheet)`,
    `${manifest.runId}/grades.json     оценки судьи (после grade.mjs --apply)`,
    "```",
    "",
    `<!-- generated by ${HARNESS_NAME} v${HARNESS_VERSION} -->`,
    "",
  );
  return lines.join("\n");
}
