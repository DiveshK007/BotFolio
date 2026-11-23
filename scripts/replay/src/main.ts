import { readFile } from "node:fs/promises";
import { QIE_RPC_URLS, qieMainnet } from "@botfolio/shared";
import { verifyOffline, verifyOnChain, type Finding } from "@botfolio/worker/runner";
import { createPublicClient, fallback, http, isAddress, parseAbi, type Address, type PublicClient } from "viem";

const USAGE = `botfolio-replay <season-<n>.jsonl | https://… | season number> [options]

Recomputes a BotFolio season from its replay file (SPEC §6.5): every decision's hashes and gate() result, the
data root, each Trade event and the QIE oracle round it priced against, and each bot's balances.

  --ledger <address>   SeasonLedger, to fetch a season's file by its number
  --rpc <url,url>      QIE RPCs (default rpc3, rpc4, rpc5, rpc1, rpc2)
  --offline            skip the chain checks
`;

const SEASONS = parseAbi(["function seasons(uint32 n) view returns (uint64, uint64, bytes32, string dataURI, bool closed)"]);

export interface Io {
  out(line: string): void;
  fetchText(url: string): Promise<string>;
  readText(path: string): Promise<string>;
  client(rpcUrls: string[]): PublicClient;
}

export const realIo: Io = {
  out: (line) => console.log(line),
  async fetchText(url) {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  },
  readText: (path) => readFile(path, "utf8"),
  client: (rpcUrls) =>
    createPublicClient({ chain: qieMainnet, transport: fallback(rpcUrls.map((url) => http(url, { timeout: 20_000 })), { rank: false }) }) as PublicClient,
};

/** 0 = everything matches, 1 = a mismatch, 2 = bad usage or the file couldn't be read. */
export async function main(argv: string[], io: Io = realIo): Promise<number> {
  const args = [...argv];
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const [, value] = args.splice(i, 2);
    return value;
  };
  const offline = args.includes("--offline");
  if (offline) args.splice(args.indexOf("--offline"), 1);
  const rpcUrls = (flag("--rpc") ?? QIE_RPC_URLS.slice(2).concat(QIE_RPC_URLS.slice(0, 2)).join(",")).split(",");
  const ledger = flag("--ledger");
  const [source, ...rest] = args;
  if (!source || rest.length > 0 || source === "--help") {
    io.out(USAGE);
    return 2;
  }

  let text: string;
  try {
    if (/^\d+$/.test(source)) {
      if (!ledger || !isAddress(ledger)) {
        io.out("A season number needs --ledger <SeasonLedger address>.");
        return 2;
      }
      const [, , , dataURI, closed] = await io.client(rpcUrls).readContract({ address: ledger as Address, abi: SEASONS, functionName: "seasons", args: [Number(source)] });
      if (!closed || !dataURI) {
        io.out(`Season ${source} isn't closed on-chain yet, so it has no file.`);
        return 2;
      }
      text = await io.fetchText(dataURI);
    } else {
      text = /^https?:\/\//.test(source) ? await io.fetchText(source) : await io.readText(source);
    }
  } catch (error) {
    io.out(`Couldn't read ${source}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const report = (findings: Finding[]) => findings.forEach((f) => io.out(`  ✗ ${f.line ? `line ${f.line}: ` : ""}${f.what}`));
  const result = verifyOffline(text);
  io.out(`Season ${result.season.season}: ${result.lines} lines, ${result.decisions} decisions, root ${result.root}`);
  io.out(result.findings.length === 0 ? "  ✓ canonical lines, hashes and every gate() result" : "  offline checks:");
  report(result.findings);
  if (offline) return result.findings.length === 0 ? 0 : 1;

  const chain = await verifyOnChain(io.client(rpcUrls), result);
  io.out(chain.onChainRoot ? `  on-chain root ${chain.onChainRoot}` : "  the season isn't closed on-chain, so there is no root to compare yet");
  io.out(`  ${chain.trades} trades and ${chain.bots} bots checked against QIE`);
  if (chain.findings.length === 0) io.out("  ✓ root, Trade events, oracle rounds and balances");
  report(chain.findings);
  return result.findings.length + chain.findings.length === 0 ? 0 : 1;
}
