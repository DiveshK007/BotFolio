import type { Abi, Address, Hex, PublicClient } from "viem";
import { TARGET_ABIS } from "../relay/abis";
import type { SystemSender } from "../system/sender";

export interface SeasonChain {
  /** How many seasons have opened, which is also the number of the next one. */
  nextSeason(): Promise<number>;
  openSeason(n: number, startsAt: Date, endsAt: Date): Promise<void>;
  isClosed(n: number): Promise<boolean>;
  closeSeason(n: number, root: Hex, uri: string): Promise<void>;
}

const unixSeconds = (date: Date) => BigInt(Math.floor(date.getTime() / 1000));

/**
 * #152: closeSeason stores its dataURI, one fresh slot per 32 bytes, so it costs more than SYSTEM_MIN_GAS. Measured on
 * a fork of the deployed SeasonLedger: 167,403 for an 85-byte Supabase URL, 305,025 for 265 bytes. Without this a
 * bare-intrinsic estimate (#339) sends it with the 150k floor and it runs out of gas.
 */
export const closeSeasonMinGas = (uri: string) => 100_000n + 25_000n * BigInt(Math.ceil(Buffer.byteLength(uri) / 32) + 1);

export function createSeasonChain(opts: { client: PublicClient; address: Address; sender: SystemSender }): SeasonChain {
  const { client, address, sender } = opts;
  const abi: Abi = TARGET_ABIS.SeasonLedger;
  return {
    async nextSeason() {
      return Number(await client.readContract({ address, abi, functionName: "nextSeason" }));
    },
    async isClosed(n) {
      const season = (await client.readContract({ address, abi, functionName: "seasons", args: [n] })) as readonly unknown[];
      return season[4] === true;
    },
    async closeSeason(n, root, uri) {
      await sender.write({ address, abi, functionName: "closeSeason", args: [n, root, uri], minGas: closeSeasonMinGas(uri) });
    },
    async openSeason(n, startsAt, endsAt) {
      await sender.write({ address, abi, functionName: "openSeason", args: [n, unixSeconds(startsAt), unixSeconds(endsAt)] });
    },
  };
}
