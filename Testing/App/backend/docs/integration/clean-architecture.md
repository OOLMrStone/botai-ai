# Минимальная Clean Architecture интеграции

Аудит 2026-10-04: только рекомендации, продуктовый код не менялся. Прочитаны применимые AGENTS, [WORKLOG](WORKLOG.md), [security](security-review.md), [frontend](frontend-flow.md), [данные](data-architecture.md); решения intent/retry и reuse AI согласованы с авторами аудитов.

## Основа и границы

- [Backend](../../build.gradle.kts) уже использует Java 21, Boot 4.1, MVC, JPA, Flyway и JDBC Session; [AuthService](../../src/main/java/org/botai/back/auth/AuthService.java) задаёт feature-first `Controller → Service → Repository`. Сохраняем этот масштаб, не вводим новые сервисы, broker, CQRS/event bus или generic CRUD framework.
- Это практические clean boundaries: чистые правила не знают HTTP/SQL/SDK, application services допускают Spring transactions и Spring Data. JPA entities остаются persistence-моделью внутри feature; отдельные domain/entity/DTO копии для каждой таблицы не нужны. Внешние DTO всегда отдельные.
- Новые контроллеры переводят запрос и session principal в command + server-derived `actorId`; servlet/security context не проникает в правила. Worker получает actor из сохранённой submission. Новые use cases не повторяют servlet-зависимость существующего login; auth не переписывается ради симметрии слоёв.
- Владельцы данных: backend — users, catalog/versioning, attempts, media metadata, history и права; AI — prompts, bounded model session и семантика проверки; S3 — bytes; frontend — отображение и временное состояние. AI не читает product DB и не назначает user progress.

## Конкретный layout под `org.botai.back`

| Пакет | Минимальные роли и направление зависимостей |
|---|---|
| `auth/`, `security/`, `user/` | Сохранить текущие классы; единое получение актуального actor и enforcement прав, без второго auth boundary. |
| `catalog/` | `CatalogController`, `CatalogService`, task/version/template entities и repositories, `dto/`; immutable `TaskSnapshot` — единственный вход содержания задачи в grading. |
| `attempt/` | `AttemptController`, `AttemptService`, attempt/item/draft/favourite repositories, `dto/`; подбор, start/resume/save draft/history. Знает catalog; не знает AI/S3 transport. |
| `grading/` | `SubmissionController`, `SubmissionService`, `GradingWorker`, `GradingTransactions`, `GradingJobRepository`, entities/repos, `dto/`; чистые `SubmissionTransitions` и `ShortAnswerChecker`; `port/GradingGateway`, `adapter/HttpGradingGateway`. |
| `media/` | `MediaController`, `MediaService`, `ImageNormalizer`, object metadata repository, `port/ObjectStorage`, `adapter/S3ObjectStorage`; `AuthorizedMediaReader` объединяет owner/admin check и выдачу bytes. |
| `profile/` | `ProfileController`, `ProfileService`, activity/stats query, `dto/`; поля профиля через allowlist, прогресс из принятых учебных событий. |
| `admin/` | Тонкий permission/audit вход к существующим feature services; отдельного доступа в bucket и дублированной модели submission нет. |

- Вводить классы при появлении потребителя. Service — конкретный use-case facade; не нужен интерфейс на каждый Service, controller или entity. Spring Data repositories — текущая persistence boundary; специальные atomic queue queries инкапсулирует один `GradingJobRepository`.
- Два сменяемых внешних порта: `ObjectStorage.put/get/delete` оперирует server key и ограниченным stream; `GradingGateway.capabilities/grade` даёт registry и принимает snapshot, ordered normalized images, run/correlation metadata. `S3ObjectStorage` использует официальный SDK после согласования зависимости; HTTP adapter — уже выбранный synchronous MVC stack, без WebFlux.
- `HttpGradingGateway` отделяет transport errors/timeout/invalid response от `Graded`/`Rejected`; возвращает raw validated artifact и безопасную проекцию, сохранение делает use case. Ни один upstream failure не становится оценкой 0. Не создавать общий `Result<T>`/exception framework ради двух адаптеров.

## Use cases и единая идентичность

| Use case | Результат и инвариант |
|---|---|
| `CatalogService.list/get` | Server taxonomy на 20 позиций; number/part/response type/capability приходят из данных. Public task не содержит accepted answers/reference solution. |
| `AttemptService.start/resume/save` | Exam и practice — разные команды одного сервиса; start фиксирует ordered immutable task versions, exam ровно 20 позиций, draft сохраняется с optimistic revision. Недобор банка — явная ошибка. |
| `AttemptService.setFavourite` | Идемпотентное `(actorId, canonicalTaskId)`; список из общего банка, включая задачи пробников. |
| `SubmissionService.createIntent/upload/finalize` | Одна submission на отправку одного attempt item; intent до multipart, finalize только по «Проверить». До finalize редактируем набор attachments, после — snapshot входов неизменяем. |
| `SubmissionService.checkAttempt` | Batch — оркестрация уже существующих submissions, не вторая очередь. Short answer создаёт submission/result синхронно; photo с подтверждённой capability ставится в очередь; unsupported получает отдельный исход без AI-вызова. |
| `GradingTransactions.acceptResult` | Единственное место принятия оценки, terminal event и обновления прогресса; тот же путь для локального short checker и AI result. Возвращаем сырые earned/max points, без выдуманной шкалы 100. |

- `taskId` — избранное; `taskVersionId` — immutable содержание; `attemptItemId` — ответ/рисунок в конкретной попытке; `submissionId` — immutable отправка после finalize; `runId` — один запуск AI. Не использовать frontend `examId:taskId` и AI `test-*` в качестве product identities.
- Фото в UI прикрепляется до проверки: при первом прикреплении создаётся draft submission, затем bytes немедленно сохраняются через `/api/submissions/{id}/images`. Кнопка проверки вызывает finalize с ожидаемой draft revision; другая вкладка/изменённый ответ дают conflict. Intent response возвращает ID и сохранённый reject, а не теряет его из-за exception rollback.
- Повтор сети с `(actorId,idempotencyKey)` возвращает ту же операцию; другой payload/revision с тем же ключом — conflict. Явная перепроверка создаёт новую submission с `retryOfId`; старые входы, ошибка и run сохраняются. Повтор finalize не создаёт новый платный запуск.

## Транзакционные границы

1. Start: lock/pin опубликованную template version или материализовать выборку practice; attempt + все items коммитятся вместе. Публикация/редактура content — отдельный use case; историческая version не изменяется.
2. Intent: после authentication/CSRF и ingress limits коротко записать request ID, owner, idempotency key и bounded submitted target; commit **до** business validation. Затем привязать проверенный item/version либо записать rejected. Unknown target допускает nullable FK; orphan intent завершает reconciler.
3. Upload: reserve metadata/key в короткой транзакции; bounded decode/normalize и S3 PUT вне неё; затем зафиксировать READY + event. Никакой общей DB/S3 транзакции; staging/orphan cleanup повторяем безопасно. Плохие bytes не сохраняются ради журнала.
4. Finalize: lock submission/item, проверить owner, expected revision, READY immutable objects, доступность grader и quota; freeze input + QUEUED + единственная job row + event в одном commit. DB job и есть durable outbox; отдельная outbox-таблица без другого потребителя не нужна.
5. Worker: scheduler лишь будит bounded executor; сначала короткий claim `FOR UPDATE SKIP LOCKED`, increment fencing token + lease, commit. Нельзя держать row lock или transaction во время S3 GET/AI HTTP. Этот SQL предназначен для queue-like consumers: [PostgreSQL 17](https://www.postgresql.org/docs/17/sql-select.html).
6. После получения/проверки photos, непосредственно перед HTTP, отдельный commit создаёт run + `DISPATCHING`. Только затем отправка. Crash/timeout после этой точки — `FAILED` с `UNKNOWN_AFTER_DISPATCH`; консервативно допускаем потерянный незапущенный запрос, исключая автоматический повтор возможной оплаты.
7. Lease продлевается короткими fenced updates. Reaper возвращает в очередь только заведомо pre-dispatch работу; начатый dispatch не requeue. `HttpGradingGateway` и proxy не повторяют POST; текущий [AI Provider](../../../botai-ai/app/grading/provider.py) уже задаёт `max_retries=0`.
8. Complete: проверить task/image binding, schema, range, run/fencing token и ожидаемый статус; result + terminal event + progress projection + job completion коммитятся вместе. UNIQUE accepted result и conditional update делают повторное применение безвредным. Late/cancelled результат — audit, не новая оценка.
9. `GradingWorker` не `@Transactional`; вызывает отдельный `GradingTransactions` bean для claim/dispatch/complete. Для reserve/commit вокруг S3 применить ту же явную границу или `TransactionTemplate`: вызов собственного `@Transactional` метода не проходит proxy, см. [Spring transactions](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html).
10. Короткий ответ использует тот же atomic accept-result без queue/provider run; сравнение только с server answers и согласованной нормализацией. История отказа, ошибки и отмены не откатывается вместе с неуспешным действием; exception наружу бросать после её commit.

## Владение контрактами и сохранение текущих паттернов

- До имплементации общий `SPEC.md` фиксирует IDs, state machine, intent/upload/finalize, errors и mappings. Backend владеет public OpenAPI artifact и безопасными DTO; frontend потребляет согласованную версию через `lib/api/*`. AI владеет internal schema и exact result fixtures; backend закрепляет contract version и валидирует границу. Общий runtime/npm/JAR пакет не нужен.
- Public error сохраняет нынешний [ProblemDetail](../../src/main/java/org/botai/back/auth/AuthExceptionHandler.java) и добавляет `code`, `requestId`, field errors/retry metadata. `[FAILED, REJECTED, UNSUPPORTED]` нельзя свернуть в `incorrect`; score nullable по контракту, не frontend default.
- Один internal multipart маршрут AI для №14–20: JSON metadata + 1–4 sanitized photos, service authentication, без public ingress. `taskVersionId`, `runId`, schema/package version живут в transport envelope; не добавлять их в текущий exact `task` JSON, пока его схема не изменена согласованно.
- Реальная точка reuse AI: [GradingService.run](../../../botai-ai/app/grading/service.py) делится на task-image preparation и `run_prepared(task,imageIds,images,correlation)` с тем же model loop; [Session](../../../botai-ai/app/grading/session.py) уже строит `Statement.md`/`Solution.md` и проверяет точное совпадение task/images. Database snapshot устраняет task OCR, не меняет approved prompts или validator.
- Registry AI описывает все №14–20; только handler/validator №16 доступен сейчас, остальные descriptors имеют `supported=false`. Backend кэширует серверный registry, сопоставляет version/max с catalog и проверяет capability до enqueue; UI получает итог от backend. Новые approved handler+validator подключаются в AI без изменения front/back; текущая задача не включает разработку prompts. Legacy routes и пустые prompt directories capability не предоставляют.
- Frontend сохраняет `config → hooks → components`, Zustand для state и единственный [apiFetch](../../../botai-front/src/lib/api/client.ts). Заменить тела task/exam API, вынести network из stores; polling живёт в hook, update приходит по submission ID/revision. Общий cache получает user key/invalidation и сброс при logout; не добавлять второй HTTP/cache framework.
- Catalog/config содержит UI copy/layout, но runtime задачи/таксономия/ответы/история идут с backend. Legacy persisted mock results не импортируются. Quizzes продолжают использовать собственный mock API и не порождают реальные XP/streak/paid jobs.

## Подтверждённый максимум первичных баллов

На 2026-10-05 официальная страница ФИПИ публикует **проект** КИМ-2027. Проверены текст и изображение §10 спецификации профильной математики, печатная стр. 10/19 (PDF page 5) из [архива ФИПИ](https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2027/ma_11_2027.zip): №1–13 — по 1; map №14–20 = `{14:2,15:3,16:2,17:2,18:3,19:4,20:4}`, всего 33. Это источник frozen catalog/registry `max_score`, а не свидетельство готовности AI-пакетов. Статус draft и источник сохранить в versioned format; [план изменений ФИПИ](https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2027/Plan_izmeneniya_KIM_EGE_2027.pdf) отдельно подтверждает 20 задач/33 балла.

## Проверка решения перед реализацией

- Сквозной первый slice: один настоящий task №16 → intent → upload → finalize → mock AI → history → reload; затем short answers, practice/exam compositions и profile. Сначала согласовать Flyway V1–V4 с production, новые migration numbers только после V4, по [аудиту данных](data-architecture.md).
- Обязательные contract fixtures: graded/rejected/invalid/unsupported/unknown dispatch; integration races: duplicate finalize, two workers, crash до/после dispatch, stale worker, cancel/late result, S3 partial failure, cross-user read. Использовать имеющиеся Testcontainers/Postgres и mock providers; не добавлять тесты структуры классов и платные вызовы.
- Этот аудит не подтверждает работающую интеграцию: queue, S3 adapter, prepared AI entry point и публичные DTO ещё предстоит реализовать. Основные риски — согласование контракта до параллельных изменений и применение актуальной auth/Flyway baseline, а не нехватка архитектурных абстракций.
