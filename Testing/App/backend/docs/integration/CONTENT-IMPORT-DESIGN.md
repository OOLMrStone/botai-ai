# Импорт каталога: контракт и минимальная модель

## Уточнение пользователя 2026-10-06: BankZadach и скрытые источники

Разрешён импорт банка BankZadach: `provider=bankzadach`, `permissionRef=user-grant-2026-10-06-bankzadach`, `sourceGroups=["bankzadach"]`, lowercase UUID identity и точный capture URL `https://bank-zadach.ru/task/{uuid}/`. Это отдельная политика от прежнего разрешения Школково; ограничения HTTPS/host/path, assets, формул и publisher gates сохранены. Неизвестное авторство не заменяется названием поставщика.

По новому решению пользователя происхождение ученику не отображается: совместимое публичное `sources=[]`, без миграции и переписывания immutable provenance, content fingerprints или прошлых попыток. `TrainingRequest.source=catalog|favorites` сохраняет прежний смысл. Указания о публичном показе первоисточников ниже являются историческими и заменены этим уточнением.


Статус: контракт JSONL v1 для реализации, 2026-10-05. Прочитаны действующие V5/V6, `CatalogRepository`, `CatalogDtos`, `TaskSnapshot`, `ImageNormalizer`, SPEC v1.6 и инструкции соседних front/AI репозиториев; backend/родительские AGENTS.md отсутствуют. Root согласовал additive реализацию миграции/publisher/media; применение сначала pilot local, затем stage. V5/V6, прежние данные и пользовательская история сохраняются. Границы обработки недоверенного контента: [CONTENT-IMPORT-SECURITY](CONTENT-IMPORT-SECURITY.md).

## Разрешённый объём

Пользователь подтвердил разрешение переносить в BotAI задания, решения и изображения разделов «ЕГЭ прошлых лет», «ФИПИ», «СтатГрад», «ЕГКР», «Ященко». Это зафиксированное пользовательское разрешение для перечисленных групп; повторное согласование этих групп не требуется. «Школково Авторские» и прочие подготовительные разделы исключены. Подтверждение пользователя не переименовывается в лицензию издателя: хранить основание `user-confirmed`, дату, точный scope и ссылку на запись решения, без выдуманных условий лицензии.

Школково — поставщик/агрегатор, а ФИПИ, конкретный экзамен, СтатГрад, ЕГКР или Ященко — отдельные сведения о первоначальном источнике. У одной карточки может быть несколько таких сведений. Идентичность карточки определяется `(provider, externalId)`, а не разделом каталога: одна карточка, найденная в нескольких разрешённых разделах, остаётся одним заданием. Неизвестный первоначальный издатель хранится как неизвестный, а не автоматически «Школково».

## Фактическая исходная схема V5/V6

| Объект | Фактические поля и ограничения |
| --- | --- |
| `exam_formats` | `source_year`, `source_url`, `source_status`; это источник формата экзамена, не происхождение задания. Форматы и позиции immutable. |
| `topics` | `source_url`, стабильный строковый ID, format/number/sort_order. Ссылка относится к таксономии; provider задания отдельно не хранится. |
| `task_versions` | `source_year` NOT NULL, `content` JSON-массив, `statement` до16000, обязательный `reference_answer` до16000, nullable `reference_solution` до32000, `difficulty=easy/medium/hard`, `is_demo`. Нет provider/publisher/source URL/rights/fingerprint. |
| `tasks` | Стабильный UUID и `current_version_id`; FK проверяет принадлежность версии заданию. Избранное и результаты связаны с этим UUID. |
| `task_version_answers/topics` | UPDATE/DELETE запрещены; INSERT запрещён после публикации current pointer или включения в попытку. FK темы сам по себе не проверяет совпадение format/number с версией. |
| `attempt_items` / шаблоны | Попытки ссылаются на конкретные immutable версии; менять membership нельзя. Опубликованный пробник immutable и содержит ровно20 позиций. |
| `stored_objects` | Требует владельца-user и purpose `solution`/`avatar`; не подходит для медиа каталога. |

V6 сохраняет100 оригинальных synthetic заданий, 140 тем и исходные опубликованные шаблоны. Их версии, `is_demo`, попытки, ответы, избранное и результаты не переписываются. Новые задания не объявлять synthetic только потому, что runtime AI работает в mock; результат mock остаётся demo по существующей границе проверки.

В исходном V5/V6 публичный Task DTO не содержал provenance; `sourceYear` был обязательным int. В V7 это nullable year и публичные `sources` только originalPublisher/originalReferences, без provider/externalId/capture URL и answer/reference. Immutable сохранённый snapshot/provenance остаётся прежним; API делает безопасную проекцию, поэтому переимпорт для изменения подписи источника не требуется. `TrainingRequest.source` означает только `catalog|favorites` и не используется для издателя. `TaskSnapshot` передаёт AI серверные statement/reference/acceptedAnswers, без произвольных URL. Reference выдаётся отдельно по существующим правилам раскрытия после проверки, а не в обычном Task DTO.

## Минимальные добавления после согласования

1. `task_source_links`: уникальные `(provider_namespace, external_id)` → `task_id`. ID не включает source group или год. Не объединять разные external IDs/поставщиков только по совпадению текста; такие совпадения — кандидаты для review.
2. `task_version_provenance`: 1:1 к версии, immutable snapshot JSONB с provider, canonical source URL, original source references/publisher, группами, годами, основанием разрешения, mapping revision и hashes. Отдельный обязательный `version_fingerprint` и уникальность `(task_id, version_fingerprint)` обеспечивают повторное использование прежней версии. Разрешить вставку provenance только до публикации версии, затем запретить вставку/UPDATE/DELETE как для существующих children.
3. `catalog_assets` и `task_version_assets`: серверные UUID, private bucket/key, normalized SHA256, MIME/size/dimensions, состояние staged/ready/failed, scope `statement|reference`, ordinal. Ни fake user, ни расширение student upload route. Версия связывается с готовыми immutable объектами до публикации.
4. Один отчёт import run с manifest hash/adapter+mapping revisions и счётчиками; item-level quarantine JSONL хранится в закрытом runtime-каталоге. Если нужен возобновляемый большой импорт — добавить run/items таблицы с теми же ключами, а не второй путь публикации.

Пользовательское отображение происхождения — отдельный небольшой DTO `sources`: массив с provider, безопасной canonical ссылкой и original source labels/references. В него не попадают пути staging, служебные fingerprints, raw HTML, разрешения с приватными реквизитами или reference answer/solution. Новый фильтр поставщика при необходимости имеет отдельное имя `provider`; старый `source=catalog|favorites` сохраняется.

## Единый JSONL v1

Одна строка — одна карточка поставщика, UTF-8, strict JSON без duplicate/unknown keys. Общий envelope и имена полей:

```json
{
  "schemaVersion": "botai-content.v1",
  "provider": "shkolkovo",
  "externalId": "185802",
  "provenance": {
    "sourceUrl": "https://3.shkolkovo.online/catalog/203/185802",
    "sourceGroups": ["past-ege", "fipi"],
    "originalPublisher": null,
    "originalReferences": [],
    "permissionRef": "user-grant-2026-10-05-shkolkovo-named-groups",
    "mappingRevision": "reviewed-manifest-revision",
    "retrievedAt": "2026-10-05T00:00:00Z",
    "extractorVersion": "1"
  },
  "formatId": "ege-profile-20-v1",
  "examNumber": 20,
  "topicIds": ["botai-20-divisibility"],
  "sourceYear": 2026,
  "difficulty": "medium",
  "content": [{"type": "text", "value": "Пример структуры; не исходное задание"}],
  "statement": "Пример структуры; не исходное задание",
  "acceptedAnswers": ["0"],
  "referenceAnswer": "0",
  "referenceSolution": null,
  "referenceContent": [],
  "referenceAnswerContent": [],
  "assets": []
}
```

Это пример структуры, не извлечённая карточка и не утверждение её темы/ответа. `provenance.originalReferences` содержит объекты `{publisher,label,url,year,examNumber}` с nullable неизвестными значениями и plural provenance. `originalReferences[].examNumber` — исходный номер, `examNumber` — текущая позиция после review; исторические19/20 нельзя переносить механически. `sourceYear` nullable во входном staging; root согласовал nullable изменение БД/DTO для безгодовых карточек; текущий2027 формата не подставлять как год задания. Сложность может быть редакционной оценкой по описанному правилу, но не выдаётся за оценку поставщика.

Допустимый дополнительный блок `paragraph` содержит ordered `runs`: text `{type,value}`, latex `{type,value}` с точным TeX, formula `{type:"formula",assetId,alt?,heightEm?,baselineEm?}` для безопасно растеризованной формулы. Численные метрики берутся из наблюдаемого источника, без CSS passthrough; неизвестные конструкции в карантин. Publisher заменяет assetId на server-owned src. Формулы из lossy alt не реконструируются.

В staging image-block содержит `{type:"image",assetId,alt,aspectRatio?}`; asset manifest — `{id,purpose,path,sha256}`. Файлы только внутри предоставленного export-root, без symlink/path traversal. В публичном DTO image получает серверный same-origin `src`, а не исходный URL. `referenceAnswerContent` — отдельные точные блоки ответа. `referenceAnswer` может быть null только для14–20 при непустом rich answer; короткие1–13 требуют точный строковый ответ/acceptedAnswers.

`referenceSolution` — nullable точный текст; дополнительно root согласовал `referenceContent:TaskBlock[]` в immutable версии и additive solution DTO для точного порядка блоков/изображений решения, только через существующее checked-item/daily раскрытие. AI snapshot остаётся текстовым: версия с существенной непредставленной фигурой не получает AI-ready, без молчаливого отбрасывания информации.

Сеть находится только в адаптере acquisition с разрешёнными точными hosts; publisher/reference URL — metadata, импортёр их автоматически не обходит. Проверяемые ограничения HTML, LaTeX, картинок, URL и JSONL определяет security-документ; raw HTML/SVG и неизвестный type не проходят в renderer.

## Публикация, повторы и карантин

1. Получить разрешённый JSONL/export или выгрузку адаптера в private staging; записать manifest и исходные byte hashes. Никакого bulk DDL с контентом в Flyway/V6 и никакой публикации прямо из scraped DOM.
2. Validate → normalize → mapping review → quality report. Проверить область разрешения; полноту условия/всех подпунктов, формулы из реального markup, изображения, ответ и решение; format/number/topic consistency; отсутствие reference в statement/alt. Не считать formula-image alt гарантированным LaTeX и не подменять отсутствующую формулу OCR/догадкой.
3. Посчитать `content_fingerprint` canonical нормализованных данных с порядком blocks/подпунктов и normalized asset hashes. `version_fingerprint` включает также provenance, reviewed topic mapping и editorial difficulty; timestamps acquisition/import run исключаются. Raw hash остаётся для evidence, косметическая смена исходного HTML не создаёт новую версию без изменения нормализованного snapshot. Разные способы записи математически эквивалентного задания автоматически не сливать.
4. Под блокировкой source identity/task проверить fingerprints. Identical snapshot — noop; изменённый — новая `version=max+1`, новый UUID. Создать версию, answers/topics/provenance/asset membership, затем atomic current pointer в одной транзакции. Уникальные ограничения + повтор после конфликта делают concurrent reimport идемпотентным. Нельзя overwrite или UPSERT immutable версии.
5. При ошибке карточка остаётся вне selectable каталога с reason `incomplete`, `unmapped`, `unsafe-media`, `invalid-answer`, `out-of-scope` либо `unsupported-reference`. Частичная карточка не публикуется; успешно проверенные независимые карточки можно публиковать контролируемым batch. Исправленная quarantine строка проходит тот же pipeline.

Выпавшая из очередной выгрузки карточка не удаляется и не архивируется автоматически. Import run никогда не чистит synthetic или историю. Media upload/DB commit имеют reconciliation: staged объекты очищаются только после ограниченного TTL, ready assets с ссылками на любую историческую версию не удаляются. Откат batch возвращает только изменённые current pointers при совпадении ожидаемой версии; никакого удаления попыток/версий/пользователей.

## Таксономия и критерии готовности

Предложение владельца taxonomy: №4 сохраняет `sdamgia-166` как единственную тему; №5 сохраняет `sdamgia-185` («Вероятности сложных событий»), legacy `sdamgia-265` убирается только из текущей выдачи. №20 получает6 новых method IDs: `botai-20-divisibility`, `botai-20-integer-equations`, `botai-20-digits`, `botai-20-sequences`, `botai-20-invariants`, `botai-20-extrema`. Старые172/217/209/210 и memberships остаются для истории. Итого текущая предложенная выдача141 тема. Manifest и review принадлежат taxonomy-владельцу; нужен active-topic boundary в запросе каталога, поскольку текущий SQL показывает все topics.

Новые версии получают reviewed current topic IDs; для №20 основную method-тему и отдельные ортогональные теги, без угадывания по старому широкому разделу. Topic remap старого опубликованного задания создаёт новую версию, а не меняет immutable membership. До publish сервер повторно проверяет принадлежность каждой темы format/number.

Перед импортом local, затем отдельный stage: baseline counts/users/history; reviewed coverage по позициям/темам/source groups, отдельно distinct карточки и occurrences; completeness/quarantine totals без ложного обещания полного банка; first small sample; rerun/concurrent noop; changed content/mapping новая версия; прежняя попытка/reference остаются прежними; atomic rollback; private media/owner/reference denial. Реальная полнота определяется найденными count/pagination и отчётом acquisition, а не100 synthetic fixtures. Пользовательские аккаунты и public production не затрагиваются; расширение платной AI проверки этим импортом не разрешается.

## Реализация и применение

V7 и Java publisher/media/API реализованы: итоговый Java21 full57/57 PASS, independent security PASS. Локально V7 применено и3 reviewed real tasks опубликованы; repeat noop3, оригинальные100demo и пользовательские rows сохранены. Stage остаётся на последнем подтверждённом V6/100demo/0real: SSH banner timeout, remote deployment не выполнялся. CLI `scripts/integration/publish-content.sh /absolute/package normalized/tasks.jsonl` выполняет preflight, с `--publish` — явную публикацию. Mount read-only, отдельный контейнер без host ports, worker=false с запуска, Flyway выключен: V7 применяется отдельным одобренным deployment. До него CLI не использовать. Истинный размер банка ещё не установлен;3 вручную захваченных source samples не означают полный seed.

Root/security согласовали `POST /api/attempts/{attempt}/items/{item}/solution-reveal` только для extended стабильного unsupported: owner+CSRF+expectedAnswerRevision/latest submission ID+revision, без оценок и progress. Immutable grant одновременно audit event; повторы идемпотентны. GET solution и media используют единый predicate graded-current OR valid grant, включая version/asset membership. Текст/рисунок, новая submission, upload/delete/revision и staged фото делают прежний grant недействительным. Nullable rich answer, media и новый reveal требуют финальных tests/review до deployment.

### Замена synthetic fixtures без потери истории (2026-10-06)

Ретирация исходных V6 fixtures означает `tasks.archived=true` для точного списка100 UUID/version, не удаление версий. Каталог, избранное и новые тренировки уже исключают archived tasks. Дополнительно список доступных пробников и новый startExam исключают published templates с архивным участником; pinned старые attempts по-прежнему читают immutable version. Immutable exam template не изменяется. На frontend отсутствие доступных пробников имеет штатный empty state. Приватный guarded SQL и baseline находятся в `runtime/content-import/synthetic-retirement/`; archive script требует реальное покрытие всех20 номеров и unchanged V6 identities. Само наличие скрипта не означает его выполнения.
