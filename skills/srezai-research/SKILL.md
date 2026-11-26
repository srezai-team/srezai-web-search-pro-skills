---
name: srezai-research
description: "Проверка и синтез: вердикт по факту с цитатами (verify до текста), готовый ответ по источникам, глубокое исследование. Триггеры: «проверь факт», «проверь до текста», «собери ответ», «исследуй тему». English: fact check, verify claim, deep research, cited answer."
license: Apache-2.0
---

# srezai-research — проверка, готовый ответ, глубокое исследование

Ступени синтеза: `search` → `answer` → `verify` → `deep`; начинай с дешёвой,
что закрывает задачу.

## Как позвать: MCP → CLI → REST

1. **MCP** — если хост дал инструменты srezai (`verify_claim`, `answer_search`, `deep_research`), зови их напрямую.
2. **CLI** — есть shell и `srezai-cli`: `srezai …`.
3. **REST** — только HTTP: `POST https://srezai.ru/api/v1/…` с `Authorization: Bearer srz_live_…`.

Каналы и таблица — [references/how-to-call.md](references/how-to-call.md).

## Быстрый старт

```bash
srezai verify "Node.js 22 — LTS" --language ru --max-sources 3
```

## Инструменты

| Инструмент | Зачем | Цена |
|---|---|---|
| `verify_claim` | Проверить одно утверждение с дословными цитатами | 8 кредитов за вызов |
| `answer_search` | Готовый связный ответ по нескольким источникам | 3 (fast) / 5 (balanced) / 10 (deep) кредитов |
| `deep_research` | Многошаговое исследование темы с готовым ответом и источниками | 20 кредитов + 3 за каждую 1000 output-токенов |

### `verify_claim` — Проверить одно утверждение с дословными цитатами

```bash
srezai verify "Node.js 22 — LTS" --language ru --max-sources 3
```

8 кредитов за вызов · 2–5 источников. Параметры: claim, query, language, timeRange, maxSources.

Когда НЕ он: нужен обзор темы — это deep_research; нужен текст страницы — read_url.

- `unverified` и `mixed` — честный результат, а не сбой
- каждая цитата сверена с текстом страницы

Вывод: verdict, confidence, agreeing/disagreeing, evidence[] с цитатами, caveats. Подробнее — [references/verify_claim.md](references/verify_claim.md).

### `answer_search` — Готовый связный ответ по нескольким источникам

```bash
srezai answer "вопрос" --depth balanced
```

3 (fast) / 5 (balanced) / 10 (deep) кредитов · 2 (fast) – 10 (deep) страниц. Параметры: query, depth (fast|balanced|deep), language.

Когда НЕ он: нужен список ссылок — web_search в 20 раз дешевле; нужен один факт — тоже мимо.

- нужен список ссылок — `search` дешевле в 20 раз
- `fast`=3, `balanced`=5, `deep`=10 кредитов

Вывод: answer, sources[] с relevance, confidence, pagesRead. Подробнее — [references/answer_search.md](references/answer_search.md).

### `deep_research` — Многошаговое исследование темы с готовым ответом и источниками

```bash
srezai deep "тема" --async → srezai deep status <ticket>
```

20 кредитов + 3 за каждую 1000 output-токенов · обычно 3–10 минут, до 42. Параметры: query, ticket (дозабор готового ответа — бесплатно).

Когда НЕ он: нужен один факт или список ссылок — это web_search.

- синхронный режим обрывается ~на 150-й секунде — для долгих тем только `--async`
- дозабор по талону бесплатный

Вывод: async: талон 202; status: stage, progress, result, error. Подробнее — [references/deep_research.md](references/deep_research.md).

## Процедуры

### Проверка утверждения (verify-first)
1. Сформулировать утверждение одной фразой.
2. `srezai verify "…" --language ru --max-sources 3` — **до** того, как писать
   текст.
3. `supported` — можно ссылаться; `refuted` — утверждение неверно; `mixed` и
   `unverified` — **не считать проверенным**, сказать человеку.
4. Цитаты дословные, уже сверены — используй их.

### Готовый ответ
`answer --depth fast|balanced|deep` — это **черновик**: сверяй ссылки.

### Исследование (талон)
`srezai deep "тема" --async` → талон (202); `srezai deep status <ticket>` — опрос
с паузами, дозабор бесплатный. Синхронный `deep` обрывается ~на 150-й секунде.

## Когда остановиться

- Стоп, когда два независимых источника согласны; расхождения назови, не сглаживай.
- Сгенерированный ответ (`answer`/`deep`) — не источник: тезисы сверяй со страницами.
- Цифры, релизы, даты, решения органа — только официальный домен или первоисточник.
- Каждый фактический тезис — с inline-ссылкой; в конце — секция «Источники».
- Пять шагов и контракт цитат — [references/research-workflow.md](references/research-workflow.md).

## Правила

- `deep` и `verify` — последняя ступень; перед ними — бесплатный `get_usage`.
- `unverified`/`mixed` — не факт. Ошибки —
  [errors.md](../srezai-web/references/errors.md), безопасность —
  [security.md](../srezai-web/references/security.md).

## Версия

Скиллы 0.6.4.
