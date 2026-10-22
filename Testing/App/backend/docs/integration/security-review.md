# Security review интеграции, 2026-10-04

Статический аудит трёх локальных репозиториев; production-конфигурация изучена по sanitized reference в AI, не подтверждена этим аудитом на сервере. Секреты не читались. Код не менялся.

## Подтверждено в коде

| Область | Факт и следствие |
| --- | --- |
| Backend auth | `security/SecurityConfig.java`, `auth/AuthService.java`: BCrypt через delegating encoder, PostgreSQL sessions, CSRF, смена session ID, явный `saveContext`; сохранить существующую схему |
| Cookies | `application.yaml:26,55`: idle timeout 14 дней, `secure: false`; production override обязателен и должен проверяться фактическим `Set-Cookie` через proxy |
| Admin | `SecurityConfig.java:36` проверяет лишь authenticated; `Role.ADMIN` пока не защищает маршруты. До admin API добавить явное ограничение роли |
| Отзыв доступа | Principal содержит роль на момент входа; `currentUser()` не проверяет enabled. Блокировка/понижение роли должны отзывать сессии; admin-проверка должна учитывать актуальный статус пользователя |
| Пароли | `RegisterRequest.java:10`: `@Size(max=72)` ограничивает Java-строку, не UTF-8 bytes; BCrypt требует отдельной проверки byte length без усечения. У login нет верхнего предела длины |
| Auth abuse | Rate limit в backend не найден; регистрация раскрывает наличие email через 409; конкурентная регистрация полагается на unique index, но конфликт БД отдельно не преобразован |
| Frontend | `lib/api/client.ts` и `next.config.ts`: единый same-origin proxy и CSRF; auth store не persisted. `botai-profile`, `botai-tasks`, `botai-mock-exams` имеют общие persisted keys без user scope; требуется очистка/изоляция при смене аккаунта |
| AI contract | `app/api/routes_grading.py`: `/api/v1/photo-check` принимает фото задания и 1–4 фото решения; это standalone test identity, не DB user. `GradingService.run()` сам OCR-ит условие/ответ; прямо подключать к продукту нельзя |
| AI images | `app/grading/images.py`: decode + re-encode JPEG, удаление metadata, JPEG/PNG/WebP, 8 MiB, 20 MP, сторона 8192, запрет анимации; текущий путь не принимает remote URLs |
| AI boundary | `Session`: allowlist виртуальных файлов/tools, привязка task/image IDs к запросу, возвращается точный валидированный JSON. Сохранить эти гарантии; отказ имеет `is_graded=false`, score отсутствует |
| AI history | `app/grading/reports.py` хранит только подозрительные случаи с тестовыми ID и retention 30 дней; это не история всех попыток |
| AI exposure | Встроенной service-auth у grading routes нет; защиту предоставляет proxy. Legacy routes остаются mounted, допускают клиентские statement/reference/features, upload читает файл целиком до проверки размера |
| Proxy drift | `deploy/caddy-host.Caddyfile` разрешает `/api/v1/*` через `/api/auth/session/verified`; такого auth endpoint в текущем backend нет. Не заменять работающий auth этим checkout без миграции и проверки маршрутов |
| Debug drift | AGENTS требует выключить debug в prod; `app/config.py` допускает `DEBUG_ALLOW_IN_PROD=true`. Новый production stack должен запретить этот override; legacy/debug не включать в product ingress |

## Обязательные решения для реализации

1. Browser → backend → AI. Backend получает owner только из сессии; клиент не задаёт user ID, role, plan, score, streak, task version, эталон, AI model/features/URL или S3 key. Profile PATCH имеет allowlist редактируемых полей; тариф/прогресс меняются сервером.
2. Same-origin `/api` сохранить. Production SESSION: Secure, HttpOnly, host-only, Path=/, SameSite=Lax; CSRF cookie остаётся читаемой JS. Не расширять cookie Domain на sibling develop. При возможности перейти согласованно на `__Host-` cookies. Cookie auth требует CSRF для всех мутаций; internal AI auth не является исключением для browser routes.
3. Custom login должен выполнить session/CSRF authentication strategy, затем сохранить context; проверить ротацию CSRF при login/logout и получение свежего токена frontend. Сейчас видна только ручная смена session ID. [Spring CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)
4. Login/register и создание submissions: ограничение частоты по user/account и IP, ограниченные body/time/concurrency; trusted proxy фиксирует настоящий client IP. Per-user quota/plan проверяется атомарно до enqueue. Не считать client-side лимиты защитой.
5. Все запросы history/favourites/exams/attachments фильтруются по owner в БД. UUID не заменяет проверку доступа. Для чужого объекта возвращать одинаковый 404; admin использует отдельный маршрут/permission и audit event.
6. Public task DTO не содержит reference answer/solution до разрешённого продуктового момента. Пробник хранит серверный набор ровно 20 task/version IDs; membership проверяется на сервере. Квиз-моки не записывают настоящий прогресс/тариф.
7. Internal AI API: отдельный маршрут, недоступный public ingress, обязательный service token с constant-time comparison; без токена конфигурация fail-closed. Loopback/private network, HTTPS между хостами. Браузерные Cookie/Authorization не пересылать AI; служебный секрет не помещать в `NEXT_PUBLIC_*`.
8. AI получает только server snapshot task ID/version, statement, reference answer, разрешённый reference solution, task number/max score и нормализованные фото с непрозрачными IDs. Email, имя, возраст, тариф, история и S3 credentials не нужны. Eval hidden expert answers по AGENTS не передаются; учебный эталон задачи является отдельным полем.
9. AI output повторно проверяется backend: schema/version, task/image IDs, score range и соответствие `is_graded`; invalid/error никогда не превращается в 0 баллов. Сохранять проверенный оригинальный JSON отдельно от безопасного product DTO; не отдавать клиенту raw upstream errors/prompts/служебные поля.
10. OCR, AI feedback, названия файлов и имена пользователей отображать как текст либо разрешённые math-блоки; не вставлять raw HTML. Запросы/ответы не логировать целиком; request ID генерировать или строго ограничивать. В audit только actor/action/object/time/result, без фото/паролей/cookies/подписанных URL.

## История без потерь и без повторной оплаты

- До multipart создать небольшой JSON submission intent: durable ID, session owner, idempotency key (unique per owner), request time и requested task ID. Проверки business validity завершают тот же intent отказом; неизвестный task ID не должен требовать существующего FK для записи rejection.
- Фото загружаются к intent; предельный размер проверяется на proxy и streaming ingress, затем decoder. При 413 до controller строка intent уже существует; bounded edge log содержит request/intent ID без тела. Reconciler завершает зависший intent как upload failed/abandoned. Нельзя обещать запись в product history запроса, который не дошёл даже до создания intent; для него есть ограниченный security/edge log.
- Некорректный файл оставляет reason code и ограниченные metadata, а не raw unsafe bytes. Невалидность, unreadable, attack, provider failure, timeout, cancel и successful grading сохраняются как разные события. Удаление/retention фото не удаляет факт события.
- После готовности нормализованных фото: submission transition + Postgres job/outbox в одной транзакции. Worker claim через `FOR UPDATE SKIP LOCKED`, lease, bounded concurrency; долгий HTTP выполняется без открытой DB-транзакции.
- Перед HTTP фиксировать provider run + DISPATCHING и commit. После crash/timeout на этой границе считать исход неизвестным, не автоматически повторять платный запрос. Reaper автоматически возвращает в очередь только заведомо pre-dispatch работу. Явный retry создаёт новый run, исходная попытка сохраняется.
- Exactly-once inference без idempotency AI не гарантируется. Unique job/run IDs и условные transitions исключают двойную выдачу прогресса; fencing token/claim version запрещает устаревшему worker перезаписать результат после истечения lease. Browser abort не удаляет job/history.

## Private S3 и admin

- Предпочтителен официальный AWS SDK Java v2 после согласования зависимости; не писать собственный SigV4. Для MVP browser загружает через backend; AI получает bytes, без S3 URL и разрешений. Credentials только у backend, только нужные bucket/prefix/actions.
- Bucket private с запретом public access/ACL, шифрование at rest, TLS. Object key генерируется сервером, immutable, без email/исходного имени. БД хранит owner, purpose, state, size, hash, media type, created/deleted time; не подписанный URL. [AWS S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/granting-public-access.html)
- Сохранять только перекодированные статические JPEG/PNG/WebP; avatar обрабатывается отдельным меньшим размером/разрешением. Определять тип декодированием, проверять bytes/pixels до полного выделения памяти, ограничивать параллельные decoders. Не принимать SVG/HTML/PDF/URL как фото. [OWASP uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- Просмотр фото: authenticated backend stream с owner/admin check, `Cache-Control: private, no-store`, правильный image type и nosniff. Presigned GET допустим после такой же проверки, TTL 60–300 секунд; это переносимый bearer-доступ до истечения срока, а не постоянная ссылка. Предпочтителен stream для admin.
- S3+DB не имеют общей транзакции: staged key/state, подтверждение записи, затем READY/outbox; reconciler чистит orphan objects. Повтор finalize идемпотентен; чужой, старый, удалённый или уже привязанный upload не принимается. Нельзя перезаписать уже проверенное фото.
- Admin API: актуальная роль ADMIN, пагинация и пределы фильтров; любое чтение подробностей/фото и изменения фиксируются. Нет кнопок выполнения команд/произвольного SQL, raw HTML preview или прямого доступа к bucket. Production admin через ограниченный ingress/MFA-границу; роли не назначаются публичной регистрацией.

## Матрица обязательных проверок

| Проверка | Ожидаемый результат |
| --- | --- |
| Anonymous/USER → history/photo/admin; чужой task/attempt/upload/exam ID | 401/403/404, нет чужих данных и AI вызова |
| Нет/чужой/stale CSRF; login/logout; заранее созданная сессия | Мутация отклонена, session и CSRF обновлены; logout/disable/role downgrade отзывают доступ |
| Unicode password >72 UTF-8 bytes; огромный login; race register | Предсказуемый 4xx, нет truncation/500/неограниченного BCrypt CPU |
| MIME spoof, SVG/polyglot, EXIF GPS, corrupt, animated, decompression bomb, missing Content-Length | Ограниченный reject/re-encode, нет metadata и unsafe bytes; intent остаётся |
| Повтор idempotency key, concurrent finalize/workers, crash до/после dispatch, browser abort | Одна логическая submission, нет автоматического повторного платного запуска и двойного прогресса |
| AI timeout/429/5xx/malformed/wrong IDs/out-of-range/attack | История сохранена, score отсутствует у ошибки/отказа, исходный успех не перезаписан |
| Prompt injection в фото/OCR/эталоне; traversal/tool names | Нет network/filesystem powers, сохранены allowlists и request binding |
| Private bucket/object URL, expired presign, чужой upload, S3 failure/orphan | Анонимный доступ запрещён; отказ безопасен, cleanup идемпотентен |
| Logout → другой аккаунт; production build + routing | Нет прежних persisted данных; mocks/dev/legacy/debug не дают настоящие права или расходы |
| Oversize/slow requests, queue flood, duplicate retries | Bounded memory/connections/queue; user/rate quota атомарна; история и edge log не становятся бесконечным хранилищем |

Проверено офлайн: `LLM_PROVIDER=mock LLM_VISION_PROVIDER=mock .venv/bin/python -m pytest tests/test_grading_api.py tests/test_grading_session.py tests/test_grading_validator.py tests/test_gateway.py -q` завершился с exit 0. Платных вызовов и readiness probe не было. Backend auth-тесты изучены, в этом аудите не запускались; новая матрица пока не реализована.

## Нерешённые вопросы для production

- Retention фото, OCR/feedback, событий и backups; удаление аккаунта; регион S3/обработки и допустимый AI provider. Текущие 30 дней AI-report store не являются согласованной политикой продукта.
- Кто получает ADMIN, механизм MFA/ограниченного ingress; параметры login/submission rate limits, пользовательских квот и общего денежного лимита. У существующего developer gateway документированно нет общего бюджета; не переносить это автоматически в B2C.
- Покрытие AI: текущий валидированный пакет обслуживает project task 16; для остальных номеров нельзя выдавать синтетическую оценку как реальную. Нужна capability policy и явный unsupported status.
- Миграция существующих production auth/users/sessions и proxy routes, срок жизни сессий; один изолированный mock stack до переключения. Release gate: вся матрица выше, проверка фактических cookies/ingress/storage policy, восстановление backup без утраты истории.

## Review DRAFT SPEC, 2026-10-05

- Согласованы: internal token fail-closed до multipart parsing, private ingress, отсутствие account PII/credentials/URL в AI; лимиты 33 MiB total/8 MiB file/4 images; registry14–20 с единственным supported16, без новых prompts (`ai-contract.md:13–35`).
- Закрыт disclosure: обновлённый `SPEC.md:47,70` убирает public raw `aiResponse`, содержащий reference даже при rejection; exact JSON остаётся storage/admin, user получает typed projection, reveal разрешён только checked/graded item.
- Закрыт upload race: `SPEC.md:46,69,76` задаёт revision/expectedRevision, атомарный max4 с учётом staged slots, запрет finalize при in-flight uploads и draft/revision check при READY commit.
- Закрыт повторный dispatch: `SPEC.md:78` требует CAS claimed state+fencing+живой lease до HTTP; неуспешный CAS запрещает вызов. Проверить тестом старого worker после reaper/reclaim и cancellation.
- Закрыт mock/live drift: `SPEC.md:80` связывает mode/package с каждым response. Синхронизировать точные `X-Grading-Provider-Mode`/`X-Grading-Package-Id` в `ai-contract.md:24`; проверять pinned capability, сохранять run metadata, mock не начисляет real progress.
- Для HTTP adapter согласовать точные ресурсные defaults: response≤1 MiB до JSON parsing, total deadline≤390s (AI360s + transport margin), redirects/retries disabled. Это bounded adapter к принятому контракту, не новый сервис или scope.
- Worker intent→queue→dispatch→terminal, immutable history, explicit retry и cancellation без late progress согласованы. Garage допустим для private local/staging по `runtime-plan.md:31–36`; AWS BlockPublicAccess/ACL нельзя считать работающими в Garage, отрицательный anonymous GET обязателен.
- Уже объявленные coordinator fixes client-rejection/retryOfId/daily-task solution повторно не запрашиваются. Это review контракта; новые endpoints/queue/storage не исполнялись, production или оплачиваемый AI не проверялись.
- После повторного чтения исправленного SPEC pre-implementation security gate подтверждён; реализация и production допуск требуют ранее согласованных отрицательных/race tests, это не подтверждение безопасности ещё не написанного кода.
