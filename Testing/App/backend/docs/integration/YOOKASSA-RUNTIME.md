# ЮKassa: изолированный тестовый runtime

2026-10-08, время ниже UTC. Только test shop 1489695; production billing и реальные списания не включались. Provider E2E завершена, новые provider POST запрещены. Контракт: [YOOKASSA-TESTING.md](YOOKASSA-TESTING.md). Final frontend развёрнут; designer targeted recheck и actual UI outage/recovery прошли. Локальные commits выполняются отдельно, без push и deployment основного production приложения.

## Текущее состояние

Изолированный Compose project `botai-billing-test`: frontend `http://localhost:13002/billing/sandbox`, backend `127.0.0.1:18084`, PostgreSQL 17.11/БД `botai_payments_test`, Garage 2.3.0, Mailpit и mock AI. Шесть сервисов healthy по final-runtime-closure-receipt.json. Отдельные volumes/networks/секреты; DB/Garage/AI/Mailpit не имеют host ports. Garage private bucket ограничен 1 GiB/2000 objects, anonymous GET/list и website access запрещены. Main production app/DB и существующий local integration не менялись; единственное добавление ingress описано ниже.

| Компонент | Текущий image ID |
|---|---|
| Backend | `sha256:5c9c25f474d635308556d418e7bf71c931ef04ed67f036dd2005aefabf1a4007` |
| Frontend | `sha256:20de438756874e37a44e10b889d4255c0cfea0b1e142bc9d01cd4f1bfcc95b88` |
| Mock AI | `sha256:dbe402aeaf52047b29cf52dd8c69ccc0790d77a389b40237b4885d906ecfceb9` |

Backend source 135 files aggregate `77b4f2ad1ab44b721e63eff1b352f9631e5cb8e1870f0c243b8541bbb9c3519f`; независимый security review и exact Java21 fullsuite:152 tests,150 passed,2 прежних S3 skips,0 failures/errors. Frontend 639-file aggregate `6f69d6c99be5adacc5c7b76a064b31ddd1474e8cf59457cde5561bb4ad3231be`. Все receipts ниже лежат в приватном `runtime/evidence/billing-test/`: `backend-adversarial-security-review-receipt.json`, `frontend-padding-final-rollout-receipt.json`, `infra-final-source-receipt.json`. Frontend-only swap 14:29:13 UTC: только один container ID изменён,6 healthy, все 6 billing-table fingerprints сохранены; backend/DB/tunnel не менялись. ErrorNote paid-management, training short-height, home container width и multiline billing controls входят в этот образ.

Frontend local commit `3e6317440fd84786c643c1a9f3f3c10000fbcb24` (`develop`,44 scoped paths); hooks PASS, code/config hashes совпали с final image freeze, docs-only QA дополнен. Push не выполнялся.

Actual DB V14. Runtime app role имеет DML/sequence usage, без owner/superuser/CREATE/role memberships/Flyway privileges; миграционных секретов в backend нет, Flyway=false. Billing test-mode допускает только четыре verified USER. AI жёстко mock/mock/debug=false/no live keys; S3 signed roundtrip/delete/anonymous denial и auth/CSRF/ownership/allowlist smoke PASS. Обычный `users.plan_id` остаётся free; оплаченные права отдельные.

## Проверенные платежи

| Операция | RUB | Итог | Начисление |
|---|---:|---|---|
| Core initial |699|succeeded|70 текущих;1mock-проверка использована,69 осталось|
| Core early renewal |699|succeeded|70 будущих с07ноября до07декабря; текущая квота не выросла|
| Light initial |299|succeeded|30 до07ноября; восстановление после реального backend outage|
| Light early renewal |299|canceled, verified insufficient_funds|0; текущие30 сохранены, auto off|
| Heavy season one-off |4999|succeeded|880 до2027-06-10T21:00Z; без подписки/saved method|

Ровно 5 logical payments/5POST authorizations/4grants,0 pending/0 reservations/0 active autoRenew. Core auto отключён пользователем, paid periods сохранены. Три synthetic повторных callback дали0дубликатов; отрицательный повтор Core early CLI —0новых операций. Первый отказ карты Core оставил invoice pending: затем успешно оплачен тот же order. Это не terminal decline. Renewal decline Light отдельно подтверждён provider GET. `e2e-final-ledger-receipt.json`, `core-duplicate-and-cancel-negative-receipt.json`, `core-mock-check-receipt.json`, `light-renewal-decline-receipt.json`.

**Без зависимости от браузера:** Light backend остановлен13:50:42, ingress502. Первое мгновенное Pay→close оставило provider pending; root возобновил тот же invoice, увидел processing и закрыл вкладку до success/return. Direct GET13:53:23 подтвердил paid при local pending/0grant. После START13:53:43–44 grant 30 создан13:53:47.490745 при отсутствии app tabs/refresh/synthetic callbacks. Actual callback пришёл позже13:55:10.254023505; первая выдача была фоновой. Receipt `light-autonomous-recovery-receipt.json`.

Heavy processing→close также прошёл без app return/refresh; direct GET подтвердил paid/saved=false, grant 880 создан13:59:55.130113. Exact browser-close timestamp не сохранён, поэтому точный порядок close относительно grant не заявляется. Actual callback получен13:59:23.383494428. Receipt `heavy-autonomous-oneoff-receipt.json`. Всего actual known callback 4 (Core initial, Light initial/decline, Heavy), synthetic duplicates 3 отдельно. Core renewal actual callback не наблюдался; succeeded не объявляется доказательством доставки callback.

Root browser QA подтвердил logout/new-session restore Core 69+future70, Light 30 после outage и decline, Heavy 880 без auto controls; пользовательский test@test.test login/offers PASS, purchases0. Screenshots `ui-core-new-session-restored.jpg`, `ui-light-after-outage.jpg`, `ui-light-renewal-declined.jpg`, `ui-heavy-season-restored.jpg`.

**Финальный UI gate:** designer подтвердил training short-height, home narrow-column и billing multiline/text-200% исправления. Actual management outage: backend остановлен14:33:46, root GET «Обновить статус» показал видимую ошибку/«Повторить» с сохранёнными69/70, paidThrough и autooff (375×812). Тот же контейнер/image запущен,6 healthy14:35:07; root Retry только GET убрал ошибку без checkout/новой оплаты, финальный screenshot360×640. Все6billing-table fingerprints и 5 payments/5POST authorizations/4grants неизменны. `management-outage-receipt.json`, `ui-paid-management-network-error.jpg`, `ui-paid-management-network-restored.jpg`, `final-runtime-closure-receipt.json`. Backend 135 и frontend 639 code hashes повторно сверены без drift (`final-code-source-verification.json`).

Root оставил браузер на `/billing/sandbox` под `test@test.test`: offers видны, purchases0; merchant tab сохранена, договор не менялся.

## Ingress, credentials и эксплуатация

Merchant root сохранил test webhook/events через UI; `/v3/me` подтвердил test=true/account match/enabled. Exact public POST `https://www.botai-ege.ru/api/billing/yookassa/test/webhook` →remote127.0.0.1:18084→owned SSH-R→localbackend. GatewayPorts=no, actual binding loopback; Cookie/Authorization stripped, body caps64000/16384bytes, other methods405, suffix denied, tunnel/backend down502 без production fallback. Caddy SHA `b60dddc332475e45598ae1a23ac3ae7a9c338f1f98ddfefcd0f327dc54677acf`; добавлен только exact handler, без global error handler. Backup `/srv/botai-public/runtime/Caddyfile.before-billing-test-20261008`, root:caddy0640. Public home/API Secure cookies сохранились; localhost sandbox Secure=false намеренно.

Private 0600/gitignored: `runtime/.env.billing-test` и `runtime/evidence/billing-test/*`; каталог 0700. Fixtures: `fixture.json` Core, `fixture-decline.json` Light, `fixture-pack.json` Heavy, `fixture-user-smoke.json` test@test.test с ранее разрешённым паролем из `runtime/credentials.json:smoke_test`. Пароли/keys/payload/card data в journal/log receipts отсутствуют; known-webhook audit содержит только timestamp/exactroute/localUUID/requestUUID/event/status.

Все команды только через scoped helper:

```sh
scripts/integration/billing-test-compose.sh ps
python3 scripts/integration/billing-test-tunnel.py status
python3 scripts/integration/billing-test-tunnel.py stop
# После проверки approved Caddy; занимает foreground, не затрагивает другие SSH:
python3 scripts/integration/billing-test-tunnel.py start --reviewed-ingress
```

Останавливать стенд через `stop`, не `down -v`. Runtime/tunnel пока активны, readonly observer остановлен. Recreate только выбранных sandbox services с точными reviewed image IDs; provider POST требуют отдельного разрешения. Fresh `initialize` допустим только для пустой dedicated БД; существующая V14 не инициализируется заново. Additive `billing-test-upgrade.py --execute --image sha256:…` предназначен только для V13→V14, с transient migration credentials, backup/fingerprints и повторным no-op; currentV14 отказал бы без reset/clean/repair.

Backup evidence: `upgrade-v14-20261008T131038Z/receipt.json` —46 старых таблиц/V1–V13 сохранены,3 таблицы добавлены. Последний patch backup `rollout-adversarial-20261008T134553Z/before.dump` SHA256 `7e97ffbb67eea4fd9daa866cff0435235e7a63bd70049ba6a5eee8d17406302e`; все 49 таблиц/V1–V14 сохранены, миграций не было. Оба custom dumps 0600, pg_restore --list PASS; полный restore этих sandbox dumps не выполнялся. При сбое — review фактической версии и исправление вперёд; автоматического restore поверх актуальных данных нет.

Offline 20 days/30-day rollover, concurrency/fencing/atomic reservation release проверены controlled-clock integration tests, не реальным ожиданием. Full server outage дольше 24ч notification retention при неизвестном provider ID требует ручного разбора; повторный charge после 23ч запрещён. Live payments/production recurring, чеки/возвраты, смена метода/upgrade и seasonal price aging не проверялись. Locale ru_RU сохранён в новых requests, однако provider UI оставался английским; причину не утверждаем.
