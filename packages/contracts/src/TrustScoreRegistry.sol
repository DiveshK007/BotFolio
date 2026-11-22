// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ITrustScoreRegistry} from "./interfaces/ITrustScoreRegistry.sol";
import {Roles} from "./lib/Roles.sol";

/// @title TrustScoreRegistry
/// @notice Published trust rules and a Merkle root of scores per season (SPEC §4.5, §7).
/// @dev No user calls this, so it trusts no forwarder.
contract TrustScoreRegistry is ITrustScoreRegistry, AccessControl {
    bytes32 public constant COMMITTER_ROLE = Roles.COMMITTER;

    mapping(bytes32 version => string) public rulesURI;
    mapping(bytes32 version => bytes32) public rulesDocHash;
    mapping(uint32 season => bytes32) public scoresRoot;
    mapping(uint32 season => bytes32) public rulesVersionOf;

    /// @notice The admin argument was zero.
    error ZeroAddress();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @dev `docHash` can't be zero, so a non-zero `rulesDocHash` is what "published" means.
    function publishRules(bytes32 version, string calldata uri, bytes32 docHash)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (version == bytes32(0) || bytes(uri).length == 0 || docHash == bytes32(0)) {
            revert EmptyValue();
        }
        if (rulesDocHash[version] != bytes32(0)) revert RulesAlreadyPublished(version);

        rulesURI[version] = uri;
        rulesDocHash[version] = docHash;
        emit RulesPublished(version, uri, docHash);
    }

    function commitScores(uint32 season, bytes32 rulesVersion, bytes32 root, string calldata uri)
        external
        onlyRole(COMMITTER_ROLE)
    {
        if (root == bytes32(0) || bytes(uri).length == 0) revert EmptyValue();
        if (rulesDocHash[rulesVersion] == bytes32(0)) revert UnknownRules(rulesVersion);

        scoresRoot[season] = root;
        rulesVersionOf[season] = rulesVersion;
        emit ScoresCommitted(season, rulesVersion, root, uri);
    }

    function leafHash(
        uint32 season,
        uint256 botId,
        uint16 fRules,
        uint16 fDrawdown,
        uint16 fConsistency,
        uint16 fExplains,
        uint16 total
    ) external pure returns (bytes32) {
        return _leaf(season, botId, fRules, fDrawdown, fConsistency, fExplains, total);
    }

    function verifyScore(
        uint32 season,
        uint256 botId,
        uint16 fRules,
        uint16 fDrawdown,
        uint16 fConsistency,
        uint16 fExplains,
        uint16 total,
        bytes32[] calldata proof
    ) external view returns (bool) {
        // Summed as uint256: a bad input must return false, not overflow and revert.
        if (uint256(fRules) + fDrawdown + fConsistency + fExplains != total) return false;

        bytes32 root = scoresRoot[season];
        if (root == bytes32(0)) return false;

        bytes32 leaf = _leaf(season, botId, fRules, fDrawdown, fConsistency, fExplains, total);
        return MerkleProof.verifyCalldata(proof, root, leaf);
    }

    /// @dev A single hash, as SPEC §4.5 defines it. It can't be confused with an inner node, because a
    ///      leaf preimage is 224 bytes and a node preimage is 64.
    function _leaf(
        uint32 season,
        uint256 botId,
        uint16 fRules,
        uint16 fDrawdown,
        uint16 fConsistency,
        uint16 fExplains,
        uint16 total
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(season, botId, fRules, fDrawdown, fConsistency, fExplains, total));
    }
}
