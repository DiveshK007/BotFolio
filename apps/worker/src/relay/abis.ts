import type { Abi } from "viem";
import type { RelayTargetContract } from "@botfolio/shared";
import botForwarder from "../../../../packages/contracts/abi/BotForwarder.json";
import botRegistry from "../../../../packages/contracts/abi/BotRegistry.json";
import challenges from "../../../../packages/contracts/abi/Challenges.json";
import dailyCall from "../../../../packages/contracts/abi/DailyCall.json";
import paperLedger from "../../../../packages/contracts/abi/PaperLedger.json";
import seasonLedger from "../../../../packages/contracts/abi/SeasonLedger.json";

// The exported ABIs (frozen, generated from the Solidity interfaces). tsup inlines them into dist.
export const FORWARDER_ABI = botForwarder as Abi;

export const TARGET_ABIS: Record<RelayTargetContract, Abi> = {
  BotRegistry: botRegistry as Abi,
  SeasonLedger: seasonLedger as Abi,
  PaperLedger: paperLedger as Abi,
  DailyCall: dailyCall as Abi,
  Challenges: challenges as Abi,
};
