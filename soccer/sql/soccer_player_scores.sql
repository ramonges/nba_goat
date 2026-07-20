-- Season-level soccer GOAT scores (raw + adjusted × classic + full).
-- Run once in the Supabase SQL editor before upserting from Step 2.

create table if not exists public.soccer_player_scores (
  player_slug text not null,
  player_name text not null,
  season text not null,
  mode text not null check (mode in ('raw', 'adjusted')),
  score_type text not null check (score_type in ('classic', 'full')),
  data_tier text check (data_tier in ('A', 'B')),
  total double precision,
  era text,
  decade text,
  season_start integer,
  primary_competition text,
  competition_tier double precision,
  minutes_total double precision,
  advanced_coverage double precision,
  "cat_FINISHING" double precision,
  "cat_CREATION" double precision,
  "cat_INVOLVEMENT" double precision,
  "cat_CARRYING" double precision,
  "cat_IMPACT" double precision,
  "cat_BIG_GAME" double precision,
  updated_at timestamptz not null default now(),
  primary key (player_slug, season, mode, score_type)
);

create index if not exists soccer_player_scores_decade_idx
  on public.soccer_player_scores (decade, mode, score_type, total desc);

create index if not exists soccer_player_scores_player_idx
  on public.soccer_player_scores (player_name, mode, score_type);
