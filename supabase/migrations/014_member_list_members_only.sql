-- 014: the member list is for members only, and everyone is on it by default
--
-- Run once in the Supabase SQL Editor, after 001-013 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file.
--
-- 012 added an opt-in *public* list. The owner decided instead (2026-10-06):
-- every approved member is listed automatically, members can hide themselves,
-- and the list is visible to other members only. So:
--   * the opt-in switch becomes an opt-out switch that starts switched on
--   * signed-out visitors lose the public_members() function entirely

alter table public.profiles rename column public_listing to directory_listing;
alter table public.profiles alter column directory_listing set default true;

-- Nobody had been offered the old switch yet, so everyone starts listed.
update public.profiles set directory_listing = true;

comment on column public.profiles.directory_listing is
  'Show this member in the member list that other approved members see. They can switch it off.';

drop function public.public_members();
