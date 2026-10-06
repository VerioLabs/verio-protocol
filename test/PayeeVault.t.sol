// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PayeeVault} from "../src/PayeeVault.sol";
import {PayeeVaultFactory} from "../src/PayeeVaultFactory.sol";
import {ResourceRegistry} from "../src/ResourceRegistry.sol";

/// @dev A minimal ERC-20: returns bool, or nothing when `noReturn`; refuses transfers to `blocked`.
contract TestToken {
    mapping(address => uint256) public balanceOf;
    bool public noReturn;
    address public blocked;

    constructor(bool noReturn_) {
        noReturn = noReturn_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function block_(address who) external {
        blocked = who;
    }

    function transfer(address to, uint256 amount) external {
        require(to != blocked, "blocked");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (noReturn) return;
        assembly {
            mstore(0, 1)
            return(0, 32)
        }
    }
}

/// @dev A token whose `transfer` reports failure instead of reverting.
contract FalseToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract RejectsEth {}

contract PayeeVaultTest is Test {
    event Swept(address indexed token, address indexed to, uint256 amount);
    event VaultDeployed(address indexed vault, address indexed beneficiary, bytes32 indexed key);

    /// @dev ERC-8021 schema-0 suffix for the code "demo": codes ∥ len ∥ schemaId ∥ marker.
    bytes internal constant SUFFIX = hex"64656d6f" hex"04" hex"00" hex"80218021802180218021802180218021";
    bytes32 internal constant KEY = keccak256("repo-1");

    PayeeVaultFactory internal factory;
    TestToken internal usdc;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal mallory = makeAddr("mallory");

    function setUp() public {
        factory = new PayeeVaultFactory();
        usdc = new TestToken(false);
    }

    // ───────────── vaultOf / deploy ─────────────

    function test_vaultOf_matchesDeployedAddress() public {
        address predicted = factory.vaultOf(alice, KEY);
        assertEq(predicted.code.length, 0);

        vm.expectEmit(true, true, true, true, address(factory));
        emit VaultDeployed(predicted, alice, KEY);
        address vault = factory.deploy(alice, KEY);

        assertEq(vault, predicted);
        assertGt(vault.code.length, 0);
        assertEq(PayeeVault(payable(vault)).beneficiary(), alice);
    }

    function test_vaultOf_differsByBeneficiaryAndKey() public view {
        address a = factory.vaultOf(alice, KEY);
        assertTrue(a != factory.vaultOf(bob, KEY));
        assertTrue(a != factory.vaultOf(alice, keccak256("repo-2")));
    }

    function test_deploy_isIdempotent() public {
        address first = factory.deploy(alice, KEY);
        vm.recordLogs();
        address second = factory.deploy(alice, KEY);
        assertEq(first, second);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_deploy_anyoneGetsTheSameVault() public {
        vm.prank(mallory);
        address vault = factory.deploy(alice, KEY);
        assertEq(PayeeVault(payable(vault)).beneficiary(), alice);
    }

    function test_deploy_revertsOnZeroBeneficiary() public {
        vm.expectRevert(PayeeVault.ZeroAddress.selector);
        factory.deploy(address(0), KEY);
    }

    // ───────────── sweep ─────────────

    function test_sweep_paysOutWhatArrivedBeforeDeployment() public {
        address vault = factory.vaultOf(alice, KEY);
        usdc.mint(vault, 30_000);

        vm.expectEmit(true, true, true, true, vault);
        emit Swept(address(usdc), alice, 30_000);
        vm.prank(mallory);
        uint256 sent = factory.sweep(alice, KEY, address(usdc));

        assertEq(sent, 30_000);
        assertEq(usdc.balanceOf(alice), 30_000);
        assertEq(usdc.balanceOf(vault), 0);
        assertEq(usdc.balanceOf(mallory), 0);
    }

    function test_sweep_onDeployedVault_byAnyone() public {
        address vault = factory.deploy(alice, KEY);
        usdc.mint(vault, 5);
        vm.prank(mallory);
        assertEq(PayeeVault(payable(vault)).sweep(address(usdc)), 5);
        assertEq(usdc.balanceOf(alice), 5);
    }

    function test_sweep_zeroBalanceIsANoOp() public {
        address vault = factory.deploy(alice, KEY);
        vm.recordLogs();
        assertEq(PayeeVault(payable(vault)).sweep(address(usdc)), 0);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_sweep_tokenWithoutReturnValue() public {
        TestToken token = new TestToken(true);
        address vault = factory.vaultOf(alice, KEY);
        token.mint(vault, 7);
        factory.sweep(alice, KEY, address(token));
        assertEq(token.balanceOf(alice), 7);
    }

    function test_sweep_revertsWhenTokenReportsFailure() public {
        FalseToken token = new FalseToken();
        address vault = factory.vaultOf(alice, KEY);
        token.mint(vault, 7);
        vm.expectRevert(PayeeVault.TransferFailed.selector);
        factory.sweep(alice, KEY, address(token));
    }

    function test_sweep_eth() public {
        address vault = factory.vaultOf(alice, KEY);
        vm.deal(vault, 1 ether);
        factory.sweep(alice, KEY, address(0));
        assertEq(alice.balance, 1 ether);
        assertEq(vault.balance, 0);

        // Once deployed, the vault still accepts ETH.
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        (bool ok,) = vault.call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(vault.balance, 0.5 ether);
    }

    function test_sweep_ethRevertsWhenBeneficiaryRejects() public {
        address rejecter = address(new RejectsEth());
        address vault = factory.vaultOf(rejecter, KEY);
        vm.deal(vault, 1 ether);
        vm.expectRevert(PayeeVault.TransferFailed.selector);
        factory.sweep(rejecter, KEY, address(0));
    }

    function test_sweep_toleratesBuilderCodeSuffix() public {
        address vault = factory.vaultOf(alice, KEY);
        usdc.mint(vault, 9);
        bytes memory data = abi.encodeCall(PayeeVaultFactory.sweep, (alice, KEY, address(usdc)));
        (bool ok, bytes memory ret) = address(factory).call(bytes.concat(data, SUFFIX));
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint256)), 9);
        assertEq(usdc.balanceOf(alice), 9);
    }

    // ───────────── sweepTo ─────────────

    function test_sweepTo_letsTheBeneficiaryRedirect() public {
        address vault = factory.deploy(alice, KEY);
        usdc.mint(vault, 11);
        usdc.block_(alice);

        vm.expectRevert(PayeeVault.TransferFailed.selector);
        PayeeVault(payable(vault)).sweep(address(usdc));

        vm.expectEmit(true, true, true, true, vault);
        emit Swept(address(usdc), bob, 11);
        vm.prank(alice);
        PayeeVault(payable(vault)).sweepTo(address(usdc), bob);
        assertEq(usdc.balanceOf(bob), 11);
    }

    function test_sweepTo_revertsForOthers() public {
        address vault = factory.deploy(alice, KEY);
        usdc.mint(vault, 11);
        vm.prank(mallory);
        vm.expectRevert(PayeeVault.NotBeneficiary.selector);
        PayeeVault(payable(vault)).sweepTo(address(usdc), mallory);
    }

    function test_sweepTo_revertsOnZeroDestination() public {
        address vault = factory.deploy(alice, KEY);
        vm.prank(alice);
        vm.expectRevert(PayeeVault.ZeroAddress.selector);
        PayeeVault(payable(vault)).sweepTo(address(usdc), address(0));
    }

    // ───────────── sweepMany ─────────────

    function test_sweepMany_paysEachAndSkipsEmptyVaults() public {
        bytes32 key2 = keccak256("repo-2");
        bytes32 key3 = keccak256("repo-3");
        usdc.mint(factory.vaultOf(alice, KEY), 1);
        usdc.mint(factory.vaultOf(alice, key2), 2);
        usdc.mint(factory.vaultOf(bob, key3), 4);
        address empty = factory.vaultOf(bob, KEY);

        address[] memory bs = new address[](4);
        bytes32[] memory ks = new bytes32[](4);
        (bs[0], ks[0]) = (alice, KEY);
        (bs[1], ks[1]) = (alice, key2);
        (bs[2], ks[2]) = (bob, key3);
        (bs[3], ks[3]) = (bob, KEY);
        factory.sweepMany(bs, ks, address(usdc));

        assertEq(usdc.balanceOf(alice), 3);
        assertEq(usdc.balanceOf(bob), 4);
        assertEq(empty.code.length, 0);
    }

    function test_sweepMany_revertsOnLengthMismatch() public {
        vm.expectRevert(PayeeVaultFactory.LengthMismatch.selector);
        factory.sweepMany(new address[](2), new bytes32[](1), address(usdc));
    }

    // ───────────── with the registry ─────────────

    /// One seller, several resources: each gets its own vault as payee, which the registry accepts.
    function test_registry_acceptsOneVaultPerResource() public {
        ResourceRegistry registry = new ResourceRegistry(factory);
        ResourceRegistry.PayeeAuth memory first = ResourceRegistry.PayeeAuth(alice, KEY, 0, "");
        ResourceRegistry.PayeeAuth memory second = ResourceRegistry.PayeeAuth(alice, keccak256("repo-2"), 0, "");
        vm.startPrank(alice);
        uint256 a = registry.registerResource(factory.vaultOf(alice, KEY), first, address(usdc), 10_000, "ipfs://a", 0);
        uint256 b = registry.registerResource(
            factory.vaultOf(alice, keccak256("repo-2")), second, address(usdc), 20_000, "ipfs://b", 0
        );
        vm.stopPrank();
        assertEq(registry.resourceOfPayee(factory.vaultOf(alice, KEY)), a);
        assertEq(registry.resourceOfPayee(factory.vaultOf(alice, keccak256("repo-2"))), b);
    }

    // ───────────── fuzz ─────────────

    function testFuzz_sweep_alwaysPaysTheBeneficiary(address beneficiary, bytes32 key, uint128 amount, address caller)
        public
    {
        vm.assume(beneficiary != address(0));
        address vault = factory.vaultOf(beneficiary, key);
        vm.assume(beneficiary != vault);
        uint256 before = usdc.balanceOf(beneficiary);
        usdc.mint(vault, amount);
        vm.prank(caller);
        factory.sweep(beneficiary, key, address(usdc));
        assertEq(usdc.balanceOf(beneficiary), before + amount);
        assertEq(usdc.balanceOf(vault), 0);
    }
}
