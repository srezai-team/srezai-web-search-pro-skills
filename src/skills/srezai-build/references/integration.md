# srezai-build — REST и MCP: контракт интеграции

Сверено с `https://srezai.ru/docs` 20.11.2026. Цены, лимиты инструментов и
параметры — из `src/tools.json` (единственный источник правды для скиллов);
здесь — механика транспорта, которой в `tools.json` нет.

## REST: один метод, один ключ

База — `https://srezai.ru`. Все инструментальные эндпоинты `/api/v1/*` принимают
**только POST** (на другой метод — `405`, `code: "method_not_allowed"`).
Исключение — служебный `GET /api/v1/whoami`. Тело — JSON, ключ —
`Authorization: Bearer srz_live_…`.

| Эндпоинт | Инструмент | Обязательное поле |
|---|---|---|
| `POST /api/v1/search` | `web_search` | `query` |
| `POST /api/v1/media` | `image_search` | `query` |
| `POST /api/v1/read` | `read_url`, `read_urls` | `url` или `urls` |
| `POST /api/v1/fetch` | `fetch_page` | `url` |
| `POST /api/v1/map` | `map` | `url` |
| `POST /api/v1/crawl` | `crawl` | `url` |
| `POST /api/v1/extract` | `extract` | `url`/`urls` + `schema` |
| `POST /api/v1/verify` | `verify_claim` | `claim` |
| `POST /api/v1/answer` | `answer_search` | `query` |
| `POST /api/v1/deep` | `deep_research` | `query` |
| `POST /api/v1/transcript` | `yt_srt` | `videos` |

`get_usage` — инструмент MCP (бесплатный): баланс, остаток квоты, расход,
прайс. Состояние ключа и аккаунта отдаёт `GET /api/v1/whoami`. У `whoami` метод
именно GET: POST вернёт `405`.

**Ловушка:** у REST неизвестные или недопустимые значения необязательных полей
мягко заменяются значением по умолчанию. Опечатку в `depth` или `timeRange`
получишь не как `400`, а как тихо другой ответ. Вход валидируй у себя.

### Форма ответа

Поля — как в `output` инструмента в `src/tools.json`. Примеры верхнего уровня:

- `search` → `{query, results[], answers[], suggestions[], meta{total, tookMs, …}}`,
  результат: `title, url, content, engine, source, score, publishedDate, relevance`;
- `read` → `{url, title, markdown, truncated, engine, meta{offset, nextOffset, hasMore, tokensApprox, contentQuality}}`;
- `answer` → `{answer, sources[], confidence, tookMs}`, источник: `url, title, relevance, chars_read, read_success`;
- `map` → `{url, total, returned, pages[], sections, source, sitemaps}`;
- `crawl` → `{pages[], skipped[], credits, meta}`;
- `extract` → `{pages[].data, missing[]}`.

Конверт ответа не оборачивай в свою модель вслепую: сначала один пробный вызов,
потом фикстура и адаптер. `truncated`, `skipped[]`, `degraded`, `meta.hasMore` —
обязательные к обработке, а не украшение.

### Ошибки

Тело ошибки: `{"error": "текст для человека", "code": "машинный_код"}`, у `429`
ещё `reason` (`burst` / `quota`) и `retryAfterSec`; у `401` — заголовок
`WWW-Authenticate: Bearer`. Ветвление — по `code`, не по тексту (текст может
уточняться).

| HTTP | `code` | Действие клиента |
|---|---|---|
| 400 | `bad_request`, `ssrf_blocked` | исправить вход, не ретраить |
| 401 | `missing_key`, `invalid_key`, `revoked_key`, `unauthorized` | падать, ключ неверен/отозван |
| 402 | `insufficient_funds` | остановиться, сказать человеку |
| 403 | `forbidden` | не обходить, сменить инструмент/тариф |
| 405 | `method_not_allowed` | исправить HTTP-метод |
| 429 | `rate_limited`, `key_limit_reached`, `trial_limit_reached` | ждать `Retry-After`, повторять |
| 502/503/504 | `search_unavailable`, `service_unavailable` | повтор с backoff |
| 200 | `empty_result`, `null` в `extract`, `mixed`/`unverified` | не ошибка: менять запрос, а не число попыток |

`source_blocked`, `page_not_found`, `page_forbidden`, `tls_untrusted`,
`tls_hostname`, `tls_expired`, `site_error` — проблемы сайта-источника; повтор
той же ссылки не поможет. Пустое чтение и ошибка не тарифицируются.

## MCP: JSON-RPC поверх Streamable HTTP

Эндпоинт `https://srezai.ru/api/mcp`, тот же Bearer, транспорт Streamable HTTP.
Порядок: `initialize` → заголовок ответа `mcp-session-id` → уведомление
`notifications/initialized` с этим заголовком → `tools/list` / `tools/call`.
JSON-RPC 2.0; `Accept: application/json, text/event-stream` — ответ может прийти
SSE-потоком, тогда бери последнюю строку `data:`.

```bash
curl -sS -X POST https://srezai.ru/api/mcp \
  -H "Authorization: Bearer $SREZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -D /tmp/mcp.headers \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"app","version":"1.0"}}}'
```

Ошибки инструментов MCP приходят текстом с кодом в квадратных скобках в начале
строки (`[bad_request] …`), транспортные — как JSON-RPC `error`. MCP есть смысл
брать, когда потребитель сам MCP-клиент (чат-хост, n8n); в бэкенде он дороже
REST: ≈10,8 тыс. токенов схем на каждый запрос. Для старых stdio-клиентов есть
мост `npx srezai-mcp`, но HTTP-эндпоинт проще.

## Лимиты и квота

| Режим | Burst | Суточная квота |
|---|---|---|
| пробный без ключа (`search`, `read`, `transcript`) | 5 / 10 с на IP | 25 / 24 ч на IP |
| ключ, бесплатный тариф | 10 / 10 с | 200 / 24 ч |
| ключ, PRO после пополнения | 50 / 10 с | 2000 / 24 ч |

Квота считает **обращения** к API (один HTTP-запрос = одно обращение), а не
операции: батч `read_urls` на 10 ссылок — одно обращение и десять списаний.
Отказы по burst не расходуют суточную квоту. Ошибка и пустой результат не
тарифицируются; `get_usage` показывает и вызовы без списания.

Клиент проектируй от burst: семафор на `burst / 10` одновременных вызовов,
очередь с приоритетом дешёвых операций, без «веера» из 50 одинаковых запросов.
Заголовки `X-RateLimit-Limit/Remaining/Reset` и `Retry-After` читай, числа не
хардкодь: тариф меняется.

## Ретраи

- Повторять: `429`, `502`, `503`, `504`. Не повторять: `400`, `401`, `402`,
  `403`, `405`.
- Задержка: `Retry-After` (секунды) или экспонента `2^attempt`; добавь jitter.
  Потолок попыток — 3 (для `503` это же число советует и документация).
- Таймаут сети на billable-вызове — не «не выполнилось», а «неизвестно»: не
  повторяй слепо, зафиксируй и сверь расход через `get_usage`.
- `deep_research` в синхронном режиме обрывается ~на 150-й секунде. Только
  async-талон; опрос талона бесплатный, поэтому талон и есть твой идемпотентный
  ключ.

## Идемпотентность и кэш

Idempotency-Key сервер не документирует — дедупликация твоя. Минимум:

1. Ключ кэша: `tool` + нормализованные параметры (порядок ключей, регистр
   запроса, дефолты подставлены явно) + версия схемы адаптера.
2. Single-flight: одинаковые запросы в полёте склеиваются в один.
3. TTL по смыслу: `search` — минуты (зависит от `timeRange`), `read` — часы,
   `extract` — часы/сутки, `map`/`crawl` — часы. Изменился запрос или нужен
   свежий ответ — `fresh` у `read`, не новый TTL.
4. Для `deep_research` в кэш кладётся талон; результат дозабирается бесплатно.

## Деньги: до, во время, после

- До батча: `get_usage` (бесплатно) — хватает ли кредитов; проверь тариф.
- Во время: лимит кредитов на задачу; при `402` — стоп, без «добьём мелкими
  вызовами».
- После: сверь `credits` из ответов (где есть) и `get_usage` с логом; расхождение
  — сигнал, что где-то двойной вызов.
- Дешёвая ступень сначала: `search` → `read` → `extract`/`map` → `crawl` →
  `fetch` → `answer` → `verify` → `deep`. Полная лестница с ценами —
  [../../srezai-web/references/economy.md](../../srezai-web/references/economy.md).

## Наблюдаемость и секреты

Пиши в лог: `tool`, `status`, `code`, `latency_ms`, `credits`, `attempt`,
`request_id`, хэш нормализованных параметров. Не пиши: `Authorization`, полный
ключ, полные тела ответов, query-строки URL с токенами (`?token=…`, `?sign=…`) —
маскируй. Ошибки не логируй вместе с телом запроса, если в нём есть пользовательские
данные.

## Проверка версии API

Документация и `src/tools.json` живут отдельно: скиллы фиксируют состояние на
дату, API может добавить поля. Перед релизом прогони smoke-набор (см.
`references/checklist.md`), после релиза — следящий тест на 1 дешёвом вызове:
`401`/`402`/`429`-ветки и форма ответа. Ломающее изменение заметишь по `code` и
по исчезнувшим полям, а не по тексту ошибки.
