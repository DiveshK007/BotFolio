-- #219 Part C: S0 is the hidden test season. site_seasons already leaves it out; its results and trust scores
-- (and so site_leaderboards, which reads site_season_results) now do too. Same columns, so the grants stay.

create or replace view site_season_results as
select season_id, bot_id, start_value_e8, end_value_e8, return_bps, sortino, max_dd_bps, trades, battle_rank
from season_results
where season_id > 0;

create or replace view site_trust_scores as
select season_id, bot_id, rules_version, f_rules, f_drawdown, f_consistency, f_explains, total,
       provisional, leaf_hash
from trust_scores
where season_id > 0;
