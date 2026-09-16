// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

contract LISATest is Test {
    address internal target;
    uint internal a = 0;

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
    function test_Program() public {
        bytes memory dt = abi.encodePacked(
            bytes1(0x20),uint256(uint160(address(this))), //push32 target
            bytes1(0x20),uint(0), //push32 value
            bytes1(0x32),uint(32),LISATest.incA.selector,bytes28(0), //blob 32 bytes with incA selector
            bytes1(0x34) //call
        );
        (bool ok, bytes memory result) = target.call(dt);

        assertTrue(ok);
        assertEq(result.length, 0);
        assertEq(a,1);
    }
    function incA() external {
        a++;
    }
}
