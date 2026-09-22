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

    function incA() external {
        a++;
    }

    function setA(uint256 value) external {
        a = value;
    }

    function getA() external view returns (uint256) {
        return a;
    }
    function test_Program_PatchCalldata() public {
        bytes memory setup = abi.encodePacked(
            bytes1(0x20), uint256(uint160(address(this))), // PUSH32 target
            bytes1(0x20), uint256(0),                     // PUSH32 value
            bytes1(0x2c), bytes2(uint16(36)),             // BLOB len
            LISATest.setA.selector,
            bytes32(0)                                    // setA(0)
        );

        bytes memory patch = abi.encodePacked(
            bytes1(0x22), bytes1(0x02), // DUP2 -> duplicate blob offset
            bytes1(0x01), bytes1(0x04), // PUSH1 4
            bytes1(0x24),               // ADD -> offset + 4
            bytes1(0x01), bytes1(0x2a),   // PUSH1 42
            bytes1(0x2d)                // MSTORE
        );

        bytes memory program = bytes.concat(
            setup,
            patch,
            hex"2e00" // CALL, STOP
        );

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 42);
    }
    function test_Program_ConditionalCall() public {
        a = 7;

        bytes memory readA = abi.encodePacked(
            bytes1(0x20), uint256(uint160(address(this))), // PUSH32 target
            bytes1(0x2c), bytes2(uint16(4)),               // BLOB getA()
            LISATest.getA.selector,
            bytes1(0x2f),                                  // STATICCALL
            bytes1(0x21),                                  // POP success
            bytes1(0x21),                                  // POP rdsize
            bytes1(0x01), bytes1(0x00),                    // PUSH1 returndata offset 0
            bytes1(0x30)                                   // RDLOAD
        );

        bytes memory condition = abi.encodePacked(
            bytes1(0x01), bytes1(0x07), // PUSH1 7
            bytes1(0x29),               // EQ
            bytes1(0x2b), bytes2(0x004c) // JZ -> skip incA call
        );

        bytes memory inc = abi.encodePacked(
            bytes1(0x20), uint256(uint160(address(this))), // PUSH32 target
            bytes1(0x20), uint256(0),                     // PUSH32 value
            bytes1(0x2c), bytes2(uint16(4)),               // BLOB incA()
            LISATest.incA.selector,
            bytes1(0x2e)                                   // CALL
        );

        bytes memory program = bytes.concat(
            readA,
            condition,
            inc,
            hex"00" // STOP
        );

        // a == 7 -> branch executes
        (bool ok,) = target.call(program);
        assertTrue(ok);
        assertEq(a, 8);

        // a == 8 -> branch skipped
        (ok,) = target.call(program);
        assertTrue(ok);
        assertEq(a, 8);
    }
    function test_Program_Loop() public {
        bytes memory loopHead = abi.encodePacked(
            bytes1(0x01), bytes1(0x03),       // PUSH1 3  -> counter
            bytes1(0x22), bytes1(0x01),       // DUP1
            bytes1(0x2b), bytes2(0x0054)      // JZ +84 -> exit
        );

        bytes memory callInc = abi.encodePacked(
            bytes1(0x20), uint256(uint160(address(this))), // PUSH32 target
            bytes1(0x20), uint256(0),                     // PUSH32 value

            bytes1(0x2c), bytes2(uint16(4)),               // BLOB incA()
            LISATest.incA.selector,

            bytes1(0x2e), // CALL -> [counter, rdsize, success]
            bytes1(0x21), // POP success
            bytes1(0x21)  // POP rdsize
        );

        bytes memory loopTail = abi.encodePacked(
            bytes1(0x01), bytes1(0x01),       // PUSH1 1
            bytes1(0x25),                     // SUB -> counter--

            bytes1(0x2a), bytes2(0x8055),     // JMP -85 -> DUP1

            bytes1(0x21),                     // exit: POP counter
            bytes1(0x00)                      // STOP
        );

        bytes memory program = bytes.concat(
            loopHead,
            callInc,
            loopTail
        );

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 3);
    }
}
