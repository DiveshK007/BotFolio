// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Roles
/// @notice Every AccessControl role id BotFolio uses (SPEC §4.6), so two contracts can't disagree.
/// @dev The admin is OZ's DEFAULT_ADMIN_ROLE (0x00): the cold key, never on a server. The relayer
///      deliberately has no role here: it can only submit what a user signed to `BotForwarder`.
library Roles {
    /// Runner hot wallet: `PaperLedger.executeBatch`, and the signer of ApprovedOrders and bot views.
    bytes32 internal constant RUNNER = keccak256("RUNNER_ROLE");
    /// Committer hot wallet (separate key): seasons, scores, settlements.
    bytes32 internal constant COMMITTER = keccak256("COMMITTER_ROLE");
    /// On PaperLedger, held by the BotRegistry contract: `initPortfolio`.
    bytes32 internal constant REGISTRY = keccak256("REGISTRY_ROLE");
    /// On BotRegistry, held by the SeasonLedger contract: `setLimits`.
    bytes32 internal constant SEASON_LEDGER = keccak256("SEASON_LEDGER_ROLE");
}
