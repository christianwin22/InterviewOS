create table if not exists job_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  profile_name text not null default 'Untitled profile',
  name text,
  cv_text text,
  cv_pdf_url text,
  preset_qa text,
  personal_background text,
  additional_context text,
  interview_type text,
  interview_type_detail text,
  interviewer text,
  expected_duration text,
  company text,
  job_title text,
  job_description text,
  requirements text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table job_profiles enable row level security;

create policy "Users can manage their own job profiles"
  on job_profiles for all using (auth.uid() = user_id);
