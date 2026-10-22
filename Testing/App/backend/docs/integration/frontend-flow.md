# Frontend: проверенный flow и потребности API

Аудит 2026-10-04, `botai-front` develop `c74f8cd`. Ниже пути относительно `/Users/vasiliyslobozhanov/projects/botai/botai-front`. DTO/endpoints предложены для общей спеки, пока не реализованы.

## Основа и ограничения

- Прочитаны `AGENTS.md`, релевантный `SCOPE.md`, шесть `.claude/skills/*/SKILL.md`. Один backend boundary `src/lib/api/*`; Zustand без fetch; существующий `apiFetch` + cookie SESSION / XSRF-TOKEN. Новые зависимости не нужны.
- Front и back исходно чистые; front worktrees `botai-front-availability`, `botai-front-storefront`, `botai-front-work-3` detached на том же commit. Back develop `8fc88a5`. AI содержит чужие незакоммиченные изменения, не трогать. Код приложения в аудите не менялся.
- Preview: `.claude/launch.json` задаёт `npm run dev` :3000 и `npm run start:dev -- -p 3100`; node_modules есть, Node 22.23.1/npm 11.18.0. При проверке :3000/:3100/:3001/:8080 не слушали. Специального preview tool нет; доступен CUA browser, запуск через терминал разрешён verify-ui. Визуальные изменения не выполнялись, браузерный QA не заявляется.
- `npm run dev:api` и prod проксируют `/api/*` на BACKEND_URL через `next.config.ts` beforeFiles. Это переключает только реальные HTTP-вызовы: stats/profile/tasks/onboarding остаются безусловными моками даже в prod.

## Фактические сценарии

| Flow | Код | Реальное поведение / разрыв |
| --- | --- | --- |
| Вход/регистрация | `src/lib/api/auth.ts`, `src/stores/auth-store.ts`, `src/app/register/{password,done}/page.tsx` | Email registration -> login -> HttpOnly session; age отбрасывается. `done` не ждёт saveOnboarding и сразу очищает ответы. OAuth возвращает выдуманного User без серверной сессии |
| Onboarding | `src/config/onboarding-steps.ts`, `src/stores/onboarding-store.ts` | source/goal/level/daily minutes/notifications; password только память. Lesson и streak до регистрации - заглушки; реального учебного события нет |
| Home | `src/app/(app)/home/page.tsx`, `src/lib/api/{stats,daily-task}.ts` | Стрик 7, XP120, 12/30 минут, goal good-plus, level middle фиксированы; задача дня локальная. Continue берёт единственную browser-local тренировку, иначе ведёт в lesson stub. AI-карточка только текст за PlanGate |
| Профиль/настройки | `src/app/(app)/profile/page.tsx`, `src/app/settings/page.tsx`, `src/stores/profile-store.ts` | Имя/email, placeholder UserRound, тариф, стрик/XP/цели. Нет registration date, avatar upload, видимого level, истории. Настройки name/goal/dailyGoal накладывают localStorage поверх stats; PATCH mock |
| Каталог | `src/components/tasks/{TaskCatalog,ExamNumberCard}.tsx`, `src/config/tasks.ts` | Части 1/2, favourites; раскрытие номера -> все задачи или одна тема -> шторка. 19 номеров, активны №1 (24 задачи)/№2 (18); шесть тем только для них; остальные «Скоро» |
| Подбор | `src/components/tasks/TrainingSetupSheet.tsx`, `src/hooks/use-training-setup.ts`, `src/lib/task-training.ts` | Одно выбранное множество задач, count 5/10/20/all и slider сложности. Выбора количества каждого номера нет. Отбор локальный: in-progress -> новые -> correct; для all исключает correct, численный count со slider может их повторять |
| Тренировка | `src/stores/tasks-store.ts`, `src/hooks/use-training-shell.ts`, `src/app/training/page.tsx` | Один session, scrubber, ответ, рисунок, review, synchronous check через acceptedAnswers. Новая попытка пустая; exit очищает ответы, оставляет solvedAt/рисунки неверных и session. Resume не полноценное восстановление черновика |
| Избранное | `src/hooks/use-task-favorite.ts`, `src/components/tasks/FavoritesGrid.tsx` | Optimistic toggle + no-op API, ошибка откатывается молча; <=5 задач запускаются сразу, иначе настройка. При выходе предлагает удалить верные. Пробники сохраняют canonical id, но favourites резолвит лишь TRAINING_TASKS: задачи пробников исчезают из списка |
| Каталог пробников | `src/config/mock-exams.ts`, `src/components/mock-exams/{MockExamCatalog,MockExamCard,MockExamDetails}.tsx` | 4 карточки одного 19-задачного FIPI-2025 варианта. Сортировка newest/oldest/score (score фактически группирует решённые); фильтр all/solved/unsolved. Details показывает дату варианта вместо completedAt |
| Решение пробника | `src/hooks/use-mock-exam-training.ts`, `src/stores/mock-exams-store.ts` | Одна session/result на examId, без истории попыток; при открытии всегда №1. 1..12 short, 13..19 attachment. Score = round(correct/count*100), любой attachment считается correct; нет частичных баллов |
| Загрузка | `src/components/mock-exams/MockExamAttachments.tsx` | input multiple image/*,.pdf передаёт только file.name; File сразу теряется. Нет upload/preview/лимитов/MIME validation/AI/async check. Дубликаты имени схлопываются |
| Демо | `src/stores/mock-exams-store.ts` | variant-01 seed: score70 + правильные 1..12; merge восстанавливает seed. SCOPE §«Демо проверки №13» описывает 20сек/2из2, но этого кода в checkout нет. Эти декларации нельзя считать реализованными |
| Квизы | `src/app/quizzes/page.tsx`, `src/config/quiz*.ts`, `src/stores/quiz-store.ts` | Оставить существующими моками; не использовать их результаты для серверных XP/streak |

## Что перенести в общий контракт

- Taxonomy обязана приходить с сервера: `examFormatId`, `version`, массив 20 `{id,number,part,title,responseType,maxPoints,topics,availableCount,progress}`. Новая нумерация не получается добавлением №20: исследование координатора выявило вставку статистики №6 и последующие смещения. Не вычислять part/AI-route по index или порогу `<=12`.
- `TaskBlock` уже поддерживает text/latex/image `{src,alt,aspectRatio?,colorMode?}`. Сохранить форму; image выдавать через доступный same-origin media URL (next/image сейчас без remotePatterns). `TaskDto`: `{id,version,examFormatId,examNumber,part,topicIds,difficulty,responseType,content,provenance,favorite,lastSolvedAt,progressStatus,gradingCapability}`. acceptedAnswers исключить; solution получать после проверки через серверный result.
- Отличать canonical `taskId`, immutable `taskVersionId`, уникальный `attemptItemId`, `attemptId`, `templateId`. Сейчас taskId одновременно ключ ответа/статуса/рисунка, а пробник искусственно добавляет examId:; это ломается на повторных попытках и повторных задачах.
- `CreateTraining`: `{examFormatId,selection:[{numberId,topicIds?,count}],difficultyLevel?,source:'catalog'|'favorites',favoriteTaskIds?}`. Сервер подбирает задачи, возвращает порядок и фактические counts. Для недостатка банка вернуть availability по номерам; не молча уменьшать заданное число. `all` допустим как отдельный режим выбранного номера с серверным пределом.
- `AttemptDto`: `{id,kind:'training'|'mock-exam',templateId?,formatVersion,status,revision,currentIndex,createdAt,updatedAt,completedAt?,items:[{id,task,answer,attachments,drawing?,answerRevision,checkState,result?}],summary}`. `summary`: answered/total, earned/maxPoints, optional scaledScore+scaleVersion; результат не вычислять по проценту верных на клиенте.
- `AttachmentDto`: `{id,fileName,mimeType,sizeBytes,status,previewUrl?,downloadUrl?}`. Реальные байты upload, удаление по id, порядок файлов сохранять. URL доступен только владельцу. Наличие attachment не означает оценку. Draft drawing остаётся редактируемым массивом DrawingStroke; серверная синхронизация после жеста/выхода, не каждый pointermove.
- `CheckDto`: `{id,attemptId,inputRevision,status:'queued'|'running'|'completed'|'failed',items:[{attemptItemId,status:'pending'|'graded'|'rejected'|'failed'|'unsupported',isGraded,score?,maxScore?,feedback?,retryable?}],summary?}`. rejected/unsupported/failed не превращать в 0/incorrect. Partial score требует отдельного UI-состояния, текущих трёх TaskStatus недостаточно.
- `ProfileDto`: `{id,email,displayName,createdAt,avatar?,goalId,levelId,dailyGoalMinutes,timeZone,notificationsEnabled,plan,features}`. Цели norm/good/good-plus/excellent/flawless; level zero/basics/middle/confident/strong; минуты 15/30/45/60. createdAt серверный, levelId сейчас самооценка, XP отдельно.
- `StatsDto`: `{xp,streakDays,dailyGoalMinutes,dailyProgressMinutes,date,timeZone,week:[{date,active,minutes}],resumeAttempt?}`. `StreakCalendar.tsx` сейчас рисует историю из одного streakDays и локальной даты; заменить фактами дней. Сервер учитывает активное учебное время через уникальные activity events, повторная отправка не удваивает минуты/XP.

## Предложенные HTTP операции

| Операция | Request -> response |
| --- | --- |
| GET `/api/catalog` | formatId -> taxonomy/topics, availability и пользовательский прогресс; без загрузки всего банка |
| GET `/api/tasks` | numberId/topicIds/difficulty/cursor -> page TaskSummary; GET `/api/tasks/{id}` -> TaskDto |
| GET `/api/favorites` | cursor -> page TaskSummary из общего банка, включая задачи пробников |
| PUT / DELETE `/api/favorites/{taskId}` | идемпотентное add/remove -> состояние; bulk DELETE принимает taskIds для «убрать решённые» |
| POST `/api/training-attempts` | CreateTraining + idempotency key -> AttemptDto |
| GET `/api/mock-exams` | sort/filter/cursor -> templates + latest/active attempt summaries |
| POST `/api/mock-exams/{templateId}/attempts` | idempotency key -> AttemptDto из ровно 20 versioned items; resume существующей попытки отдельным GET |
| GET `/api/attempts/{id}` | AttemptDto; POST `/api/attempts/{id}/items/{itemId}/attachments` multipart file -> AttachmentDto |
| PATCH `/api/attempts/{id}` | revision/currentIndex/items[{id,answer,drawing?}] -> новый revision; DELETE attachment по id |
| POST `/api/attempts/{id}/checks` | revision + idempotency key -> CheckDto; GET `/api/checks/{id}` для polling/reload |
| GET `/api/attempts` | kind/templateId/cursor -> настоящая история; GET attempt возвращает прошлый snapshot/result |
| GET / PATCH `/api/profile` | ProfileDto / editable patch -> ProfileDto; POST avatar multipart / DELETE avatar |
| GET `/api/stats`, GET `/api/daily-task` | StatsDto / task+date; POST `/api/activity-events` -> updated stats |
| PATCH `/api/onboarding` | goal/level/dailyGoal/notifications/source -> ProfileDto; await перед reset/navigation |

## Server state, валидация, ошибки

- `cachedResource` (`src/lib/cached-resource.ts`) бессрочен на JS-модуль, не имеет user key/invalidate/subscriptions; `useAsyncData` хранит собственную копию. Нужны user-keyed ресурсы с invalidation/уведомлением после profile/favourite/check/activity, сбросом на logout/user switch и отменой старых запросов. Одна исправленная схема загрузки, без второго клиента.
- Persist `botai-tasks`, `botai-profile`, `botai-mock-exams` browser-global: не импортировать их mock results/history в сервер. Версионированно удалить/изолировать legacy учебные ключи; оставить локальными scroll/filter/раскрытие/инструмент. Черновик допустим с userId+attemptId+revision; сервер authoritative.
- Save/check защищены от double click и повторов сети; revision связывает результат с конкретными ответами/фото. Ответ позднего check не заменяет изменённый draft; reload восстанавливает queued/running. Pending upload запрещает submit; уход не теряет успешно сохранённое.
- `apiFetch` уже принимает FormData через body без ручного Content-Type, credentials и CSRF. Расширить ApiError structured `{status,code,fieldErrors,retryAfter?,requestId}`; 401 обновляет auth и ведёт на login, CSRF-expiry отличать от entitlement 403.
- Существующие ErrorNote/Skeleton использовать для fetch/save; добавить явные empty catalog/favorites/history, no active session, invalid/deleted attempt, insufficient selection, saving/unsaved/retry, upload rejection, queued/running/rejected/failed AI. Сейчас invalid exam -> пустой экран; favourite rollback без объяснения; auth refresh rejection не обработан.
- Валидация `src/lib/validation.ts`: age14..100 (SCOPE неверно 1..120), password только min8 (backend max72), name лишь nonempty, email regex. Синхронизировать ограничения с server DTO; неизвестные goal/level/minutes, отрицательные/слишком большие counts, max files/bytes и MIME отклоняет сервер.
- Новая попытка создаёт новый id; просмотр завершённой не мутирует историю. Перепроверка текущей версии ответа создаёт отдельный check; latest summary и immutable result различаются. Favourites всегда canonical taskId, ответы/фото/рисунки всегда attemptItemId.

## Приёмочные сценарии интеграции

1. Два пользователя в одном браузере: отдельные profile/favourites/attempts/stats; reload и повторный вход восстанавливают серверные данные.
2. Каталог ровно 1..20 по новой taxonomy; выбор нескольких номеров с собственными counts; темы и нехватка банка честные; 20-item mock template без дубля/молчаливого сдвига.
3. Draft -> reload -> resume; новый attempt пуст; completed history неизменна. Favourite из пробника виден в каталоге.
4. Байты изображения сохранены; retry upload/check не создаёт дубль; проверка асинхронна; отказ/ошибка AI без ложного балла; результат переживает reload.
5. Profile save/onboarding await, avatar/date/level/streak/plan подтверждаются GET; сохранение/401/конфликт показывают действие для восстановления; квизы остаются моками.
