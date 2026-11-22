import { ignored, type ContractHandlers } from "./types";

export const forwarderHandlers: ContractHandlers<"BotForwarder"> = {
  /**
   * relay_log is the relayer's (#39): it records the outcome with gas_used, and only over a `submitted` row, so a
   * confirmation from here would lose the gas. Never an insert either: anyone can call the forwarder with any
   * target and pad /stats. User rows take the _msgSender that each contract checked.
   */
  async ExecutedForwardRequest() {
    return ignored("relay_log belongs to the relayer");
  },
};
