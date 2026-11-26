-- Carry the preview DNA seed from /create through birth so a bot keeps its look (issue #95 / HANDOFF #7).
alter table bots add column dna_seed text;

-- Append at the end of site_bots so Postgres CREATE OR REPLACE VIEW keeps column positions and grants.
create or replace view site_bots as
select b.id, b.owner_wallet, q.qie_name as owner_qie_name, b.name, b.emoji, b.persona_text, b.persona_hash,
       b.created_at, b.created_tx, b.is_house, b.status, b.dna_seed
from bots b
left join qie_names q on q.wallet_address = b.owner_wallet;
