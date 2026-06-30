-- Run this in your Supabase SQL editor to set up the database schema

-- PROFILES TABLE
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique not null,
  name text,
  cv_text text,
  cv_pdf_url text,
  preset_qa text,
  personal_background text,
  additional_context text,
  updated_at timestamptz default now()
);

-- SESSIONS TABLE
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  mode text not null check (mode in ('interview', 'practice')),
  company text,
  job_title text,
  interview_type text,
  interview_type_detail text,
  interviewer text,
  expected_duration text,
  pacing_choice text,
  job_description text,
  requirements text,
  notes text,
  started_at timestamptz default now(),
  ended_at timestamptz,
  audio_url text,
  created_at timestamptz default now()
);

-- SESSION REPORTS TABLE
create table if not exists session_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade unique not null,
  full_transcript text,
  per_question_breakdown jsonb default '[]'::jsonb,
  overall_score numeric(4,1),
  score_justification text,
  created_at timestamptz default now()
);

-- ROW LEVEL SECURITY
alter table profiles enable row level security;
alter table sessions enable row level security;
alter table session_reports enable row level security;

-- PROFILES POLICIES
create policy "Users can read their own profile"
  on profiles for select using (auth.uid() = user_id);

create policy "Users can insert their own profile"
  on profiles for insert with check (auth.uid() = user_id);

create policy "Users can update their own profile"
  on profiles for update using (auth.uid() = user_id);

-- SESSIONS POLICIES
create policy "Users can read their own sessions"
  on sessions for select using (auth.uid() = user_id);

create policy "Users can insert their own sessions"
  on sessions for insert with check (auth.uid() = user_id);

create policy "Users can update their own sessions"
  on sessions for update using (auth.uid() = user_id);

create policy "Users can delete their own sessions"
  on sessions for delete using (auth.uid() = user_id);

-- SESSION REPORTS POLICIES
create policy "Users can read their own reports"
  on session_reports for select
  using (session_id in (select id from sessions where user_id = auth.uid()));

create policy "Users can insert their own reports"
  on session_reports for insert
  with check (session_id in (select id from sessions where user_id = auth.uid()));

-- INDEXES
create index if not exists sessions_user_id_idx on sessions(user_id);
create index if not exists sessions_started_at_idx on sessions(started_at desc);
create index if not exists session_reports_session_id_idx on session_reports(session_id);

-- STORAGE BUCKETS
-- Run these in Supabase Storage UI or via API:
-- 1. Create bucket "recordings" (private)
-- 2. Create bucket "resumes" (private)

-- STORAGE POLICIES (run after creating buckets)
-- Recordings bucket
insert into storage.buckets (id, name, public) values ('recordings', 'recordings', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('resumes', 'resumes', false)
  on conflict (id) do nothing;

create policy "Users can upload their own recordings"
  on storage.objects for insert
  with check (bucket_id = 'recordings' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can read their own recordings"
  on storage.objects for select
  using (bucket_id = 'recordings' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own recordings"
  on storage.objects for delete
  using (bucket_id = 'recordings' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can upload their own resumes"
  on storage.objects for insert
  with check (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can read their own resumes"
  on storage.objects for select
  using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update their own resumes"
  on storage.objects for update
  using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);
