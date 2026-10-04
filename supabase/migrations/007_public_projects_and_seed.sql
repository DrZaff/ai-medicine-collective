-- 007: published projects become public, and the Collective's own tools move
--      into the hub
--
-- Run once in the Supabase SQL Editor, after 001-006 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run).
--
-- ORDER: run this file FIRST, then deploy the matching site code (the new
-- code reads the doc_url column added here).
--
-- What becomes public (readable without signing in):
--   * published rows of kind 'project' (not learning materials, not anything
--     still in review or rejected)
--   * the name and picture of the people who authored those projects
--   * files attached to those projects
-- What stays members-only: submitting, comments, private messages, learning
-- materials, chat, and every unpublished item.

-- ---------------------------------------------------------------- instructions link
-- A second link for documentation (the existing tools each have an
-- instructions PDF on the site).

alter table public.projects
  add column doc_url text
    constraint projects_doc_url_check check (doc_url ~ '^https://' and char_length(doc_url) <= 500);

-- ---------------------------------------------------------------- public read: projects
-- Signed-out visitors get only the columns a visitor needs; no review notes,
-- no reviewer.

grant select (id, kind, folder, title, category, description, link_url, doc_url,
              file_path, file_name, status, created_at, author_id)
  on public.projects to anon;

-- Also granted to "authenticated" so someone who has signed in but isn't an
-- approved member yet sees at least what the public sees.
create policy "projects: anyone can read published projects"
  on public.projects
  for select
  to anon, authenticated
  using (status = 'published' and kind = 'project');

-- ---------------------------------------------------------------- public read: author names

grant select (id, full_name, avatar_url) on public.profiles to anon;

create policy "profiles: anyone can see who authored a published project"
  on public.profiles
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.projects p
       where p.author_id = profiles.id
         and p.status = 'published'
         and p.kind = 'project')
  );

-- ---------------------------------------------------------------- public read: attached files

create policy "project files: anyone can read files of published projects"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.projects p
       where p.file_path = storage.objects.name
         and p.status = 'published'
         and p.kind = 'project')
  );

-- ---------------------------------------------------------------- the Collective's existing tools
-- Moved from the old Projects and App Store pages, published under the first
-- admin's account. If there is no admin yet, nothing is inserted.

insert into public.projects
  (author_id, kind, title, category, description, link_url, doc_url, status, reviewed_at)
select admin.id, 'project', tool.title, tool.category, tool.description, tool.link_url, tool.doc_url,
       'published', now()
  from (
    select id from public.profiles where role = 'admin' order by created_at limit 1
  ) admin
  cross join (values
    -- Custom GPTs (from the old Projects page)
    ('VA Night Float Algorithm – Excel',
     'Patient care',
     'Excel sheet that automates the VA night admission algorithm.',
     'https://ai-medicine-collective.netlify.app/projects/VA%20Night%20Shift%20Algorithm.xlsx',
     'https://ai-medicine-collective.netlify.app/projects/VA_Night_Float_Algorithm_Excel_Instructions.pdf'),
    ('VA Night Float Algorithm – Custom GPT',
     'Patient care',
     'Conversational assistant that applies the VA night float assignment rules. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-6912a44ed37081918d9ef6192c0e1d1b-va-night-call-algorithm',
     'https://ai-medicine-collective.netlify.app/projects/VA_Night_Float_Algorithm_GPT_Instructions.pdf'),
    ('ClinicalToolsDEV – Custom GPT',
     'Patient care',
     'A developer assistant that guides you step by step through creating custom clinical tool apps, with no prior coding experience required. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-69327e70b56881919d9d47197683eca7-clinicaltoolsdev',
     'https://ai-medicine-collective.netlify.app/projects/ClinicalTools_Dev_Instructions.pdf'),
    ('ANKIGen AI',
     'Medical education',
     'Turns medical text into ANKI-style flash cards. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-68e43efd7d608191ba161e3f1e6da8f8-ankigen-med',
     'https://ai-medicine-collective.netlify.app/projects/ANKIGenAI_Instructions.pdf'),
    ('MLMS Generator',
     'Medical education',
     'Creates My Life, My Story articles. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-68d0619bcb588191af62116a5fe8fe05-my-life-my-story',
     'https://ai-medicine-collective.netlify.app/projects/MLMS_Generator.pdf'),
    ('Workout Generator',
     'Lifestyle',
     'Evidence-based exercise coach that designs practical, individualized weightlifting routines. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-68ffd310574c819187dae7fab8ffde8f-workout-generator',
     'https://ai-medicine-collective.netlify.app/projects/WorkoutGen_Instructions.pdf'),
    ('NextSet AI Personal Trainer',
     'Lifestyle',
     'Personal trainer that guides workouts, answers questions, and logs performance. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-6904fac2c86081918edc09697f9cc770-nextset-ai',
     'https://ai-medicine-collective.netlify.app/projects/NextSetAI_Instructions.pdf'),
    ('Life Cross Sections',
     'Lifestyle',
     'Performs a cross-sectional "alignment check" for medical students to facilitate introspection. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-68b7826dbf108191bbe26bf6df2fff29-life-cross-sections',
     'https://ai-medicine-collective.netlify.app/projects/LCS_Instructions.pdf'),
    ('Residency Personal Statement Writing Guru',
     'Productivity',
     'All-in-one residency personal statement writing assistant. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-68e07a63873c8191b8678a002eea4b31-dr-sage-personal-statement-guru',
     'https://ai-medicine-collective.netlify.app/projects/PS_Guru_Instruction.pdf'),
    ('Projects Meeting Summarizer',
     'Productivity',
     'Converts transcriptions into concise project meeting minutes. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-68d04208ab20819184d3a4013326ed30-project-meeting-summarizer',
     'https://ai-medicine-collective.netlify.app/projects/PMS_Instructions.pdf'),
    ('Neapolitan Personality Quiz',
     'Other',
     'Automated personality quiz to determine which ice cream flavor you are. Custom GPT: needs a paid ChatGPT subscription.',
     'https://chatgpt.com/g/g-68c8846d98948191a1bfba004e2b1dbf-it-s-a-neapolitan-world',
     'https://ai-medicine-collective.netlify.app/projects/Neapolitan_Instructions.pdf'),
    -- Clinical micro-apps (from the App Store page, which stays as the icon launcher)
    ('Acid-Base Calculator',
     'Patient care',
     'Clinical micro-app for acid-base interpretation, built with ClinicalToolsDEV. Opens in the browser on phone or computer.',
     'https://acid-base-calculator.netlify.app/',
     'https://ai-medicine-collective.netlify.app/projects/ABInterpreter_Instructions.pdf'),
    ('HEART Score Calculator',
     'Patient care',
     'Clinical micro-app that calculates the HEART score, built with ClinicalToolsDEV. Opens in the browser on phone or computer.',
     'https://heart-score-calculator.netlify.app/',
     'https://ai-medicine-collective.netlify.app/projects/Heart_Score_Instructions.pdf'),
    ('QT Interval Corrector',
     'Patient care',
     'Clinical micro-app that corrects the QT interval, built with ClinicalToolsDEV. Opens in the browser on phone or computer.',
     'https://qtc-calc.netlify.app/',
     'https://ai-medicine-collective.netlify.app/projects/QT_Calc_Instructions.pdf'),
    ('Thyroid Workup Assistant',
     'Patient care',
     'Clinical micro-app that walks through a thyroid workup, built with ClinicalToolsDEV. Opens in the browser on phone or computer.',
     'https://thyroid-cascader.netlify.app/',
     'https://ai-medicine-collective.netlify.app/projects/Thyroid_Cascader_Instructions.pdf'),
    ('VA Night Float Algorithm – App',
     'Patient care',
     'Clinical micro-app version of the VA night float algorithm, built with ClinicalToolsDEV. Opens in the browser on phone or computer.',
     'https://va-night-algorithm.netlify.app/',
     'https://ai-medicine-collective.netlify.app/projects/VA_Night_Algorithm.pdf')
  ) as tool (title, category, description, link_url, doc_url);
