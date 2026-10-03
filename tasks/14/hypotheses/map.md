# Где что лежит — задания 14, 15, 18

Карта файлов и мест по работе над проверкой заданий 14, 15, 18. Порядок чтения в новой сессии: [work-notes.md](work-notes.md) → этот файл → конец [history.md](history.md) → [итоги раунда 5](../../common/hypotheses/research/round5-reader-2026-10-03/README.md).

## Контекст и решения (читать в первую очередь)

| Файл | Зачем |
| --- | --- |
| `tasks/14/hypotheses/work-notes.md` | **Начать отсюда.** Текущее состояние, правила Кости и руководителя, следующие шаги. |
| `tasks/14/hypotheses/history.md` | Хронология всего, что обсуждали: решения, цитаты Кости и руководителя, что пробовали и отбросили, цифры каждого прогона. |
| `tasks/14/hypotheses/map.md` | Этот файл. |
| `tasks/{14,15,18}/hypotheses/README.md` | Все оценённые работы ФИПИ по заданию с кодами ошибок и источниками справочников. |
| `tasks/common/hypotheses/research/round5-reader-2026-10-03/README.md` | **Итоги на 03.10**: таблица версий, вердикты (подошло/нет/спорно), разбор промахов, открытые вопросы, состояние сервера. |
| `…/round5-reader-2026-10-03/matrix.md` | Балл каждой работы в каждой версии. |
| `…/round5-reader-2026-10-03/symbol-tier.md` | Тир символов, которые модель путает на фото (S/A/B). |
| `tasks/common/hypotheses/research/round4-misgrading-2026-10-02/` | Разбор в 4 агента: почему модель ошибается (чтение «как должно быть», достраивание доказательства). План и вопросы эксперту — `critic-plan.md`. |
| `tasks/common/hypotheses/research/round3-evals-2026-10-02/` | Разбор первого платного прогона: промахи, предложения R1–R7, критик, защита. |
| `tasks/common/hypotheses/research/round1-2026-09-30/`, `round2-geometry-2026-10-01/` | Исследование типичных ошибок для справочников (`popular_mistakes.md`). |

## Промпты (то, что видит модель)

| Файл | Зачем |
| --- | --- |
| `tasks/{14,15,18}/prompts/main.md` | Порядок этапов: расшифровка → эталон → анализ → Notes → оценка. Свой у каждого задания (transcript-first). |
| `tasks/{14,15,18}/prompts/ocr.md` | Как переписывать фото: запись ученика, а не эталон; спорное — с вариантами. |
| `tasks/{14,15,18}/prompts/analysis.md` | Как анализировать: б на недоказанном а, необоснованные утверждения, спорное прочтение. |
| `tasks/{14,15,18}/prompts/popular_mistakes.md` | Справочник ошибок E01…; коды проверяет `validator.py`. |
| `tasks/{14,15,18}/prompts/criteria.md` | Критерии ФИПИ-2026 дословно. |
| `tasks/{14,15,18}/prompts/response-format.md` | Формат JSON-ответа. |
| `tasks/common/prompts/grading.md`, `main.md` | Общие файлы (16 использует общий `main.md`; у 14/15/18 свой). |
| `tasks/16/` | Неравенство — на сайте, **не менять**. |

## Код (что меняли)

| Файл | Зачем |
| --- | --- |
| `app/grading/package.py` | `TRANSCRIPT_TASKS = {14, 15, 18}` (сначала расшифровка), `READER_TASKS = {14, 15}` (расшифровку делает отдельный вызов). |
| `app/grading/reader.py` | Буквальное чтение фото тремя увеличенными полосами без условия и ответа. |
| `app/grading/session.py` | Порядок чтения файлов, скрытие ответа, запрет переписывать `Transcript.md`, адаптеры. |
| `app/grading/service.py` | Запускает reader параллельно с подготовкой задачи; при сбое — модель читает сама. |
| `app/grading/provider.py` | `transcribe()` — вызов без рассуждения для reader; mock. |
| `scripts/run_photo_evals.py` | Прогон evals через `/api/v1/photo-check`; `--resume`, `--retries`, `--case`. |
| `scripts/prepare_fipi_evals.py` | Сборка evals из PDF ФИПИ. |
| `scripts/render_photo_eval_report.py` | HTML-отчёт по прогону. |
| `tests/test_grading_session.py` и др. | Тесты (mock, только Linux/WSL: `fcntl`). |

## Данные для замеров

| Где | Что |
| --- | --- |
| `tasks/{14,15,18}/evals/fipi/` | 63 работы ФИПИ-2026 (22/22/19) — фото, эталоны, манифесты; `verdict-overrides.json` — решение руководителя по 17.6.2. |
| `…/round5-reader-2026-10-03/tools/reshu/` | Независимый набор Решу ЕГЭ: скрипты сборки, `verification.md` (сверка баллов), `manifest-keep-{14,15,18}.json` (30 работ). **Картинок в репозитории нет** — они в `Desktop/botai-references/reshu/evals/` на старом ПК; пересобрать скриптами. |
| `output/evals/<прогон>/` | Результаты прогонов (в `.gitignore`, только на старом ПК). Префиксы: `trial/full` — до правок, `v4`, `v5`, `v6c`, `v6cfix` (повтор сбоев), `v6d`, `v6e`, `*reshu*` — Решу. |

## Инструменты прогона (с WSL старого ПК)

| Файл | Зачем |
| --- | --- |
| `…/tools/wsl/run_evals.sh` | `run_evals.sh <префикс> <задание> [работы…]` — SSH-туннель к develop и прогон ФИПИ (`CONC`, `RETRIES`). |
| `…/tools/wsl/chain_deploy_and_run.sh` | Пример цепочки: сборка runtime, выкладка слоем `Dockerfile.transcript`, сверка хешей промптов, прогон. Запуск отвязанным: `setsid nohup … & disown`. |
| `…/tools/summary.py`, `matrix.py`, `compare.py` | Сводка совпадений по прогонам, таблица по работам, сравнение с исходным прогоном. Пути к `output/evals` поправить под новый ПК. |
| `…/tools/reader/` | Эксперимент с reader до внедрения: места (`places.json`), прогон, подсчёт. |

## Вне репозитория

| Где | Что |
| --- | --- |
| develop-сервер (`docs/DEPLOYMENT.md`, доступ по ключу Кости `botai_dev`, пользователь `botai-dev`) | Контейнер `botai-develop`, порт 18080 (через SSH-туннель), шлюз Васи `10.0.2.2:8091`. Слой: `/srv/develop/Dockerfile.transcript` (`FROM botai-develop:prompts-r3b`, копирует `tr/grading/` и `tr/prompts/`). Сейчас образ `v6e`. `.env`, `compose.yaml`, Dockerfile Васи — **не трогать**. |
| Рабочий стол старого ПК | `Отчёт руководителю 02.10.pdf`; `Ошибки модели — {14 уравнения, 15 стереометрия, 18 планиметрия}.pdf` (фото + ответ модели + разбор); `Модель — сильные и слабые стороны.pdf`; `Тир проблемных символов.md` (копия в репо); `PR — описание.md`; `botai-backups/` (архивы v4). |
| `Desktop/botai-references/` старого ПК | Первоисточники (методички ФИПИ), набор Решу ЕГЭ с картинками, эксперимент reader. |
| GitHub | Репозиторий руководителя `OOLMrStone/botai-ai` (PR из `grading-v6-results` в `main`); личный `STRa1K1234/botai-ai-work` (PR из `grading-v6-results` в `14-implementation`). |
