# srezai-migrate — соответствие провайдеров, параметры, потерянные функции

Сверено с публичными описаниями провайдеров на 20.11.2026 и с живой
документацией srezai. Имена параметров у провайдеров меняются — перед правкой
кода сверь их с актуальной докой, здесь важна логика соответствия, а не буквы.
Наши цены, лимиты и параметры — только из `src/tools.json`.

## Быстрый свод

| Возможность | Tavily | Firecrawl | Exa | Serper / Serply / SearchAPI / SerpAPI | srezai |
|---|---|---|---|---|---|
| поиск | search | search | search | search | `web_search` |
| картинки | — | — | — | images | `image_search` |
| чтение страницы | extract | scrape | contents | — | `read_url`, `read_urls` |
| поля по схеме | extract | extract | contents (summary) | — | `extract` |
| карта сайта | map | map | — | — | `map` |
| обход сайта | crawl | crawl | agent (исследование) | — | `crawl` |
| готовый ответ | research | — | answer | — | `answer_search` |
| доказательная проверка | — | — | — | — | `verify_claim` |
| глубокое исследование | research | — | agent | — | `deep_research` |
| видео YouTube | — | — | — | videos (ссылки) | `yt_srt` |
| браузерные действия | — | interact | — | — | нет |
| мониторы | — | monitor | monitors | — | нет |
| snapshots | — | — | snapshot | — | нет |

## Tavily

| Было | Стало | Как переписать |
|---|---|---|
| `search` | `web_search` | `max_results` → `num` (≤30); `search_depth` → `depth flash|auto`; `include_domains`/`exclude_domains` → `includeDomains`/`excludeDomains` (≤10); `topic`/`days` → `category`/`timeRange`; `include_answer` → в ответе уже есть `answers[]` |
| `extract` | `read_urls` / `extract` | нужен markdown — `read_urls` (батч ≤10, 1 кредит за ссылку); нужны поля — `extract` (2 кредита за ссылку, 2–5 полей по схеме) |
| `crawl` | `map` + `crawl` | у нас нет `max_depth`/`instructions`: глубину задают `selectPaths`/`search`/`limit`; один `crawl` читает ≤20 страниц |
| `map` | `map` | `limit` ≤200; `search` у нас фильтрует по адресу, а не по смыслу |
| `research` | `deep_research` / `answer_search` | research-отчёт — `deep_research` (async-талон), короткий ответ — `answer_search` (3/5/10) |
| MCP | MCP | меняются URL и имена инструментов; схемы те же по смыслу |

Ловушка Tavily `include_raw_content`: у нас это `includeRawContent` у
`web_search`**только для топ-4** и до 20 тыс. символов. Массово тянуть сырой
текст — `read_urls`, а не раздувать `num`.

## Firecrawl

| Было | Стало | Как переписать |
|---|---|---|
| `scrape` (formats: markdown/html/rawHtml/screenshot) | `read_url` (+`fetch_page`) | markdown — `read_url`; HTML/rawHtml не отдаём; скриншот — `fetch_page` (3 кредита, дороже текста) |
| `crawl` | `map` + `crawl` | `limit` у нас ≤20 за вызов; `includePaths`/`excludePaths` → `selectPaths`/`excludePaths`; `maxDiscoveryDepth`/`allowBacklinks` нет |
| `map` | `map` | `limit` ≤200, `includeSubdomains` есть |
| `search` (со scrape опций) | `web_search` | `scrapeOptions` → `excerpts`/`chunksPerSource`; отдельный scrape не нужен |
| `extract` (prompt/schema) | `extract` | `prompt` → `instruction`; `schema` — сокращённый (`?` — необязательное, `[]` — массив), 2–5 полей |
| `interact` | нет | кликов/форм/навигации нет; `read_url` только рендерит JS |
| `monitor` | нет | только вызов по запросу; фонового отслеживания нет |

Firecrawl-пайплайн «поиск → scrape топ-N» заменяется одним `web_search
--excerpts` или `--chunks-per-source`: дешевле и без второго прохода.

## Exa

| Было | Стало | Как переписать |
|---|---|---|
| `search` (neural) | `web_search` | у нас лексический поиск + реранк; `numResults` → `num`; `category` есть; семантического индекса нет |
| `contents` | `read_urls` / `extract` | текст/подсветки → `read_url`/`read_urls`; нужны поля — `extract` |
| `answer` | `answer_search` | `depth fast|balanced|deep` = 3/5/10 кредитов |
| `agent` | `deep_research` | async-талон; это не диалоговый агент с уточнениями |
| `snapshot` | нет | версий/снимков страниц нет — только чтение текущей |
| `monitors` | нет | фонового отслеживания изменений нет |

Если продукт держится именно на семантике Exa, честный вариант — оставить Exa
на поиске, а srezai взять на чтение/проверку/синтез. Это гибрид, а не провал
миграции.

## Serper / Serply / SearchAPI / SerpAPI (SERP-провайдеры)

| Было | Стало | Как переписать |
|---|---|---|
| поиск Google/Bing | `web_search` | `q` → `query`; `num` → `num` (≤30); `gl`/`hl` → `language`; `tbs` → `timeRange`/`publishedAfter` |
| images | `image_search` | `query`, `num` (1–48), `safe`, `timeRange` |
| news | `web_search` | `category: news` + `timeRange` |
| места, карты, shopping, scholar, видео-вертикали | нет | отдельного доступа нет; YouTube — только `yt_srt` (текст ролика, не поиск видео) |
| SERP-features (knowledge graph, PAA, sitelinks, позиции) | частично | `answers[]`, `suggestions[]`, `infoboxes[]` могут прийти, но это не контракт SERP: ранги и фичи не гарантируются |
| пагинация (`page`) | нет | один вызов ≤30 результатов; нужен глубже — переформулируй запрос |

Rank tracking, проверка позиций и парсинг выдачи «как в Google» на srezai не
строятся: для этого нужен SERP-провайдер.

## Сопоставление полей ответа

| Откуда | Куда | Поле |
|---|---|---|
| Tavily/Firecrawl/Exa/Serper/SerpAPI `results[].title`, `.url` | `web_search` | `results[].title`, `.url` |
| snippet/content/excerpt | `web_search` | `results[].content`, `excerpt`, `rawContent` |
| score / rank | `web_search` | `score`, `relevance` (0–1) — не позиция в SERP |
| published_date | `web_search` | `publishedDate` |
| extract `content[]` | `read_urls` | `pages[].markdown`, `pages[].url` |
| extract `data` | `extract` | `pages[].data`, `missing[]` |
| answer + citations | `answer_search` | `answer`, `sources[]` (`relevance`, `read_success`) |
| crawl `data[]` | `crawl` | `pages[]`, `skipped[]` |
| map `links[]` | `map` | `pages[]`, `sections`, `total` |

Адаптер пиши к своей внутренней модели: если она повторяет чужую, миграция
второго раза будет такой же дорогой.

## Что теряется и чем это заменить

| Потеря | Замена | Честная оценка |
|---|---|---|
| Мониторы/подписки | внешний планировщик (cron) + `map`/`read_url` + своё сравнение | у нас нет доставки и истории; сравнение — на вашей стороне |
| Snapshots страниц | кэш прочитанного у себя | версионирования нет; `fresh` только отключает кэш чтения |
| Браузерные действия (`interact`) | нет | формы/клики/логин не автоматизируем; JS-рендер — `read_url --engine dynamic` |
| Соцсети | публичные страницы через `read_url` | нестабильно, часто закрыто; отдельного API нет |
| Вертикали Maps/Scholar/Shopping | `web_search` + `read` официальных источников | вертикального индекса нет |
| Ранжирование/позиции | SERP-провайдер | у нас нет понятия «позиция в Google» |
| Глубокий обход сайта (>20 страниц за раз) | несколько `crawl` по разделам после `map` | дороже и медленнее, чем «один crawl на 500 страниц» |
| HTML/rawHtml | markdown | разметку не отдаём; парсинг HTML — свой |

## Что srezai делает лучше — чтобы миграция была не только про потери

- Прозрачная цена в кредитах за операцию, а не «подписка с лимитом»: расход
  виден в `get_usage` и в поле `credits` ответа.
- `verify_claim` с дословными цитатами и честными `mixed`/`unverified` — этого
  обычно нет у поисковых API.
- `deep_research` с талоном: длинное исследование не держит HTTP-соединение.
- Runet-first: Яндекс и русские сайты, PDF/Office, скриншоты, работа с
  антибот-заглушками (`source_blocked` не тарифицируется).
- Три канала (CLI, MCP, REST) на один биллинг: чат-хост и бэкенд ходят в один и
  тот же сервис.

Эти различия — причина миграции; потерянные функции — причина гибрида. Скажи
человеку и то, и другое.
