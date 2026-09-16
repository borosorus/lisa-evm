// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

contract LISATest is Test {
    address internal target;

    function setUp() public {
        bytes memory init = vm.parseBytes(vm.readFile("build/yul/LISA.bin"));
        address deployed;
        assembly {
            deployed := create(0, add(init, 32), mload(init))
        }
        require(deployed != address(0), "Deployment failed");
        require(deployed.code.length > 0, "Empty runtime");
        target = deployed;
    }

    function test_Deploy() public view {
        assertGt(target.code.length, 0);
    }

    function test_EmptyProgram() public {
        (bool ok, bytes memory result) = target.call("");
        assertTrue(ok);
        assertEq(result.length, 0);
    }
}
