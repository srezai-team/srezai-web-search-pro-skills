# Как позвать: CLI, MCP, REST

Один и тот же инструмент доступен тремя каналами. Выбирай по возможностям
хоста, порядок один: **MCP → CLI → REST**.

1. **MCP.** Хост уже дал инструменты srezai — значит, он подключён к
   `https://srezai.ru/api/mcp` с ключом (Claude Code, VS Code, ChatGPT-коннектор).
   Зови инструмент по имени, ставить ничего не нужно. В этом режиме сервер
   отдаёт и сами навыки (Skills over MCP), поэтому отдельная установка пакета
   не обязательна.
2. **CLI.** Есть shell: `npx srezai-cli --help` или `npm i -g srezai-cli`,
   затем `srezai <команда>`. Контекст дешевле: схемы инструментов не грузятся.
3. **REST.** Есть только HTTP: `POST https://srezai.ru/api/v1/<endpoint>` с
   `Authorization: Bearer srz_live_…`, тело — JSON. Все эндпоинты — POST,
   кроме `GET /api/v1/whoami`; ответы совпадают с MCP.

| CLI | MCP-инструмент | REST |
|---|---|---|
| `srezai search` | `web_search` | `POST /api/v1/search` |
| `srezai media` | `image_search` | `POST /api/v1/media` |
| `srezai read` | `read_url` | `POST /api/v1/read` |
| `srezai read` | `read_urls` | `POST /api/v1/read` |
| `srezai extract` | `extract` | `POST /api/v1/extract` |
| `srezai fetch` | `fetch_page` | `POST /api/v1/fetch` |
| `srezai map` | `map` | `POST /api/v1/map` |
| `srezai crawl` | `crawl` | `POST /api/v1/crawl` |
| `srezai verify` | `verify_claim` | `POST /api/v1/verify` |
| `srezai answer` | `answer_search` | `POST /api/v1/answer` |
| `srezai deep` | `deep_research` | `POST /api/v1/deep` |
| `srezai transcript` | `yt_srt` | `POST /api/v1/transcript` |
| `srezai whoami` | `get_usage` | `GET /api/v1/whoami` |

Ключ — `SREZAI_API_KEY` или `~/.config/srezai/config.json` (chmod 600);
в чат, в файлы и в коммиты ключ не вставляй. Списания во всех каналах
одинаковые; MCP дополнительно занимает контекст схемами инструментов.

<!-- сгенерировано из src/tools.json v0.6.4 (2026-11-26); руками не править -->