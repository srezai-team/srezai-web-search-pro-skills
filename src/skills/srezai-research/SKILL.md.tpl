---
name: srezai-research
description: {{DESCRIPTION}}
license: Apache-2.0
---

# srezai-research — проверка, готовый ответ, глубокое исследование

Ступени синтеза: `search` → `answer` → `verify` → `deep`; начинай с дешёвой,
что закрывает задачу.

{{HOW_TO_CALL}}

## Быстрый старт

```bash
{{CLI_EXAMPLE}}
```

## Инструменты

{{TOOLS_SUMMARY}}

{{TOOL_DETAILS}}

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

Скиллы {{VERSION}}.
