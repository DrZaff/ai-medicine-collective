-- Public artwork only. Contact details entered in the Studio stay in the browser.
begin;

create table public.signature_card_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 64 and name = btrim(name)),
  created_at timestamptz not null default now(),
  front_art text not null check (
    octet_length(front_art) <= 650000
    and front_art ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
  ),
  back_art text check (
    octet_length(back_art) <= 650000
    and back_art ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
  ),
  thumbnail text not null check (
    octet_length(thumbnail) <= 48000
    and thumbnail ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
  )
);

alter table public.signature_card_templates enable row level security;
revoke all on public.signature_card_templates from public, anon, authenticated;
grant select on public.signature_card_templates to anon, authenticated;
grant insert (name, front_art, back_art, thumbnail) on public.signature_card_templates to authenticated;
grant delete on public.signature_card_templates to authenticated;

create policy "Anyone can read published card templates"
  on public.signature_card_templates for select to anon, authenticated using (true);
create policy "Admins can publish card templates"
  on public.signature_card_templates for insert to authenticated with check ((select public.is_admin()));
create policy "Admins can delete card templates"
  on public.signature_card_templates for delete to authenticated using ((select public.is_admin()));

commit;
