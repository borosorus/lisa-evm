// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.29;

import {Script} from "forge-std/Script.sol";

contract LISAScript is Script {
    function run() public returns (address deployed) {
        bytes memory init = vm.parseBytes(vm.readFile("build/yul/LISA.bin"));
        vm.startBroadcast();
        assembly {
            deployed := create(0, add(init, 32), mload(init))
        }
        vm.stopBroadcast();
        require(deployed != address(0), "Deployment failed");
        require(deployed.code.length > 0, "Empty runtime");
    }
}
