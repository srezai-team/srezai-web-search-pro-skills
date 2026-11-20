#!/usr/bin/env node
// Web-search evaluation harness for srezai (and an optional baseline provider).
//
// Default mode is dry-run: print the plan and write manifest/summary artifacts,
// no network calls, no key required. --live performs real calls and needs
// SREZAI_API_KEY (and BASELINE_URL/BASELINE_KEY for the optional second provider).
//
// Artifacts: runs/<UTC-run-id>/{manifest.json,results/<id>.json,summary.json,summary.md}
//
//   node scripts/eval/run.mjs                 # dry-run
//   node scripts/eval/run.mjs --live          # real calls
//   node scripts/eval/run.mjs --help          # offline help, no key needed
//
// Exit codes: 0 success/dry-run, 1 live run with infrastructure failures,
// 2 usage/config/dataset error (including a missing key for --live).

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HARNESS_NAME,
  HARNESS_VERSION,
  displayPath,
  distributionText,
  domainOf,
  languageDistribution,
  intentDistribution,
  latencyStats,
  maskSecrets,
  normalizeResults,
  readJson,
  renderSummaryMd,
  safeUrl,
  utcRunId,
  writeJson,
  writeText,
} from "./lib.mjs";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(EVAL_DIR, "..", "..");

const HELP = `Оценка качества веб-поиска srezai: прогон датасета, артефакты, метрики.

Использование:
  node scripts/eval/run.mjs [опции]

Режимы:
  (по умолчанию)  dry-run: печатает план и пишет артефакты, сеть не трогает
  --live          реальные вызовы провайдеров; нужен SREZAI_API_KEY
  --trial         реальные вызовы без ключа: анонимный пробный режим srezai
                  (лимит 25 запросов в сутки на IP). Только --repeats 1:
                  это дымовой прогон интеграции, не методическая оценка

Опции:
  --positions <file>       датасет (по умолчанию scripts/eval/positions.json)
  --limit <n>              взять первые n позиций (для пробного режима и дымовых прогонов)
  --out <dir>              каталог прогонов (по умолчанию scripts/eval/runs)
  --run-id <id>            имя каталога прогона (по умолчанию UTC-таймстемп)
  --providers <list>       srezai,baseline (по умолчанию srezai; baseline — если задан BASELINE_URL)
  --repeats <n>            повторов на позицию, 1–10 (по умолчанию 1; методика требует ≥3)
  --num <n>                результатов на запрос, 1–30 (по умолчанию 10)
  --depth <mode>           flash | auto (по умолчанию auto)
  --language <lang>        auto | ru | en (по умолчанию auto; zh сервер не принимает)
  --excerpts               запросить excerpts: true
  --chunks <n>             chunksPerSource, 0–5 (по умолчанию 0)
  --category <name>        general | news | it | science | marketplace
  --include-domains <csv>  до 10 доменов
  --exclude-domains <csv>  до 10 доменов
  --time-range <value>     all | day | week | month | year
  --published-after <date> YYYY-MM-DD
  --published-before <date> YYYY-MM-DD
  --timeout-ms <ms>        таймаут одного HTTP-вызова (по умолчанию 120000)
  --retries <n>            повторов при ошибке, 0–5 (по умолчанию 0)
  --concurrency <n>        параллельных позиций, 1–8 (по умолчанию 1)
  --max-credits <n>        предохранитель: не стартовать, если план дороже (по умолчанию 100)
  -h, --help               эта справка (работает без сети и без ключа)

Переменные окружения (значения никогда не печатаются и не пишутся в артефакты):
  SREZAI_API_KEY           ключ srezai; без него --live не запускается
  SREZAI_BASE_URL          база REST (по умолчанию https://srezai.ru)
  BASELINE_URL             endpoint второго провайдера (опционально)
  BASELINE_KEY             его ключ; уходит в заголовок Authorization: Bearer
  BASELINE_NAME            имя провайдера в отчёте (по умолчанию baseline)
  BASELINE_BODY            JSON-шаблон тела запроса; подставляются JSON-значения
                           {{query}}, {{num}}, {{depth}}, {{language}} (без кавычек в шаблоне)

Коды возврата:
  0  успех (dry-run всегда; live — без инфраструктурных фейлов)
  1  live-прогон с инфраструктурными фейлами (таймаут, сеть, HTTP 5xx/429, битый ответ)
  2  ошибка использования: аргументы, датасет, отсутствие ключа

Примеры:
  node scripts/eval/run.mjs
  node scripts/eval/run.mjs --live --repeats 3
  node scripts/eval/grade.mjs --run scripts/eval/runs/<UTC> --judge-sheet

Подробности и ограничения метода — scripts/eval/README.md.`;

const fail = (message, code = 2) => {
  console.error(`Ошибка: ${message}`);
  process.exit(code);
};

const parseIntFlag = (name, value, min, max) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`--${name}: нужно целое от ${min} до ${max}, получено «${value}»`);
  }
  return parsed;
};

const parseDateFlag = (name, value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail(`--${name}: нужна дата YYYY-MM-DD, получено «${value}»`);
  }
  return value;
};

const splitList = (value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function parseArgs(argv) {
  const options = {
    help: false,
    live: false,
    trial: false,
    positions: join(EVAL_DIR, "positions.json"),
    limit: null,
    out: join(EVAL_DIR, "runs"),
    runId: null,
    providers: null,
    repeats: 1,
    num: 10,
    depth: "auto",
    language: "auto",
    excerpts: false,
    chunksPerSource: 0,
    category: null,
    includeDomains: [],
    excludeDomains: [],
    timeRange: null,
    publishedAfter: null,
    publishedBefore: null,
    timeoutMs: 120000,
    retries: 0,
    concurrency: 1,
    maxCredits: 100,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) fail(`флаг ${arg} требует значения`);
      index += 1;
      return next;
    };
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--live":
        options.live = true;
        break;
      case "--trial":
        // Пробный режим — это тоже живой прогон, просто без ключа.
        options.trial = true;
        options.live = true;
        break;
      case "--positions":
        options.positions = resolve(process.cwd(), value());
        break;
      case "--limit":
        options.limit = parseIntFlag("limit", value(), 1, 1000);
        break;
      case "--out":
        options.out = resolve(process.cwd(), value());
        break;
      case "--run-id":
        options.runId = value();
        if (!/^[A-Za-z0-9._-]+$/.test(options.runId)) {
          fail("--run-id: допустимы буквы, цифры, точка, дефис и подчёркивание");
        }
        break;
      case "--providers":
        options.providers = splitList(value());
        break;
      case "--repeats":
        options.repeats = parseIntFlag("repeats", value(), 1, 10);
        break;
      case "--num":
        options.num = parseIntFlag("num", value(), 1, 30);
        break;
      case "--depth":
        options.depth = value();
        if (!["flash", "auto"].includes(options.depth)) fail("--depth: flash или auto");
        break;
      case "--language":
        options.language = value();
        if (!["auto", "ru", "en"].includes(options.language)) {
          fail("--language: auto, ru или en (китайский язык серверному параметру не передаётся)");
        }
        break;
      case "--excerpts":
        options.excerpts = true;
        break;
      case "--chunks":
        options.chunksPerSource = parseIntFlag("chunks", value(), 0, 5);
        break;
      case "--category":
        options.category = value();
        if (!["general", "news", "it", "science", "marketplace"].includes(options.category)) {
          fail("--category: general, news, it, science или marketplace");
        }
        break;
      case "--include-domains":
      case "--exclude-domains": {
        const domains = splitList(value());
        if (domains.length > 10) fail(`${arg}: не больше 10 доменов`);
        options[arg === "--include-domains" ? "includeDomains" : "excludeDomains"] = domains;
        break;
      }
      case "--time-range":
        options.timeRange = value();
        if (!["all", "day", "week", "month", "year"].includes(options.timeRange)) {
          fail("--time-range: all, day, week, month или year");
        }
        break;
      case "--published-after":
        options.publishedAfter = parseDateFlag("published-after", value());
        break;
      case "--published-before":
        options.publishedBefore = parseDateFlag("published-before", value());
        break;
      case "--timeout-ms":
        options.timeoutMs = parseIntFlag("timeout-ms", value(), 1000, 600000);
        break;
      case "--retries":
        options.retries = parseIntFlag("retries", value(), 0, 5);
        break;
      case "--concurrency":
        options.concurrency = parseIntFlag("concurrency", value(), 1, 8);
        break;
      case "--max-credits":
        options.maxCredits = parseIntFlag("max-credits", value(), 1, 100000);
        break;
      default:
        fail(`неизвестный аргумент: ${arg}\nЗапусти node scripts/eval/run.mjs --help`);
    }
  }
  return options;
}

// --- dataset ---------------------------------------------------------------

const LANGUAGES = new Set(["ru", "en", "zh"]);
const INTENTS = new Set(["fact", "list", "compare", "factory"]);

function loadDataset(path) {
  if (!existsSync(path)) fail(`датасет не найден: ${path}`);
  let dataset;
  try {
    dataset = readJson(path);
  } catch (error) {
    fail(`датасет ${path}: невалидный JSON (${error.message})`);
  }
  const positions = dataset?.positions;
  if (!Array.isArray(positions) || positions.length < 1) {
    fail(`датасет ${path}: нет непустого массива positions[]`);
  }
  const seen = new Set();
  for (const position of positions) {
    for (const field of ["id", "query", "language", "intent", "notes"]) {
      if (typeof position[field] !== "string" || position[field].trim() === "") {
        fail(`датасет: у позиции ${position.id ?? "?"} пустое поле ${field}`);
      }
    }
    if (seen.has(position.id)) fail(`датасет: дубль id ${position.id}`);
    seen.add(position.id);
    if (!LANGUAGES.has(position.language)) {
      fail(`позиция ${position.id}: language «${position.language}» вне ru/en/zh`);
    }
    if (!INTENTS.has(position.intent)) {
      fail(`позиция ${position.id}: intent «${position.intent}» вне fact/list/compare/factory`);
    }
  }
  return { dataset, positions, version: dataset.version ?? "unversioned" };
}

// --- providers -------------------------------------------------------------

function loadSrezaiPrice() {
  // The price is defined in src/tools.json (source of truth). Read it, never guess.
  const fallback = { perCall: 1, source: "fallback: 1 credit per web_search call" };
  try {
    const source = readJson(join(REPO_ROOT, "src/tools.json"));
    const tool = (source.tools ?? []).find((item) => item.name === "web_search");
    const priceText = tool?.price ?? "";
    const match = /(\d+)\s*кредит/i.exec(priceText);
    const perCall = match ? Number(match[1]) : 1;
    return {
      perCall,
      source: `src/tools.json v${source.version}: web_search — ${priceText || "1 кредит за вызов"}`,
    };
  } catch {
    return fallback;
  }
}

function resolveProviders(requested, live, trial) {
  const price = loadSrezaiPrice();
  const providers = [];
  for (const name of requested) {
    if (name === "srezai") {
      const key = process.env.SREZAI_API_KEY ?? "";
      const baseUrl = (process.env.SREZAI_BASE_URL ?? "https://srezai.ru").replace(/\/+$/, "");
      if (trial && key) {
        fail("--trial и SREZAI_API_KEY одновременно: выбери что-то одно (пробный режим идёт без ключа)");
      }
      if (trial && requested.includes("baseline")) {
        fail("--trial работает только с srezai: у пробного режима нет ключа для второго провайдера");
      }
      providers.push({
        name: "srezai",
        kind: "srezai",
        key: trial ? "" : key,
        baseUrl,
        endpoint: safeUrl(`${baseUrl}/api/v1/search`),
        // В пробном режиме запрос уходит без Authorization — сервер отвечает по лимиту на IP.
        auth_configured: trial ? true : Boolean(key),
        mode: trial ? "trial" : key ? "key" : "keyless",
        credits_per_call: price.perCall,
      });
    } else if (name === "baseline") {
      const url = process.env.BASELINE_URL ?? "";
      const key = process.env.BASELINE_KEY ?? "";
      const displayName = (process.env.BASELINE_NAME ?? "baseline").trim() || "baseline";
      if (!/^[A-Za-z0-9._-]+$/.test(displayName)) {
        fail("BASELINE_NAME: допустимы буквы, цифры, точка, дефис и подчёркивание");
      }
      providers.push({
        name: displayName,
        kind: "baseline",
        key,
        url,
        endpoint: url ? safeUrl(url) : "не задан (BASELINE_URL)",
        auth_configured: Boolean(url),
        bodyTemplate:
          process.env.BASELINE_BODY ??
          '{"query":{{query}},"num":{{num}},"depth":{{depth}},"language":{{language}}}',
        credits_per_call: null,
      });
    } else {
      fail(`неизвестный провайдер «${name}»: допустимы srezai и baseline`);
    }
  }
  if (live) {
    for (const provider of providers) {
      if (!provider.auth_configured) {
        fail(
          provider.kind === "srezai"
            ? "для --live нужен SREZAI_API_KEY в окружении (значение не печатается); без ключа есть --trial — анонимный пробный лимит"
            : "для --live с baseline нужен BASELINE_URL",
        );
      }
    }
  }
  return providers;
}

function buildRequest(provider, position, config) {
  if (provider.kind === "srezai") {
    const body = {
      query: position.query,
      num: config.num,
      depth: config.depth,
      language: config.language,
    };
    if (config.excerpts) body.excerpts = true;
    if (config.chunksPerSource > 0) body.chunksPerSource = config.chunksPerSource;
    if (config.category) body.category = config.category;
    if (config.includeDomains.length > 0) body.includeDomains = config.includeDomains;
    if (config.excludeDomains.length > 0) body.excludeDomains = config.excludeDomains;
    if (config.timeRange) body.timeRange = config.timeRange;
    if (config.publishedAfter) body.publishedAfter = config.publishedAfter;
    if (config.publishedBefore) body.publishedBefore = config.publishedBefore;
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
    };
    // Пробный режим: без ключа и без заголовка Authorization — иначе сервер ответит 401.
    if (provider.key) headers.authorization = `Bearer ${provider.key}`;
    return {
      url: `${provider.baseUrl}/api/v1/search`,
      method: "POST",
      headers,
      body,
    };
  }
  const template = provider.bodyTemplate
    .split("{{query}}")
    .join(JSON.stringify(position.query))
    .split("{{num}}")
    .join(String(config.num))
    .split("{{depth}}")
    .join(JSON.stringify(config.depth))
    .split("{{language}}")
    .join(JSON.stringify(config.language));
  let body;
  try {
    body = JSON.parse(template);
  } catch (error) {
    fail(`BASELINE_BODY: невалидный JSON после подстановки (${error.message})`);
  }
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (provider.key) headers.authorization = `Bearer ${provider.key}`;
  return { url: provider.url, method: "POST", headers, body };
}

// --- execution -------------------------------------------------------------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function singleCall(provider, position, config, secrets) {
  const request = buildRequest(provider, position, config);
  const startedAt = performance.now();
  let timedOut = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      return {
        ok: false,
        http_status: response.status,
        latency_ms: latencyMs,
        kind: "http",
        message: maskSecrets(text.slice(0, 400), secrets),
      };
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return {
        ok: false,
        http_status: response.status,
        latency_ms: latencyMs,
        kind: "parse",
        message: maskSecrets(text.slice(0, 200), secrets),
      };
    }
    return {
      ok: true,
      http_status: response.status,
      latency_ms: latencyMs,
      results: normalizeResults(payload),
      raw: payload,
    };
  } catch (error) {
    return {
      ok: false,
      http_status: null,
      latency_ms: Math.round(performance.now() - startedAt),
      kind: timedOut ? "timeout" : "network",
      message: maskSecrets(error?.message ?? String(error), secrets),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runAttempt(provider, position, repeat, config, secrets) {
  const calls = [];
  for (let call = 0; call <= config.retries; call += 1) {
    const result = await singleCall(provider, position, config, secrets);
    calls.push({
      ok: result.ok,
      http_status: result.http_status,
      latency_ms: result.latency_ms,
      kind: result.kind ?? null,
      message: result.message ?? null,
    });
    if (result.ok) {
      return {
        provider: provider.name,
        position_id: position.id,
        repeat,
        ok: true,
        http_status: result.http_status,
        latency_ms: result.latency_ms,
        http_calls: calls.length,
        total_latency_ms: calls.reduce((sum, item) => sum + item.latency_ms, 0),
        request: {
          url: maskSecrets(safeUrl(buildRequest(provider, position, config).url), secrets),
          body: buildRequest(provider, position, config).body,
        },
        results: result.results,
        raw: result.raw,
        call_log: calls,
      };
    }
    if (call < config.retries) await sleep(500 * (call + 1));
  }
  const last = calls[calls.length - 1];
  return {
    provider: provider.name,
    position_id: position.id,
    repeat,
    ok: false,
    http_status: last.http_status,
    latency_ms: last.latency_ms,
    http_calls: calls.length,
    total_latency_ms: calls.reduce((sum, item) => sum + item.latency_ms, 0),
    request: {
      url: maskSecrets(safeUrl(buildRequest(provider, position, config).url), secrets),
      body: buildRequest(provider, position, config).body,
    },
    error: { kind: last.kind ?? "unknown", status: last.http_status, message: last.message ?? null },
    call_log: calls,
  };
}

async function runPool(items, limit, worker) {
  const total = items.length;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, total) }, async () => {
    while (next < total) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

const round = (value, digits = 1) => {
  if (value == null || Number.isNaN(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
};

function aggregateAttempts(attempts, providerName, provider) {
  const okAttempts = attempts.filter((attempt) => attempt.ok);
  const failedAttempts = attempts.filter((attempt) => !attempt.ok);
  const results = okAttempts.flatMap((attempt) => attempt.results ?? []);
  const snippets = results.map((result) => (result.content ?? "").length);
  const domainsPerAttempt = okAttempts.map(
    (attempt) => new Set((attempt.results ?? []).map((result) => result.domain).filter(Boolean)).size,
  );
  const publishedCount = results.filter((result) => result.published_date).length;
  const allDomains = new Set(results.map((result) => result.domain).filter(Boolean));
  const credits =
    providerName === "srezai" && provider?.credits_per_call != null
      ? okAttempts.length * provider.credits_per_call
      : null;
  return {
    attempts: attempts.length,
    ok: okAttempts.length,
    failed: failedAttempts.length,
    timeouts: failedAttempts.filter((attempt) => attempt.error?.kind === "timeout").length,
    latency: latencyStats(okAttempts.map((attempt) => attempt.latency_ms)),
    results: {
      total: results.length,
      avg_per_query: okAttempts.length > 0 ? round(results.length / okAttempts.length) : null,
      unique_domains_total: allDomains.size,
      avg_unique_domains:
        okAttempts.length > 0
          ? round(domainsPerAttempt.reduce((sum, value) => sum + value, 0) / okAttempts.length)
          : null,
      avg_snippet_chars:
        snippets.length > 0 ? round(snippets.reduce((sum, value) => sum + value, 0) / snippets.length) : null,
      published_date_share: results.length > 0 ? round(publishedCount / results.length, 3) : null,
    },
    cost: {
      billable_calls: okAttempts.length,
      credits,
      usd: null,
      note:
        providerName === "srezai"
          ? "ошибки и пустые ответы не списываются: кредиты = успешные вызовы × цена из src/tools.json"
          : "цена baseline неизвестна: задай прайс вручную для расчёта стоимости",
    },
  };
}

function groupAttempts(attempts, positionsById, key) {
  const groups = {};
  for (const attempt of attempts) {
    const position = positionsById.get(attempt.position_id);
    const group = position?.[key] ?? "unknown";
    groups[group] ??= [];
    groups[group].push(attempt);
  }
  return groups;
}

function computePairs(attempts, providers) {
  const pairs = [];
  for (let left = 0; left < providers.length; left += 1) {
    for (let right = left + 1; right < providers.length; right += 1) {
      const providerA = providers[left].name;
      const providerB = providers[right].name;
      const positionIds = [...new Set(attempts.map((attempt) => attempt.position_id))];
      const shared = [];
      const jaccards = [];
      for (const positionId of positionIds) {
        const attemptA = attempts.find(
          (attempt) => attempt.provider === providerA && attempt.position_id === positionId && attempt.repeat === 1 && attempt.ok,
        );
        const attemptB = attempts.find(
          (attempt) => attempt.provider === providerB && attempt.position_id === positionId && attempt.repeat === 1 && attempt.ok,
        );
        if (!attemptA || !attemptB) continue;
        const domainsA = new Set((attemptA.results ?? []).map((result) => result.domain).filter(Boolean));
        const domainsB = new Set((attemptB.results ?? []).map((result) => result.domain).filter(Boolean));
        const overlap = [...domainsA].filter((domain) => domainsB.has(domain));
        const union = new Set([...domainsA, ...domainsB]);
        shared.push(overlap.length);
        jaccards.push(union.size > 0 ? overlap.length / union.size : 0);
      }
      if (shared.length > 0) {
        pairs.push({
          a: providerA,
          b: providerB,
          positions: shared.length,
          shared_domains_mean: round(shared.reduce((sum, value) => sum + value, 0) / shared.length),
          jaccard_mean: round(jaccards.reduce((sum, value) => sum + value, 0) / jaccards.length, 3),
        });
      }
    }
  }
  return pairs;
}

// --- trace files -----------------------------------------------------------

function traceFor(attempt) {
  const base = {
    provider: attempt.provider,
    repeat: attempt.repeat,
    ok: attempt.ok,
    http_status: attempt.http_status,
    latency_ms: attempt.latency_ms,
    total_latency_ms: attempt.total_latency_ms,
    http_calls: attempt.http_calls,
    request: attempt.request,
    call_log: attempt.call_log,
  };
  if (attempt.ok) {
    return { ...base, results: attempt.results, raw: attempt.raw };
  }
  return { ...base, error: attempt.error };
}

function writePositionTrace(resultsDir, position, attempts) {
  const trace = {
    position: {
      id: position.id,
      query: position.query,
      language: position.language,
      intent: position.intent,
      notes: position.notes,
    },
    attempts: attempts.map(traceFor),
  };
  writeJson(join(resultsDir, `${position.id}.json`), trace);
}

// --- main ------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const { dataset, positions: allPositions, version } = loadDataset(options.positions);
  if (options.trial) {
    // Пробный режим — анонимный, лимит на IP суточный: методику на нём не строят.
    if (options.repeats > 1) {
      fail("--trial не поддерживает --repeats > 1: пробный лимит 25 запросов в сутки на IP");
    }
    if (options.maxCredits <= 0) fail("--max-credits должен быть положительным");
  }
  const positions = options.limit === null ? allPositions : allPositions.slice(0, options.limit);
  if (positions.length === 0) fail("после --limit не осталось ни одной позиции");
  const positionsById = new Map(positions.map((position) => [position.id, position]));

  const defaultProviders = ["srezai", ...(process.env.BASELINE_URL ? ["baseline"] : [])];
  const requestedProviders = options.providers ?? defaultProviders;
  if (requestedProviders.length === 0) fail("--providers: нужен хотя бы один провайдер");
  const providers = resolveProviders(requestedProviders, options.live, options.trial);
  const secrets = [
    process.env.SREZAI_API_KEY,
    process.env.BASELINE_KEY,
  ].filter((value) => typeof value === "string" && value.length > 0);

  const config = {
    positions: positions.length,
    repeats: options.repeats,
    num: options.num,
    depth: options.depth,
    language: options.language,
    excerpts: options.excerpts,
    chunksPerSource: options.chunksPerSource,
    category: options.category,
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains,
    timeRange: options.timeRange,
    publishedAfter: options.publishedAfter,
    publishedBefore: options.publishedBefore,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    concurrency: options.concurrency,
    maxCredits: options.maxCredits,
  };

  // Fail on a broken BASELINE_BODY before the run starts, not mid-way through it.
  for (const provider of providers) buildRequest(provider, positions[0], config);

  const runId = options.runId ?? utcRunId();
  const runDir = join(options.out, runId);
  const resultsDir = join(runDir, "results");
  if (existsSync(join(runDir, "manifest.json"))) {
    fail(`прогон ${runId} уже существует: ${runDir}. Выбери другой --run-id`);
  }
  mkdirSync(resultsDir, { recursive: true });

  const price = loadSrezaiPrice();
  const plannedCalls = providers.length * positions.length * options.repeats;
  const plannedCredits = providers.some((provider) => provider.name === "srezai")
    ? positions.length * options.repeats * price.perCall
    : 0;
  if (options.live && plannedCredits > options.maxCredits) {
    fail(
      `план прогона ${plannedCredits} кредитов > --max-credits ${options.maxCredits}. Уменьши --repeats/--positions или подними потолок`,
    );
  }

  const manifest = {
    harness: HARNESS_NAME,
    harnessVersion: HARNESS_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    mode: options.trial ? "live-trial" : options.live ? "live" : "dry-run",
    nodeVersion: process.version,
    platform: process.platform,
    command: maskSecrets(process.argv.slice(2).join(" "), secrets),
    dataset: {
      path: displayPath(options.positions, REPO_ROOT),
      version,
      positions: positions.length,
      by_language: languageDistribution(positions),
      by_intent: intentDistribution(positions),
      by_language_text: distributionText(languageDistribution(positions)),
    },
    config,
    providers: providers.map((provider) => ({
      name: provider.name,
      kind: provider.kind,
      endpoint: maskSecrets(provider.endpoint, secrets),
      auth_configured: provider.auth_configured,
      mode: provider.mode,
      request_contract:
        provider.kind === "srezai" ? "srezai web_search: query,num,depth,language + optional filters" : "BASELINE_BODY template",
      credits_per_call: provider.credits_per_call,
    })),
    limits: {
      timeout_ms: options.timeoutMs,
      retries: options.retries,
      concurrency: options.concurrency,
      max_credits: options.maxCredits,
    },
    pricing: {
      srezai: { unit: "credit", per_call: price.perCall, source: price.source },
      baseline: { unit: "usd", per_call: null, source: "не задан: провайдер неизвестен" },
    },
    network: options.live ? "performed" : "skipped",
    auth: options.trial ? "anonymous trial (no key): 25 requests/day per IP" : "bearer key",
    secrets: {
      SREZAI_API_KEY: process.env.SREZAI_API_KEY ? "set" : "unset",
      BASELINE_KEY: process.env.BASELINE_KEY ? "set" : "unset",
    },
  };
  writeJson(join(runDir, "manifest.json"), manifest);

  console.log(`${HARNESS_NAME} v${HARNESS_VERSION} · ${options.trial ? "LIVE по пробному лимиту (без ключа)" : options.live ? "LIVE" : "dry-run"} · ${runId}`);
  console.log(`датасет: ${manifest.dataset.path} v${version}, ${positions.length} позиций (${manifest.dataset.by_language_text})`);
  console.log(`провайдеры: ${providers.map((provider) => provider.name).join(", ")}`);
  console.log(`план: ${plannedCalls} вызов(ов), ~${plannedCredits} кредит(ов) srezai`);
  console.log(`артефакты: ${runDir}`);
  console.log("");

  if (!options.live) {
    const planned = {};
    for (const provider of providers) {
      planned[provider.name] = {
        calls: positions.length * options.repeats,
        credits: provider.name === "srezai" ? plannedCredits : null,
      };
    }
    const summary = {
      harness: HARNESS_NAME,
      harnessVersion: HARNESS_VERSION,
      runId,
      mode: "dry-run",
      generatedAt: new Date().toISOString(),
      planned,
      providers: {},
      failures: [],
      pairs: [],
      quality: null,
      note: "dry-run: сетевых вызовов не было, метрик качества и латентности нет",
    };
    writeJson(join(runDir, "summary.json"), summary);
    writeText(join(runDir, "summary.md"), renderSummaryMd(manifest, summary));
    for (const position of positions) {
      console.log(`  ${position.id} [${position.language}/${position.intent}] ${position.query}`);
    }
    console.log("");
    console.log(`dry-run готов: ${join(runDir, "manifest.json")}`);
    console.log("боевой прогон: SREZAI_API_KEY=... node scripts/eval/run.mjs --live --repeats 3");
    console.log("дымовой прогон без ключа: node scripts/eval/run.mjs --trial --limit 20");
    return 0;
  }

  const attempts = [];
  const attemptsByPosition = new Map();
  let positionIndex = 0;
  const startedAt = performance.now();

  await runPool(positions, options.concurrency, async (position) => {
    positionIndex += 1;
    const positionAttempts = [];
    for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
      for (const provider of providers) {
        const attempt = await runAttempt(provider, position, repeat, options, secrets);
        positionAttempts.push(attempt);
        attempts.push(attempt);
        const status = attempt.ok
          ? `ok ${(attempt.latency_ms / 1000).toFixed(1)} с, ${attempt.results.length} рез.`
          : `FAIL ${attempt.error?.kind}${attempt.http_status ? ` ${attempt.http_status}` : ""}`;
        console.log(`[${positionIndex}/${positions.length}] ${position.id} ${provider.name} r${repeat}: ${status}`);
      }
    }
    attemptsByPosition.set(position.id, positionAttempts);
    writePositionTrace(resultsDir, position, positionAttempts);
  });

  const failures = attempts
    .filter((attempt) => !attempt.ok)
    .map((attempt) => ({
      position_id: attempt.position_id,
      provider: attempt.provider,
      repeat: attempt.repeat,
      kind: attempt.error?.kind ?? "unknown",
      status: attempt.http_status ?? null,
      message: attempt.error?.message ?? null,
    }));

  const summary = {
    harness: HARNESS_NAME,
    harnessVersion: HARNESS_VERSION,
    runId,
    mode: options.trial ? "live-trial" : "live",
    generatedAt: new Date().toISOString(),
    duration_ms: Math.round(performance.now() - startedAt),
    config,
    providers: {},
    failures,
    pairs: computePairs(attempts, providers),
    quality: null,
  };

  for (const provider of providers) {
    const mine = attempts.filter((attempt) => attempt.provider === provider.name);
    const metrics = aggregateAttempts(mine, provider.name, provider);
    metrics.by_language = {};
    metrics.by_intent = {};
    for (const [language, subset] of Object.entries(groupAttempts(mine, positionsById, "language"))) {
      metrics.by_language[language] = aggregateAttempts(subset, provider.name, provider);
    }
    for (const [intent, subset] of Object.entries(groupAttempts(mine, positionsById, "intent"))) {
      metrics.by_intent[intent] = aggregateAttempts(subset, provider.name, provider);
    }
    summary.providers[provider.name] = metrics;
  }

  writeJson(join(runDir, "summary.json"), summary);
  writeText(join(runDir, "summary.md"), renderSummaryMd(manifest, summary));

  console.log("");
  for (const [name, metrics] of Object.entries(summary.providers)) {
    const p50 = metrics.latency.p50_ms == null ? "—" : `${(metrics.latency.p50_ms / 1000).toFixed(2)} с`;
    const p95 = metrics.latency.p95_ms == null ? "—" : `${(metrics.latency.p95_ms / 1000).toFixed(2)} с`;
    console.log(
      `${name}: ${metrics.ok}/${metrics.attempts} успешно, p50 ${p50}, p95 ${p95}, результатов ${metrics.results.total}, кредитов ${metrics.cost.credits ?? "—"}`,
    );
  }
  console.log(`отчёт: ${join(runDir, "summary.md")}`);
  if (failures.length > 0) {
    console.error(`инфраструктурных фейлов: ${failures.length} — код возврата 1`);
    return 1;
  }
  console.log("живой прогон завершён без инфраструктурных фейлов");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`Ошибка: ${maskSecrets(error?.stack ?? String(error), [process.env.SREZAI_API_KEY, process.env.BASELINE_KEY].filter(Boolean))}`);
    process.exit(1);
  });
