-- The game server's tables (Neon Postgres). Safe to run more than once. docs/game-server.md has the steps.
-- Times are milliseconds since 1970 (server time).

-- a run: created (approved, not yet paid) -> playing (RunPaid seen) -> over (first miss)
create table if not exists game_runs (
  run_id         text primary key,          -- 0x + 64 hex (bytes32)
  game_id        integer not null,          -- FireGames id (paper football = 1)
  wallet         text not null,             -- lower-case 0x address
  series         bigint not null,
  status         text not null default 'created',
  streak         integer not null default 0,
  next_n         integer not null default 0,  -- the next scored shot
  practice_used  integer not null default 0,
  scored_started boolean not null default false,
  created_at     bigint not null,
  paid_at        bigint,
  tx_hash        text unique,
  ended_at       bigint,
  ip             text
);
create index if not exists game_runs_wallet on game_runs (wallet, created_at);

-- each shot as issued (re-issued with a new t0 and nonce when a run resumes)
create table if not exists game_shots (
  run_id   text not null references game_runs (run_id),
  n        integer not null,                -- < 0: practice
  level    integer not null,
  practice boolean not null default false,
  t0       bigint not null,
  nonce    text not null,
  ping_at  bigint,
  shot     jsonb not null,
  issued   integer not null default 1,
  primary key (run_id, n)
);

-- the judged kicks: append-only; the primary key is the per-shot lock (one verdict per shot)
create table if not exists game_kicks (
  run_id    text not null references game_runs (run_id),
  n         integer not null,
  at        bigint not null,
  kick_tick integer,
  input     jsonb,
  kick      jsonb,
  result    text not null,
  detail    jsonb,
  rtt       integer,
  version   integer,
  primary key (run_id, n)
);

-- kicks the server turned down (not a verdict; kept for review)
create table if not exists game_rejects (
  id     bigserial primary key,
  run_id text,
  n      integer,
  at     bigint not null,
  reason text not null,
  input  jsonb
);

-- the leaderboard: one row per wallet per (Series, game): the best streak and when it was first reached
create table if not exists game_board (
  series     bigint not null,
  game_id    integer not null,
  wallet     text not null,
  streak     integer not null,
  reached_at bigint not null,
  run_id     text,
  primary key (series, game_id, wallet)
);
create index if not exists game_board_rank on game_board (series, game_id, streak desc, reached_at asc);

create table if not exists game_rate (
  key          text primary key,
  window_start bigint not null,
  count        integer not null
);

create table if not exists game_flags (
  name  text primary key,
  value text,
  at    bigint
);
