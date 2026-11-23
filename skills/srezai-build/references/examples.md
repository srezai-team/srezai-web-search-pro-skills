# srezai-build — рабочие примеры: Node, Python, curl

Минимальные клиенты без SDK: ключ только из окружения, таймаут на вызов,
ретраи только на 429/502/503/504. Ключ `SREZAI_API_KEY` в коде не появляется
никогда. Официальные клиенты (`pip install srezai`, JS — репозиторий
srezai-sdk, MIT) берут заголовки, разбор ошибок и повторы на себя; ручной клиент
нужен, когда SDK не подходит по рантайму или зависимостям.

## Node 20+ (без зависимостей)

```js
// srezai-rest.mjs
const BASE = "https://srezai.ru/api/v1";

class SrezaiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `srezai ${status}`);
    this.status = status;
    this.code = body?.code;                 // ветвиться по code, не по тексту
    this.retryAfterSec = body?.retryAfterSec;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(tool, body, { timeoutMs = 30_000, attempts = 3 } = {}) {
  const key = process.env.SREZAI_API_KEY;
  if (!key) throw new Error("SREZAI_API_KEY не задан");
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs), // таймаут ≠ «не выполнилось»
    });
    if (res.ok) return res.json();
    let payload = {};
    try { payload = await res.json(); } catch { /* тело не JSON */ }
    const retryable = res.status === 429 || res.status >= 502;
    if (!retryable || attempt >= attempts) throw new SrezaiError(res.status, payload);
    const wait = (payload.retryAfterSec ?? 2 ** attempt) * 1000;
    await sleep(wait + Math.random() * 250); // backoff + jitter
  }
}

// Поиск: сначала дешёвая ступень
const found = await call("search", { query: "srezai API", num: 5, language: "ru" });
console.log(found.results.map((r) => r.url));

// Чтение окном: продолжение — meta.nextOffset, не считать самому
const page = await call("read", { url: "https://example.com/article", maxChars: 4000 });
console.log(page.markdown);
if (page.meta.hasMore) {
  const next = await call("read", {
    url: "https://example.com/article",
    maxChars: 4000,
    offset: page.meta.nextOffset,
  });
  console.log(next.markdown);
}

// Поля по схеме: 2 кредита за ссылку, дешевле чтения только если поля известны
const card = await call("extract", {
  url: "https://example.com/product",
  schema: { title: "string", price: "number?" }, // "?" — необязательное, "[]" — массив
});
console.log(card.pages[0].data, card.missing);
```

## Python 3.10+ (стандартная библиотека)

```python
# srezai_rest.py
import json, os, random, time
import urllib.error
import urllib.request

BASE = "https://srezai.ru/api/v1"
RETRYABLE = {429, 502, 503, 504}


def call(tool: str, body: dict, *, timeout: float = 30.0, attempts: int = 3) -> dict:
    key = os.environ["SREZAI_API_KEY"]
    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(
            f"{BASE}/{tool}",
            data=json.dumps(body).encode("utf-8"),
            headers={"content-type": "application/json",
                     "authorization": f"Bearer {key}"},
            method="POST",  # все /api/v1/* — только POST
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            payload = json.loads(exc.read() or b"{}")
            if exc.code not in RETRYABLE or attempt == attempts:
                raise RuntimeError(f"{exc.code} {payload.get('code')}: {payload.get('error')}") from exc
            wait = float(payload.get("retryAfterSec") or 2 ** attempt)
            time.sleep(wait + random.random() * 0.25)
    raise AssertionError("недостижимо")


found = call("search", {"query": "srezai REST API", "num": 5, "language": "ru"})
print([r["url"] for r in found["results"]])

page = call("read", {"url": "https://example.com/article", "maxChars": 4000})
print(page["markdown"][:500], page["meta"].get("nextOffset"))
```

`response.ok` / `urlopen` с таймаутом закрывают только транспорт. Смысловые
исходы приходят с `200`: пустая выдача `search`, `null` в `extract`, вердикты
`mixed`/`unverified` в `verify` — это ответ «данных нет», повтор не поможет.

## curl: smoke-тест перед релизом

```bash
# 1. Ключ и аккаунт: GET, не POST
curl -sS https://srezai.ru/api/v1/whoami \
  -H "Authorization: Bearer $SREZAI_API_KEY"

# 2. Один дешёвый поиск
curl -sS -X POST https://srezai.ru/api/v1/search \
  -H "Authorization: Bearer $SREZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"квантовые вычисления 2026","num":3,"timeRange":"year"}'

# 3. Чтение страницы
curl -sS -X POST https://srezai.ru/api/v1/read \
  -H "Authorization: Bearer $SREZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","maxChars":2000}'

# 4. Извлечение по схеме
curl -sS -X POST https://srezai.ru/api/v1/extract \
  -H "Authorization: Bearer $SREZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/card","schema":{"title":"string","price":"number?"}}'

# 5. Проверка утверждения
curl -sS -X POST https://srezai.ru/api/v1/verify \
  -H "Authorization: Bearer $SREZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"claim":"Node.js 22 — LTS","language":"ru","maxSources":3}'
```

Тот же smoke через CLI (проще в CI, ключ из окружения):

```bash
srezai whoami
srezai search "srezai API" --num 3
srezai read https://example.com --max-chars 2000
```

## MCP: минимум для серверного клиента

```bash
# initialize → mcp-session-id в заголовках ответа → notifications/initialized
curl -sS -X POST https://srezai.ru/api/mcp \
  -H "Authorization: Bearer $SREZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -D /tmp/mcp.headers \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"app","version":"1.0"}}}'

SID=$(grep -i '^mcp-session-id:' /tmp/mcp.headers | tr -d '\r' | cut -d' ' -f2)

curl -sS -X POST https://srezai.ru/api/mcp \
  -H "Authorization: Bearer $SREZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SID" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -sS -X POST https://srezai.ru/api/mcp \
  -H "Authorization: Bearer $SREZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SID" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_search","arguments":{"query":"srezai","num":3}}}'
```

Ответ может прийти как `text/event-stream`: бери последнюю строку `data:`.
Ошибка инструмента придёт текстом с `[code]` в начале — разбирай код.

## Долгое исследование: талон, не блокирующий запрос

```bash
srezai deep "тема" --async          # 202 + талон
srezai deep status <ticket>         # опрос; дозабор результата бесплатный
```

Синхронный `deep` обрывается около 150-й секунды — в API-цикле его не
использовать. Через MCP та же схема: `deep_research` отдаёт талон, повторный
вызов с `ticket` дозабирает результат.
