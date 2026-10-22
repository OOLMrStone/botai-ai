# Интеграция: проверенные факты

- 2026-10-04: backend `develop@8fc88a5`, чистый; fetch подтвердил актуальность. PostgreSQL/JPA/Flyway: V1 users, V2 JDBC sessions.
- Production PostgreSQL 17.11: V1–V4 success; `users.email_verified`, `one_time_codes`; users=0. Локальные V3/V4 находятся в `origin/feature/email-ops`. Нельзя переиспользовать номера миграций.
- Front `develop@c74f8cd`, чистый; sibling worktrees availability/storefront/work-3 на том же коммите. Код расходится с SCOPE: фото проверяется по имени файла; демопробник заранее «решён»; реальные задачи только №1/2; каталог 1–19.
- AI: действующий photo-check принимает task_image + 1–4 solution_images. Текущий prompt package только №16 (старый ФИПИ-2026 №15). Остальные capabilities требуют проверки.
- [Решу ЕГЭ: каталог](https://math-ege.sdamgia.ru/prob_catalog) доступен; главная возвращает JS shell. 20 номеров: новый №6 «Статистика», №13 «Финансовая математика», №14 уравнения, №16 неравенства. Нельзя просто добавить №20.
- SSH `ege-server` работает. AI 127.0.0.1:8080, auth 127.0.0.1:8082, frontend 127.0.0.1:3000, private postgres:17; 42 ГБ свободно. Изолированные /srv/develop и /srv/gateway: правила в AI docs/DEVELOPMENT_SERVER.md.
- Security: auth+CSRF сохраняются; user ID только из session. Фото: frontend preflight + backend decode/normalize. Private S3, SDK, server-generated keys. Опасные отвергнутые bytes не сохраняются.
- История начинается с JSON intent до multipart. Queue в PostgreSQL, claim/lease, dispatch фиксируется до AI. Неопределённый исход после dispatch не повторяется автоматически.
- AI тесты только mock: AGENTS запрещает платные вызовы без прямого запроса. Provider env/секреты не менять и не выводить.
- Оркестратор пишет документы, продуктовый код делегирует. Квизы остаются моками. Исполнители читают SPEC.md.

## Исследования

security-review.md: security_architect; frontend-flow.md: frontend_flow; data-architecture.md: data_architect. Исследования завершены; SPEC.md FROZEN v1 после architecture/security review. Реализация поручается агентам.
- Пользователь подтвердил: новые AI-пакеты/критерии НЕ разрабатывать. Подключается существующий №16; остальные extended — explicit unsupported, без оценки. AI actual timeout=360 s; docs480 устарели.
- ФИПИ draft2027 подтверждён PDF: 20 задач/33 балла; 14:2,15:3,16:2,17:2,18:3,19:4,20:4. Docker Desktop запущен; private S3 config не найдена.
- Перед freeze исправлены: finalize revision/staged upload race, dispatch lease/fencing CAS, raw AI reference leakage, per-run mock/package provenance, explicit retry/rejection routes.
- Backend develop fast-forward до существующего email-ops commit0295e72; локальные V1–V4 теперь соответствуют требуемому baseline. Нового продуктового коммита оркестратор не создавал.
- После пользовательского прерывания: рабочие файлы сохранены; agents возобновляются. V5 schema/ports подготовлены, compile/migration ещё не проверены; ownership в BACKEND-HANDOFF.md. DTO enums согласованы SPEC v1.1.
- V6 seed подготовлен: catalog snapshot2026-10-05,140 topics/20 positions,100 original synthetic tasks (5/номер,is_demo=true),1 template20. Это не импорт чужого банка. Core Java21 compile запущена, результат ещё не подтверждён.
- AI shared prepared refactor: existing150 offline tests passed; новые internal tests и full regression пока выполняются.

## Frontend baseline correction (user, 2026-10-05)

- Identical HEAD c74f8cd concealed stashed newer UI. User requests main develop aligned with Work3 + latest large Storefront, and final whole stack running. Current frontend integration paused for recoverable checkpoint.
- Verified original stash hashes: work3 `0468de3a4f2f5f85beff50a613733d8f1250ab90`; storefront `68c31c43ed1977b382a4e5952d8c195f8c0fc7f5`; develop `ba32bf4f63577d2fb9061a06640628981f3dd27f`; availability `68386c743a39d844b6994e19c9eba0421d7f5c39`. Preserve, no pop/drop.
- Read user-linked chats: «большой сайт» 01a0ede8-8295-7330-bdd7-d480151db3c5 worked in storefront; latest claims root landing/pricing/desktop+mobile/username/smart onboarding routing, source handoff synchronizes Work3 design. «Застешить все изменения Git» 01a0fce2-e479-7251-a4ba-80e8b23d7c40 has no completed restoration. «Убери все изменения в stash» 01a0fce5-035d-75f3-a0c8-b5643bddb4f7 saved all four; subsequent restore requests interrupted. Actual stash list confirms all four still present.
- Existing entitlement confirmed: `aiReview`; free features=[],pro features=[aiReview]. No client-side tariff elevation.
- Front integration checkpoint verified: stash c7c1573e94da31f3796ce7eeb5460dc430fd1657; backup ~/.codex/backups/botai-front-integration-2026-10-05 (tracked.patch,16 new files archive,sha256,HANDOFF.md). Working tree clean; no lint/build yet. Recovery delegated frontend_recovery (Astra), API resume follows recovered baseline.
- Более точное требование пользователя: PRIMARY frontend baseline — именно latest Storefront из чата «большой сайт», витрина+учебныйпродукт в одном main develop. Work3 supporting, не override. Полезные existingdevelop изменения сохранить. SPECv1.3/recoveryagent уведомлены.
- AI slice завершен:460passed,3existing skips,1probe deselected; exported runtime74files, authenticatedcap+preparedmockPOST200. Core Java21 compile passed; realPG tests running. GradingBackend Astra начал worker/media/admin/checks.
- Root проверил actual JUnit: AuthFlow6/Learning6/Upgrade1, все13pass. Upgrade проверяет V4→V6 и сохранение auth/session. Recovery restoredlatestStorefront вmaindevelop, lint+76guards passed, build/browser pending.
- User уточнил HOME: вместо daily task список всех незавершённых persistedAttempt collections+exams, exactresume без lessonfallback; logout/reload/browserQA обязателен. Финально нужен actualDBschema guide+viewer. SPECv1.4, front/worker уведомлены.
- После повторныхinterrupts исполнители пересозданы: backend_completion(Astra),frontend_completion(Sol),runtime_completion(Sol). Rootverified27JUnit/0fail; добавляютсяHTTP/HOME/EXIFtests. Local PG17.11/Garage2.3/Mailpit1.27.8 запущены; AI/backend startup pending. Privatecredentials runtime/credentials.json/.env.integration0600. ОдинSSHbanner timeout, serverне менялся.
- Backend завершён:35JUnit/0fail, realPG/Mailpit/GarageAWS SDK; EXIF1–8, HOMErelogin2collections+exam. Localbackend/AI/S3healthy, frontpreview13000HTTP200; actualDATABASE-GUIDE+readonlyAdminer18090 готовы. SSH3bannerfailures, serverнеизменён.
- Independentsecurity_code_review:184AItests+HTTPownership/CSRF/media/DTO/currentrole/admin+DBoperatorrestrictions PASS. Подтверждёнquota bypass:30admittedtoday draftscreated25hago→counter0→31stqueued. Fixpending.
- Combinedruntime выявил wire360.0 vsinteger360; AIserializationисправлена,64internaltestsPASS. Второйblocker: JDKh2cupgrade→Uvicornmultipart422, PythonHTTP1samebody200; backendHTTP1fix+realroundtrippending. RuntimePG+S3snapshotrestorewitnessPASS.
