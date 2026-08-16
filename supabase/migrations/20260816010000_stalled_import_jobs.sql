-- 取り込みジョブの救済（architecture §3.1）。
--
-- Edge Function は即 202 を返して裏で抽出を続けるため、関数が落ちると import_jobs が
-- pending のまま残り、ユーザーからは「送ったのに何も起きない」状態になる。
-- 10 分以上 pending の行を failed に落として、PWA の「取り込み状況」に理由が出るようにする。
--
-- 注意: pg_cron が有効でないプロジェクトでは最後の cron.schedule が失敗する。
-- その場合はこのファイルの関数だけ作り、スケジュールは Dashboard の Integrations →
-- Cron から同じ SQL を登録すればよい（PWA 側は 10 分経過を自前でも「停止」と表示する）。

create or replace function fail_stalled_import_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update import_jobs
     set status = 'failed',
         error = coalesce(error, '10 分以上応答がありませんでした。送り直してください。')
   where status = 'pending'
     and created_at < now() - interval '10 minutes';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function fail_stalled_import_jobs is
  '10 分以上 pending の取り込みジョブを failed にする（Edge Function が落ちた場合の救済）';

create extension if not exists pg_cron;

-- 5 分ごとに実行。既存の同名ジョブがあれば作り直す。
select cron.unschedule('fail-stalled-import-jobs')
 where exists (select 1 from cron.job where jobname = 'fail-stalled-import-jobs');

select cron.schedule(
  'fail-stalled-import-jobs',
  '*/5 * * * *',
  $$select fail_stalled_import_jobs()$$
);
