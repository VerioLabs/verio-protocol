// generated from contracts/out/ProofOfContribution.sol/ProofOfContribution.json — regenerate after changing the contract
export const proofOfContributionAbi = [
  {
    type: 'function',
    name: 'checkIn',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'contributors',
    inputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'registeredAt',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'proofs',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'checkIns',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'lastCheckInDay',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isRegistered',
    inputs: [
      {
        name: 'who',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'prove',
    inputs: [
      {
        name: 'contentHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'register',
    inputs: [
      {
        name: 'referrer',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'totalContributors',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalProofs',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'CheckedIn',
    inputs: [
      {
        name: 'contributor',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'day',
        type: 'uint32',
        indexed: true,
        internalType: 'uint32',
      },
      {
        name: 'count',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Proved',
    inputs: [
      {
        name: 'contributor',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'contentHash',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'index',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      {
        name: 'contributor',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'referrer',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'AlreadyCheckedInToday',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AlreadyRegistered',
    inputs: [],
  },
  {
    type: 'error',
    name: 'SelfReferral',
    inputs: [],
  },
] as const

// generated from contracts/out/ResourceRegistry.sol/ResourceRegistry.json — regenerate after changing the contract
export const resourceRegistryAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'factory',
        type: 'address',
        internalType: 'contract PayeeVaultFactory',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'MAX_CONSENT_TTL',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'PAYEE_CONSENT_TYPEHASH',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'acceptResource',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'payee',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'auth',
        type: 'tuple',
        internalType: 'struct ResourceRegistry.PayeeAuth',
        components: [
          {
            name: 'beneficiary',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'key',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'deadline',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'signature',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'activeResources',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deactivateResource',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'domainSeparator',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getResource',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ResourceRegistry.Resource',
        components: [
          {
            name: 'owner',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'active',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'payee',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'token',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'price',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'metadataHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'uri',
            type: 'string',
            internalType: 'string',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isAgent',
    inputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'payeeConsentDigest',
    inputs: [
      {
        name: 'payee',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'owner',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'deadline',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'payeeVaultFactory',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract PayeeVaultFactory',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pendingOwnerOf',
    inputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'registerAgent',
    inputs: [
      {
        name: 'uri',
        type: 'string',
        internalType: 'string',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerResource',
    inputs: [
      {
        name: 'payee',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'auth',
        type: 'tuple',
        internalType: 'struct ResourceRegistry.PayeeAuth',
        components: [
          {
            name: 'beneficiary',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'key',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'deadline',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'signature',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'price',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'uri',
        type: 'string',
        internalType: 'string',
      },
      {
        name: 'metadataHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resourceOfPayee',
    inputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalAgents',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalResources',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transferResource',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'newOwner',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateAgent',
    inputs: [
      {
        name: 'uri',
        type: 'string',
        internalType: 'string',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateResource',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'payee',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'auth',
        type: 'tuple',
        internalType: 'struct ResourceRegistry.PayeeAuth',
        components: [
          {
            name: 'beneficiary',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'key',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'deadline',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'signature',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
      {
        name: 'price',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'uri',
        type: 'string',
        internalType: 'string',
      },
      {
        name: 'metadataHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      {
        name: 'agent',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'uri',
        type: 'string',
        indexed: false,
        internalType: 'string',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentUpdated',
    inputs: [
      {
        name: 'agent',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'uri',
        type: 'string',
        indexed: false,
        internalType: 'string',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ResourceDeactivated',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ResourceRegistered',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'owner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'payee',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'price',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'uri',
        type: 'string',
        indexed: false,
        internalType: 'string',
      },
      {
        name: 'metadataHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ResourceTransferStarted',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'from',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'to',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ResourceTransferred',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'from',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'to',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ResourceUpdated',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'payee',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'price',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'uri',
        type: 'string',
        indexed: false,
        internalType: 'string',
      },
      {
        name: 'metadataHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'AgentAlreadyRegistered',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AgentNotRegistered',
    inputs: [],
  },
  {
    type: 'error',
    name: 'BadSignature',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ConsentExpired',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ConsentTooLong',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotPendingOwner',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotResourceOwner',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotVault',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PayeeConsentRequired',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PayeeTaken',
    inputs: [
      {
        name: 'resourceId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ResourceInactive',
    inputs: [],
  },
  {
    type: 'error',
    name: 'UnknownResource',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ZeroAddress',
    inputs: [],
  },
] as const
