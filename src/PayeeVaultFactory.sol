// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Balance, PayeeVault} from "./PayeeVault.sol";

/// @title PayeeVaultFactory
/// @notice Gives each ResourceRegistry resource its own payee address without a deployment up front. The
///         registry binds a payee to one resource forever, so a seller with several resources needs several
///         payees; `vaultOf(beneficiary, key)` is one, usable as soon as it is computed. The vault is deployed on
///         its first sweep, so a resource that never sells costs nothing on chain.
/// @dev Stateless and permissionless: anyone may deploy or sweep any vault, and every vault pays only its
///      beneficiary. Every call tolerates an ERC-8021 attribution suffix appended to calldata.
contract PayeeVaultFactory {
    /// @notice Thrown when `sweepMany` gets arrays of different lengths.
    error LengthMismatch();

    /// @notice The vault for (`beneficiary`, `key`) was deployed at `vault`.
    event VaultDeployed(address indexed vault, address indexed beneficiary, bytes32 indexed key);

    /// @notice The vault address for `beneficiary` and `key`, whether or not it is deployed yet.
    /// @param key Any value the seller picks, one per resource (a random bytes32 by convention).
    function vaultOf(address beneficiary, bytes32 key) public view returns (address) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(PayeeVault).creationCode, abi.encode(beneficiary)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), key, initCodeHash)))));
    }

    /// @notice Deploy the vault for (`beneficiary`, `key`) unless it already has code. Returns its address either way.
    function deploy(address beneficiary, bytes32 key) public returns (address vault) {
        vault = vaultOf(beneficiary, key);
        if (vault.code.length == 0) {
            new PayeeVault{salt: key}(beneficiary);
            emit VaultDeployed(vault, beneficiary, key);
        }
    }

    /// @notice Deploy the vault if needed, then send its whole balance of `token` (zero address: ETH) to the
    ///         beneficiary.
    function sweep(address beneficiary, bytes32 key, address token) external returns (uint256) {
        return PayeeVault(payable(deploy(beneficiary, key))).sweep(token);
    }

    /// @notice `sweep` for many vaults at once. Vaults with a zero balance are skipped, and not deployed.
    function sweepMany(address[] calldata beneficiaries, bytes32[] calldata keys, address token) external {
        if (beneficiaries.length != keys.length) revert LengthMismatch();
        for (uint256 i; i < keys.length; ++i) {
            address vault = vaultOf(beneficiaries[i], keys[i]);
            uint256 balance = token == address(0) ? vault.balance : IERC20Balance(token).balanceOf(vault);
            if (balance == 0) continue;
            deploy(beneficiaries[i], keys[i]);
            PayeeVault(payable(vault)).sweep(token);
        }
    }
}
