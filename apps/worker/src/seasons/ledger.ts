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
      await sender.write({ address, abi, functionName: "closeSeason", args: [n, root, uri] });
    },
    async openSeason(n, startsAt, endsAt) {
      await sender.write({ address, abi, functionName: "openSeason", args: [n, unixSeconds(startsAt), unixSeconds(endsAt)] });
    },
  };
}
