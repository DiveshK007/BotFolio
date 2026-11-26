-- #219 item 20: house bots trade up to 5 assets in one decision (Steady Sam holds all 5), so a trade or big move
-- can have action_index 0-4. LLM decisions still have at most 3 actions (§6.3 maxItems), which gate() checks.
-- 0002 is taken by an open PR (#319), hence 0003.

alter table trades drop constraint trades_action_index_check;
alter table trades add constraint trades_action_index_check check (action_index between 0 and 4);

alter table big_moves drop constraint big_moves_action_index_check;
alter table big_moves add constraint big_moves_action_index_check check (action_index between 0 and 4);
