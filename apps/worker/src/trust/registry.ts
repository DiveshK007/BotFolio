import { zeroHash, type Abi, type Address, type Hex, type PublicClient } from "viem";
import trustScoreRegistry from "../../../../packages/contracts/abi/TrustScoreRegistry.json";
import type { SystemSender } from "../system/sender";

const abi = trustScoreRegistry as Abi;

export interface TrustRegistryChain {
  scoresRoot(season: number): Promise<Hex>;
  rulesPublished(version: Hex): Promise<boolean>;
  commitScores(season: number, version: Hex, root: Hex, uri: string): Promise<void>;
}

/** `TrustScoreRegistry` for the season close. Writes go through the committer key (COMMITTER_ROLE, SPEC §4.6). */
export function createTrustRegistryChain(opts: { client: PublicClient; address: Address; sender: SystemSender }): TrustRegistryChain {
  const { client, address, sender } = opts;
  return {
    async scoresRoot(season) {
      return (await client.readContract({ address, abi, functionName: "scoresRoot", args: [season] })) as Hex;
    },
    async rulesPublished(version) {
      return ((await client.readContract({ address, abi, functionName: "rulesDocHash", args: [version] })) as Hex) !== zeroHash;
    },
    async commitScores(season, version, root, uri) {
      await sender.write({ address, abi, functionName: "commitScores", args: [season, version, root, uri] });
    },
  };
}
