-- ZecWise core schema. Runs on Supabase Postgres or any Postgres 15+ with pgvector.
create extension if not exists vector;
create extension if not exists pgcrypto;

-- Users who can sign in (administrators and editors). Chat visitors are anonymous
-- and identified only by an opaque visitor cookie.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_visitor_idx on conversations (visitor_id, updated_at desc);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  status text not null default 'complete' check (status in ('streaming', 'complete', 'error')),
  categories text[] not null default '{}',
  model text,
  prompt_version text,
  retrieval jsonb not null default '{}'::jsonb,
  followups jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);

-- Source metadata is stored separately from generated answers. Every row here is a
-- source that was actually retrieved for the answer; `cited` marks the ones the
-- answer referenced after citation validation.
create table if not exists message_sources (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  ref int not null,
  kind text not null check (kind in ('kb', 'web')),
  document_id uuid,
  chunk_id uuid,
  url text not null,
  title text not null,
  publisher text,
  published_at timestamptz,
  retrieved_at timestamptz not null,
  trust text,
  snippet text not null,
  score double precision,
  cited boolean not null default false,
  unique (message_id, ref)
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  visitor_id text not null,
  rating smallint not null check (rating in (-1, 1)),
  comment text,
  created_at timestamptz not null default now(),
  unique (message_id, visitor_id)
);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('url', 'website', 'rss', 'github_releases')),
  url text not null,
  normalized_url text not null unique,
  category text not null default 'documentation',
  trust text not null default 'unverified'
    check (trust in ('official', 'primary', 'reputable', 'community', 'unverified')),
  enabled boolean not null default true,
  refresh_interval_minutes int not null default 1440 check (refresh_interval_minutes >= 15),
  max_pages int not null default 25 check (max_pages between 1 and 500),
  crawl_depth int not null default 1 check (crawl_depth between 0 and 3),
  path_prefix text,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  next_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete cascade,
  canonical_url text not null unique,
  title text not null default '',
  publisher text,
  author text,
  published_at timestamptz,
  retrieved_at timestamptz,
  category text not null default 'documentation',
  trust text not null default 'unverified',
  content_text text not null default '',
  content_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'indexed', 'failed', 'duplicate', 'disabled', 'blocked')),
  duplicate_of uuid references documents(id) on delete set null,
  version int not null default 0,
  last_success_at timestamptz,
  last_changed_at timestamptz,
  http_etag text,
  http_last_modified text,
  error text,
  injection_flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_source_idx on documents (source_id);
create index if not exists documents_hash_idx on documents (content_hash);
create index if not exists documents_status_idx on documents (status);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  ord int not null,
  heading text,
  content text not null,
  token_estimate int not null default 0,
  tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) stored,
  embedding vector(1024),
  unique (document_id, ord)
);
create index if not exists chunks_tsv_idx on chunks using gin (tsv);
create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

create table if not exists ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('source_refresh', 'document_reindex')),
  source_id uuid references sources(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  stats jsonb not null default '{}'::jsonb,
  requested_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ingestion_jobs_queue_idx on ingestion_jobs (status, run_after);
-- At most one pending job per source/document, so repeated clicks or overlapping
-- schedules cannot pile up duplicate work.
create unique index if not exists ingestion_jobs_one_pending_source
  on ingestion_jobs (source_id) where status in ('queued', 'running') and kind = 'source_refresh';
create unique index if not exists ingestion_jobs_one_pending_doc
  on ingestion_jobs (document_id) where status in ('queued', 'running') and kind = 'document_reindex';

create table if not exists ingestion_events (
  id bigserial primary key,
  job_id uuid references ingestion_jobs(id) on delete cascade,
  source_id uuid references sources(id) on delete cascade,
  level text not null check (level in ('info', 'warn', 'error')),
  url text,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists ingestion_events_job_idx on ingestion_events (job_id);

create table if not exists retrieval_events (
  id bigserial primary key,
  message_id uuid references messages(id) on delete set null,
  query text not null,
  used_kb boolean not null,
  used_live boolean not null,
  kb_results int not null default 0,
  web_results int not null default 0,
  latency_ms int not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists retrieval_events_created_idx on retrieval_events (created_at);

-- Provider usage, for cost reporting. Costs are estimates computed from the
-- configured price table, not invoices.
create table if not exists usage_events (
  id bigserial primary key,
  kind text not null check (kind in ('llm', 'embedding', 'search')),
  provider text not null,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  units int not null default 0,
  est_cost_usd numeric(12, 6),
  purpose text,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_created_idx on usage_events (created_at);

create table if not exists eval_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  model text not null,
  prompt_version text not null,
  git_sha text,
  dataset_version text not null,
  summary jsonb not null default '{}'::jsonb
);

create table if not exists eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references eval_runs(id) on delete cascade,
  case_id text not null,
  category text not null,
  passed boolean not null,
  scores jsonb not null default '{}'::jsonb,
  failures jsonb not null default '[]'::jsonb,
  answer text,
  sources jsonb not null default '[]'::jsonb,
  manually_verified boolean,
  reviewer_notes text,
  unique (run_id, case_id)
);

create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
