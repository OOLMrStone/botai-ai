# Локальный кабинет эксперта

Отдельный Docker Compose project `botai-expert-local`, база `botai_expert_local` и собственные volumes. Существующие integration/billing/public runtimes и их аккаунты сохраняются. API доступен только на `127.0.0.1:18085`, Mailpit — `127.0.0.1:18026`. Postgres, S3/Garage, AI и management не опубликованы. AI использует `mock`, платные вызовы отсутствуют; billing mode `disabled`.

Из каталога `botai-back`:

```sh
python3 scripts/expert-local/start.py
python3 scripts/expert-local/seed.py
python3 scripts/expert-local/smoke.py
scripts/expert-local/compose.sh ps
```

Нужны Docker Compose, Python 3 и соседние `botai-front`/`botai-ai`. Сборка backend использует контейнерный Java 21. `start.py` проверяет занятые порты, экспортирует только разрешённый AI runtime и собирает сервисы последовательно. Повторный запуск сохраняет credentials и данные. Для уже собранных образов: `start.py --skip-build`.

После изменений AI и подтверждённого code freeze: `python3 scripts/expert-local/start.py --refresh-ai-export`. Предыдущий разрешённый export архивируется локально; новый manifest проверяется, затем AI и backend пересобираются. Без refresh существующий export намеренно сохраняется. Local AI принудительно mock; `APP_EXPERT_GRADING_ALLOW_LIVE=false` исключает live stage по умолчанию. Gateway перед каждой stage командой заново проверяет current capabilities/provider/package; исторический mock результат не даёт разрешения отправлять запрос в live provider.

Frontend разработчик запускает отдельный API dev процесс из `botai-front`, когда изменения `/grade` готовы:

```sh
NEXT_DIST_DIR=.next-expert-api BACKEND_URL=http://127.0.0.1:18085 npm run dev:api -- --webpack --hostname 127.0.0.1 --port 13003
```

Открыть `http://localhost:13003/grade`; same-origin `/api` проксируется в отдельный backend. `.env.local` не перезаписывается. Backend использует cookie `EXPERT_SESSION`; CSRF — существующий `XSRF-TOKEN`/`X-XSRF-TOKEN`. Origin `localhost:13003` также используется в локальных email. Если нужен контейнерный frontend после готовности `/grade`, остановить только этот dev процесс и явно выполнить `start.py --with-frontend` (dev build, API mock отключён).

Логины и случайные пароли находятся в **приватном** `runtime/expert-local/credentials.json` (0600): `expert` — школа А/Анна, `same_school_expert` — школа А/Иван, `other_expert` — школа Б/Мария; три соответствующих student аккаунта. Пароли не прописаны в коде. Seed регистрирует аккаунты через обычный auth API (BCrypt), затем только в отдельной БД назначает verified demo roles/roster и локальный Pro для mock photo review. Roster/membership не являются публичным self-enrolment API.

Seed назначает учеников через expert API и создаёт четыре работы. Из существующего локального PNG graph asset загружаются реальные байты в приватное storage; mock AI проверяет транспорт и возвращает явно демонстрационный результат. Затем ученик явно направляет submission школе. Изображение является fixture, не фотографией реальной ученической работы; mock не распознаёт его содержимое. API/media права проверяются сервером, публичные URL storage не выдаются. Две работы основного эксперта оставлены в очереди для ручной проверки `/grade`. Seed повторно не стирает draft/final и не сбрасывает назначение.

Smoke создаёт отдельную новую работу при каждом запуске. Проверяет login/role, школьный список/назначение, private image bytes, чужую школу и другого эксперта той же школы, текущую membership/roster и смену назначения, CSRF, повторную маршрутизацию, conflict по revision, скрытие draft от ученика, отправку final ученику и запрет повторной правки. В canonical документе OCR находится в `ocr.blocks`, анализ — в `analysis.block_reviews`/общих полях. Правка анализа сохраняет OCR; явная правка OCR сохраняет существующий анализ без автоматического AI-запуска или сброса. Backend дважды перезапускается: отдельно после draft и после final; данные и текущая JDBC session должны сохраниться. Исходные `ai_document`, feedback и exact AI response остаются неизменными, final version ровно одна. Приватные fixture IDs/evidence — `runtime/expert-local/{fixtures,smoke-evidence}.json`; scripts выводят только результат проверок.

Изменение OCR/analysis либо обычная правка score делает серверный `gradingStale=true` и блокирует send (409). Smoke запускает настоящий mock `POST /grade` с Idempotency-Key: backend резервирует durable job и draft (+1 revision), отправляет только trusted task + ordered OCR block IDs + analysis в `/internal/v1/grading/grade-analysis`, затем сохраняет только grading (+1 revision). OCR text/photos в этот RPC не входят. Проверяются job GET, replay одного ключа без новой модели, конфликт другого payload, tenant/CSRF и unchanged OCR/analysis. Отдельная ветка проверяет `POST /manual-grade`: явное принятие текущего балла снимает stale без AI job. Модель не повторяет OCR/analysis, автоматического вызова после редактирования нет. Если HTTP ожидание прервалось, восстанавливать latest gradeJob через GET work/job; `unknown` не ретраится автоматически.

Фактическая проверка 2026-10-13 13:09 MSK: API/Flyway V16, все пять сервисов healthy, stage-only + manual + send/learner delivery, ownership/CSRF/revision/immutability и два рестарта PASS. AI export содержит stage endpoint, все 81 файла сверены с manifest. Runtime/source fingerprints записаны в приватный `runtime/expert-local/final-snapshot.json`; production source во время финальной сборки не менялся. Frontend/browser QA выполняется отдельно.

При переходе собственных первоначальных demo fixtures с промежуточного flat документа на nested схему после final code freeze выполняется `python3 scripts/expert-local/seed.py --replace-queued-demos`. Он находит только видимые flat works наших трёх synthetic student аккаунтов с `status=queued,revision=0`, мягко удаляет их fixture attempts штатным API и создаёт replacement works через новую AI/route цепочку. Immutable origins/triggers не меняются; edited/sent works не архивируются. Прежние IDs и manifest сохраняются в приватном `fixtures-replaced-*.json`, включая orphan work от незавершённого первого smoke. Обычный `seed.py` replacements не выполняет.

Сохранить данные и остановить только этот sandbox:

```sh
scripts/expert-local/compose.sh stop
scripts/expert-local/compose.sh up -d --wait postgres garage mailpit ai pdf-renderer backend
```

Не использовать `down -v`, database reset, Flyway repair или очистку старших runtimes. Никакого production/deploy эта процедура не выполняет. Основной backend/frontend контракт: `botai-front/docs/expert-backend-contract.md`; содержимое review: `botai-front/docs/expert-ai-contract.md`.

PDF runtime подготовлен отдельно: `renderer/pdf` — самостоятельный Java21/PDFBox 3.0.8 проект, API JVM PDF не разбирает. Compose `pdf-renderer` не получает secrets и не публикует port; единственная сеть Docker `internal` `pdf` разделяется с backend. Internet routing отсутствует; это не запрет контакта с backend peer. Read-only, tmpfs 128MiB, memory 512MiB, CPU 1/PIDs 64/nocaps; child heap 256MiB/concurrency 1 и 45s hard kill/reap. Original PDF immutable/private/download-only, UI показывает JPEG страницы.

Renderer targeted QA: `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew -p renderer/pdf test --no-daemon --max-workers=2`; отдельные reports в `renderer/pdf/build/test-results`, основной backend suite не затрагивается. Synthetic fixtures в `renderer/pdf/build/qa`: `passive-two-pages.pdf`, `page-1.jpg`, `page-2.jpg`, encrypted-empty-password/unsafe-javascript PDFs. Ink/FreeText и rotation визуально сверены.

PDF HTTP smoke после backend/security freeze и новой локальной сборки: `python3 scripts/expert-local/pdf-smoke.py`. Проверяет точные original bytes/SHA и attachment headers, reload processing→ready, ordered JPEG pages и actual cleaned hashes, scoped owner/expert access/CSRF, conversion→mock AI only JPEG IDs, encryption/active-content rejection+cleanup+finalize409 `pdf_failed`, remaining page budget, deletion whole group и restart persistence. Evidence `runtime/expert-local/pdf-smoke-evidence.json`; новый snapshot включает V17/renderer sources/image.

Фактический PDF runtime PASS (2026-10-13 21:51 MSK): Flyway V17, все шесть сервисов healthy, вся указанная HTTP цепочка прошла, backend restart сохранил original и AI. Renderer 9 targeted tests PASS (включая actual stalled HTTP body close и следующий good request), backend 215 tests/213 passed/2 skipped/0 failures/errors, independent security PASS. Effective renderer limits/private network сверены; Internet HTTPS probe отклонён. Source/build drift отсутствовал. Приватный `runtime/expert-local/pdf-snapshot.json` заменяет исторические V16 fingerprints для текущего runtime: source manifest SHA256 `a7e7296fa57a3447c6be99c182110d6fb73047c38139df50b5d704d3f05cb671`, backend running imageId `sha256:bab9e49a399966894bd02f45f9716402c7a5035f65f00847d2b28a21947452c6`, renderer imageId `sha256:28ec97c4ae8a9edb5cf2aa8bafc1db2aed2411caa2af9f1899a9434d658f5cf5`, PDF evidence SHA256 `a4b1a954859e49c8abdae7204ebc39c2a6ebda9079e035e7f2a413195d067cc8`. Existing mock AI/export неизменны; snapshot различает built tag и actual running image. `/grade` и `/manual-grade` доступны; browser QA выполняется отдельно. Sandbox оставлен работающим, ports 3000/13003 не затрагивались.
