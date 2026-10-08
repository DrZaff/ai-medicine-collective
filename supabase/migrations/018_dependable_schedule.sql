-- 018: start the blog draft and the weekly digest on time
--
-- Run once in the Supabase SQL Editor, after 001-017 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file.
--
-- GitHub's own scheduler has started these jobs hours late, or not at all.
-- This makes the database press "Run workflow" on GitHub at the scheduled
-- times instead. GitHub's own schedule stays as a backup: whichever starts
-- first does the work, and a later start sees the day is handled and stops.
--
-- Needs a GitHub access token stored in Supabase Vault under the exact name
-- 'github_actions_token' (see docs/auth-setup.md; never in this repo or in
-- chat). The token may only start workflows on this one repository. Until
-- it is stored, the scheduled jobs here do nothing.

-- Lets the database run something on a timetable.
create extension if not exists pg_cron;

create function public.start_site_workflow(workflow text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  if workflow not in ('blog-draft.yml', 'weekly-newsletter.yml') then
    raise exception 'Unknown workflow';
  end if;

  select s.decrypted_secret into token
    from vault.decrypted_secrets s
   where s.name = 'github_actions_token'
   limit 1;

  if token is null then
    raise warning 'No github_actions_token in Vault; workflow % not started', workflow;
    return;
  end if;

  perform net.http_post(
    url := 'https://api.github.com/repos/DrZaff/ai-medicine-collective/actions/workflows/' || workflow || '/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'amc-scheduler',
      'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main')
  );
end;
$$;

-- Only the timetable below may call it: not visitors, not members.
revoke execute on function public.start_site_workflow(text) from public, anon, authenticated;

-- Times are UTC. 07:23 is 3:23 AM Eastern in summer, 2:23 AM in winter;
-- 21:00 is 5 PM Eastern in summer, 4 PM in winter.
select cron.schedule('amc-blog-draft', '23 7 * * 1,3,5',
  $job$select public.start_site_workflow('blog-draft.yml')$job$);

select cron.schedule('amc-weekly-digest', '0 21 * * 5',
  $job$select public.start_site_workflow('weekly-newsletter.yml')$job$);
