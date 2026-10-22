# Актуальное дополнение: сложность 1–5, 2026-10-06

V8 применена локально; backend/frontend обновлены. API difficulty integer1..5|null, isGrob derived; DB difficulty_level +generated is_grob. Historical varchardifficulty не используетсякакчисловаяоценка. Training difficultyPreference0..100:0only1,100only4/5,interior smoothweights centre5/45/45/4/1%, unknown last. UI counts followeligiblepool.

Все1708 BankZadach получили native difficulty через новый immutable package-native-difficulty-1, contentunchanged. Published1708,quarantine0;repeatbatch4noop208. Distribution1:219,2:384,3:285,4:161,5:55,null604. БД1811tasks/1711active/3522versions/100archiveddemo. Old1814versions41attempt249itemsunchanged;QAadded2attempt9items. Evidence bankzadach/difficulty5-database-verification.json +difficulty5-ui-qa.json. Python95,backend32,front98+lint/type/buildPASS; realUIleft/right+mobile/desktopPASS. Safeoperatorview такжеимеетdifficulty_level,is_grob. Backup local-pre-difficulty5-20261006T111244Z. Stage/production untouched. Болееранниесчётчикинижеисторические.

---

# Актуальное дополнение: BankZadach, 2026-10-06

Полный локальный импорт завершён:1731raw,1708published,23quarantine. Все20позиций;1711active real tasks включая3прежних;100synthetic archived,0active demo. Всего1811tasks/1814versions. Старые103versions/38attempts/227items fingerprint-identical;100tasks изменили толькоarchived; QA добавила1attempt/1item. Source API/UI hidden, privateprovenance intact. Production/stage не менялись.

Immutable package `runtime/content-import/bankzadach/package-final-candidate-3` (500/500/500/208). Все4preflightPASS; финальныйpublish1212/noop496/quarantine0 поверх первого499, включая3исправленныеreference versions. Evidence `release-result-final3.json`, `final-database-verification.json`; Python89PASS, Java19integration+6mathPASS, frontlint/types/buildPASS. Реальное решение проверено desktop/mobile. Новыйsynthetic exam недоступен (архивированыегоtasks), историческиеattempts сохранены; realmocktemplates не создавались.

Backup `runtime/backups/local-pre-bankzadach-20261006T092709Z/postgres.dump`; обратимостьархивации `runtime/content-import/synthetic-retirement/restore-visibility.sql`. Текущий workflow `scripts/content_import/README.md`; skill `botai-bankzadach-import`. Подробный итог и журнал находятся в outputs текущего Codex-чата. Старые сведения ниже — история предыдущих этапов, не текущие счётчики каталога.

---

# BotAI: текущая точка — 2026-10-05

По последнему запросу пользователя подготовлен отдельный исторический handoff `INTEGRATION-BEFORE-CONTENT-SEED.md`: все результаты подъёма/связки сервисов до реального банка (back6f5dfae/front6bcd282+f6d8bab), без последующего импорта. Root сверил факты/файл, секреты не включены. ManualLuna остановлен; fullbulk acquisition не запущен. Новый source-onlyprojection локально deployed по runtime: back78812a5/front3057a2a,103tasks unchanged; root UI этой правки ещё не проверил.

## Новая активная работа: реальный банк

Пользователь заказал все задачи прошлых ЕГЭ, ФИПИ, СтатГрада, ЕГКР, Ященко из Школково; исключить авторские/прочие подготовительные ветки. Подтвердил разрешение переноса текстов, решений, изображений в BotAI. Контракт: CONTENT-IMPORT-SPEC.md; отдельно research/design/security. Frontend owner получает/классифицирует; runtime owner реализует DB/API/publisher; security reviewer проверяет до и после. Root пишет только документы и координирует.

Каталог Решу ЕГЭ сверён: все 140 IDs/названий совпали с V6. Новая актуальная taxonomy: 141 тема (№4 одна, №5 merge185/265, №20 шесть методных блоков). Source запроса уже означает catalog/favorites; происхождение будет отдельным `sources`. Год может быть null; исторические версии/попытки сохраняются.

Root IAB tab1/browser2 работает; у frontend agent IAB недоступен. Manifest74 разрешённых source-sections сохранён private в runtime/content-import/section-manifest.json. №20:203 ЕГЭ (pagination.TotalRecords=212; кнопка192 означает остаток),7814 ФИПИ,4180 Ященко,7821 СтатГрад/ЕГКР;11037 авторские исключены. Task185802 одновременно ЕГЭ+ФИПИ; решение доступно без входа. TexSessions содержит HTML/CSS/SVG, точного TeX нет; alt сложных формул неполон. Допущен strict SVG subset → offline PNG через существующий Sharp0.35.5; неизвестное не терять.

HTTP HTML/JS503; публичные theme/by-id и subject/by-id200. UI «Загрузить ещё» вызывает /api/test/v1/question/public/list; GET404, два bounded POST500, формат неизвестен. Пользователь разрешил отдельное окно Chrome; managedChrome недоступен, root открыл своё native окно203/DevTools, Payload пока не получен. Новых guessed POST/обходов/cookies не делать. Системный DNS даёт240.0.0.188 (также Docker); security допускает только фиксированный provider/path, pinned address + строгий TLS Host/SNI без proxy/redirect/secrets; VPN/DNS не менять.

Контракт JSONL botai-content.v1 согласован. Backend V7 immutable publisher/media/referenceContent/aiInputReady реализован; atomic cleanup claim проверен. Transport13/13 + independent PASS, actual pinnedTLS GET theme/203→200. Raw/cache0700/0600 вне Git.

Root census всех74 source-sections:4257 occurrences/249 pages, distinct неизвестно. Exact section counts переданы frontend для private manifest; источник — live SSR pagination, titles/IDs совпали. Никаких author/prep веток. q.Themes включает методы, но crosswalk не механический:137451 source60→BotAI111 по решению.

Manual DOM samples:185802→extrema,92097→166 (ответ0,3),137451→111 (ответ98). Нормализованное вручную форматирование — НЕ raw API bytes; provenance manual-reviewed. 41/41 original SVG→offline PNG, repeated glyphs dedup. Runtime владеет frontend DTO/rendering, sourceYear nullable/sources/paragraph runs.

Rich referenceAnswerContent (text null толькоphoto+rich+AIreadyfalse) и explicit reveal толькоstable unsupported extended реализованы/проверены. Grant: owner+attempt/item+answer revision И latest submission id/revision, atomic audit, edits invalidate; единая граница solution/media, без score/jobs/XP/progress.

Final scoped security PASS: independentPython32/32, acquisition36, Java57/57, front lint95/API43/types/build/6newrender tests. Findings закрыты. Root wholecard QA PASS через private preview127.0.0.1:18094 (frontend,session23239): candidate tasks.jsonl SHA256 `95a806cf386bb7de1a591bf5e5eb9e9cc4f8f3e291f52d9df5985bc3b7cfc1cc`,3rows/32scopedPNG/41source occurrences. ActualV6→V7 detached rehearsal сохранил15fingerprints. Commits: runtime back772c931/front45300af; acquisition backeacc213. Содержимое3карт не перепроверять без изменения content/media; Publicprod/paidAI/push внеscope.

ACTIVE LOCAL: V7,103tasks=100synthetic+3real; publish3, повтор0/noop3;7up/6healthcheckshealthy. narrowHTTP/media/reveal/CSRF/editrevocation PASS; baselineusers/100demoversions+answers/templates/attempts/items byte-identical сdetachedbackup. Docs0be80c5. STAGE: lastknown100synthetic0real/V6; SSHbanner3failures, ownedtunnel socket отсутствует, retriesstopped; ничегоremoteнеприменено. IDs:137451→84a5e8de-73f2-4f03-854b-66c67884430d;185802→eed8684f-9648-4de0-9543-5b92e9975a16;92097→586387d2-8b3f-441e-be23-4fec32b5c216.

Skill ~/.codex/skills/botai-task-import готов, quick_validatePASS. Новый /root/luna_manual_import gpt-6-luna/medium/cleancontext делает1новую#4 ID137554 из7776, capture-only. ЕгоIAB послеcreateнедоступен; rootIAB2 новаяtab4→7776 нормально. Root sourceoldtab1 удалена приinterruption. Luna разрешён taskownednativeChrome203(single-tab), нашёлчерезWindowmenu, пробуетштатныйSavePageAs→privateHTML; rootChromeне трогает. CUA DOM→tooloutput, directfilesystembridgeнеподтверждён; pageAssets bundle работает. Усечённоене реконструировать. Usergrant не перепроверять из-за общегоcopyrightnotice. МеткиStreamStack video, taskmediaнеподтверждены.

RootlocalUI новойверсии: IAB2tab3/QAProduction, attemptabe9e3cd-ce1e-4a0e-84a0-4f9488d8ebf8 (#4/6items), imported92097pos3. source+conditionwholecard visible;0,3→saveexit→home«Подборка№4/продолжитьс3»→exactrestore; servercheckchecked1/6score1/6. Screenshot585×657okay, не320/375gate.

НОВАЯПРАВКАuser: в публичномsource толькоПЕРВОИСТОЧНИК(FIPI/EGEволна/Yashchenko/StatGrad/EGKR), безШколковоназвания/ссылки. Provider/captureURLinternalprovenanceдлядедуп/аудита. RuntimeисправляетDTO/UI+localdeploy; frontendownerskill/docs. Не мутироватьужеpublished3versions/пакет95a806радиpresentation.

## Результат и входы

Готовы два частных mock-стенда, каждый с7 работающими сервисами: большой Storefront+учебный frontend, Java21 backend, PG17.11, private Garage2.3, AI mock, Mailpit, Adminer. Public production auth8082/AI8080/front3000/DB V1–V4 и develop18080/gateway8091 не менялись.

| Вход | Mac | Сервер через tunnel |
|---|---|---|
| Сайт | http://127.0.0.1:13000 | http://localhost:23000 |
| База | http://127.0.0.1:18090/?pgsql=postgres&username=botai_operator&db=botai | http://localhost:28090/?pgsql=postgres&username=botai_operator&db=botai |
| Почта | http://127.0.0.1:18025 | http://localhost:28025 |

Credentials0600/ignored: `runtime/credentials.json` и `runtime/evidence/stage-credentials.json`; server `/srv/botai-integration/runtime/credentials.json`. `test@test.test`: USER+Pro/emailVerified, actual same-origin login+aiReview PASS на обоих. Пароль только private/user message. **Пользователь явно просит сохранить все старые тестовые аккаунты; ничего не удалять.**

Tunnel: owned reconnecting supervisor, control socket `runtime/stage-tunnel.sock`; PID/exec session меняются при reconnect, актуальная session только в private checkpoint. Не создавать дубликат без проверки. Local использовать127, stagelocalhost: cookies не разделяются портами. Stage FRONTEND_BASE_URL=http://localhost:23000.

## Код и доказательства

- Front `develop`: implementation `6bcd282`, final docs `f6d8babff89c9049e2d15131cc193c40a0a72d0b`. Оба образа совпадают с478-path SHA256 `b63975290568371e0bded79a5f34a99c550037d59d3c1360fc9e9f32004c8f61`; никакого нового source delta.
- Back `develop`: reviewed product/runtime/docs локально сохранены; runtime slice `add34cc`. Java38 tests, realPG/Garage SDK, quota queued-event rolling24h/HTTP1.1, strict AI validation PASS. Внешний push/live switch не выполнялись.
- Front lint89, API/auth/drawing43, types/build и независимые persistence regressions PASS. Полный same-origin HTTP roundtrip обоих образов и shared-cookie-jar isolation PASS.
- Независимый final Safari: оба login/HOME/catalog/точный answer+старыйstroke save/reload, local ADMIN list, обе свежие generated email URLs→явное UIconfirm PASS. Fresh console reload Errors0; local warning1 unreadable, причина неизвестна.
- Exact320×568 AX подтверждает полное20-number название и отдельный exam. Визуальный clipping самого CTA не проверен (native scroll limit); physical1400ms seal-hold не автоматизирован. Safari Develop restored0, inspector/RDM exited, Chrome пользователя untouched.
- Next16.3.8/sharp0.35.5: production audit0, actual standalone23 manifests на ARM/x86; CLI/tool trees отсутствуют. Dev audit17 (14high/3moderate) остаётся; это не полный SBOM/OS-CVE scan.
- Backuprestore PASS: local `runtime/backups/20261004T220704Z`, server `/srv/botai-integration/backups/20261004T232603Z`; detached PG counts+S3 bytes совпали, active volumes сохранены. Не повторять без нового риска.

## Границы и сохранность

AI только mock; registry14–20, доступен16, остальные unsupported без ложной нулевой оценки. Synthetic bank100, demo без реального XP/streak, quizzes mock. Новых промптов/paid calls/probes не делать. Public live потребует one-shot Flyway/credential separation и HTTPS/ingress gate; это отдельная работа.

Все6 recovery refs/5 original stashes и approved baseline сохранены; не pop/drop/reapply whole stash. Provenance в FRONTEND-RECOVERY/WORKLOG. Исторические research/business docs и AI preexisting dirty changes не трогать. No down-v/global prune/OS upgrades/production data replacement.

Итог предыдущей интеграции: DELIVERY.md. Практический DB smoke/схема: DATABASE-GUIDE.md. Запуск/доступ: RUNTIME-RUNBOOK.md. Actual runtime/security: RUNTIME-EVIDENCE.md, SECURITY-CODE-REVIEW.md, DEPENDENCY-SECURITY-REVIEW.md. UI матрица/ограничения: `botai-front/docs/FINAL-BROWSER-QA.md`. Готовые сервисы и tunnel оставить running, изменения нового импорта отмечать отдельно.
