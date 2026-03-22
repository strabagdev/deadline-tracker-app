alter table public.dashboard_ai_summaries
  add column if not exists executive_comment text,
  add column if not exists executive_comment_model text,
  add column if not exists executive_comment_updated_at timestamptz;
