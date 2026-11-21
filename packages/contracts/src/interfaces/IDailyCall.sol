// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

/// @title IDailyCall
/// @notice Coach vs Bot: once per IST day the owner calls BTC up or down next to the bot's own call;
///         both are settled against QIE's official mainnet oracle (SPEC §4.7).
/// @dev Asset fixed to BTC. Day = (block.timestamp + 19800) / 86400. Calls close at 20:00 IST;
///      settlement needs a BTC round updated at or after 21:00 IST that day.
///      The bot's view must carry a RUNNER_ROLE EIP-712 signature (domain "BotFolio DailyCall",
///      version "1", chain 1990) over `BotView(uint256 botId,uint32 day,bool botUp)`.
///      Roles: DEFAULT_ADMIN_ROLE, RUNNER_ROLE (signs bot views), COMMITTER_ROLE (settles).
interface IDailyCall is IAccessControl, IERC165, IERC5267 {
    /// @notice One day's call for one bot.
    struct Call {
        bool userUp;
        bool botUp;
        int256 priceAtCall;
        uint80 roundAtCall;
        uint64 calledAt;
        bool settled;
        bool userCorrect;
        bool botCorrect;
    }

    /// @notice The owner made today's call. `price`/`roundId` are the BTC round read in this tx.
    event Called(uint256 indexed botId, uint32 indexed day, bool userUp, bool botUp, int256 price, uint80 roundId);
    /// @notice A call was settled. Equal price = both false (no winner).
    event Settled(
        uint256 indexed botId, uint32 indexed day, int256 price, uint80 roundId, bool userCorrect, bool botCorrect
    );

    /// @notice Caller does not own the bot.
    error NotBotOwner(uint256 botId, address caller);
    /// @notice This bot already called today.
    error AlreadyCalled(uint256 botId, uint32 day);
    /// @notice It is 20:00 IST or later.
    error CallsClosed(uint32 day);
    /// @notice BTC price older than 30 min or invalid ("price too old").
    error PriceTooOld();
    /// @notice `botSig` is malformed or not from a RUNNER_ROLE key.
    error InvalidBotSignature(address recovered);

    /// @notice Role of the runner key that signs bot views.
    function RUNNER_ROLE() external view returns (bytes32);
    /// @notice Role of the committer key that settles.
    function COMMITTER_ROLE() external view returns (bytes32);
    /// @notice EIP-712 typehash of `BotView(uint256 botId,uint32 day,bool botUp)`.
    function BOT_VIEW_TYPEHASH() external view returns (bytes32);
    /// @notice Seconds into the IST day when calls close (72000 = 20:00).
    function CALL_CUTOFF() external view returns (uint32);
    /// @notice Seconds into the IST day the settle price must be at or after (75600 = 21:00).
    function SETTLE_FROM() external view returns (uint32);
    /// @notice Max BTC price age in seconds (1800).
    function MAX_AGE() external view returns (uint32);

    /// @notice The BTC/USDT feed (same fixed address as PaperLedger; no setter).
    function btcFeed() external view returns (address);
    /// @notice The BotRegistry used for owner checks.
    function registry() external view returns (address);
    /// @notice The ERC-2771 forwarder this contract trusts.
    function trustedForwarder() external view returns (address);
    /// @notice True if `forwarder` is the trusted forwarder.
    /// @param forwarder Address to check.
    function isTrustedForwarder(address forwarder) external view returns (bool);

    /// @notice Raw call record.
    /// @param botId Bot id.
    /// @param day IST day number.
    function calls(uint256 botId, uint32 day)
        external
        view
        returns (
            bool userUp,
            bool botUp,
            int256 priceAtCall,
            uint80 roundAtCall,
            uint64 calledAt,
            bool settled,
            bool userCorrect,
            bool botCorrect
        );
    /// @notice Today's IST day number.
    function today() external view returns (uint32);
    /// @notice Helper: the EIP-712 digest the runner signs for a bot view.
    /// @param botId Bot id.
    /// @param day IST day number.
    /// @param botUp The bot's call.
    function hashBotView(uint256 botId, uint32 day, bool botUp) external view returns (bytes32);

    /// @notice Makes today's call (via forwarder, bot owner only), before 20:00 IST. Reads BTC now
    ///         and reverts if the price is older than 30 min.
    /// @param botId Bot id.
    /// @param userUp The owner's call: true = BTC higher at settle.
    /// @param botUp The bot's call, revealed to the user after they pick.
    /// @param botSig RUNNER_ROLE EIP-712 signature over (botId, today, botUp).
    function call(uint256 botId, bool userUp, bool botUp, bytes calldata botSig) external;

    /// @notice Settles calls for `day`. COMMITTER_ROLE only. If BTC is not fresh or was last updated
    ///         before 21:00 IST that day, does nothing (no revert); the worker retries. Bots with no
    ///         call or already settled are skipped.
    /// @param botIds Bots to settle.
    /// @param day IST day number.
    function settle(uint256[] calldata botIds, uint32 day) external;
}
