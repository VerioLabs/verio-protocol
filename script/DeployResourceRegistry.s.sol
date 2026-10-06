// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console2} from "forge-std/console2.sol";
import {PayeeVaultFactory} from "../src/PayeeVaultFactory.sol";
import {ResourceRegistry} from "../src/ResourceRegistry.sol";
import {DeploymentsFile} from "./DeploymentsFile.sol";

/// @notice Deploys ResourceRegistry through the canonical CREATE2 factory, then records it in
///         `deployments/<chainId>.json` next to any other contracts listed there. The registry takes the chain's
///         PayeeVaultFactory (read from that file) as its constructor argument, which is part of the init code: the
///         address is the same on every chain whose factory is (the factory itself is deployed the same way).
contract DeployResourceRegistry is DeploymentsFile {
    /// @dev v1 (`resource-registry.v1`) bound payees without their consent; it stays on Base Sepolia, unused.
    bytes32 internal constant SALT = keccak256("resource-registry.v2");

    /// @notice The chain's PayeeVaultFactory, from `deployments/<chainId>.json` (or the `PAYEE_VAULT_FACTORY` env
    ///         variable, which tests set); reverts when it is missing or has no code.
    function factory() public view returns (PayeeVaultFactory) {
        address fromEnv = vm.envOr("PAYEE_VAULT_FACTORY", address(0));
        if (fromEnv != address(0)) {
            require(fromEnv.code.length != 0, "PAYEE_VAULT_FACTORY has no code on this chain");
            return PayeeVaultFactory(fromEnv);
        }
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        require(vm.exists(path), "no deployments file for this chain");
        string memory json = vm.readFile(path);
        require(vm.keyExistsJson(json, ".payeeVaultFactory"), "deploy PayeeVaultFactory first");
        address f = vm.parseJsonAddress(json, ".payeeVaultFactory");
        require(f.code.length != 0, "PayeeVaultFactory has no code on this chain");
        return PayeeVaultFactory(f);
    }

    /// @notice The address `run()` will produce on this chain.
    function predict() public view returns (address) {
        bytes memory init = abi.encodePacked(type(ResourceRegistry).creationCode, abi.encode(factory()));
        return vm.computeCreate2Address(SALT, keccak256(init));
    }

    function run() external returns (ResourceRegistry registry) {
        PayeeVaultFactory f = factory();
        address predicted = predict();
        if (predicted.code.length != 0) {
            console2.log("ResourceRegistry already deployed at", predicted);
            return ResourceRegistry(predicted);
        }
        vm.startBroadcast();
        registry = new ResourceRegistry{salt: SALT}(f);
        vm.stopBroadcast();
        require(address(registry) == predicted, "unexpected address");
        require(address(registry.payeeVaultFactory()) == address(f), "unexpected factory");

        _record("resourceRegistry", address(registry), "resourceRegistryStartBlock");
        console2.log("ResourceRegistry deployed at", address(registry));
        console2.log("  with PayeeVaultFactory", address(f));
    }
}
