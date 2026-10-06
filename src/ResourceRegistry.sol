// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PayeeVaultFactory} from "./PayeeVaultFactory.sol";

/// @title ResourceRegistry
/// @notice Permissionless, immutable registry of paid resources for AI agents (models, tools, APIs, datasets,
///         compute) and of the agent wallets that use them. Payments do not pass through this contract: agents
///         pay each resource's `payee` directly (x402 settles USDC with `transferWithAuthorization`), so the
///         registry holds no funds and has no admin, fee, pause switch or upgrade path.
/// @dev A payee address is bound to one resource forever, including after the resource changes payee or is
///      deactivated, so every token transfer to a registered payee is attributable to exactly one resource from
///      logs alone. Because that binding attributes an address's income to a resource, an address is bound only
///      with the consent of whoever controls it: the payee itself, or the beneficiary of the PayeeVault it is.
///      Every call tolerates an ERC-8021 attribution suffix appended to calldata.
contract ResourceRegistry {
    /// @notice Thrown when a resource id does not exist.
    error UnknownResource();
    /// @notice Thrown when the caller does not own the resource.
    error NotResourceOwner();
    /// @notice Thrown when changing a resource that has been deactivated.
    error ResourceInactive();
    /// @notice Thrown when the payee is already bound to another resource.
    error PayeeTaken(uint256 resourceId);
    /// @notice Thrown when an address argument that must be set is zero.
    error ZeroAddress();
    /// @notice Thrown when an address registers as an agent twice.
    error AgentAlreadyRegistered();
    /// @notice Thrown when updating an agent that never registered.
    error AgentNotRegistered();
    /// @notice Thrown when `auth` names a beneficiary and key whose vault is not the payee.
    error NotVault();
    /// @notice Thrown when binding a payee the caller does not control, without a signed consent.
    error PayeeConsentRequired();
    /// @notice Thrown when a signed consent is past its deadline.
    error ConsentExpired();
    /// @notice Thrown when a signed consent's deadline is further away than `MAX_CONSENT_TTL`.
    error ConsentTooLong();
    /// @notice Thrown when a consent's signature is not the controller's.
    error BadSignature();
    /// @notice Thrown when accepting a resource the caller was not offered.
    error NotPendingOwner();

    /// @notice A registered resource.
    /// @param owner Address allowed to update, deactivate or transfer the resource.
    /// @param active False once deactivated; deactivation is final.
    /// @param payee Address that receives payments for calls to the resource.
    /// @param token ERC-20 the price is denominated in (USDC in v1).
    /// @param price Price per call in the token's smallest unit (USDC: 6 decimals).
    /// @param metadataHash Hash of the metadata document at `uri` (sha256 of the bytes by convention), or zero.
    /// @param uri Off-chain metadata: name, kind, endpoint, schema.
    struct Resource {
        address owner;
        bool active;
        address payee;
        address token;
        uint256 price;
        bytes32 metadataHash;
        string uri;
    }

    /// @notice How a payee's controller agrees to it being bound to a resource of `owner`.
    /// @param beneficiary Zero unless the payee is a PayeeVault: then the vault's beneficiary, its controller.
    /// @param key The vault's CREATE2 key, when it is one.
    /// @param deadline Last timestamp `signature` is valid at; ignored without a signature.
    /// @param signature Empty when the controller is the caller; otherwise the controller's EIP-712 signature of
    ///        `PayeeConsent(payee, owner, deadline)`, by ECDSA or, for a contract, ERC-1271.
    struct PayeeAuth {
        address beneficiary;
        bytes32 key;
        uint256 deadline;
        bytes signature;
    }

    /// @notice A resource was registered by `owner`.
    event ResourceRegistered(
        uint256 indexed resourceId,
        address indexed owner,
        address indexed payee,
        address token,
        uint256 price,
        string uri,
        bytes32 metadataHash
    );
    /// @notice A resource's payee, price or metadata changed; the token never changes.
    event ResourceUpdated(
        uint256 indexed resourceId, address indexed payee, uint256 price, string uri, bytes32 metadataHash
    );
    /// @notice A resource was deactivated for good.
    event ResourceDeactivated(uint256 indexed resourceId);
    /// @notice `from` offered a resource to `to`, who becomes owner by accepting it; `to` zero withdraws the offer.
    event ResourceTransferStarted(uint256 indexed resourceId, address indexed from, address indexed to);
    /// @notice Ownership of a resource moved from `from` to `to`.
    event ResourceTransferred(uint256 indexed resourceId, address indexed from, address indexed to);
    /// @notice `agent` declared itself an agent wallet; `uri` describes the agent and its operator.
    event AgentRegistered(address indexed agent, string uri);
    /// @notice A registered agent changed its description.
    event AgentUpdated(address indexed agent, string uri);

    /// @notice How long a signed consent may stay valid, at most.
    uint256 public constant MAX_CONSENT_TTL = 1 days;
    /// @notice EIP-712 type of a payee's consent.
    bytes32 public constant PAYEE_CONSENT_TYPEHASH =
        keccak256("PayeeConsent(address payee,address owner,uint256 deadline)");
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes4 private constant _ERC1271_MAGIC = 0x1626ba7e;
    /// @dev secp256k1n / 2: a larger `s` is the malleable twin of a valid signature.
    uint256 private constant _HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /// @notice The factory whose vaults `PayeeAuth.beneficiary` and `key` identify.
    PayeeVaultFactory public immutable payeeVaultFactory;
    uint256 private immutable _chainId;
    bytes32 private immutable _domainSeparator;

    /// @notice Number of resources ever registered; ids run from 1 to `totalResources`.
    uint256 public totalResources;
    /// @notice Number of resources currently active.
    uint256 public activeResources;
    /// @notice Number of registered agents.
    uint256 public totalAgents;
    /// @notice The resource a payee is bound to, or zero if the address has never been a payee.
    mapping(address => uint256) public resourceOfPayee;
    /// @notice Whether an address registered as an agent.
    mapping(address => bool) public isAgent;
    /// @notice Who a resource has been offered to, or zero.
    mapping(uint256 => address) public pendingOwnerOf;

    mapping(uint256 => Resource) private _resources;

    constructor(PayeeVaultFactory factory) {
        if (address(factory) == address(0)) revert ZeroAddress();
        payeeVaultFactory = factory;
        _chainId = block.chainid;
        _domainSeparator = _buildDomainSeparator();
    }

    /// @notice Register a resource owned by the caller.
    /// @param payee Address that receives payments; must not already be bound to a resource.
    /// @param auth The payee controller's consent; see `PayeeAuth`.
    /// @param token ERC-20 the price is denominated in.
    /// @param price Price per call in the token's smallest unit.
    /// @param uri Off-chain metadata location.
    /// @param metadataHash Hash of the metadata document, or zero.
    /// @return resourceId Sequential id, starting at 1.
    function registerResource(
        address payee,
        PayeeAuth calldata auth,
        address token,
        uint256 price,
        string calldata uri,
        bytes32 metadataHash
    ) external returns (uint256 resourceId) {
        if (token == address(0)) revert ZeroAddress();
        resourceId = ++totalResources;
        _bindPayee(payee, resourceId, auth);
        ++activeResources;
        _resources[resourceId] = Resource({
            owner: msg.sender,
            active: true,
            payee: payee,
            token: token,
            price: price,
            metadataHash: metadataHash,
            uri: uri
        });
        emit ResourceRegistered(resourceId, msg.sender, payee, token, price, uri, metadataHash);
    }

    /// @notice Change a resource's payee, price and metadata. Owner only, active resources only.
    /// @dev The previous payee stays bound to this resource, so it can be switched back (without a new consent)
    ///      but never reused elsewhere. A payee new to the resource needs `auth`.
    function updateResource(
        uint256 resourceId,
        address payee,
        PayeeAuth calldata auth,
        uint256 price,
        string calldata uri,
        bytes32 metadataHash
    ) external {
        Resource storage r = _ownedActive(resourceId);
        _bindPayee(payee, resourceId, auth);
        r.payee = payee;
        r.price = price;
        r.uri = uri;
        r.metadataHash = metadataHash;
        emit ResourceUpdated(resourceId, payee, price, uri, metadataHash);
    }

    /// @notice Deactivate a resource for good. Owner only. Its payee stays bound to it; a pending offer lapses.
    function deactivateResource(uint256 resourceId) external {
        Resource storage r = _ownedActive(resourceId);
        r.active = false;
        --activeResources;
        delete pendingOwnerOf[resourceId];
        emit ResourceDeactivated(resourceId);
    }

    /// @notice Offer a resource to `newOwner`, replacing any earlier offer; `address(0)` withdraws it. Owner only,
    ///         active resources only. Nothing changes until `newOwner` calls `acceptResource`.
    function transferResource(uint256 resourceId, address newOwner) external {
        _ownedActive(resourceId);
        pendingOwnerOf[resourceId] = newOwner;
        emit ResourceTransferStarted(resourceId, msg.sender, newOwner);
    }

    /// @notice Take a resource offered to the caller, and set its payee in the same step, so payments never keep
    ///         flowing to the previous owner's payee by default. Passing the current payee keeps it (and the
    ///         revenue with whoever controls it), with no consent needed.
    function acceptResource(uint256 resourceId, address payee, PayeeAuth calldata auth) external {
        Resource storage r = _existing(resourceId);
        if (!r.active) revert ResourceInactive();
        if (pendingOwnerOf[resourceId] != msg.sender) revert NotPendingOwner();
        delete pendingOwnerOf[resourceId];
        address from = r.owner;
        r.owner = msg.sender;
        emit ResourceTransferred(resourceId, from, msg.sender);
        if (payee != r.payee) {
            _bindPayee(payee, resourceId, auth);
            r.payee = payee;
            emit ResourceUpdated(resourceId, payee, r.price, r.uri, r.metadataHash);
        }
    }

    /// @notice Declare the caller an agent wallet, once.
    /// @param uri Description of the agent and its operator.
    function registerAgent(string calldata uri) external {
        if (isAgent[msg.sender]) revert AgentAlreadyRegistered();
        isAgent[msg.sender] = true;
        ++totalAgents;
        emit AgentRegistered(msg.sender, uri);
    }

    /// @notice Change the caller's agent description.
    function updateAgent(string calldata uri) external {
        if (!isAgent[msg.sender]) revert AgentNotRegistered();
        emit AgentUpdated(msg.sender, uri);
    }

    /// @notice A resource by id; reverts for an unknown id.
    function getResource(uint256 resourceId) external view returns (Resource memory) {
        return _existing(resourceId);
    }

    /// @notice The EIP-712 domain separator consents are signed under: name "ResourceRegistry", version "2",
    ///         this chain and this contract.
    function domainSeparator() public view returns (bytes32) {
        return block.chainid == _chainId ? _domainSeparator : _buildDomainSeparator();
    }

    /// @notice The digest a payee's controller signs to let `owner` bind `payee` until `deadline`.
    function payeeConsentDigest(address payee, address owner, uint256 deadline) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01", domainSeparator(), keccak256(abi.encode(PAYEE_CONSENT_TYPEHASH, payee, owner, deadline))
            )
        );
    }

    /// @dev Binds `payee` to `resourceId` for the caller, who is or becomes the resource's owner. A payee already
    ///      bound to this resource needs nothing; one bound elsewhere never moves; a new one needs consent.
    function _bindPayee(address payee, uint256 resourceId, PayeeAuth calldata auth) private {
        if (payee == address(0)) revert ZeroAddress();
        uint256 bound = resourceOfPayee[payee];
        if (bound == resourceId) return;
        if (bound != 0) revert PayeeTaken(bound);
        _checkConsent(payee, auth);
        resourceOfPayee[payee] = resourceId;
    }

    function _checkConsent(address payee, PayeeAuth calldata auth) private view {
        address controller = payee;
        if (auth.beneficiary != address(0)) {
            if (payeeVaultFactory.vaultOf(auth.beneficiary, auth.key) != payee) revert NotVault();
            controller = auth.beneficiary;
        }
        if (controller == msg.sender) return;
        if (auth.signature.length == 0) revert PayeeConsentRequired();
        if (block.timestamp > auth.deadline) revert ConsentExpired();
        if (auth.deadline > block.timestamp + MAX_CONSENT_TTL) revert ConsentTooLong();
        bytes32 digest = payeeConsentDigest(payee, msg.sender, auth.deadline);
        if (!_signedBy(controller, digest, auth.signature)) revert BadSignature();
    }

    /// @dev An ECDSA signature by `signer` (low `s` only), else, if `signer` has code, its ERC-1271 approval. ECDSA
    ///      is tried first so an EOA with EIP-7702 delegated code can still sign with its key.
    function _signedBy(address signer, bytes32 digest, bytes calldata signature) private view returns (bool) {
        if (signature.length == 65) {
            bytes32 r = bytes32(signature[0:32]);
            bytes32 s = bytes32(signature[32:64]);
            uint8 v = uint8(signature[64]);
            if (uint256(s) <= _HALF_N && (v == 27 || v == 28)) {
                address recovered = ecrecover(digest, v, r, s);
                if (recovered != address(0) && recovered == signer) return true;
            }
        }
        if (signer.code.length == 0) return false;
        (bool ok, bytes memory ret) = signer.staticcall(abi.encodeWithSelector(_ERC1271_MAGIC, digest, signature));
        return ok && ret.length >= 32 && abi.decode(ret, (bytes32)) == bytes32(_ERC1271_MAGIC);
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(_DOMAIN_TYPEHASH, keccak256("ResourceRegistry"), keccak256("2"), block.chainid, address(this))
        );
    }

    function _existing(uint256 resourceId) private view returns (Resource storage r) {
        r = _resources[resourceId];
        if (r.owner == address(0)) revert UnknownResource();
    }

    function _ownedActive(uint256 resourceId) private view returns (Resource storage r) {
        r = _existing(resourceId);
        if (r.owner != msg.sender) revert NotResourceOwner();
        if (!r.active) revert ResourceInactive();
    }
}
