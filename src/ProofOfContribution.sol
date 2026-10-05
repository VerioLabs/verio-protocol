// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ProofOfContribution
/// @notice Permissionless, immutable registry of contributors and their proofs of contribution.
///         One packed storage slot per contributor plus two global counters. No admin, no upgrade path.
/// @dev Every call tolerates an ERC-8021 attribution suffix appended to calldata (the ABI decoder
///      ignores trailing bytes); that suffix is how transactions are attributed to a Base Builder Code.
contract ProofOfContribution {
    /// @notice Thrown when an address registers twice.
    error AlreadyRegistered();
    /// @notice Thrown when the referrer is the caller.
    error SelfReferral();
    /// @notice Thrown on a second check-in within the same UTC day.
    error AlreadyCheckedInToday();

    /// @notice Per-contributor state, packed into one slot.
    /// @param registeredAt Block timestamp of registration; zero means unregistered.
    /// @param proofs Number of proofs submitted.
    /// @param checkIns Number of daily check-ins.
    /// @param lastCheckInDay UTC day index (timestamp / 1 days) of the latest check-in.
    struct Contributor {
        uint32 registeredAt;
        uint32 proofs;
        uint32 checkIns;
        uint32 lastCheckInDay;
    }

    /// @notice A new contributor joined; `referrer` is zero when none was given.
    event Registered(address indexed contributor, address indexed referrer);
    /// @notice A contributor anchored a content hash; `index` is 1-based per contributor.
    event Proved(address indexed contributor, bytes32 indexed contentHash, uint32 index);
    /// @notice A contributor checked in on UTC day `day`; `count` is their lifetime check-ins.
    event CheckedIn(address indexed contributor, uint32 indexed day, uint32 count);

    /// @notice Contributor state by address.
    mapping(address => Contributor) public contributors;
    /// @notice Number of distinct registered addresses.
    uint256 public totalContributors;
    /// @notice Number of proofs across all contributors.
    uint256 public totalProofs;

    /// @notice Register the caller once, optionally crediting a referrer.
    /// @param referrer Address that referred the caller, or zero.
    function register(address referrer) external {
        if (referrer == msg.sender) revert SelfReferral();
        Contributor storage c = contributors[msg.sender];
        if (c.registeredAt != 0) revert AlreadyRegistered();
        _register(c, referrer);
    }

    /// @notice Anchor a content hash for the caller, registering them first if needed.
    /// @param contentHash Hash of the contributed content (sha256 of the bytes by convention).
    function prove(bytes32 contentHash) external {
        Contributor storage c = contributors[msg.sender];
        if (c.registeredAt == 0) _register(c, address(0));
        uint32 index = ++c.proofs;
        ++totalProofs;
        emit Proved(msg.sender, contentHash, index);
    }

    /// @notice Record one check-in per UTC day for the caller, registering them first if needed.
    function checkIn() external {
        Contributor storage c = contributors[msg.sender];
        if (c.registeredAt == 0) _register(c, address(0));
        uint32 day = uint32(block.timestamp / 1 days);
        if (c.checkIns != 0 && c.lastCheckInDay == day) revert AlreadyCheckedInToday();
        c.lastCheckInDay = day;
        uint32 count = ++c.checkIns;
        emit CheckedIn(msg.sender, day, count);
    }

    /// @notice Whether `who` has registered (directly or via prove/checkIn).
    function isRegistered(address who) external view returns (bool) {
        return contributors[who].registeredAt != 0;
    }

    function _register(Contributor storage c, address referrer) private {
        c.registeredAt = uint32(block.timestamp);
        ++totalContributors;
        emit Registered(msg.sender, referrer);
    }
}
