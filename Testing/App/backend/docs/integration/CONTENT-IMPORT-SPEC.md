# Импорт банка — контракт v1, 2026-10-05

## Уточнение пользователя 2026-10-06: BankZadach и скрытые источники

Разрешён импорт банка BankZadach: `provider=bankzadach`, `permissionRef=user-grant-2026-10-06-bankzadach`, `sourceGroups=["bankzadach"]`, lowercase UUID identity и точный capture URL `https://bank-zadach.ru/task/{uuid}/`. Это отдельная политика от прежнего разрешения Школково; ограничения HTTPS/host/path, assets, формул и publisher gates сохранены. Неизвестное авторство не заменяется названием поставщика.

По новому решению пользователя происхождение ученику не отображается: совместимое публичное `sources=[]`, без миграции и переписывания immutable provenance, content fingerprints или прошлых попыток. `TrainingRequest.source=catalog|favorites` сохраняет прежний смысл. Указания о публичном показе первоисточников ниже являются историческими и заменены этим уточнением.


Статус: реализация. Дополнение к SPEC v1.6; прежние утверждения «только synthetic seed / 140 актуальных тем» заменяются лишь после проверенного применения импорта. Все исполнители читают этот файл и CONTENT-IMPORT-SECURITY.md; найденные факты — в профильных research/design файлах.

## Объём и разрешение

- Пользователь запросил все задачи прошлых ЕГЭ, ФИПИ, СтатГрада, ЕГКР и сборников Ященко из `https://3.shkolkovo.online/catalog?SubjectId=1`; авторский раздел Школково исключён. Подготовительные и прочие коллекции не добавляются автоматически.
- На прямой вопрос о разрешении переноса заданий, решений и изображений этих групп в BotAI пользователь ответил: «Да — есть разрешение на перенос в BotAI». Основание — заявление пользователя, не проверенная внешняя лицензия. Grant ID: `user-grant-2026-10-05-shkolkovo-named-groups`.
- Перенос охватывает условие, ответ, эталонное решение, необходимые изображения и происхождение. Недоступное/отсутствующее поле не придумывать, неполные записи учитывать в отчёте отдельно.

## Классификация и происхождение

- Существующие категории Решу ЕГЭ сохраняются, кроме №5 и №20. №4 остаётся единственной темой `sdamgia-166`; №5 объединяет 185/265 в единственную актуальную `sdamgia-185` («Вероятности сложных событий»).
- №20: `botai-20-divisibility` (делимость, остатки и чётность), `botai-20-integer-equations` (целочисленные уравнения), `botai-20-digits` (цифры и запись числа), `botai-20-sequences` (последовательности и прогрессии), `botai-20-invariants` (операции и инварианты), `botai-20-extrema` (оценки и экстремальные значения). Один основной учебный блок, дополнительные методы могут быть тегами. Источник и год не являются темой.
- Итог: 141 актуальная тема; исторические строки и принадлежность старых версий сохраняются. Сомнительная классификация требует разбора, не случайного назначения.
- `provider=shkolkovo`, external task ID и URL отделены от исходной публикации. Задача может иметь несколько источников. Год неизвестен → null. Старый `TrainingRequest.source=catalog|favorites` не менять; публичное происхождение — отдельное `sources`, содержащие только originalPublisher/originalReferences. Provider, externalId и capture URL остаются внутренними provenance/audit полями, не источником в интерфейсе.

## Целостность

- Повторный импорт не дублирует задачи. Изменение текста/ответа/эталона создаёт новую неизменяемую версию; сохранённые Attempt продолжают ссылаться на прежнюю. Не переписывать V5/V6 и не удалять synthetic, пользователей, попытки, stash или старые данные.
- Обычные публичные HTTPS-запросы с ограничением частоты, кэшом, возобновлением и точной сверкой страниц/ID. Не обходить запреты доступа, CAPTCHA или rate limit. Секреты/браузерные cookies не экспортировать.
- HTML не исполняется. Нужны точные формулы: alt у SVG бывает неполным, его нельзя выдавать за LaTeX. Безопасное преобразование рисунков/формул согласуется с security reviewer; неизвестные конструкции не теряются молча.
- Условия доступны ученику; ответы, решения и их изображения — только через существующую проверенную границу раскрытия. Импортёр не позволяет входным данным выбрать isDemo, роль, SQL или S3 URL.
- Raw/cache/пакеты с ответами — private, вне Git; Git содержит код, миграции, классификацию и обезличенный отчёт. Публикация только после валидации. Отчёт: ожидаемые/полученные уникальные ID, дубли, исходы по источнику/номеру, причины карантина.

## Исполнение и приёмка

- `frontend_completion`: acquisition/parser/classification, затем отображение источника и UI-проверка. `runtime_completion`: DB migration/publisher/catalog media/API, применение local/stage. `dependency_security_review`: независимый контракт и проверка реализации. Root: координация и короткие фактические заметки.
- Сначала разнородный pilot с формулами/картинкой/коротким и развёрнутым ответом; затем весь разрешённый объём. Проверить повторный запуск, приватность решений, сохранность старой попытки, counts и отображение в UI. Local/stage изменять последовательно; публичный production не переключать.

## Additive API v1

- Канонический package JSONL — [CONTENT-IMPORT-DESIGN](CONTENT-IMPORT-DESIGN.md): `botai-content.v1`; отдельные `referenceAnswerContent` и `referenceContent`. Точный строковый `referenceAnswer` nullable только для14–20 при непустом rich answer;1–13 по-прежнему требуют точный accepted answer.
- Task: nullable `sourceYear`, публичный `sources[]` только с первоисточниками `originalPublisher`/`originalReferences`; provider/sourceUrl/externalId исключены. Ссылки возможны лишь на подтверждённый первоисточник, без fallback на Школково. Private reference blocks исключены. Image/formula media URL server-owned; общий catalog-media отдаёт только условие.
- Solution: прежние reference строки + `referenceAnswerContent`/`referenceContent`, только через авторизованное раскрытие.
- POST `/api/attempts/{attempt}/items/{item}/solution-reveal`: `{expectedAnswerRevision,expectedSubmissionId:null|UUID,expectedSubmissionRevision:null|int}`. Только extended stable unsupported/неполный AI snapshot, auth+CSRF+owner, неизменяемый audit grant без grade/progress. Grants действуют лишь для текущего task version/text-drawing revision/latest submission ID+revision без staged фото; изменения отзывают доступ. Повтор идентичного запроса не создаёт второй grant. GET solution/reference media — общий owner/current-state predicate. Transient unavailable, unknown capability и отсутствиеPro сами по себе не разрешают reveal.


## Numeric difficulty revision (V8)

New manifests use `difficulty: 1|2|3|4|5|null`; null is explicitly unknown. Booleans, fractional numbers and values outside 1..5 are invalid. Do not send `isGrob`: it is generated by PostgreSQL as `coalesce(difficulty_level = 5, false)` and projected by the API. For replay compatibility only, prior string labels `easy|medium|hard` remain accepted and stored in the legacy column, with numeric level null. They must not be used by new adapters or inferred as numeric ratings. The difficulty value participates in the immutable content/version fingerprint, so moving an existing task to an explicit numeric rating creates a new version while preserving old attempts and provenance.
