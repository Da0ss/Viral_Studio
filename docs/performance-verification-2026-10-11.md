# Проверка производительности БД — 2026-10-11

Миграция применена к подключённой Supabase как `20261011154832_performance_fk_indexes_and_rls_initplan`. Канонический локальный источник — `20261011160000_performance_fk_indexes_and_rls_initplan.sql`; timestamp отличается из-за времени применения hosted runner. Перед изменением пакет требует точного исходного вида двух policies и трёх валидированных FK, отклоняет конфликт целевого имени индекса и не создаёт дубликат существующего valid/ready полного B-tree индекса с той же ведущей колонкой. Не повторять весь локальный baseline на hosted проекте.

## Выбранные изменения

- `private.generation_output_reservations(project_id)` покрывает FK и суммирование резервов по проекту в `private.project_media_usage`.
- `public.team_invitations(project_id)` покрывает FK-каскад проекта и проектные invitation-пути.
- `public.team_invitations(invited_by)` покрывает FK-каскад пользователя, который создал приглашение.
- В двух owner-management policies только `auth.uid()` обёрнут в некоррелированный `select`. Аргументы `organization_id` и `project_id` остаются зависимыми от строки. `ALTER POLICY` сохраняет имена, `ALL`, роль `authenticated`, `USING`/`WITH CHECK` и permissive OR с другими SELECT policies.

Оставшиеся восемь предупреждений unindexed FK не исправлены автоматически: это преимущественно редкие проверки при удалении Auth-пользователя, `SET NULL`/каскады и таблицы с малым числом строк. На текущей почти пустой базе planner выбирает sequential scan, поэтому измерение не доказывает реального ускорения выбранных индексов.

Отдельная отложенная задача: полный FK `team_invitations(organization_id)` не покрывается частичным `team_invitations_pending_org_idx`, потому что FK-проверка должна находить и завершённые приглашения. Advisor может не показывать это отдельным finding, поэтому покрытие нужно оценить после роста таблицы вместе с остальными отложенными FK-индексами.

Семь `unused_index` INFO оставлены без изменений. Нулевая статистика использования на новой малой базе не доказывает бесполезность индекса. Два `multiple_permissive_policies` предупреждения тоже оставлены: их механическое объединение может изменить OR-доступ.

## Проверка

- `supabase/tests/performance_fk_rls_acceptance.sql` проверяет ведущую колонку каждого индекса, форму обеих policies и матрицу owner/admin/editor/viewer/outsider в транзакции с `ROLLBACK`.
- `docs/sql/hosted-performance-acceptance.sql` проверяет каталог без чтения пользовательских строк и показывает планы трёх выбранных lookup-путей.
- До применения advisor показывал 11 unindexed FK, 2 `auth_rls_initplan`, 7 unused indexes и 2 multiple permissive policy warnings.
- Каноническая попытка `supabase migration --help` через локально закреплённый CLI 2.119.0 остановилась на `EPERM` при записи telemetry за пределами workspace. Повторная установка и повторные попытки не выполнялись; файл миграции создан вручную как документированный fallback.

Hosted acceptance и performance advisor выполнены. `auth_rls_initplan` отсутствует (2 → 0), unindexed FK сократились с 11 до 8. На малых таблицах `EXPLAIN` может обоснованно выбрать sequential scan; наличие валидного ведущего индекса проверено отдельно через каталог.

Для `apply_migration` нужно передать канонический файл целиком: runner сам выполняет его атомарно. При ручном запуске через SQL Editor весь файл следует явно обернуть в `BEGIN; ... COMMIT;`.

## Подтверждённый результат hosted

- До применения и после него один и тот же `docs/sql/hosted-performance-role-acceptance.sql` прошёл успешно с `ROLLBACK`: owner сохраняет управление членством, admin/editor/viewer читают предусмотренные membership-строки и не получают owner-запись, outsider не читает и не изменяет чужое членство. Использованы существующие подтверждённые пользователи, две временные строки членства откатились; Auth/profiles не изменялись.
- `apply_migration` вернул `success: true`. Timeout для блокировки — 5 секунд, для SQL — 60 секунд; выполнен один apply.
- Hosted catalog acceptance прошёл: присутствуют полноценные valid/ready B-tree префиксы для трёх FK, обе policy сохранили ALL/authenticated/PERMISSIVE и симметричные USING/WITH CHECK. В возвращённом последнем EXPLAIN виден Bitmap Index Scan по `team_invitations_invited_by_idx`. Это проверка доступного пути, не измерение ускорения на рабочем объёме данных.
- Advisor после применения: unindexed FK — 8, multiple permissive policies — 2. Unused indexes — 8 INFO в текущей статистике; индексы по этому признаку не удалялись. [Справочник FK-предупреждения](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- Исходные users/profiles/organizations/projects/organization_members/project_members — по 2 строки; jobs/assets/versions/invitations/outbox — 0. Тестовые memberships не остались.
- Доказательства: `docs/db-snapshots/hosted-performance-final-verification-2026-10-11.json`, только каталог/агрегаты/advisor, без пользовательских строк и ключей.
