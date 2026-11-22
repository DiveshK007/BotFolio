// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title ITrustScoreRegistry
/// @notice Published trust-score rules and one Merkle root of scores per season (SPEC §4.5, §7).
/// @dev Leaf = keccak256(abi.encode(season, botId, fRules, fDrawdown, fConsistency, fExplains, total)).
///      Tree = keccak256 over sorted pairs (OpenZeppelin MerkleProof), same as the replay script.
///      Not user-facing, so no forwarder. Roles: DEFAULT_ADMIN_ROLE (publishRules), COMMITTER_ROLE.
interface ITrustScoreRegistry is IAccessControl, IERC165 {
    /// @notice A rules version was published. Rules are never edited; a change is a new version.
    event RulesPublished(bytes32 indexed version, string uri, bytes32 docHash);
    /// @notice A season's score root was committed (may be re-committed, e.g. daily provisional roots).
    event ScoresCommitted(uint32 indexed season, bytes32 indexed rulesVersion, bytes32 root, string uri);

    /// @notice This rules version is already published.
    error RulesAlreadyPublished(bytes32 version);
    /// @notice This rules version was never published.
    error UnknownRules(bytes32 version);
    /// @notice Empty version, URI or root.
    error EmptyValue();

    /// @notice Role of the committer key.
    function COMMITTER_ROLE() external view returns (bytes32);

    /// @notice Rules doc URL for a version ("" if unpublished). Versions are bytes32 strings, e.g. "trust-v1".
    /// @param version Rules version.
    function rulesURI(bytes32 version) external view returns (string memory);
    /// @notice keccak256 of the rules doc for a version.
    /// @param version Rules version.
    function rulesDocHash(bytes32 version) external view returns (bytes32);
    /// @notice Latest committed score root for a season.
    /// @param season Season number.
    function scoresRoot(uint32 season) external view returns (bytes32);
    /// @notice Rules version used for a season's scores.
    /// @param season Season number.
    function rulesVersionOf(uint32 season) external view returns (bytes32);

    /// @notice Publishes a rules version. Admin only; each version once.
    /// @param version e.g. bytes32("trust-v1-sprint").
    /// @param uri Public URL of the rules doc.
    /// @param docHash keccak256 of the rules doc bytes.
    function publishRules(bytes32 version, string calldata uri, bytes32 docHash) external;

    /// @notice Commits a season's score root. COMMITTER_ROLE only; `rulesVersion` must be published.
    /// @param season Season number.
    /// @param rulesVersion Rules version the scores were computed with.
    /// @param root Merkle root of the score leaves.
    /// @param uri Public URL of the score file.
    function commitScores(uint32 season, bytes32 rulesVersion, bytes32 root, string calldata uri) external;

    /// @notice The leaf for one bot's score (helper for clients and tests).
    /// @param season Season number.
    /// @param botId Bot id.
    /// @param fRules F1, 0..250.
    /// @param fDrawdown F2, 0..250.
    /// @param fConsistency F3, 0..250.
    /// @param fExplains F4, 0..250.
    /// @param total F1+F2+F3+F4, 0..1000.
    function leafHash(
        uint32 season,
        uint256 botId,
        uint16 fRules,
        uint16 fDrawdown,
        uint16 fConsistency,
        uint16 fExplains,
        uint16 total
    ) external pure returns (bytes32);

    /// @notice True if this score is in the season's committed root. False if `total` is not the
    ///         sum of the four factors, if no root is committed, or if the proof fails.
    /// @dev SPEC §4.5 lists `verifyScore(season, botId, total, proof)`, but its leaf needs all four
    ///      factors, so they are parameters here (see PR notes).
    /// @param season Season number.
    /// @param botId Bot id.
    /// @param fRules F1.
    /// @param fDrawdown F2.
    /// @param fConsistency F3.
    /// @param fExplains F4.
    /// @param total Total score.
    /// @param proof Sorted-pair Merkle proof.
    function verifyScore(
        uint32 season,
        uint256 botId,
        uint16 fRules,
        uint16 fDrawdown,
        uint16 fConsistency,
        uint16 fExplains,
        uint16 total,
        bytes32[] calldata proof
    ) external view returns (bool);
}
