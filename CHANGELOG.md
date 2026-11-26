# Changelog

## [0.6.4] — 2026-11-26

Универсальный вход: навыки больше не предполагают CLI. Любой агент — MCP-хост,
консоль или чистый HTTP — получает один порядок вызова и таблицу соответствия.

### Added

- **Блок «Как позвать: MCP → CLI → REST»** в каждом из 10 `SKILL.md`. Порядок:
  сначала инструменты srezai, если хост их дал (так работает Claude Code/VS Code
  после подключения `https://srezai.ru/api/mcp`, Skills over MCP); затем CLI
  `srezai …`, если есть shell и `srezai-cli`; затем REST
  `POST https://srezai.ru/api/v1/…` с `Authorization: Bearer srz_live_…`. Блок
  генерируется из `src/tools.json` через `{{HOW_TO_CALL}}`, а не копипастится в
  десять шаблонов.
- **`references/how-to-call.md`** в каждом скилле: тот же порядок каналов, установка
  CLI, контракт REST и таблица «CLI → MCP → REST». У инструментальных навыков —
  только свои инструменты, у `srezai-web` и руководств — все 13.
- `src/tools.json`: поле `rest` (метод + путь) у каждого инструмента и
  `call_examples`; таблица каналов в `docs/tools.md`; `served_over_mcp` в
  `manifest.json`; в `llms.txt` — что навыки отдаёт и сам MCP-сервер.
- README (RU/EN): три канала в порядке приоритета и Skills over MCP как способ
  поставки без установки.

### Changed

- **`allowed-tools` убран из frontmatter всех 10 шаблонов.** По спецификации Agent
  Skills поле необязательное и экспериментальное: это список инструментов,
  которые хост заранее одобряет, с host-specific синтаксисом (`Bash(srezai *)` —
  Claude Code). Навык, который может исполняться через MCP, CLI или REST, не может
  перечислить эти инструменты переносимо, поэтому разрешения остаются у хоста, а
  скилл описывает канал и не просит доступов. Решение и причина зафиксированы в
  `docs/writing-skills.md`.
- README больше не утверждает, что скиллы «зовут CLI и откатываются на MCP»:
  фолбэка нет, порядок MCP → CLI → REST описан явно в каждом навыке.
- Версия 0.6.4.

## [0.6.3] — 2026-11-23

### Changed

- Репозиторий переименован: `srezai-web-search-pro-skill` → **`srezai-web-search-pro-skills`**
  (набор растёт, множественное число честнее). GitHub редиректит старый путь, но все
  команды установки и манифесты обновлены на новое имя.
- Скилл `srezai-sourcing` переименован в **`srezai-china-sourcing`**: в листинге
  реестра видно домен, а не абстрактный «sourcing».
- Версия 0.6.3.

## [0.6.2] — 2026-11-23

### Added

- **`srezai-sourcing`** (guide) — закупки и поставщики в Китае: два прохода EN/ZH,
  `site:`-фильтры по 1688/zhihu/gov.cn, карточка поставщика по JSON-схеме (город,
  адрес, контакт, MOQ, цена, сертификаты), матрица доказательств и пометки
  достоверности, стоп-правила и формат отчёта. References: `channels.md`,
  `query-patterns.md`, `supplier-card.md`, `checklist.md`.
- Группа `Verticals` в `skills.sh.json`.

### Changed

- Бюджет описаний 3000 → 3300 символов (2631 занято) — десятый скилл.
- Версия 0.6.2.

## [0.6.1] — 2026-11-23

Внешняя находимость: SEO/GEO-слова в описаниях, русский блок для LLM, метаданные
реестров. Код и процедуры скиллов не менялись.

### Changed

- Описания девяти скиллов переписаны под поисковые и агентные интенты: добавлены
  `scrape page`/`scrape section`/`scrape SERP`, `news search`, `crawl website`,
  `sitemap`, `fact check`, `SDK`, `switch provider`, `bake-off`, русские триггеры
  «поищи в интернете», «новости за неделю», «обойди сайт», «почему 401»,
  «сколько потрачу», «бенчмарк», «переезд с Tavily». Бюджет описаний 2600 → 3000
  символов (2373 занято).
- `llms.txt`: добавлен русский раздел «For Russian-speaking readers (RU)» —
  возможности, покрытие рунета и что уходит в телеметрию (имя клиента и скилла,
  без текста запросов).
- Версия 0.6.1.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions are semantic.

## [0.6.0] — 2026-11-20

Операционные правила, три скилла-руководства, мультихарнесс-поставка и
воспроизводимый harness оценки. Разбор конкурентов, из которого это выросло:
`research/competitor-skills-analysis-2026-11-20.md`.

### Added

- **`srezai-build`** (guide) — встроить srezai в код: выбор канала, ключ, ошибки по
  `code`, идемпотентность, лимиты, примеры Node/Python/curl/MCP, чек-лист перед
  релизом. References: `integration.md`, `examples.md`, `checklist.md`.
- **`srezai-migrate`** (guide) — переезд с Tavily / Firecrawl / Exa / SerpAPI: таблица
  соответствия инструментов, потерянные функции, grep остатков, проверка после
  переезда. References: `mapping.md`, `checklist.md`.
- **`srezai-eval`** (guide, **user-invocable**) — методика воспроизводимой оценки:
  датасет, манифест, ≥3 прогона, судья, p50/p95, учёт фейлов и цена.
  References: `dataset-and-manifest.md`, `metrics-and-report.md`.
- **`scripts/eval/`** — запускаемый harness: `positions.json` (25 позиций, en/ru/zh),
  `run.mjs` (dry-run по умолчанию, `--live`, `--repeats`, `--max-credits`,
  артефакты прогона, p50/p95, стоимость), `grade.mjs` (лист судьи CSV → `grades.json`,
  пересборка отчёта), `test-dry-run.sh`, README с разделом «Ограничения метода».
- **Операционные разделы в существующих скиллах**:
  - `srezai-research`: verify-first (проверка **до** текста), «Когда остановиться»,
    контракт цитат, новый `references/research-workflow.md` — пять шагов, Failure
    Recovery по кодам, шаблон вывода.
  - `srezai-web`: «Бюджет до вызова, а не после» (`get_usage`, потолок на задачу),
    «Ошибки: деградировать, а не падать», `references/security.md` — канонический
    файл про untrusted-контент, на который ссылаются все скиллы.
  - `srezai-read`: дисциплина больших результатов — окна по `offset`, проверка
    `truncated`/`skipped[]` перед выводом о полноте.
  - `srezai-site`: критерий «Done when» и «обход не гарантирован».
  - `srezai-search`, `srezai-transcript`: «Когда остановиться» / «Не для этого» и
    связка «утверждение из видео → таймкод → verify».
- **Мультихарнесс-поставка** (генерируется): `.codex-plugin/plugin.json`,
  `.cursor-plugin/plugin.json`, `gemini-extension.json`. Плюс `manifest.json` с
  SHA-256 каждого скилла и `AGENTS.md` / `CLAUDE.md` — инструкции для агентов,
  работающих с этим репозиторием.
- `rules/srezai-awareness.mdc` — always-on правило для Cursor: напоминает агенту
  про srezai, даже если задачу не назвали (как `tavily-awareness.mdc` у Tavily).
- `.mcp.json` — hosted MCP-сервер `https://srezai.ru/api/mcp` для плагинов и
  хостов, которые читают этот файл.
- `skills.sh.json` — группы Core / Tasks / Guides для каталога skills.sh.

### Changed

- Генератор поддерживает `kind: "guide"`: скилл без собственных инструментов
  (шаблон не может использовать `TOOLS_SUMMARY`/`TOOL_DETAILS`/`CLI_EXAMPLE`).
- `user_invocable: true` в `src/skills.json` добавляет в frontmatter
  `disable-model-invocation: true` — такой скилл вызывает человек, а не модель
  (использовано для `srezai-eval`, чтобы методика не грузилась в контекст каждый ход).
- Бюджеты: `skill_md_chars` 3830 → 4600 (нужны операционные разделы),
  `descriptions_chars` 1860 → 2600 (три новых скилла), новый гейт
  `extra_reference_chars` 8200 — ручные справочники тоже ограничены.
- `skills.sh.json` и описания: добавлены триггеры «сколько потрачу кредитов»,
  «проверь до текста», «страница не влезла», «цитата из видео».
- CI: проверка группировки `skills.sh.json`, JSON всех манифестов и соответствия
  `manifest.json` файлам `skills/`, прогон `scripts/eval/test-dry-run.sh`.
  `selftest.sh` теперь проверяет все относительные ссылки (включая кросс-скилловые)
  и сами манифесты.

## [0.5.0] — 2026-10-24

### Breaking

- Один скилл `srezai-web` заменён **шестью узкими скиллами** в `skills/`:
  `srezai-web` (вход: каналы, ключ, оплата, экономика, ошибки), `srezai-search`,
  `srezai-read`, `srezai-site`, `srezai-research`, `srezai-transcript`.
  Корневого `SKILL.md` больше нет — поставь набор заново:
  `npx skills add srezai-team/srezai-web-search-pro-skill`.
- Дефолтный путь — **CLI `srezai`** (пакет `srezai-cli`, ноль зависимостей);
  MCP и REST остаются как fallback для хостов без консоли. Это уменьшает
  контекст: описания набора ≈440 токенов (o200k), типовая задача — один скилл
  плюс один справочник.

### Added

- `src/skills.json` — описания, привязка инструментов и бюджеты токенов.
- `scripts/generate.mjs` собирает `skills/*/SKILL.md`, `references/*.md`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `docs/tools.md`,
  `llms.txt`, `VERSION`, `SHA256SUMS.txt` из `src/tools.json` + `src/skills.json`.
- Поля `cli`, `output`, `notes`, `skill` в `src/tools.json` — единый источник для
  справки CLI, скиллов и справочников.
- Проверка бюджетов в генераторе: описания ≤1 860 символов суммарно,
  SKILL.md ≤3 830 символов, справочник ≤4 800 символов.
- `scripts/selftest.sh` проверяет frontmatter всех скиллов, битые ссылки и плейсхолдеры.
- `scripts/install.sh` ставит весь набор в `$DSH_HOME/skills` и убирает старый
  одиночный `srezai-web.md`.

### Changed

- README (en/ru) переписан под набор скиллов и CLI, с числами по контексту.
- `check-drift.mjs` без изменений: сверяет каталог с живым MCP-сервером.

## [0.4.2] — 2026-10-23

### Changed

- `yt_srt` отдаёт длинные ролики целиком: `maxChars` поднят до 200 000 символов,
  а окна сервиса склеиваются внутри одного вызова (раньше клиент получал первые
  50 000 и должен был сам догадываться о продолжении). Если текста больше,
  в ответе есть сводка «Не влезло в лимит» и `from` по каждому ролику.
- MCP-сервер понимает настройки соединения заголовками `X-Srezai-*`
  (`X-Srezai-Max-Chars`, `X-Srezai-Timestamps`, `X-Srezai-Speakers`,
  `X-Srezai-Credits: off`, `X-Srezai-Format: json`, `X-Srezai-Options` одним
  JSON), чтобы не повторять параметры в каждом вызове; аргумент вызова их
  перекрывает.

## [0.4.1] — 2026-10-23

### Added

- `yt_srt` умеет разметку по говорящим (`speakers: true`): реплики «Спикер 1/2»
  с таймкодами вместо сплошного текста — для интервью, подкастов и круглых
  столов. Это разметка по смыслу реплик, а не диаризация по голосу: имена не
  определяются, на перебиваниях возможны ошибки. Цена — 15 кредитов за ролик
  вместо одного, нужен API-ключ.

## [0.4.0] — 2026-10-22

### Added

- **Step 0.5 — the path from trial to payment** in `SKILL.md`: no key → 25-call trial →
  `[trial_limit_reached]` → key from the chat (`quick-register`) → 20 starter credits →
  `loginUrl` for a top-up page that needs no login or password (24 hours) → 100 ₽
  welcome bonus after Telegram confirmation.
- Honest limits in the same section: `deep_research` is disabled in the trial and on
  starter credits (`[requires_key]`), and existing emails never get a chat key
  (`[account_exists]`, account-takeover protection). New rows for both codes in the
  error table and two new anti-patterns ("registration is broken", retrying research).
- README: skills CLI install (`npx skills add …`) as the first, simplest install path.

### Changed

- Registration flow on the server: a key is issued only to a **new** account; starter
  credits are 20 (2 ₽), one per account.

## [0.3.0] — 2026-10-20

### Added

- `yt_srt` в `src/tools.json`: текст ролика YouTube (ручные или авто-субтитры) прямо
  в контекст агента — 1 кредит за ролик, до 5 роликов за вызов, окно по `from`/`to`,
  таймкоды, продолжение без повторной оплаты. Видео и звук не скачиваются.
- Сценарий «найти ролик через `web_search` (`includeDomains: youtube.com`), затем
  забрать текст через `yt_srt`» — в карту задач.
- Артефакты перегенерированы из источника: `SKILL.md`, `docs/tools.md`, `llms.txt`,
  `VERSION`, `SHA256SUMS.txt`.

## [0.2.0] — 2026-10-07

First public release. The skill is usable by any agent that supports a skills directory
or an MCP server.

### Added

- `SKILL.md` — the procedure: channel detection (MCP → REST/stdio bridge → stop), a
  task-to-tool map, the cost ladder, recovery after errors, mandatory procedures
  (`deep_research` ticket polling, site walks, verification) and a list of anti-patterns.
- Russian-web section: `includeDomains` instead of the unsupported `site:`/`OR`, PDF
  handlers without a `.pdf` extension, slow government sites, freshness windows.
- `src/tools.json` — single source of truth for the 12 tools, their limits and prices.
- `scripts/generate.mjs` — generates the tool block in `SKILL.md`, `docs/tools.md`,
  `llms.txt`, `VERSION` and `SHA256SUMS.txt`; `--check` mode for CI.
- `scripts/check-drift.mjs` — compares the published tool list with the live MCP server
  (`tools/list`) and fails on any difference. Nightly in CI.
- `scripts/selftest.sh` — secrets, line endings, strict-YAML frontmatter, checksums and
  broken relative links.
- `scripts/install.sh` — runs the checks and installs the skill into `$DSH_HOME/skills`.
- `README.md` / `README.ru.md` — landing pages for the repository: a generated tool table,
  install paths (HTTP MCP, stdio bridge, skill file), cost model, FAQ and an honest section on
  when a different tool is the better choice.
- English purposes and prices in the source of truth, so the landing page and `llms.txt` are
  fully English while `SKILL.md` keeps its Russian tool table.
- `assets/social-preview.png` — repository social card, regenerated by `scripts/social-preview.py`
  (the script verifies its own layout geometry, since the card cannot be reviewed by eye in CI).
- CI for GitHub Actions and GitVerse Actions.

### Notes

- The public skill does **not** register accounts on a user's behalf: the agent asks the
  human for a key or for the console link.
- `SKILL.md` states explicitly that a human's instruction outranks the skill, and that a
  failed call is reported with real quota numbers rather than silently replaced by
  another provider.

## [0.1.0] — 2026-10-07

- Internal draft: procedure file for one agent installation. Superseded by 0.2.0.
