// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console2} from "forge-std/console2.sol";
import {ResourceRegistry} from "../src/ResourceRegistry.sol";
import {DeploymentsFile} from "./DeploymentsFile.sol";

/// @notice Deploys ResourceRegistry through the canonical CREATE2 factory so the address is identical on every
///         chain, then records it in `deployments/<chainId>.json` next to any other contracts listed there.
contract DeployResourceRegistry is DeploymentsFile {
    bytes32 internal constant SALT = keccak256("resource-registry.v1");

    /// @notice The address `run()` will produce on any chain with the canonical CREATE2 factory.
    function predict() public pure returns (address) {
        return vm.computeCreate2Address(SALT, keccak256(type(ResourceRegistry).creationCode));
    }

    function run() external returns (ResourceRegistry registry) {
        address predicted = predict();
        if (predicted.code.length != 0) {
            console2.log("ResourceRegistry already deployed at", predicted);
            return ResourceRegistry(predicted);
        }
        vm.startBroadcast();
        registry = new ResourceRegistry{salt: SALT}();
        vm.stopBroadcast();
        require(address(registry) == predicted, "unexpected address");

        _record("resourceRegistry", address(registry), "resourceRegistryStartBlock");
        console2.log("ResourceRegistry deployed at", address(registry));
    }
}
