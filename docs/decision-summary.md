# Viral Studio — краткие обоснования решений

Это проверяемое резюме технических решений, не внутренняя цепочка рассуждений.
Состояние и план продолжения: handoff-2026-09-29.md.

## Границы доказательств

Build доказывает компиляцию, mocked tests — отдельные программные сценарии,
PGlite — локальные SQL-инварианты. Ни один из них не заменяет живые Auth/Storage,
двухпользовательский Realtime или authenticated browser acceptance. Поэтому
production-readiness остаётся NOT APPROVED.

## Решения и их основания

| Проблема | Решение | Ограничение/компромисс |
| --- | --- | --- |
| Ошибочная tenant policy | Квалифицировать внешние поля в EXISTS и тестировать два tenant | Hosted применение ещё требуется |
| Рекурсивная membership policy | Private lookup helper с ограниченными правами | Privileged helpers требуют отдельного audit |
| Client mass assignment | RLS плюс конкретные column grants | Изменение полей требует осознанного обновления grants |
| Whole-table privileges вне RLS | Отозвать TRUNCATE/REFERENCES/TRIGGER у клиентов | Defaults других владельцев таблиц отдельно проверяются |
| Потеря последнего владельца | Внутренние guards и parent-row write | Конкурентные/deadlock сценарии ещё не подтверждены |
| Старые роли после org revocation | Атомарно удалить project-memberships; admission требует org membership | Перед отзывом sole owner нужно передать проекты |
| Storage и БД не одна транзакция | Durable outbox, retries, immutable paths | Upload reconciliation и enqueue-only delete ещё не завершены |
| Повторное использование удалённого пути | Permanent tombstone для metadata и restrictive Storage policy | RLS bypass/service writes и concurrent HTTP требуют проверки |
| Managed Storage schema | RLS policy вместо пользовательского trigger на storage.objects | Snapshot check не даёт cross-system fencing |
| Параллельные workers | SKIP LOCKED claim, token+expiry completion, bounded backoff | Многосессионная и hosted проверка впереди |
| Зависший transport | Native AbortSignal deadline 20 секунд | Timeout не гарантирует серверную отмену |
| Machine endpoint | Отдельный secret, constant-time comparison, disabled by default | Scheduler и activation после staging acceptance |
| Приватные материалы | User-scoped Storage и короткие signed URLs | Выданная URL действует до TTL, не мгновенно отзывается |
| Конкурирующие avatar saves | Unique upload path и CAS | Cleanup failures остаются предметом reconciliation |
| Потерянный ответ mutations | Безопасное сообщение о неподтверждённом результате | До idempotency нельзя обещать безопасный повтор создания |
| Generation пока отсутствует | Сначала контракт и права worker-owned fields | Провайдер, модель и бюджет должен выбрать пользователь |

## Источники технических правил

- Supabase skills: Auth/RLS/Storage security checklist, server-only service keys,
  минимальные привилегии и обязательная проверка изменений.
- Supabase Postgres skills: короткие транзакции, SKIP LOCKED, порядок блокировок.
- Next.js skill: Node Route Handlers, безопасные Server Action ошибки и границы runtime.
- Context7: ранее проверены Storage schema ownership и способы ограничения uploads;
  дальнейшие запросы остановились из-за истёкшего OAuth.
- [PostgreSQL: Row Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
- [Supabase: Column Level Security](https://supabase.com/docs/guides/database/postgres/column-level-security).

## Правило продолжения

Сначала читать текущий код и проверить покрытие, затем менять минимально необходимый
контракт целиком и тестировать успех, отказ, неоднозначный результат и конкуренцию.
Не считать число тестов доказательством полноты проекта; не подменять полный MVP
набором прошедших локальных проверок. Применение remote изменений, запуск paid
generation и активация destructive worker требуют подтверждённых условий доступа.
