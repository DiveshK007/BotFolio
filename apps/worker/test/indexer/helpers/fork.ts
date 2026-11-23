import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createTestClient,
  encodeFunctionData,
  http,
  publicActions,
  walletActions,
  type Abi,
  type Account,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  ASSETS,
  forwardRequestTypedData,
  qieMainnet,
  RELAY_LIMITS,
  toForwardRequest,
} from "@botfolio/shared";
import { CONTRACT_NAMES, type ContractName } from "../../../src/indexer/abi";
import { ADDRESS_ENV, type ContractAddresses } from "../../../src/indexer/config";
import { aggregatorV3Abi } from "../../../src/oracle";

const run = promisify(execFile);
const CONTRACTS = fileURLToPath(new URL("../../../../../packages/contracts/", import.meta.url));
// Read only, to fork from. Every transaction goes to the Anvil process on 127.0.0.1.
const UPSTREAMS = [4, 5, 3].map((n) => `https://rpc${n}mainnet.qie.digital`);
// Anvil's public test mnemonic. Not a secret, never funded by us anywhere.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const account = (addressIndex: number) => mnemonicToAccount(TEST_MNEMONIC, { addressIndex });

export const ACCOUNTS = {
  deployer: account(0),
  runner: account(1),
  committer: account(2),
  relayer: account(3),
  alice: account(4),
  bob: account(5),
  carol: account(6),
  admin: account(9),
};

export const ABIS = Object.fromEntries(
  CONTRACT_NAMES.map((name) => [name, JSON.parse(readFileSync(join(CONTRACTS, `abi/${name}.json`), "utf8"))]),
) as Record<ContractName, Abi>;

export interface Fork {
  url: string;
  client: PublicClient;
  addresses: ContractAddresses;
  deployBlock: bigint;
  /** Each feed's real round at the fork block. */
  rounds: { feed: Hex; roundId: bigint; answer: bigint }[];
  read<T>(contract: ContractName, functionName: string, args?: unknown[]): Promise<T>;
  send(from: Account, contract: ContractName, functionName: string, args: unknown[]): Promise<TransactionReceipt>;
  relay(
    user: ReturnType<typeof account>,
    contract: ContractName,
    functionName: string,
    args: unknown[],
  ): Promise<TransactionReceipt>;
  setClock(time: bigint, move?: { btcBps: bigint }): Promise<void>;
  /** Puts this many blocks on top of the last tx. */
  confirm(blocks: bigint): Promise<void>;
  stop(): void;
}

/**
 * The real contracts, deployed by the real Deploy.s.sol onto a throwaway Anvil fork of QIE mainnet.
 * null when Anvil, the submodules or the network are absent, so the plain `pnpm test` skips.
 * INDEXER_E2E=required turns each of those into a failure, so a verification run can't skip by accident.
 */
export async function startFork(): Promise<Fork | null> {
  const absent = (why: string) => {
    if (process.env.INDEXER_E2E === "required") throw new Error(`indexer fork test can't run: ${why}`);
    console.warn(`[indexer] fork test skipped: ${why}`);
    return null;
  };

  const dirs = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".foundry/bin")];
  const bin = dirs.find((dir) => dir && existsSync(join(dir, "anvil")) && existsSync(join(dir, "forge")));
  if (!bin) return absent("no Anvil");
  for (const file of ["lib/forge-std/src/Script.sol", "lib/openzeppelin-contracts/contracts/metatx/ERC2771Forwarder.sol"]) {
    if (!existsSync(join(CONTRACTS, file))) return absent("contract submodules not initialised");
  }

  for (const upstream of UPSTREAMS) {
    if (!(await answers(upstream, 8_000))) continue;

    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const args = ["--fork-url", upstream, "--chain-id", "1990", "--hardfork", "shanghai"];
    const anvil = spawn(join(bin, "anvil"), [...args, "--host", "127.0.0.1", "--port", String(port), "--silent"], {
      stdio: "ignore",
    });
    const kill = () => void anvil.kill();
    process.once("exit", kill);

    if (await untilUp(anvil, url)) {
      try {
        return await deployOnFork(bin, url, () => {
          process.off("exit", kill);
          kill();
        });
      } catch (e) {
        kill();
        throw e;
      }
    }
    process.off("exit", kill);
    kill();
  }
  return absent("no QIE RPC (rpc4, rpc5, rpc3)");
}

async function deployOnFork(bin: string, url: string, stopAnvil: () => void): Promise<Fork> {
  const client = createTestClient({
    mode: "anvil",
    chain: { ...qieMainnet, rpcUrls: { default: { http: [url] } } },
    transport: http(url, { timeout: 60_000 }),
    pollingInterval: 100,
  })
    .extend(publicActions)
    .extend(walletActions);
  const { deployer, admin, runner, committer, relayer } = ACCOUNTS;
  for (const who of Object.values(ACCOUNTS)) {
    await client.setBalance({ address: who.address, value: 10n ** 21n });
  }
  const deployBlock = (await client.getBlockNumber({ cacheTime: 0 })) + 1n;

  // Foundry's output goes to a directory of our own, so the repo's out/, cache/ and broadcast/ stay untouched.
  const work = mkdtempSync(join(tmpdir(), "botfolio-indexer-fork-"));
  let stdout = "";
  const deploy = () =>
    run(
      join(bin, "forge"),
      // --unlocked: Anvil signs for its own test accounts, so no key is on the command line.
      ["script", "script/Deploy.s.sol", "--rpc-url", url, "--broadcast", "--slow", "--unlocked", "--sender", deployer.address],
      {
        cwd: CONTRACTS,
        maxBuffer: 32 * 1024 * 1024,
        timeout: 240_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          FOUNDRY_OUT: join(work, "out"),
          FOUNDRY_CACHE_PATH: join(work, "cache"),
          FOUNDRY_BROADCAST: join(work, "broadcast"),
          ADMIN_ADDRESS: admin.address,
          RUNNER_ADDRESS: runner.address,
          COMMITTER_ADDRESS: committer.address,
          RELAYER_ADDRESS: relayer.address,
        },
      },
    );
  try {
    // The fork reads accounts from QIE's public RPC, which answers 429 when several fork suites deploy at once.
    // A deploy that hit the limit is run again; it redeploys and prints its own addresses.
    for (let attempt = 1; ; attempt++) {
      try {
        ({ stdout } = await deploy());
        break;
      } catch (e) {
        const text = `${(e as { stderr?: string }).stderr ?? ""} ${(e as Error).message}`;
        if (attempt >= 4 || !/\b429\b|Too Many Requests/.test(text)) throw e;
        await new Promise((resolve) => setTimeout(resolve, 3_000 * attempt));
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const addresses = {} as ContractAddresses;
  for (const name of CONTRACT_NAMES) {
    const address = new RegExp(`${ADDRESS_ENV[name]}=(0x[0-9a-fA-F]{40})`).exec(stdout)?.[1];
    if (!address) throw new Error(`Deploy.s.sol didn't print ${ADDRESS_ENV[name]}`);
    addresses[name] = address.toLowerCase() as Hex;
  }

  // Live feeds are often too old to trade on (#219), so each is re-served at its real address with its real
  // price and round, and only updatedAt moved to the fork's clock.
  const rounds = await Promise.all(
    ASSETS.map(async ({ feed }) => {
      const [roundId, answer] = await client.readContract({
        address: feed,
        abi: aggregatorV3Abi,
        functionName: "latestRoundData",
      });
      return { feed, roundId, answer };
    }),
  );

  async function read<T>(contract: ContractName, functionName: string, args: unknown[] = []): Promise<T> {
    const result = await client.readContract({ address: addresses[contract], abi: ABIS[contract], functionName, args });
    return result as T;
  }

  async function send(from: Account, contract: ContractName, functionName: string, args: unknown[]) {
    const hash = await client.writeContract({
      account: from,
      address: addresses[contract],
      abi: ABIS[contract],
      functionName,
      args,
    });
    return succeeded(await client.waitForTransactionReceipt({ hash }));
  }

  /** A user action: the user signs, the relayer sends and pays. tx.from is the relayer. */
  async function relay(
    user: ReturnType<typeof account>,
    contract: ContractName,
    functionName: string,
    args: unknown[],
  ) {
    const message = {
      from: user.address,
      to: addresses[contract],
      value: 0n,
      gas: RELAY_LIMITS.maxGas,
      nonce: await read<bigint>("BotForwarder", "nonces", [user.address]),
      deadline: Number((await client.getBlock({ blockTag: "latest" })).timestamp) + 300,
      data: encodeFunctionData({ abi: ABIS[contract], functionName, args }),
    };
    const signature = await user.signTypedData(forwardRequestTypedData(addresses.BotForwarder, message));
    return send(relayer, "BotForwarder", "execute", [toForwardRequest(message, signature)]);
  }

  /** Moves the clock to `time` and serves every feed as updated then. `move` changes the BTC round and price. */
  async function setClock(time: bigint, move?: { btcBps: bigint }) {
    for (const [index, round] of rounds.entries()) {
      const moved = index === 0 && move;
      const roundId = moved ? round.roundId + 1n : round.roundId;
      const answer = moved ? (round.answer * (10_000n + move.btcBps)) / 10_000n : round.answer;
      await client.setCode({ address: round.feed, bytecode: constantReturn([roundId, answer, time, time, roundId]) });
    }
    await client.setNextBlockTimestamp({ timestamp: time });
    await client.mine({ blocks: 1 });
  }

  const confirm = (blocks: bigint) => client.mine({ blocks: Number(blocks) });

  return { url, client: client as unknown as PublicClient, addresses, deployBlock, rounds, read, send, relay, setClock, confirm, stop: stopAnvil };
}

function succeeded(receipt: TransactionReceipt): TransactionReceipt {
  if (receipt.status !== "success") throw new Error(`fork tx ${receipt.transactionHash} reverted`);
  return receipt;
}

/** Runtime code that answers any call with these words. */
function constantReturn(words: bigint[]): Hex {
  const store = words.map(
    (word, i) => `7f${word.toString(16).padStart(64, "0")}60${(i * 32).toString(16).padStart(2, "0")}52`,
  );
  return `0x${store.join("")}60${(words.length * 32).toString(16)}6000f3`;
}

async function answers(url: string, timeout: number): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(timeout),
    });
    return ((await res.json()) as { result?: string }).result === "0x7c6";
  } catch {
    return false;
  }
}

async function untilUp(anvil: ChildProcess, url: string): Promise<boolean> {
  let failed = false;
  anvil.once("error", () => (failed = true));
  for (let i = 0; i < 80 && !failed && anvil.exitCode === null; i++) {
    if (await answers(url, 1_000)) return true;
    await sleep(250);
  }
  return false;
}

function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });
}
