# скиллы srezai — веб-доступ для ИИ-агентов без раздувания контекста

Десять скиллов для веб-API [srezai](https://srezai.ru): шесть инструментальных
(поиск, чтение страниц и файлов, карты сайтов и обход разделов, извлечение по
JSON-схеме, проверка утверждений с цитатами, готовые ответы, глубокие исследования,
субтитры YouTube) и четыре руководства (закупки в Китае, интеграция в код, переезд с
другого провайдера, оценка качества). Один и тот же пакет поставляется тремя
способами: hosted MCP-сервер отдаёт сами навыки (Skills over MCP), `npx skills add`
ставит их любому агенту, читающему `SKILL.md`, а манифесты плагинов подключают их в
Claude Code, Codex, Cursor и Gemini CLI. Сильное покрытие рунета.

**Почему скиллы.** Скиллы грузятся по требованию: типовая задача — один скилл
(≈700–1 200 токенов) и один справочник (≈300), тогда как схемы MCP-инструментов
стоят ≈10,8 тыс. токенов в каждом запросе. Каждый навык работает через тот канал,
который даёт хост, в одном порядке: **MCP-инструменты srezai** (если хост их уже
дал — Claude Code, VS Code и ChatGPT-коннекторы после подключения
`https://srezai.ru/api/mcp`), **CLI `srezai …`** (есть shell и `srezai-cli`),
**REST** `POST https://srezai.ru/api/v1/…` с Bearer-ключом (есть только HTTP). В
каждом навыке ссылка `references/how-to-call.md` с таблицей «CLI → MCP → REST».

## Установка

### Ничего не ставить: навыки по MCP

Hosted MCP-сервер отдаёт эти навыки вместе с инструментами (Skills over MCP).
Подключите его с ключом — агент получит и то и другое, без установки пакета и
рассинхрона версий:

```json
{"mcpServers": {"srezai": {"url": "https://srezai.ru/api/mcp",
  "headers": {"Authorization": "Bearer srz_live_…"}}}}
```

Расширение поддерживают Claude Code (публичная бета с 24.11.2026) и VS Code 1.147+;
хосты без него ставят пакет одним из способов ниже.

### Скиллы (любой агент, который читает `SKILL.md`)

```bash
npx skills add srezai-team/srezai-web-search-pro-skills
```

Плагин Claude Code:

```bash
/plugin marketplace add srezai-team/srezai-web-search-pro-skills
/plugin install srezai-skills@srezai-skills
```

DSH или ручная установка (копирует `skills/*` в каталог скиллов):

```bash
bash scripts/install.sh
```

### Cursor, MCP и каталог skills.sh

- **Cursor:** скопируйте [`rules/srezai-awareness.mdc`](rules/srezai-awareness.mdc)
  в `.cursor/rules/` — правило с пометкой «применять всегда» напоминает агенту
  про srezai, даже если задачу не назвали.
- **MCP:** [`.mcp.json`](.mcp.json) подключает hosted-сервер
  `https://srezai.ru/api/mcp`.
- **Codex:** `.codex-plugin/plugin.json`; **Cursor:** `.cursor-plugin/plugin.json`;
  **Gemini CLI:** `gemini-extension.json`.
- **skills.sh:** [`skills.sh.json`](skills.sh.json) раскладывает десять скиллов
  на группы Core, Tasks и Guides для каталога.
- **Целостность:** [`manifest.json`](manifest.json) — SHA-256 каждого скилла,
  установленную копию можно сверить с опубликованной.

### CLI

```bash
npx srezai-cli --help
npm install -g srezai-cli
```

Все десять навыков не предполагают CLI: сначала MCP-инструменты, если хост их дал,
затем `srezai …`, если есть shell, затем REST, если есть только HTTP.
Репозиторий CLI: [srezai-team/srezai-cli](https://github.com/srezai-team/srezai-cli).

### Ключ

```bash
export SREZAI_API_KEY=srz_live_…      # или ~/.config/srezai/config.json (chmod 600)
```

Ключа нет? `search`, `read` и `transcript` работают в пробном режиме (25 запросов в
сутки на IP). `srezai register --email you@example.com` создаёт агентский аккаунт с
20 стартовыми кредитами и возвращает ключ один раз плюс ссылку на оплату без входа.

## Скиллы

| Скилл | Когда брать | Инструменты |
|---|---|---|
| `srezai-web` | вход: какой канал (CLI/MCP/REST), ключ, триал, оплата, экономика, ошибки | `get_usage` |
| `srezai-search` | «найди ссылки/факты/новости/картинки» | `web_search`, `image_search` |
| `srezai-read` | «прочитай страницу», «вытащи поля», «посмотри вёрстку» | `read_url`, `read_urls`, `extract`, `fetch_page` |
| `srezai-site` | «какие страницы на сайте», «обойди раздел» | `map`, `crawl` |
| `srezai-research` | «проверь факт», «собери ответ», «исследуй тему» | `verify_claim`, `answer_search`, `deep_research` |
| `srezai-transcript` | «субтитры», «о чём видео» | `yt_srt` |
| `srezai-china-sourcing` | «найди поставщика/фабрику в Китае», MOQ, FOB, 1688 | — |

## Инструменты

<!-- GENERATED:tools-readme — источник src/tools.json, сборка: node scripts/generate.mjs -->
<!-- /GENERATED:tools-readme -->

## Сколько стоит

1 кредит = 0,10 ₽. Сначала дешёвая ступень: `search` (1) → `read` (1 за окно) →
`extract` (2/ссылка) / `map` (1 за 10 адресов) → `crawl` (карта + 1/страница) →
`fetch` (3) → `answer` (3/5/10) → `verify` (8) → `deep` (20 + токены). Скиллы требуют
«самую дешёвую ступень, которая закрывает задачу»; `get_usage` бесплатен.

## Чем отличается

- **Рунет в первую очередь**, а не по остаточному принципу.
- **Файлы, а не только страницы**: PDF, Word, Excel, PowerPoint, EPUB читаются как Markdown.
- **Честные числа**: цены, лимиты и «когда НЕ этот инструмент» генерируются из
  одного источника (`src/tools.json`), а не вписаны в маркетинговый текст.
- **Проверка с цитатами**: `verify_claim` сверяет каждую цитату с текстом страницы и
  отбрасывает не найденную; `unverified`/`mixed` так и называются.
- **Недоверенный контент**: всё, что вернул веб, — данные, а не инструкции; в
  скиллах это сказано прямо.

## Безопасность

- В скиллах намеренно нет `allowed-tools`: поле необязательное и экспериментальное,
  перечисляет конкретные инструменты для предварительного одобрения хостом
  (`Bash(srezai *)` — синтаксис Claude Code), а навык, который может работать через
  MCP, CLI или REST, не может перечислить их переносимо. Разрешения остаются у
  хоста: скилл лишь говорит, какой канал предпочесть, и не просит доступы.
- У CLI фиксированный хост API, ключ никогда не печатается (только `srz_…abcd`),
  локальные файлы не читаются, ничего из аргументов не исполняется.
- В скиллах нет ключей, а общий сетап не дублируется в каждом файле — он лежит в
  одном справочнике.
- Релизы собираются и публикуются с provenance; подробности — [SECURITY.md](SECURITY.md).

## Структура репозитория

```
src/tools.json            единственный источник правды: инструменты, цены, примеры CLI
src/skills.json           десять скиллов: kind, описания, привязка инструментов, бюджеты
src/skills/<имя>/         шаблон SKILL.md + рукописные справочники
scripts/generate.mjs      собирает skills/, references, манифесты, docs, VERSION, суммы
skills/<имя>/SKILL.md     сгенерировано — руками не править
.claude-plugin/           plugin.json + marketplace.json (сгенерированы)
```

Правь источник, запускай `node scripts/generate.mjs`, коммить и то и другое.

## Проверь, прежде чем доверять

```bash
node scripts/generate.mjs --check   # артефакты совпадают с источником
sha256sum -c SHA256SUMS.txt         # контрольные суммы сходятся
bash scripts/selftest.sh            # секреты, переводы строк, frontmatter, ссылки
SRZ_API_KEY=… node scripts/check-drift.mjs   # живой MCP-сервер всё ещё совпадает с каталогом
```

## Участие · Безопасность · Лицензия

См. [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md). Apache-2.0.

Версия 0.6.4.
