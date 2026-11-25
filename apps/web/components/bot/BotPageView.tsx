import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { Inr } from "@/components/ui/Inr";
import { OraclePrice } from "@/components/ui/OraclePrice";
import { ageAtCall, bpsPct, callLabel, formatUnits, istTime, weightPct, type BotPage } from "@/lib/bot-record";
import { assetName, formatE8, shortHex } from "@/lib/format";

const FACTORS = [
  ["fRules", "Follows its rules"],
  ["fDrawdown", "Drawdown control"],
  ["fConsistency", "Consistency"],
  ["fExplains", "Explains its trades"],
] as const;

const card = "rounded-r3 border border-line bg-surface p-4 shadow-card";
const h2 = "font-display text-xl font-extrabold";
const badge = "rounded-full px-2 py-0.5 text-xs font-semibold";

/**
 * S4 body (SPEC §2.4). Every string from the bot (name, emoji, persona, reasons, roasts) is untrusted (#159):
 * JSX text only, inside <bdi>, never a link, HTML or attribute that runs. The play-money line is in the root layout's footer.
 */
export function BotPageView({ page }: { page: BotPage }) {
  const { bot, mark, trust } = page;
  const start = BigInt(page.start_cash_e8);
  const latest = page.versions[0];
  const season = page.seasons[0];
  const price = (asset: string) => mark?.prices.find((p) => p.asset === asset);

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Bot" className={card}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-r2 bg-accent-soft text-3xl">
            {bot.emoji}
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-extrabold leading-tight [overflow-wrap:anywhere]">
              <bdi>{bot.name}</bdi>
            </h1>
            <p className="text-sm text-muted">
              bot #{bot.id}
              {latest ? ` · v${latest.version}` : ""}
              {bot.status !== "active" ? ` · ${bot.status}` : ""}
            </p>
          </div>
        </div>
        {bot.is_house && <p className={`${badge} mt-3 inline-block bg-sun-soft text-ink`}>House bot · listed, never ranked</p>}
        {bot.persona && (
          <p className="mt-3 [overflow-wrap:anywhere]">
            <bdi>{bot.persona}</bdi>
          </p>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          Owner {bot.owner_qie_name ? <bdi className="font-mono text-ink">{bot.owner_qie_name}</bdi> : null}
          <ExplorerLink address={bot.owner_wallet} />
        </p>
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-semibold text-muted">Play value</p>
          {mark ? (
            <>
              <p className="font-display text-3xl font-extrabold">
                <Inr valueE8={BigInt(mark.value_e8)} startValueE8={start} />
              </p>
              <p className="text-sm text-muted">
                <Inr valueE8={BigInt(mark.value_e8)} startValueE8={start} delta /> since start · marked at the {istTime(mark.slot_time)} call
              </p>
            </>
          ) : (
            <p className="text-muted">No mark yet: the first one comes at the bot&apos;s first call.</p>
          )}
          {season && (
            <p className="mt-1 text-sm">
              Season {season.season}: <b className={season.return_bps < 0 ? "text-down" : "text-up"}>{bpsPct(season.return_bps)}</b>
              <span className="text-muted"> · max drop {bpsPct(season.max_dd_bps, false)}</span>
              {season.battle_rank !== null && !bot.is_house ? <span className="text-muted"> · rank #{season.battle_rank}</span> : null}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="holdings" className={card}>
        <h2 id="holdings" className={h2}>Holdings</h2>
        {mark ? (
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {mark.holdings.map((h) => {
              const p = price(h.asset);
              return (
                <li key={h.asset} className="flex flex-col gap-1 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <b>
                      {assetName(h.asset)} <span className="text-xs font-normal text-muted">{formatUnits(h.units_e18)} units · {weightPct(h.value_e8, mark.value_e8)}%</span>
                    </b>
                    <Inr valueE8={BigInt(h.value_e8)} startValueE8={start} />
                  </div>
                  {p ? (
                    <span className="text-sm">
                      <OraclePrice asset={h.asset} answerE8={BigInt(p.answer_e8)} roundId={p.round_id} updatedAt={Math.floor(Date.parse(p.updated_at) / 1000)} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted">No oracle read at this mark</span>
                  )}
                </li>
              );
            })}
            <li className="flex items-baseline justify-between gap-2 py-2">
              <b>
                Cash <span className="text-xs font-normal text-muted">play USDT · {weightPct(mark.cash_e8, mark.value_e8)}%</span>
              </b>
              <Inr valueE8={BigInt(mark.cash_e8)} startValueE8={start} />
            </li>
          </ul>
        ) : (
          <p className="mt-2 text-muted">All cash until the first call.</p>
        )}
      </section>

      <section aria-labelledby="trust" className={card}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="trust" className={h2}>Trust score</h2>
          {trust && (
            <span className="font-display text-2xl font-extrabold">
              {trust.total}
              <span className="text-sm font-normal text-muted"> / 1000</span>
            </span>
          )}
        </div>
        {trust ? (
          <>
            <ul className="mt-3 flex flex-col gap-2">
              {FACTORS.map(([key, label]) => (
                <li key={key}>
                  <div className="flex justify-between text-sm">
                    <span>{label}</span>
                    <b className="tabular-nums">{trust[key]} / 250</b>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, trust[key] / 2.5))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Season {trust.season} · rules <span className="font-mono">{trust.rulesVersion}</span>
              {trust.provisional ? " · new bot, provisional" : ""}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              {trust.scoresTx && trust.committedRoot === trust.root ? (
                <>
                  Score root on QIE: <ExplorerLink tx={trust.scoresTx} />
                </>
              ) : (
                "Score root not on QIE yet."
              )}
            </p>
          </>
        ) : (
          <p className="mt-2 text-muted">Scored at the first season close.</p>
        )}
      </section>

      <section aria-labelledby="calls" className={card}>
        <h2 id="calls" className={h2}>Every call, with its reason</h2>
        {page.decisions.length ? (
          <ol className="mt-3 flex flex-col divide-y divide-line">
            {page.decisions.map((d) => (
              <li key={d.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">{istTime(d.slot_time)}</span>
                  <span className={`${badge} ${d.status === "executed" ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-muted"}`}>{callLabel(d.status)}</span>
                  <span className="text-muted">v{d.version}</span>
                  {d.reason_tag && <span className="font-mono text-muted">{d.reason_tag}</span>}
                </div>
                {d.reason && (
                  <p className="mt-1 [overflow-wrap:anywhere]">
                    <bdi>{d.reason}</bdi>
                  </p>
                )}
                {d.roast && (
                  <p className="mt-1 text-sm italic text-muted [overflow-wrap:anywhere]">
                    <bdi>{d.roast}</bdi>
                  </p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-muted">No calls yet. Bots decide at 09:00, 13:00, 17:00 and 21:00 IST.</p>
        )}
        {page.decisions.length >= 50 && <p className="mt-2 text-xs text-muted">The latest 50 calls. Every earlier one is in the season&apos;s replay file.</p>}
      </section>

      <section aria-labelledby="trades" className={card}>
        <h2 id="trades" className={h2}>Trades on QIE</h2>
        <p className="mt-1 text-xs text-muted">Sent by BotFolio&apos;s runner and priced inside PaperLedger by QIE&apos;s official mainnet oracle. Owner-signed marks an Approve Big Move.</p>
        {page.trades.length ? (
          <ol className="mt-3 flex flex-col divide-y divide-line">
            {page.trades.map((t, i) => {
              const age = ageAtCall(t);
              return (
                <li key={`${t.tx_hash}:${i}`} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <b>
                      {t.side === "BUY" ? "Bought" : "Sold"} {assetName(t.asset)}{" "}
                      <span className="font-normal">
                        <Inr valueE8={BigInt(t.cash_e8)} startValueE8={start} />
                      </span>
                    </b>
                    <span className="text-xs text-muted">{istTime(t.slot_time)} call</span>
                  </div>
                  <p className="text-sm">
                    ${formatE8(BigInt(t.price_e8), t.asset === "XRP" ? 4 : 2)} <span className="text-muted">· QIE oracle round {t.round_id}</span>
                    {age ? <span className="text-xs text-muted"> · {age}</span> : null}
                  </p>
                  {t.reason && (
                    <p className="text-sm text-muted [overflow-wrap:anywhere]">
                      <bdi>{t.reason}</bdi>
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <ExplorerLink tx={t.tx_hash} />
                    {t.owner_signed && <span className={`${badge} bg-sun-soft text-ink`}>Owner-signed</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-2 text-muted">No trades on chain yet.</p>
        )}
      </section>

      <section aria-labelledby="versions" className={card}>
        <h2 id="versions" className={h2}>Versions</h2>
        <ol className="mt-3 flex flex-col divide-y divide-line">
          {page.versions.map((v) => (
            <li key={v.version} className="flex flex-col gap-1 py-3">
              <b>
                v{v.version} <span className="font-normal text-muted">· {v.source === "create" ? "created" : "approved after coaching"}{v.approved_at ? ` ${istTime(v.approved_at)}` : ""}</span>
              </b>
              <p className="text-sm text-muted">
                Max {bpsPct(v.max_per_coin_bps, false)} per coin · {v.max_trades_per_day} trades a day
              </p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                Config hash <span className="break-all font-mono text-ink" title={v.config_hash}>{shortHex(v.config_hash)}</span>
                {v.committed_tx && <ExplorerLink tx={v.committed_tx} />}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="replay" className={card}>
        <h2 id="replay" className={h2}>Check it yourself</h2>
        <p className="mt-1 text-sm text-muted">
          Each season&apos;s replay file recomputes every call, the risk gate and every trade, and checks them against QIE&apos;s official mainnet oracle.
        </p>
        <a href="/proof#replay" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-accent px-4 font-semibold text-on-accent">
          Replay this season
        </a>
      </section>
    </div>
  );
}
