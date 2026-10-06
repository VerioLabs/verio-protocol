// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ResourceRegistry} from "../src/ResourceRegistry.sol";
import {PayeeVaultFactory} from "../src/PayeeVaultFactory.sol";

/// @dev An ERC-1271 wallet that approves exactly the digests its owner key signed.
contract MockWallet {
    address internal immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 digest, bytes calldata sig) external view returns (bytes4) {
        (bytes32 r, bytes32 s) = abi.decode(sig[0:64], (bytes32, bytes32));
        return ecrecover(digest, uint8(sig[64]), r, s) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

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
    event ResourceTransferStarted(uint256 indexed resourceId, address indexed from, address indexed to);
    event ResourceTransferred(uint256 indexed resourceId, address indexed from, address indexed to);
    event AgentRegistered(address indexed agent, string uri);
    event AgentUpdated(address indexed agent, string uri);

    /// @dev ERC-8021 schema-0 suffix for the code "demo": codes ∥ len ∥ schemaId ∥ marker.
    bytes internal constant SUFFIX = hex"64656d6f" hex"04" hex"00" hex"80218021802180218021802180218021";
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    bytes32 internal constant META = keccak256("metadata");
    uint256 internal constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;
    uint256 internal constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    PayeeVaultFactory internal factory;
    ResourceRegistry internal registry;
    address internal alice;
    uint256 internal aliceKey;
    address internal bob;
    uint256 internal bobKey;
    address internal carol = makeAddr("carol");
    /// @dev EOA payees whose keys sign consents.
    address internal payA;
    uint256 internal payAKey;
    address internal payB;
    uint256 internal payBKey;

    function setUp() public {
        vm.warp(1_760_000_000);
        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
        (payA, payAKey) = makeAddrAndKey("payA");
        (payB, payBKey) = makeAddrAndKey("payB");
        factory = new PayeeVaultFactory();
        registry = new ResourceRegistry(factory);
    }

    // ───────────── helpers ─────────────

    function _none() internal pure returns (ResourceRegistry.PayeeAuth memory) {}

    function _vault(address beneficiary, bytes32 key) internal pure returns (ResourceRegistry.PayeeAuth memory a) {
        a.beneficiary = beneficiary;
        a.key = key;
    }

    function _sign(uint256 pk, address payee, address owner, uint256 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, registry.payeeConsentDigest(payee, owner, deadline));
        return abi.encodePacked(r, s, v);
    }

    /// @dev `controllerKey` consents to `owner` binding `payee`, valid for an hour.
    function _consent(uint256 controllerKey, address payee, address owner)
        internal
        view
        returns (ResourceRegistry.PayeeAuth memory a)
    {
        a.deadline = block.timestamp + 1 hours;
        a.signature = _sign(controllerKey, payee, owner, a.deadline);
    }

    /// @dev `owner` registers with the payee's own signed consent.
    function _register(address owner, address payee, uint256 payeeKey) internal returns (uint256 id) {
        ResourceRegistry.PayeeAuth memory a = _consent(payeeKey, payee, owner);
        vm.prank(owner);
        id = registry.registerResource(payee, a, USDC, 10_000, "ipfs://a", META);
    }

    function _registerA() internal returns (uint256) {
        return _register(alice, payA, payAKey);
    }

    // ───────────── registerResource ─────────────

    function test_register_storesResourceAndEmits() public {
        ResourceRegistry.PayeeAuth memory a = _consent(payAKey, payA, alice);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ResourceRegistered(1, alice, payA, USDC, 10_000, "ipfs://a", META);
        vm.prank(alice);
        uint256 id = registry.registerResource(payA, a, USDC, 10_000, "ipfs://a", META);

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
        assertEq(_registerA(), 1);
        assertEq(_register(bob, payB, payBKey), 2);
        assertEq(registry.totalResources(), 2);
    }

    function test_register_rejectsPayeeBoundToAnotherResource() public {
        _registerA();
        ResourceRegistry.PayeeAuth memory a = _consent(payAKey, payA, bob);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ResourceRegistry.PayeeTaken.selector, 1));
        registry.registerResource(payA, a, USDC, 1, "ipfs://b", bytes32(0));
    }

    function test_register_rejectsZeroPayeeOrToken() public {
        vm.startPrank(alice);
        vm.expectRevert(ResourceRegistry.ZeroAddress.selector);
        registry.registerResource(address(0), _none(), USDC, 1, "", bytes32(0));
        vm.expectRevert(ResourceRegistry.ZeroAddress.selector);
        registry.registerResource(alice, _none(), address(0), 1, "", bytes32(0));
        vm.stopPrank();
        assertEq(registry.totalResources(), 0);
    }

    function testFuzz_register_storesAnyPrice(uint256 price) public {
        vm.prank(alice);
        uint256 id = registry.registerResource(alice, _none(), USDC, price, "ipfs://a", META);
        assertEq(registry.getResource(id).price, price);
    }

    function test_register_toleratesBuilderCodeSuffix() public {
        bytes memory data =
            abi.encodeCall(ResourceRegistry.registerResource, (alice, _none(), USDC, 5, "ipfs://a", META));
        vm.prank(alice);
        (bool ok, bytes memory ret) = address(registry).call(bytes.concat(data, SUFFIX));
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint256)), 1);
        assertEq(registry.getResource(1).owner, alice);
    }

    function test_register_toleratesBuilderCodeSuffixAfterASignature() public {
        ResourceRegistry.PayeeAuth memory a = _consent(payAKey, payA, alice);
        bytes memory data = abi.encodeCall(ResourceRegistry.registerResource, (payA, a, USDC, 5, "ipfs://a", META));
        vm.prank(alice);
        (bool ok,) = address(registry).call(bytes.concat(data, SUFFIX));
        assertTrue(ok);
        assertEq(registry.resourceOfPayee(payA), 1);
    }

    // ───────────── payee consent ─────────────

    function test_consent_callerAsPayeeNeedsNoSignature() public {
        vm.prank(alice);
        uint256 id = registry.registerResource(alice, _none(), USDC, 1, "", bytes32(0));
        assertEq(registry.resourceOfPayee(alice), id);
    }

    function test_consent_ownVaultNeedsNoSignature() public {
        bytes32 key = keccak256("repo");
        address vault = factory.vaultOf(alice, key);
        vm.prank(alice);
        uint256 id = registry.registerResource(vault, _vault(alice, key), USDC, 1, "", bytes32(0));
        assertEq(registry.resourceOfPayee(vault), id);
        assertEq(vault.code.length, 0);
    }

    function test_consent_rejectsAnAddressTheCallerDoesNotControl() public {
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.PayeeConsentRequired.selector);
        registry.registerResource(payA, _none(), USDC, 1, "", bytes32(0));
        assertEq(registry.resourceOfPayee(payA), 0);
    }

    function test_consent_rejectsAnotherBeneficiarysVaultWithoutSignature() public {
        bytes32 key = keccak256("repo");
        address vault = factory.vaultOf(alice, key);
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.PayeeConsentRequired.selector);
        registry.registerResource(vault, _vault(alice, key), USDC, 1, "", bytes32(0));
        // Nor can bob claim the vault is his: it does not derive from his address.
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.NotVault.selector);
        registry.registerResource(vault, _vault(bob, key), USDC, 1, "", bytes32(0));
    }

    function test_consent_rejectsAWrongKey() public {
        address vault = factory.vaultOf(alice, keccak256("repo"));
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.NotVault.selector);
        registry.registerResource(vault, _vault(alice, keccak256("other")), USDC, 1, "", bytes32(0));
    }

    function test_consent_signedByAnEoaPayee() public {
        assertEq(_register(bob, payA, payAKey), 1);
        assertEq(registry.getResource(1).owner, bob);
    }

    function test_consent_signedByAVaultBeneficiary() public {
        bytes32 key = keccak256("repo");
        address vault = factory.vaultOf(alice, key);
        ResourceRegistry.PayeeAuth memory a = _consent(aliceKey, vault, bob);
        a.beneficiary = alice;
        a.key = key;
        vm.prank(bob);
        uint256 id = registry.registerResource(vault, a, USDC, 1, "", bytes32(0));
        assertEq(registry.resourceOfPayee(vault), id);
    }

    function test_consent_signedByAnErc1271Wallet() public {
        MockWallet wallet = new MockWallet(alice);
        ResourceRegistry.PayeeAuth memory a = _consent(aliceKey, address(wallet), bob);
        vm.prank(bob);
        uint256 id = registry.registerResource(address(wallet), a, USDC, 1, "", bytes32(0));
        assertEq(registry.resourceOfPayee(address(wallet)), id);

        // A vault whose beneficiary is that wallet.
        bytes32 key = keccak256("repo");
        address vault = factory.vaultOf(address(wallet), key);
        a = _consent(aliceKey, vault, bob);
        a.beneficiary = address(wallet);
        a.key = key;
        vm.prank(bob);
        registry.registerResource(vault, a, USDC, 1, "", bytes32(0));
        assertEq(registry.resourceOfPayee(vault), 2);
    }

    function test_consent_rejectsAnErc1271WalletThatDeclines() public {
        MockWallet wallet = new MockWallet(alice);
        ResourceRegistry.PayeeAuth memory a = _consent(bobKey, address(wallet), bob);
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.BadSignature.selector);
        registry.registerResource(address(wallet), a, USDC, 1, "", bytes32(0));
    }

    function test_consent_isForOneOwnerOnly() public {
        // payA consents to alice; bob cannot use it.
        ResourceRegistry.PayeeAuth memory a = _consent(payAKey, payA, alice);
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.BadSignature.selector);
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));
    }

    function test_consent_aFrontRunnerCopyingItStillMakesTheSellerTheOwner() public {
        // carol copies alice's pending transaction: the consent names alice, so it only works for alice.
        ResourceRegistry.PayeeAuth memory a = _consent(payAKey, payA, alice);
        vm.prank(carol);
        vm.expectRevert(ResourceRegistry.BadSignature.selector);
        registry.registerResource(payA, a, USDC, 1, "ipfs://evil", bytes32(0));
        vm.prank(alice);
        uint256 id = registry.registerResource(payA, a, USDC, 1, "ipfs://a", bytes32(0));
        assertEq(registry.getResource(id).owner, alice);
    }

    function test_consent_rejectsWrongSigner() public {
        ResourceRegistry.PayeeAuth memory a = _consent(payBKey, payA, alice);
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.BadSignature.selector);
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));
    }

    function test_consent_isBoundToThisRegistryAndChain() public {
        ResourceRegistry other = new ResourceRegistry(factory);
        ResourceRegistry.PayeeAuth memory a;
        a.deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payAKey, other.payeeConsentDigest(payA, alice, a.deadline));
        a.signature = abi.encodePacked(r, s, v);
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.BadSignature.selector);
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));

        // Signed here, then replayed on another chain id.
        a = _consent(payAKey, payA, alice);
        vm.chainId(8453);
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.BadSignature.selector);
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));
    }

    function test_consent_deadline() public {
        // Past its deadline.
        ResourceRegistry.PayeeAuth memory a = _consent(payAKey, payA, alice);
        vm.warp(a.deadline + 1);
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.ConsentExpired.selector);
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));

        // Further away than the cap.
        a = _consentAt(payAKey, payA, alice, block.timestamp + registry.MAX_CONSENT_TTL() + 1);
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.ConsentTooLong.selector);
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));

        // Exactly at the cap is valid, up to and including the deadline itself.
        a = _consentAt(payAKey, payA, alice, block.timestamp + registry.MAX_CONSENT_TTL());
        vm.warp(a.deadline);
        vm.prank(alice);
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));
        assertEq(registry.resourceOfPayee(payA), 1);
    }

    function _consentAt(uint256 pk, address payee, address owner, uint256 deadline)
        internal
        view
        returns (ResourceRegistry.PayeeAuth memory a)
    {
        a.deadline = deadline;
        a.signature = _sign(pk, payee, owner, deadline);
    }

    function test_consent_rejectsHighSAndMalformedSignatures() public {
        ResourceRegistry.PayeeAuth memory a;
        a.deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payAKey, registry.payeeConsentDigest(payA, alice, a.deadline));
        assertLe(uint256(s), HALF_N);
        // The malleable twin recovers the same signer; it must still be refused.
        a.signature = abi.encodePacked(r, bytes32(N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.BadSignature.selector);
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));

        a.signature = abi.encodePacked(r, s);
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.BadSignature.selector);
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));
    }

    function testFuzz_consent_bindingWithoutAValidAuthorizationReverts(
        address payee,
        address beneficiary,
        bytes32 key,
        uint256 deadline,
        bytes memory signature
    ) public {
        vm.assume(payee != address(0) && payee != carol && beneficiary != carol);
        vm.assume(payee.code.length == 0 && beneficiary.code.length == 0);
        ResourceRegistry.PayeeAuth memory a = ResourceRegistry.PayeeAuth(beneficiary, key, deadline, signature);
        vm.prank(carol);
        try registry.registerResource(payee, a, USDC, 1, "", bytes32(0)) {
            fail();
        } catch {}
        assertEq(registry.resourceOfPayee(payee), 0);
    }

    // ───────────── updateResource ─────────────

    function test_update_changesFieldsAndEmits() public {
        uint256 id = _registerA();
        ResourceRegistry.PayeeAuth memory a = _consent(payBKey, payB, alice);
        vm.expectEmit(true, true, false, true, address(registry));
        emit ResourceUpdated(id, payB, 20_000, "ipfs://b", bytes32(0));
        vm.prank(alice);
        registry.updateResource(id, payB, a, 20_000, "ipfs://b", bytes32(0));

        ResourceRegistry.Resource memory r = registry.getResource(id);
        assertEq(r.payee, payB);
        assertEq(r.price, 20_000);
        assertEq(r.uri, "ipfs://b");
        assertEq(r.metadataHash, bytes32(0));
        assertEq(r.token, USDC);
        assertEq(registry.resourceOfPayee(payB), id);
    }

    function test_update_newPayeeNeedsConsent() public {
        uint256 id = _registerA();
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.PayeeConsentRequired.selector);
        registry.updateResource(id, payB, _none(), 1, "", bytes32(0));
    }

    function test_update_oldPayeeStaysBoundAndCanBeSwitchedBackWithoutConsent() public {
        uint256 id = _registerA();
        vm.startPrank(alice);
        registry.updateResource(id, alice, _none(), 1, "", bytes32(0));
        assertEq(registry.resourceOfPayee(payA), id);
        // The same payee again needs nothing either.
        registry.updateResource(id, payA, _none(), 1, "", bytes32(0));
        vm.stopPrank();
        assertEq(registry.getResource(id).payee, payA);

        ResourceRegistry.PayeeAuth memory a = _consent(payAKey, payA, bob);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ResourceRegistry.PayeeTaken.selector, id));
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));
    }

    function test_update_rejectsPayeeOfAnotherResource() public {
        uint256 a = _registerA();
        uint256 b = _register(bob, payB, payBKey);
        ResourceRegistry.PayeeAuth memory auth = _consent(payBKey, payB, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ResourceRegistry.PayeeTaken.selector, b));
        registry.updateResource(a, payB, auth, 1, "", bytes32(0));
    }

    function test_update_rejectsNonOwner() public {
        uint256 id = _registerA();
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.NotResourceOwner.selector);
        registry.updateResource(id, payA, _none(), 1, "", bytes32(0));
    }

    function test_update_rejectsUnknownResource() public {
        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.UnknownResource.selector);
        registry.updateResource(1, alice, _none(), 1, "", bytes32(0));
    }

    function test_update_rejectsInactiveResource() public {
        uint256 id = _registerA();
        vm.startPrank(alice);
        registry.deactivateResource(id);
        vm.expectRevert(ResourceRegistry.ResourceInactive.selector);
        registry.updateResource(id, payA, _none(), 1, "", bytes32(0));
        vm.stopPrank();
    }

    // ───────────── deactivateResource ─────────────

    function test_deactivate_isFinalAndKeepsPayeeBound() public {
        uint256 id = _registerA();
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

        ResourceRegistry.PayeeAuth memory a = _consent(payAKey, payA, bob);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ResourceRegistry.PayeeTaken.selector, id));
        registry.registerResource(payA, a, USDC, 1, "", bytes32(0));
    }

    function test_deactivate_rejectsNonOwner() public {
        uint256 id = _registerA();
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.NotResourceOwner.selector);
        registry.deactivateResource(id);
    }

    function test_deactivate_clearsAPendingTransfer() public {
        uint256 id = _registerA();
        vm.startPrank(alice);
        registry.transferResource(id, bob);
        registry.deactivateResource(id);
        vm.stopPrank();
        assertEq(registry.pendingOwnerOf(id), address(0));
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.ResourceInactive.selector);
        registry.acceptResource(id, bob, _none());
    }

    // ───────────── transferResource / acceptResource ─────────────

    function test_transfer_onlyOffersUntilAccepted() public {
        uint256 id = _registerA();
        vm.expectEmit(true, true, true, false, address(registry));
        emit ResourceTransferStarted(id, alice, bob);
        vm.prank(alice);
        registry.transferResource(id, bob);
        assertEq(registry.pendingOwnerOf(id), bob);
        assertEq(registry.getResource(id).owner, alice);
        // Still alice's to change meanwhile.
        vm.prank(alice);
        registry.updateResource(id, payA, _none(), 2, "", bytes32(0));
    }

    function test_accept_withANewVaultMovesOwnerAndPayeeTogether() public {
        uint256 id = _registerA();
        vm.prank(alice);
        registry.transferResource(id, bob);

        bytes32 key = keccak256("bob's vault");
        address vault = factory.vaultOf(bob, key);
        vm.expectEmit(true, true, true, false, address(registry));
        emit ResourceTransferred(id, alice, bob);
        vm.expectEmit(true, true, false, true, address(registry));
        emit ResourceUpdated(id, vault, 10_000, "ipfs://a", META);
        vm.prank(bob);
        registry.acceptResource(id, vault, _vault(bob, key));

        ResourceRegistry.Resource memory r = registry.getResource(id);
        assertEq(r.owner, bob);
        assertEq(r.payee, vault);
        assertEq(registry.pendingOwnerOf(id), address(0));
        assertEq(registry.resourceOfPayee(vault), id);
        assertEq(registry.resourceOfPayee(payA), id);

        vm.prank(alice);
        vm.expectRevert(ResourceRegistry.NotResourceOwner.selector);
        registry.updateResource(id, payA, _none(), 1, "", bytes32(0));
    }

    function test_accept_keepingTheCurrentPayeeIsExplicitAndNeedsNoConsent() public {
        uint256 id = _registerA();
        vm.prank(alice);
        registry.transferResource(id, bob);
        vm.recordLogs();
        vm.prank(bob);
        registry.acceptResource(id, payA, _none());
        assertEq(vm.getRecordedLogs().length, 1); // ResourceTransferred only
        assertEq(registry.getResource(id).owner, bob);
        assertEq(registry.getResource(id).payee, payA);
    }

    function test_accept_aPayeeTheNewOwnerDoesNotControlNeedsConsent() public {
        uint256 id = _registerA();
        vm.prank(alice);
        registry.transferResource(id, bob);
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.PayeeConsentRequired.selector);
        registry.acceptResource(id, payB, _none());
        ResourceRegistry.PayeeAuth memory a = _consent(payBKey, payB, bob);
        vm.prank(bob);
        registry.acceptResource(id, payB, a);
        assertEq(registry.getResource(id).payee, payB);
    }

    function test_accept_rejectsStrangersAndCancelledOrReplacedOffers() public {
        uint256 id = _registerA();
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.NotPendingOwner.selector);
        registry.acceptResource(id, bob, _none());

        vm.startPrank(alice);
        registry.transferResource(id, bob);
        registry.transferResource(id, carol);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.NotPendingOwner.selector);
        registry.acceptResource(id, bob, _none());

        vm.expectEmit(true, true, true, false, address(registry));
        emit ResourceTransferStarted(id, alice, address(0));
        vm.prank(alice);
        registry.transferResource(id, address(0));
        vm.prank(carol);
        vm.expectRevert(ResourceRegistry.NotPendingOwner.selector);
        registry.acceptResource(id, carol, _none());
        assertEq(registry.getResource(id).owner, alice);
    }

    function test_accept_rejectsUnknownResource() public {
        vm.prank(bob);
        vm.expectRevert(ResourceRegistry.UnknownResource.selector);
        registry.acceptResource(1, bob, _none());
    }

    function test_transfer_rejectsNonOwnerAndInactive() public {
        uint256 id = _registerA();
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

    // ───────────── constructor ─────────────

    function test_constructor_rejectsZeroFactory() public {
        vm.expectRevert(ResourceRegistry.ZeroAddress.selector);
        new ResourceRegistry(PayeeVaultFactory(address(0)));
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
