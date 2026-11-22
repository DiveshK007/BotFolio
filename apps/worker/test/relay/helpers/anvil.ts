import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { qieMainnet } from "@botfolio/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import type { HDAccount } from "viem/accounts";
import { RELAYER } from "./fakes";

const WORKER = fileURLToPath(new URL("../../..", import.meta.url));
const CONTRACTS = resolve(WORKER, "../../packages/contracts");
const OZ = join(CONTRACTS, "lib/openzeppelin-contracts/contracts");
const FOUNDRY_BIN = process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry/bin");
// rpc1/rpc2 drop TLS sometimes (SPEC §0.1). Only read from: every tx goes to the local fork.
const FORK_RPCS = [4, 5, 3].map((n) => `https://rpc${n}mainnet.qie.digital`);

/** The Anvil tests are opt-in (`pnpm test:anvil`) and skip when Foundry or the submodules are missing. */
export const anvilReady =
  process.env.RELAY_ANVIL === "1" &&
  existsSync(join(FOUNDRY_BIN, "anvil")) &&
  existsSync(join(OZ, "metatx/ERC2771Forwarder.sol"));

interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

/** Compiles the real BotForwarder source and the test target with the repo's solc settings. */
export function buildArtifacts(): { forwarder: Artifact; target: Artifact } {
  const cache = join(WORKER, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  const root = mkdtempSync(join(cache, "relay-e2e-"));
  try {
    mkdirSync(join(root, "src"));
    copyFileSync(join(CONTRACTS, "src/BotForwarder.sol"), join(root, "src/BotForwarder.sol"));
    copyFileSync(join(WORKER, "test/relay/fixtures/RelayTarget.sol"), join(root, "src/RelayTarget.sol"));
    writeFileSync(
      join(root, "foundry.toml"),
      [
        "[profile.default]",
        'solc_version = "0.8.24"',
        'evm_version = "shanghai"',
        "optimizer = true",
        "optimizer_runs = 200",
        `allow_paths = ["${OZ}"]`,
        `remappings = ["@openzeppelin/contracts/=${OZ}/"]`,
      ].join("\n"),
    );
    execFileSync(join(FOUNDRY_BIN, "forge"), ["build", "--root", root], { stdio: "pipe" });
    const load = (name: string): Artifact => {
      const json = JSON.parse(readFileSync(join(root, `out/${name}.sol/${name}.json`), "utf8"));
      return { abi: json.abi, bytecode: json.bytecode.object };
    };
    return { forwarder: load("BotForwarder"), target: load("RelayTarget") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A throwaway fork of QIE mainnet on localhost, chain id 1990. */
export async function startFork(extraArgs: string[] = []): Promise<{ url: string; stop: () => void }> {
  for (const upstream of FORK_RPCS) {
    const port = await freePort();
    const args = ["--fork-url", upstream, "--chain-id", "1990", "--port", String(port), "--hardfork", "shanghai", "--silent"];
    const child = spawn(join(FOUNDRY_BIN, "anvil"), [...args, ...extraArgs], { stdio: "ignore" });
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 80 && child.exitCode === null; i++) {
      if (await answers(url)) return { url, stop: () => void child.kill() };
      await new Promise((r) => setTimeout(r, 250));
    }
    child.kill();
  }
  throw new Error("no QIE RPC could be forked");
}

export function forkClients(url: string): {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, HDAccount>;
} {
  const transport = http(url);
  return {
    publicClient: createPublicClient({ chain: qieMainnet, transport, pollingInterval: 100 }),
    walletClient: createWalletClient({ chain: qieMainnet, transport, account: RELAYER }),
  };
}

export async function deploy(url: string, artifact: Artifact, args: unknown[] = []): Promise<Address> {
  const { publicClient, walletClient } = forkClients(url);
  const hash = await walletClient.deployContract({ ...artifact, args, chain: qieMainnet, account: RELAYER });
  const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
  return contractAddress!.toLowerCase() as Address;
}

async function answers(url: string): Promise<boolean> {
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    return ((await res.json()) as { result?: string }).result === "0x7c6";
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}
