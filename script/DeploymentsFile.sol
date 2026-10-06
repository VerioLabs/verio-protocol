// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

/// @notice Records a contract in `deployments/<chainId>.json` without dropping the other contracts already listed
///         there. The file holds only the keys listed in `_record`; add new contracts there. A dry run (no
///         `--broadcast`) writes nothing, so simulating a deployment never records an address that does not exist;
///         nor does a run with `SKIP_DEPLOYMENTS_FILE=true`.
abstract contract DeploymentsFile is Script {
    function _record(string memory addressKey, address deployed, string memory blockKey) internal {
        if (vm.isContext(VmSafe.ForgeContext.ScriptDryRun)) return;
        // Tests deploy to several anvils at once, all chain 31337; they read addresses from the output.
        if (vm.envOr("SKIP_DEPLOYMENTS_FILE", false)) return;
        string[3] memory addressKeys = ["proofOfContribution", "resourceRegistry", "payeeVaultFactory"];
        string[2] memory blockKeys = ["startBlock", "resourceRegistryStartBlock"];
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory existing = vm.exists(path) ? vm.readFile(path) : "{}";

        string memory obj = "deployment";
        string memory out;
        for (uint256 i; i < addressKeys.length; ++i) {
            string memory k = addressKeys[i];
            if (_eq(k, addressKey)) {
                out = vm.serializeAddress(obj, k, deployed);
            } else if (vm.keyExistsJson(existing, string.concat(".", k))) {
                out = vm.serializeAddress(obj, k, vm.parseJsonAddress(existing, string.concat(".", k)));
            }
        }
        for (uint256 i; i < blockKeys.length; ++i) {
            string memory k = blockKeys[i];
            if (_eq(k, blockKey)) {
                out = vm.serializeUint(obj, k, block.number);
            } else if (vm.keyExistsJson(existing, string.concat(".", k))) {
                out = vm.serializeUint(obj, k, vm.parseJsonUint(existing, string.concat(".", k)));
            }
        }
        vm.writeJson(out, path);
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
