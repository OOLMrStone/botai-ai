# BotAI frontend

Next.js 16 / React 19 frontend для ученика, эксперта и журнала проверок.

## Локальный B2B-стенд

Нужны Node.js 22.23+ (проверено на 22.23.1), npm и запущенный B2B backend на `http://127.0.0.1:18086`. Для Windows используй WSL. Общая инструкция по backend, AI, seed и приватным учётным данным находится в [Testing/App/prompt.md](../prompt.md); frontend не содержит ключей AI и не вызывает провайдера напрямую.

```bash
cd Testing/App/frontend
npm ci
BACKEND_URL=http://127.0.0.1:18086 NEXT_DIST_DIR=.next-b2b-local npm run dev:api -- --webpack --hostname 127.0.0.1 --port 13004
```

Открой три отдельных адреса, чтобы роли не делили session cookie:

- Ученик: <http://student.localhost:13004/school>
- Эксперт: <http://expert.localhost:13004/grade>
- Журнал проверок: <http://dev.localhost:13004/grade/dev>

Если система не разрешает имена `*.localhost`, добавь в локальный hosts-файл строку `127.0.0.1 student.localhost expert.localhost dev.localhost`. Вход выполняется учётными данными, созданными backend seed на твоей машине. Для журнала нужен эксперт с соответствующим серверным доступом. Запуск frontend и открытие страниц не запускают платную проверку; отправка решения или пересчёт оценки используют настроенный backend/AI.

`npm run dev` включает отдельный B2C/mock-режим и не подходит для полного B2B-пути. `.env.local` можно создать из `.env.example`, но для команды выше это необязательно. В Git нет приватных фотографий, локальной БД, паролей и личной проекции разбора. Старый mock `/experimental` поэтому не включает фотографию решения; реальные кабинеты получают файлы через защищённый backend API. `B2B_PRESENTATION_FIXTURE_DIR` оставь пустым, если у тебя нет отдельно подготовленного приватного набора личного показа.

## Проверки

```bash
npm run lint
./node_modules/.bin/tsc --noEmit
BACKEND_URL=http://127.0.0.1:18086 npm run build:api-dev -- --webpack
```

Тесты offline: модель и платные проверки не вызываются. Версии зависимостей фиксирует `package-lock.json`; `npm ci` сохраняет этот набор. Подробности текущего поведения: [SCOPE.md](SCOPE.md), [контракт эксперта](docs/expert-backend-contract.md).
