# Миграция Vanilla → Next.js

## Текущее состояние

| Текущая функция | Где реализована | Перенос в Next.js | Потребность backend |
| --- | --- | --- | --- |
| Hash-маршруты `#create`, `#projects`, `#team`, `#media`, `#media-detail`, `#profile` | `app.js`: `pageFor`, `render`, `navigate` | App Router: `/create`, `/projects`, `/team`, `/media`, `/profile`; `media-detail` станет `/media/[assetId]` | Нет для статических маршрутов; ID материала для dynamic route |
| Верхняя и мобильная навигация, аккаунт-меню | `app.js`: `header`; CSS `.topbar`, `.mobile-nav` | `src/components/header.tsx` | Сессия пользователя, отображаемое имя, компания, avatar URL |
| Создание ролика / отправка брифа | `app.js`: `createPage`, `optionControl`, обработчик `create-video` | `src/app/create`, client form + server action | Authenticated user, brief, format, duration, voice, task/job status |
| Список, поиск, фильтры и сортировка проектов | `app.js`: `projects`, `projectRows`, click/input handlers | `src/app/projects`, server query + URL search params | Проекты пользователя, status/type, pagination, updated time |
| Карточка проекта и ссылка на материал | `app.js`: `projectRows` | `src/app/projects/[projectId]` и `/media/[assetId]` | Project, permissions, associated assets |
| Команда и чат | `app.js`: `teamPage`, `messageTemplate`, submit handler | `src/app/team`, client chat component | Project membership, conversations, messages, realtime transport |
| Просмотр материала, thumbnails, download/delete | `app.js`: `mediaDetailPage`, `toggleVideo`, click handlers | `src/app/media/[assetId]`, `VideoPlayer`, `AssetActions` | Asset metadata, signed download URL, delete authorization, audit trail |
| Профиль и уведомления | `app.js`: profile helpers, form and validation | `src/app/profile`, client form + server action | Account profile, notification preferences; never passwords in browser storage |
| Смена пароля | `app.js`: `passwordDialog`, password submit | `/profile/security`, dedicated authenticated flow | Auth provider only; hash/verify server-side; no password storage |
| Временные notifications/toasts | `app.js`: `flash` | `src/components/toast.tsx` | Optional operation result / job updates |

## Данные и интерфейс

- Mock-данные: `projects`, messages, thumbnails, expert, profile defaults — сейчас literal arrays/objects в `app.js`; базовые fixtures перенесены в `src/lib/mock-data.ts`.
- Повторяющиеся элементы: `header`, `cta`, `videoFrame`, `messageTemplate`, `optionControl`, profile fields/selects, toast.
- Токены: `--paper #f7f7f4`, `--ink #0c0c0c`, `--muted #8b8b91`, `--line #dededb`, `--red #f20a10`, `--lime #baff14`, `--radius 12px`; motion/focus tokens добавлены в `polish.css`.
- Шрифты: Manrope Variable (UI), Roboto Condensed Variable (display). Иконки: локальный Phosphor Webfont. Assets перенесены в `public/assets` и `public/product-campaign.png`.
- Интерактивные состояния: mobile/account/select menus; AI/team mode; idea counter; project filter/search/sort; video play/pause; active thumbnail; send message; profile validation/dirty/cancel; toggles; avatar preview; password dialog; toast; unsaved-change warning.

## Безопасный порядок работ

1. Базовый App Router создан без базы и без secret/env variables.
2. Legacy files сохранены и запускаются через `pnpm legacy:dev`; новая версия не использует `localStorage` для профильных данных.
3. До подключения данных требуется authentication boundary, RLS/authorization design, typed server-side data layer and server actions. Service-role keys and password values are never exposed to the client.
4. После переноса каждой feature необходимо заменить fixture на server query/action, добавить loading/error state, authorization test и browser regression test.
