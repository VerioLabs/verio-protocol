// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ResourceRegistry
/// @notice Permissionless, immutable registry of paid resources for AI agents (models, tools, APIs, datasets,
///         compute) and of the agent wallets that use them. Payments do not pass through this contract: agents
///         pay each resource's `payee` directly (x402 settles USDC with `transferWithAuthorization`), so the
///         registry holds no funds and has no admin, fee, pause switch or upgrade path.
/// @dev A payee address is bound to one resource forever, including after the resource changes payee or is
///      deactivated, so every token transfer to a registered payee is attributable to exactly one resource from
///      logs alone. Every call tolerates an ERC-8021 attribution suffix appended to calldata.
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
    /// @notice Ownership of a resource moved from `from` to `to`.
    event ResourceTransferred(uint256 indexed resourceId, address indexed from, address indexed to);
    /// @notice `agent` declared itself an agent wallet; `uri` describes the agent and its operator.
    event AgentRegistered(address indexed agent, string uri);
    /// @notice A registered agent changed its description.
    event AgentUpdated(address indexed agent, string uri);

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

    mapping(uint256 => Resource) private _resources;

    /// @notice Register a resource owned by the caller.
    /// @param payee Address that receives payments; must not already be bound to a resource.
    /// @param token ERC-20 the price is denominated in.
    /// @param price Price per call in the token's smallest unit.
    /// @param uri Off-chain metadata location.
    /// @param metadataHash Hash of the metadata document, or zero.
    /// @return resourceId Sequential id, starting at 1.
    function registerResource(address payee, address token, uint256 price, string calldata uri, bytes32 metadataHash)
        external
        returns (uint256 resourceId)
    {
        if (token == address(0)) revert ZeroAddress();
        resourceId = ++totalResources;
        _bindPayee(payee, resourceId);
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
    /// @dev The previous payee stays bound to this resource, so it can be switched back but never reused elsewhere.
    function updateResource(uint256 resourceId, address payee, uint256 price, string calldata uri, bytes32 metadataHash)
        external
    {
        Resource storage r = _ownedActive(resourceId);
        _bindPayee(payee, resourceId);
        r.payee = payee;
        r.price = price;
        r.uri = uri;
        r.metadataHash = metadataHash;
        emit ResourceUpdated(resourceId, payee, price, uri, metadataHash);
    }

    /// @notice Deactivate a resource for good. Owner only. Its payee stays bound to it.
    function deactivateResource(uint256 resourceId) external {
        Resource storage r = _ownedActive(resourceId);
        r.active = false;
        --activeResources;
        emit ResourceDeactivated(resourceId);
    }

    /// @notice Hand a resource to a new owner. Owner only, active resources only.
    function transferResource(uint256 resourceId, address newOwner) external {
        if (newOwner == address(0)) revert ZeroAddress();
        Resource storage r = _ownedActive(resourceId);
        r.owner = newOwner;
        emit ResourceTransferred(resourceId, msg.sender, newOwner);
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

    function _bindPayee(address payee, uint256 resourceId) private {
        if (payee == address(0)) revert ZeroAddress();
        uint256 bound = resourceOfPayee[payee];
        if (bound == 0) resourceOfPayee[payee] = resourceId;
        else if (bound != resourceId) revert PayeeTaken(bound);
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
