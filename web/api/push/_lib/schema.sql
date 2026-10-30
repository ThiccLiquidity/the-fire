-- Web push (docs/push.md): who gets notifications. Same Neon database as the game server. Safe to run more than once.
create table if not exists push_subs (
  endpoint   text primary key,        -- the browser's push address (a push service URL)
  wallet     text,                    -- lower-case 0x address, or null (drop news only)
  p256dh     text not null,
  auth       text not null,
  topics     text not null default 'ready,drops', -- ready: your cards / grades; drops: Series news
  created_at bigint not null,
  last_ok    bigint
);
create index if not exists push_subs_wallet on push_subs (wallet);
-- one notification per event, whichever keeper asks first (main and backup both may)
create table if not exists push_sent (
  tag     text primary key,
  sent_at bigint not null
);
