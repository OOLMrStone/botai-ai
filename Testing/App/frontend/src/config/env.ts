// Единственный источник правды о среде: что это за сборка, куда ходит API и
// включены ли dev-инструменты. Читают отсюда и клиент, и next.config -
// переменные окружения больше нигде не разбираются.
//
// NEXT_PUBLIC_* подставляются на сборке, поэтому APP_ENV === 'prod' известен
// минификатору: ветки dev-инструментов вырезаются из продового бандла.

export type AppEnv = 'local' | 'dev' | 'prod';

// local - разработка на своей машине (мок-бэкенд);
// dev - тестовый стенд: сборка как продовая, но с dev-инструментами;
// prod - боевая сборка, никаких dev-инструментов.
export const APP_ENV = (process.env.NEXT_PUBLIC_APP_ENV ?? 'local') as AppEnv;

// Мок вместо реального бэкенда: /api/* обслуживают файловые роуты src/app/api/*.
// По умолчанию включён везде, кроме прода.
export const IS_MOCK_API =
  (process.env.NEXT_PUBLIC_API_MOCK ?? (APP_ENV === 'prod' ? '0' : '1')) === '1';

// В real API панель показывает только безопасные действия и переходы.
export const DEV_TOOLS_ENABLED = APP_ENV !== 'prod';

// Адрес реального бэкенда для прокси /api/* (читается только на сервере,
// в next.config). В деве это localhost:8080 - `./gradlew bootRun`.
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8080';

// Локальные адреса предпросмотра для загрузки dev-ресурсов Next.
export const DEV_ALLOWED_ORIGINS = ['127.0.0.1', '192.168.0.29'];

// Раздельные каталоги позволяют держать mock и API preview одновременно.
export const NEXT_DIST_DIR = process.env.NEXT_DIST_DIR;

// Необязательный приватный каталог личного показа задаётся только на машине владельца.
export const PERSONAL_LAYOUT_FIXTURE_DIRECTORY = process.env.B2B_PRESENTATION_FIXTURE_DIR ?? '';

// Только локальный dev-процесс; приватный manifest дополнительно включает режим на сервере.
export const PERSONAL_LAYOUT_FIXTURE_LOCAL =
  process.env.NODE_ENV === 'development' && APP_ENV === 'local' && !IS_MOCK_API;
