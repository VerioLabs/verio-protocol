// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console2} from "forge-std/console2.sol";
import {ProofOfContribution} from "../src/ProofOfContribution.sol";
import {DeploymentsFile} from "./DeploymentsFile.sol";

/// @notice Deploys ProofOfContribution through the canonical CREATE2 factory so the address is identical on
///         every chain, then records it in `deployments/<chainId>.json` next to any other contracts listed there.
contract Deploy is DeploymentsFile {
    bytes32 internal constant SALT = keccak256("proof-of-contribution.v1");

    /// @notice The address `run()` will produce on any chain with the canonical CREATE2 factory.
    function predict() public pure returns (address) {
        return vm.computeCreate2Address(SALT, keccak256(type(ProofOfContribution).creationCode));
    }

    function run() external returns (ProofOfContribution proof) {
        address predicted = predict();
        if (predicted.code.length != 0) {
            console2.log("ProofOfContribution already deployed at", predicted);
            return ProofOfContribution(predicted);
        }
        vm.startBroadcast();
        proof = new ProofOfContribution{salt: SALT}();
        vm.stopBroadcast();
        require(address(proof) == predicted, "unexpected address");

        _record("proofOfContribution", address(proof), "startBlock");
        console2.log("ProofOfContribution deployed at", address(proof));
    }
}
