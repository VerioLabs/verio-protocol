// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console2} from "forge-std/console2.sol";
import {PayeeVaultFactory} from "../src/PayeeVaultFactory.sol";
import {DeploymentsFile} from "./DeploymentsFile.sol";

/// @notice Deploys PayeeVaultFactory through the canonical CREATE2 factory so the address — and so every vault
///         address it predicts — is identical on every chain, then records it in `deployments/<chainId>.json`.
contract DeployPayeeVaultFactory is DeploymentsFile {
    bytes32 internal constant SALT = keccak256("payee-vault-factory.v1");

    /// @notice The address `run()` will produce on any chain with the canonical CREATE2 factory.
    function predict() public pure returns (address) {
        return vm.computeCreate2Address(SALT, keccak256(type(PayeeVaultFactory).creationCode));
    }

    function run() external returns (PayeeVaultFactory factory) {
        address predicted = predict();
        if (predicted.code.length != 0) {
            console2.log("PayeeVaultFactory already deployed at", predicted);
            return PayeeVaultFactory(predicted);
        }
        vm.startBroadcast();
        factory = new PayeeVaultFactory{salt: SALT}();
        vm.stopBroadcast();
        require(address(factory) == predicted, "unexpected address");

        // Vault addresses are computed, not indexed from events, so no start block is recorded.
        _record("payeeVaultFactory", address(factory), "");
        console2.log("PayeeVaultFactory deployed at", address(factory));
    }
}
