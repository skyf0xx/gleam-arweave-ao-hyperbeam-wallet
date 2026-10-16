-- One daily pool row per snapshot day, so a catch-up or re-run can't grow
-- the pool twice.
CREATE UNIQUE INDEX bounty_pool_daily_day ON bounty_pool (day) WHERE reason = 'daily';
-- A ref is paid once; this is the pool-side backstop beside scan_points_ref.
CREATE UNIQUE INDEX bounty_pool_award_ref ON bounty_pool (ref) WHERE reason = 'award' AND ref IS NOT NULL;
