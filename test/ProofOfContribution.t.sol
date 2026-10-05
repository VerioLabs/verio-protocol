// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProofOfContribution} from "../src/ProofOfContribution.sol";

contract ProofOfContributionTest is Test {
    event Registered(address indexed contributor, address indexed referrer);
    event Proved(address indexed contributor, bytes32 indexed contentHash, uint32 index);
    event CheckedIn(address indexed contributor, uint32 indexed day, uint32 count);

    /// @dev ERC-8021 schema-0 suffix for the code "demo": codes ∥ len ∥ schemaId ∥ marker.
    bytes internal constant SUFFIX = hex"64656d6f" hex"04" hex"00" hex"80218021802180218021802180218021";

    ProofOfContribution internal proof;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    uint256 internal constant T0 = 1_758_326_400; // 2026-09-20 00:00:00 UTC

    function setUp() public {
        vm.warp(T0 + 3600);
        proof = new ProofOfContribution();
    }

    function _contributor(address who) internal view returns (ProofOfContribution.Contributor memory c) {
        (c.registeredAt, c.proofs, c.checkIns, c.lastCheckInDay) = proof.contributors(who);
    }

    // ───────────── register ─────────────

    function test_register_storesTimestampAndEmits() public {
        vm.expectEmit(true, true, false, false, address(proof));
        emit Registered(alice, bob);
        vm.prank(alice);
        proof.register(bob);

        ProofOfContribution.Contributor memory c = _contributor(alice);
        assertEq(c.registeredAt, uint32(block.timestamp));
        assertEq(c.proofs, 0);
        assertEq(c.checkIns, 0);
        assertTrue(proof.isRegistered(alice));
        assertEq(proof.totalContributors(), 1);
    }

    function test_register_revertsWhenAlreadyRegistered() public {
        vm.startPrank(alice);
        proof.register(address(0));
        vm.expectRevert(ProofOfContribution.AlreadyRegistered.selector);
        proof.register(bob);
        vm.stopPrank();
        assertEq(proof.totalContributors(), 1);
    }

    function test_register_selfReferralIsRejected() public {
        vm.prank(alice);
        vm.expectRevert(ProofOfContribution.SelfReferral.selector);
        proof.register(alice);
    }

    // ───────────── prove ─────────────

    function test_prove_autoRegistersWithZeroReferrer() public {
        bytes32 h = keccak256("cat.png");
        vm.expectEmit(true, true, false, false, address(proof));
        emit Registered(alice, address(0));
        vm.expectEmit(true, true, false, true, address(proof));
        emit Proved(alice, h, 1);
        vm.prank(alice);
        proof.prove(h);

        ProofOfContribution.Contributor memory c = _contributor(alice);
        assertEq(c.registeredAt, uint32(block.timestamp));
        assertEq(c.proofs, 1);
        assertEq(proof.totalContributors(), 1);
        assertEq(proof.totalProofs(), 1);
    }

    function test_prove_incrementsIndexWithoutReregistering() public {
        vm.prank(alice);
        proof.register(bob);
        uint32 registeredAt = _contributor(alice).registeredAt;
        vm.warp(block.timestamp + 1 days);

        vm.startPrank(alice);
        proof.prove(keccak256("a"));
        vm.expectEmit(true, true, false, true, address(proof));
        emit Proved(alice, keccak256("b"), 2);
        proof.prove(keccak256("b"));
        vm.stopPrank();

        ProofOfContribution.Contributor memory c = _contributor(alice);
        assertEq(c.registeredAt, registeredAt, "registration must not be overwritten");
        assertEq(c.proofs, 2);
        assertEq(proof.totalContributors(), 1);
        assertEq(proof.totalProofs(), 2);
    }

    function test_prove_acceptsDuplicateHashesFromDifferentUsers() public {
        bytes32 h = keccak256("same");
        vm.prank(alice);
        proof.prove(h);
        vm.prank(bob);
        proof.prove(h);
        assertEq(proof.totalContributors(), 2);
        assertEq(proof.totalProofs(), 2);
    }

    // ───────────── checkIn ─────────────

    function test_checkIn_autoRegistersAndRecordsUtcDay() public {
        uint32 day = uint32(block.timestamp / 1 days);
        vm.expectEmit(true, true, false, false, address(proof));
        emit Registered(alice, address(0));
        vm.expectEmit(true, true, false, true, address(proof));
        emit CheckedIn(alice, day, 1);
        vm.prank(alice);
        proof.checkIn();

        ProofOfContribution.Contributor memory c = _contributor(alice);
        assertEq(c.checkIns, 1);
        assertEq(c.lastCheckInDay, day);
        assertEq(proof.totalContributors(), 1);
    }

    function test_checkIn_revertsTwiceInSameUtcDay() public {
        vm.startPrank(alice);
        proof.checkIn();
        vm.warp(T0 + 1 days - 1); // 23:59:59 the same UTC day
        vm.expectRevert(ProofOfContribution.AlreadyCheckedInToday.selector);
        proof.checkIn();
        vm.stopPrank();
    }

    function test_checkIn_allowsNextUtcDay() public {
        vm.startPrank(alice);
        proof.checkIn();
        vm.warp(T0 + 1 days); // 00:00:00 next UTC day
        vm.expectEmit(true, true, false, true, address(proof));
        emit CheckedIn(alice, uint32((T0 + 1 days) / 1 days), 2);
        proof.checkIn();
        vm.stopPrank();
        assertEq(_contributor(alice).checkIns, 2);
    }

    // ───────────── ERC-8021 suffix tolerance ─────────────

    function test_callsSucceedWithBuilderCodeSuffixAppended() public {
        bytes32 h = keccak256("suffixed");
        vm.startPrank(alice);
        (bool ok1,) = address(proof).call(bytes.concat(abi.encodeCall(ProofOfContribution.register, (bob)), SUFFIX));
        (bool ok2,) = address(proof).call(bytes.concat(abi.encodeCall(ProofOfContribution.prove, (h)), SUFFIX));
        (bool ok3,) = address(proof).call(bytes.concat(abi.encodeCall(ProofOfContribution.checkIn, ()), SUFFIX));
        vm.stopPrank();
        assertTrue(ok1 && ok2 && ok3, "suffixed calldata must be accepted");
        ProofOfContribution.Contributor memory c = _contributor(alice);
        assertEq(c.proofs, 1);
        assertEq(c.checkIns, 1);
    }

    function test_unknownSelectorReverts() public {
        (bool ok,) = address(proof).call(hex"deadbeef");
        assertFalse(ok);
    }

    // ───────────── fuzz ─────────────

    function testFuzz_prove(address user, bytes32 h, uint8 n) public {
        vm.assume(user != address(0));
        n = uint8(bound(n, 1, 32));
        vm.startPrank(user);
        for (uint256 i = 0; i < n; i++) {
            proof.prove(keccak256(abi.encode(h, i)));
        }
        vm.stopPrank();
        assertEq(_contributor(user).proofs, n);
        assertEq(proof.totalProofs(), n);
        assertEq(proof.totalContributors(), 1);
    }
}
