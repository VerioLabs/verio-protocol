// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ResourceRegistry} from "../src/ResourceRegistry.sol";

contract ResourceRegistryTest is Test {
    event ResourceRegistered(
        uint256 indexed resourceId,
        address indexed owner,
        address indexed payee,
        address token,
        uint256 price,
        string uri,
        bytes32 metadataHash
    );
    event ResourceUpdated(
        uint256 indexed resourceId, address indexed payee, uint256 price, string uri, bytes32 metadataHash
    );
    event ResourceDeactivated(uint256 indexed resourceId);
    event ResourceTransferred(uint256 indexed resourceId, address indexed from, address indexed to);
    event AgentRegistered(address indexed agent, string uri);
    event AgentUpdated(address indexed agent, string uri);

    /// @dev ERC-8021 schema-0 suffix for the code "demo": codes ∥ len ∥ schemaId ∥ marker.
    bytes internal constant SUFFIX = hex"64656d6f" hex"04" hex"00" hex"80218021802180218021802180218021";
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    bytes32 internal constant META = keccak256("metadata");

    ResourceRegistry internal registry;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal payA = makeAddr("payA");
    address internal payB = makeAddr("payB");

    function setUp() public {
        registry = new ResourceRegistry();
    }

    function _register(address owner, address payee) internal returns (uint256 id) {
        vm.prank(owner);
        id = registry.registerResource(payee, USDC, 10_000, "ipfs://a", META);
    }

    // ───────────── registerResource ─────────────

    function test_register_storesResourceAndEmits() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit ResourceRegistered(1, alice, payA, USDC, 10_000, "ipfs://a", META);
        uint256 id = _register(alice, payA);

        assertEq(id, 1);
        ResourceRegistry.Resource memory r = registry.getResource(id);
        assertEq(r.owner, alice);
        assertTrue(r.active);
        assertEq(r.payee, payA);
        assertEq(r.token, USDC);
        assertEq(r.price, 10_000);
        assertEq(r.metadataHash, META);
        assertEq(r.uri, "ipfs://a");
        assertEq(registry.resourceOfPayee(payA), 1);
        assertEq(registry.totalResources(), 1);
        assertEq(registry.activeResources(), 1);
    }

    function test_register_idsAreSequential() public {
        assertEq(_register(alice, payA), 1);
        assertEq(_register(bob, payB), 2);
        assertEq(registry.totalResources(), 2);
    }

    function test_register_rejectsPayeeBoundToAnotherResource() public {
        _register(alice, payA);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ResourceRegistry.PayeeTaken.selector, 1));
        registry.registerResource(payA, USDC, 1, "ipfs://b", bytes32(0));
    }

    function test_register_rejectsZeroPayeeOrToken() public {
        vm.startPrank(alice);
        vm.expectRevert(ResourceRegistry.ZeroAddress.selector);
        registry.registerResource(address(0), USDC, 1, "", bytes32(0));
        vm.expectRevert(ResourceRegistry.ZeroAddress.selector);
        registry.registerResource(payA, address(0), 1, "", bytes32(0));
        vm.stopPrank();
        assertEq(registry.totalResources(), 0);
    }

    function testFuzz_register_storesAnyPrice(uint256 price) public {
        vm.prank(alice);
        uint256 id = registry.registerResource(payA, USDC, price, "ipfs://a", META);
        assertEq(registry.getResource(id).price, price);
    }

    function test_register_toleratesBuilderCodeSuffix() public {
        bytes memory data = abi.encodeCall(ResourceRegistry.registerResource, (payA, USDC, 5, "ipfs://a", META));
        vm.prank(alice);
        (bool ok, bytes memory ret) = address(registry).call(bytes.concat(data, SUFFIX));
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint256)), 1);
        assertEq(registry.getResource(1).owner, alice);
    }

    // ───────────── updateResource ─────────────

    function test_update_changesFieldsAndEmits() public {
        uint256 id = _register(alice, payA);
        vm.expectEmit(true, true, false, true, address(registry));
        emit ResourceUpdated(id, payB, 20_000, "ipfs://b", bytes32(0));
        vm.prank(alice);
        registry.updateResource(id, payB, 20_000, "ipfs://b", bytes32(0));

        ResourceRegistry.Resource memory r = registry.getResource(id);
        assertEq(r.payee, payB);
        assertEq(r.price, 20_000);
        assertEq(r.uri, "ipfs://b");
        assertEq(r.metadataHash, bytes32(0));
        assertEq(r.token, USDC);
        assertEq(registry.resourceOfPayee(payB), id);
    }

    function test_update_oldPayeeStaysBoundAndCanBeSwitchedBack() public {
        uint256 id = _register(alice, payA);
        vm.prank(alice);
        registry.updateResource(id, payB, 1, "", bytes32(0));
        assertEq(registry.resourceOfPayee(payA), id);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ResourceRegistry.PayeeTaken.selector, id));
        registry.registerResource(payA, USDC, 1, "", bytes32(0));

        vm.prank(alice);
        registry.updateResource(id, payA, 1, "", bytes32(0));
        assertEq(registry.getResource(id).payee, payA);
    }

    function test_update_rejectsPayeeOfAnotherResource() public {
        uint256 a = _register(alice, payA);
        uint256 b = _register(bob, payB);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ResourceRegistry.PayeeTaken.selector, b));
        registry.updateResource(a, payB, 1, "", bytes32(0));
    }

    function test_update_rejectsNonOwner() public {
        uint256 id = _register(alice, payA);
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.NotResourceOwner.selector);
        registry.updateResource(id, payA, 1, "", bytes32(0));
    }

    function test_update_rejectsUnknownResource() public {
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.UnknownResource.selector);
        registry.updateResource(1, payA, 1, "", bytes32(0));
    }

    function test_update_rejectsInactiveResource() public {
        uint256 id = _register(alice, payA);
        vm.startPrank(alice);
        registry.deactivateResource(id);
        vm.expectRevert(ResourceRegistry.ResourceInactive.selector);
        registry.updateResource(id, payA, 1, "", bytes32(0));
        vm.stopPrank();
    }

    // ───────────── deactivateResource ─────────────

    function test_deactivate_isFinalAndKeepsPayeeBound() public {
        uint256 id = _register(alice, payA);
        vm.expectEmit(true, false, false, false, address(registry));
        emit ResourceDeactivated(id);
        vm.prank(alice);
        registry.deactivateResource(id);

        assertFalse(registry.getResource(id).active);
        assertEq(registry.activeResources(), 0);
        assertEq(registry.totalResources(), 1);
        assertEq(registry.resourceOfPayee(payA), id);

        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.ResourceInactive.selector);
        registry.deactivateResource(id);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ResourceRegistry.PayeeTaken.selector, id));
        registry.registerResource(payA, USDC, 1, "", bytes32(0));
    }

    function test_deactivate_rejectsNonOwner() public {
        uint256 id = _register(alice, payA);
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.NotResourceOwner.selector);
        registry.deactivateResource(id);
    }

    // ───────────── transferResource ─────────────

    function test_transfer_movesOwnershipAndEmits() public {
        uint256 id = _register(alice, payA);
        vm.expectEmit(true, true, true, false, address(registry));
        emit ResourceTransferred(id, alice, bob);
        vm.prank(alice);
        registry.transferResource(id, bob);
        assertEq(registry.getResource(id).owner, bob);

        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.NotResourceOwner.selector);
        registry.updateResource(id, payA, 1, "", bytes32(0));
        vm.prank(bob);
        registry.updateResource(id, payA, 1, "", bytes32(0));
    }

    function test_transfer_rejectsZeroNonOwnerAndInactive() public {
        uint256 id = _register(alice, payA);
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.ZeroAddress.selector);
        registry.transferResource(id, address(0));

        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.NotResourceOwner.selector);
        registry.transferResource(id, bob);

        vm.startPrank(alice);
        registry.deactivateResource(id);
        vm.expectRevert(ResourceRegistry.ResourceInactive.selector);
        registry.transferResource(id, bob);
        vm.stopPrank();
    }

    // ───────────── getResource ─────────────

    function test_getResource_revertsForUnknownId() public {
        vm.expectRevert(ResourceRegistry.UnknownResource.selector);
        registry.getResource(0);
        vm.expectRevert(ResourceRegistry.UnknownResource.selector);
        registry.getResource(1);
    }

    // ───────────── agents ─────────────

    function test_registerAgent_onceThenUpdate() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentRegistered(alice, "https://agent.example");
        vm.startPrank(alice);
        registry.registerAgent("https://agent.example");
        assertTrue(registry.isAgent(alice));
        assertEq(registry.totalAgents(), 1);

        vm.expectRevert(ResourceRegistry.AgentAlreadyRegistered.selector);
        registry.registerAgent("again");

        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentUpdated(alice, "https://agent.example/v2");
        registry.updateAgent("https://agent.example/v2");
        vm.stopPrank();
        assertEq(registry.totalAgents(), 1);
    }

    function test_updateAgent_rejectsUnregistered() public {
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.AgentNotRegistered.selector);
        registry.updateAgent("x");
    }

    // ───────────── no funds ─────────────

    function test_rejectsEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(registry).call{value: 1}("");
        assertFalse(ok);
        vm.prank(alice);
        (ok,) = address(registry).call{value: 1}(abi.encodeCall(ResourceRegistry.registerAgent, ("x")));
        assertFalse(ok);
        assertEq(address(registry).balance, 0);
    }
}
