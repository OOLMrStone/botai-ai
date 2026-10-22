# Runtime / deploy: инвентаризация и план

Срез 2026-10-04/05. Проверены applicable AGENTS, WORKLOG, security-review, data-architecture и AI DEPLOYMENT/DEVELOPMENT_SERVER. До общей SPEC продуктовый код и серверная конфигурация не менялись.

## Подтверждённые факты

| Контур | Источник / runtime | Слушатель / состояние |
|---|---|---|
| AI main | `/srv/ege/app`; Compose `deploy/docker-compose.prod.yml`; `ege-grading-api`, `ege-grading:latest` | `127.0.0.1:8080 → 8000`, healthy; `/health` 200 |
| Auth | `/srv/auth/{app.jar,Dockerfile,docker-compose.yml,.env}`; исходников Java нет; `botai-auth:latest` | `127.0.0.1:8082 → 8080`, healthy; anonymous `/api/auth/session/verified` 401 |
| PostgreSQL | `botai-auth-db`, `postgres:17`; named volume `auth_auth-db` | Только container `5432`; PG17.11, V1–V4 success по data-architecture |
| Front | `/opt/botai-front/compose.yaml`; `botai-front:availability-20260929-r4` | `127.0.0.1:3000`, healthy; `/` 307 |
| DEVELOP | `/srv/develop`, rootless Docker UID1000; `botai-develop:local` | `127.0.0.1:18080`, healthy; отдельные код, env, prompts и storage |
| Gateway | `/srv/gateway`; `botai-gateway.service` | `127.0.0.1:8091`, active; credential boundary и firewall сохранены |

- Host Caddy active: api `/api/auth/*` → auth; `/api/v1/*` → main AI через tester auth либо `forward_auth /api/auth/session/verified`; `/internal/grading/api/*` переписывается для standalone формы. `/health` Caddy не проверяет AI.
- `www.botai-ege.ru` → front; `develop.botai-ege.ru` → отдельный ограниченный allowlist UI/photo-check/config на 18080. Текущая внешняя TLS/DNS-доступность DEVELOP этим аудитом не проверялась.
- Main AI mounts: `/srv/ege/reports` и `/srv/ege/suspicious-submissions`; сохраняются независимо от image. Host disk: 42 GiB свободно; DEVELOP отдельный ограниченный том, его нельзя использовать под новую интеграцию.
- Готовая S3-конфигурация не обнаружена: проверены только имена S3/BUCKET/AWS_/MINIO/OBJECT_STORAGE keys в env четырёх root Docker контейнеров, `.env` в `/srv/auth`, `/srv/ege/app`, `/srv/develop`, локальных `.env*` back/front/ai. Значения не выводились; существование настройки где-либо ещё не исключено.
- На ноутбуке Docker Desktop запущен; daemon 29.7.2 Linux aarch64 и Compose v5.5.1 отвечают, работающих контейнеров нет. Node22.23.1, front node_modules; AI `.venv` Python3.14.6. Единственный host JDK25, backend target21.
- Back `compose.yaml` сейчас postgres:latest; локальная ветка имеет V1/V2. Production auth/session/verified и V3/V4 должны войти в baseline до новых миграций.
- Front уже имеет beforeFiles same-origin rewrite `/api/*` → `BACKEND_URL`; `npm run dev:api` отключает browser API mocks. AI dev compose опасен как integration default: читает реальные `.env`, может включить debug и имеет фиксированное имя контейнера.
- Current AI photo API standalone; product internal endpoint ещё требуется. Registry14–20 должен отмечать только existing16 доступным; новые prompt packages в эту работу не входят.

## Предлагаемый первый локальный стек

- Отдельный `compose.integration.yaml`, project `botai-integration-local`, собственные named volumes/network/env; не переиспользовать существующие compose и container_name. Контейнеры: postgres17, private S3, backend, AI mock; Adminer в opt-in profile `ops`.
- PG закрепить на проверенной версии17 и digest. Сначала чистый V1–V4 baseline, затем новые миграции после V4; отключить `SPRING_DOCKER_COMPOSE_ENABLED`, явно передать JDBC. Отдельные migration/runtime/read-only operator credentials.
- Backend собирать Gradle wrapper в JDK21 container, runtime также Java21; target и host JDK не менять. Gradle cache отдельным volume. Front пока запускать имеющимся Node22 на host.
- Back единственный application port `127.0.0.1:18082`; front `127.0.0.1:13000`, `BACKEND_URL=http://127.0.0.1:18082 npm run dev:api -- --hostname 127.0.0.1 --port 13000`. Browser использует только front `/api`.
- AI только на private internal network с backend, без published port и внешнего egress; принудительно `LLM_PROVIDER=mock`, `LLM_VISION_PROVIDER=mock`, `DEBUG_ENABLED=false`, `DEBUG_ALLOW_IN_PROD=false`. Не подключать production/gateway `.env`; service token отдельный, fail-closed.
- PG/S3 только private data network; AI не получает S3/DB credentials. Backend ingress network отделить от AI internal network. Все сгенерированные secrets в gitignored файле0600, без вывода compose resolved environment.
- Для локального S3 предлагается [Garage single-node](https://garagehq.deuxfleurs.fr/documentation/quick-start/) с persistent data+metadata volumes, bucket key только backend, без публичных S3/web/admin портов. Это тестовая конфигурация без redundancy; production storage решение отдельно. Проверить AWS SDK path-style PUT/GET/HEAD/DELETE, private access, limits и cleanup; Garage не реализует AWS ACL/policy API.
- Не выбирать MinIO latest автоматически: [официальный repository](https://github.com/minio/minio) archived25.04.2026, community source-only и больше не maintained. Старый образ не считать проверенным production storage решением.
- [Adminer](https://www.adminer.org/) только `127.0.0.1:18090`, opt-in профиль, PG read-only operator по умолчанию; credentials вводятся локально. В public Caddy ни DB, ни Adminer не маршрутизировать.
- Moderation UI отдельный frontend route `/admin/submissions` и backend ADMIN API с актуальной ролью/audit; Adminer не заменяет продуктовую модерацию. Фото выдаёт authenticated backend stream, без прямой ссылки на bucket.
- Healthcheck никогда не использует probe=true или grading; AI `/health`, PG pg_isready, backend собственный liveness. Readiness отдельно подтверждает migration+DB+storage без вызова модели. Log rotation, bounded resources и timestamps/request IDs без payload/secrets.

## Предлагаемый server staging и release gate

- Создать `/srv/botai-integration/{back,front,ai,runtime,data,backups}` root-owned: back JAR/image, front release, AI runtime-only export, runtime compose и private env отдельно. Не раскладывать backend внутри AI и не копировать весь research checkout.
- Новый Compose project `botai-integration-stage`; независимые PG/S3 volumes и mock AI. Stage front `127.0.0.1:13000`, back `127.0.0.1:18082`, Adminer `127.0.0.1:18090`; перед запуском проверить занятость. Доступ владельца `ssh -N -L 127.0.0.1:13000:127.0.0.1:13000 -L 127.0.0.1:18090:127.0.0.1:18090 ege-server`.
- Не менять DEVELOP/gateway, UIDs, firewall, SSH PermitOpen, Caddy origins, provider secret, пакеты Docker или production listeners. Staging не получает root Docker socket, host network или production DB/S3 credentials.
- Сначала локально auth/session/CSRF, реальные `/api` flows, intent/upload/queue/result/history, unsupported registry, owner/admin denial, malformed images, storage outage/orphan cleanup, retry/cancel/late-result; только synthetic fixtures и mock AI.
- Затем staging те же checks плюс build architecture, фактические cookie flags/proxy paths, private ports и рестарт с сохранением volumes; отдельно snapshot→restore rehearsal PG+object metadata/data. Security gate включает review текущих диффов и отрицательные проверки, не только happy path.
- Production не перезапускать до прохождения local+stage+security gate. Перед переключением private backup existing PG17 и проверяемый restore, неизменные V1–V4 checksums, recorded images/digests/config permissions, env hashes и rollback copy Caddy. Секреты и PII не выводить.
- Финальный runtime может остаться в этих раздельных каталогах; переключать только согласованные host proxy upstreams после кандидата. Сохранить existing auth DB/session volume и `/api/auth/session/verified`; новые migrations additive после V4. Не подключать новый production backend к staging PG.
- Existing main AI standalone и product AI сохранять разными routes/containers до явного решения о замене; product internal AI не выставлять в Caddy, legacy/debug не попадут в product ingress. Backend передаёт только trusted task snapshot и normalized bytes.
- Откат: вернуть записанные application image/upstream без удаления новых таблиц/history/objects; expanded schema должна поддерживать предыдущий auth. Никакого `down -v`, Flyway repair/baseline/drop, удаления старых images/env или автоматического повторного paid dispatch.
- До production остаются решения: storage endpoint/bucket и backup/encryption policy, retention, admin operator/MFA ingress, quotas, ресурсы контейнеров. Новые платные сервисы не создавать; live AI/probes не выполнять.

Результат этого этапа: только инвентаризация, этот план и запуск локального Docker Desktop; Compose, scripts, JAR и deploy ожидают SPEC.
