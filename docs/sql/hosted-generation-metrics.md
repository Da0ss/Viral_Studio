# Hosted generation and worker metrics package

This forward-only package targets the connected Viral Studio project `sytjbknfwwbombypwfhc`. It does not replay the local baseline or write migration history on its own. The SQL package is [hosted-generation-metrics.sql](hosted-generation-metrics.sql).

Apply the upload/team package first so `private.media_upload_intents`, media quotas, and team APIs exist. Then apply this SQL as one hosted migration. It adds the durable generation lifecycle and a service-role-only aggregate metrics RPC.

The hosted catalog inspection found the six recorded migrations ending at `20261005202352` (`production_core_security_and_media_rollout`). `public.generation_jobs` has only its original ten columns, RLS enabled, the old owner/editor insert policy, and the `set_updated_at()` trigger. It has zero rows. The generation budget and upload-intent tables are absent. The migration history does not contain the local generation lifecycle or worker-metrics versions.

The package locks `generation_jobs` and aborts if any row exists. This is deliberate: the local lifecycle migration rewrites queued/running jobs to failed and adds a completed-job asset constraint; blindly applying that rewrite to hosted user jobs could lose their actual dispatch state, while old completed rows do not have `output_asset_id`. The target currently meets the empty-table precondition. If that changes before apply, stop and map/reconcile the rows rather than removing the guard or forcing a status transition.

The generation and metrics functions read `private.media_upload_intents` and `private.media_project_quotas`, so applying this before the upload/team package will fail. It returns queue aggregates and global budget totals only, with execute granted only to `service_role`. No hosted DDL was applied during preparation.
