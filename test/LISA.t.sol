// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

contract LISATest is Test {
    address internal target;
    uint256 internal a = 0;

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

    function _assertInvalid(bytes memory program) internal {
        (bool ok,) = target.call(program);
        assertFalse(ok);
    }

    function test_InvalidOpcode() public {
        _assertInvalid(hex"3a");
    }

    function test_StackUnderflow() public {
        _assertInvalid(hex"21"); // POP
    }

    function test_StackOverflow() public {
        bytes memory program;
        for (uint256 i; i < 17; i++) {
            program = bytes.concat(program, hex"0100"); // PUSH1 0
        }
        _assertInvalid(program);
    }

    function test_TruncatedPush() public {
        _assertInvalid(hex"20"); // PUSH32 without its immediate
    }

    function test_JumpOutOfBounds() public {
        _assertInvalid(hex"2b0004"); // JMP +4 from pc=1, beyond calldata
    }

    function test_MemoryOffsetWraparound() public {
        bytes memory program = abi.encodePacked(
            bytes1(0x20),
            type(uint256).max - uint256(0x25f), // 2^256 - MEM_BASE
            bytes1(0x2f) // MLOAD
        );
        _assertInvalid(program);
    }

    function test_RevertOpcode() public {
        _assertInvalid(hex"39");
    }

    function test_Program_Division() public {
        bytes memory program = bytes.concat(
            abi.encodePacked(
                bytes1(0x01),
                bytes1(0x08), // PUSH1 8
                bytes1(0x01),
                bytes1(0x02), // PUSH1 2
                bytes1(0x27) // DIV -> 4
            ),
            _writeTopToA()
        );

        (bool ok,) = target.call(program);
        assertTrue(ok);
        assertEq(a, 4);

        program = bytes.concat(
            abi.encodePacked(
                bytes1(0x01),
                bytes1(0x08), // PUSH1 8
                bytes1(0x01),
                bytes1(0x00), // PUSH1 0
                bytes1(0x27) // DIV -> 0
            ),
            _writeTopToA()
        );

        (ok,) = target.call(program);
        assertTrue(ok);
        assertEq(a, 0);
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
            bytes1(0x20),
            uint256(uint160(address(this))), // PUSH32 target
            bytes1(0x20),
            uint256(0), // PUSH32 value
            bytes1(0x2d),
            bytes2(uint16(36)), // BLOB len
            LISATest.setA.selector,
            bytes32(0) // setA(0)
        );

        bytes memory patch = abi.encodePacked(
            bytes1(0x22),
            bytes1(0x02), // DUP2 -> duplicate blob offset
            bytes1(0x01),
            bytes1(0x04), // PUSH1 4
            bytes1(0x24), // ADD -> offset + 4
            bytes1(0x01),
            bytes1(0x2a), // PUSH1 42
            bytes1(0x2e) // MSTORE
        );

        bytes memory program = bytes.concat(
            setup,
            patch,
            hex"3000" // CALL, STOP
        );

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 42);
    }

    function test_Program_ConditionalCall() public {
        a = 7;

        bytes memory readA = abi.encodePacked(
            bytes1(0x20),
            uint256(uint160(address(this))), // PUSH32 target
            bytes1(0x2d),
            bytes2(uint16(4)), // BLOB getA()
            LISATest.getA.selector,
            bytes1(0x31), // STATICCALL
            bytes1(0x21), // POP success
            bytes1(0x21), // POP rdsize
            bytes1(0x01),
            bytes1(0x00), // PUSH1 returndata offset 0
            bytes1(0x32) // RDLOAD
        );

        bytes memory condition = abi.encodePacked(
            bytes1(0x01),
            bytes1(0x07), // PUSH1 7
            bytes1(0x2a), // EQ
            bytes1(0x2c),
            bytes2(0x004c) // JZ -> skip incA call
        );

        bytes memory inc = abi.encodePacked(
            bytes1(0x20),
            uint256(uint160(address(this))), // PUSH32 target
            bytes1(0x20),
            uint256(0), // PUSH32 value
            bytes1(0x2d),
            bytes2(uint16(4)), // BLOB incA()
            LISATest.incA.selector,
            bytes1(0x30) // CALL
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
            bytes1(0x01),
            bytes1(0x03), // PUSH1 3  -> counter
            bytes1(0x22),
            bytes1(0x01), // DUP1
            bytes1(0x2c),
            bytes2(0x0054) // JZ +84 -> exit
        );

        bytes memory callInc = abi.encodePacked(
            bytes1(0x20),
            uint256(uint160(address(this))), // PUSH32 target
            bytes1(0x20),
            uint256(0), // PUSH32 value
            bytes1(0x2d),
            bytes2(uint16(4)), // BLOB incA()
            LISATest.incA.selector,
            bytes1(0x30), // CALL -> [counter, rdsize, success]
            bytes1(0x21), // POP success
            bytes1(0x21) // POP rdsize
        );

        bytes memory loopTail = abi.encodePacked(
            bytes1(0x01),
            bytes1(0x01), // PUSH1 1
            bytes1(0x25), // SUB -> counter--
            bytes1(0x2b),
            bytes2(0x8055), // JMP -85 -> DUP1
            bytes1(0x21), // exit: POP counter
            bytes1(0x00) // STOP
        );

        bytes memory program = bytes.concat(loopHead, callInc, loopTail);

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 3);
    }

    function test_Program_ContextMemoryAndHash() public {
        vm.deal(address(this), 3 ether);
        vm.deal(target, 2 ether);

        bytes32 data = bytes32(uint256(0x1234));
        bytes32 expectedHash = keccak256(abi.encodePacked(data));

        // BLOB(data)
        // -> verify MLOAD(data) == 0x1234
        // -> verify KECCAK256(data) == expectedHash
        //
        // Leaves a single boolean (1) on the stack.
        bytes memory memoryChecksA = abi.encodePacked(
            bytes1(0x2d),
            bytes2(uint16(32)),
            data, // BLOB -> [offset, len]
            bytes1(0x22),
            bytes1(0x02), // DUP2 -> duplicate offset
            bytes1(0x2f), // MLOAD
            bytes1(0x02),
            bytes2(0x1234), // PUSH2 0x1234
            bytes1(0x2a) // EQ
                // [offset, len, loadMatches]
        );

        bytes memory memoryChecksB = abi.encodePacked(
            // Rearrange:
            // [offset, len, loadMatches]
            // -> [loadMatches, offset, len]
            bytes1(0x23),
            bytes1(0x03), // SWAP3
            bytes1(0x23),
            bytes1(0x02), // SWAP2
            bytes1(0x28), // KECCAK256(offset,len)
            bytes1(0x20),
            expectedHash, // PUSH32 expectedHash
            bytes1(0x2a), // EQ
            bytes1(0x26) // MUL the two booleans
        );

        // Check CALLER, SELF and TIMESTAMP.
        // Each comparison is multiplied into our accumulated boolean.
        bytes memory contextChecksA = abi.encodePacked(
            bytes1(0x34), // CALLER
            bytes1(0x14),
            bytes20(address(this)), // PUSH20 expected caller
            bytes1(0x2a), // EQ
            bytes1(0x26), // MUL
            bytes1(0x33), // SELF
            bytes1(0x14),
            bytes20(target), // PUSH20 expected self
            bytes1(0x2a), // EQ
            bytes1(0x26) // MUL
        );

        bytes memory contextChecksB = abi.encodePacked(
            bytes1(0x38), // TIMESTAMP
            bytes1(0x20),
            block.timestamp, // PUSH32 expected timestamp
            bytes1(0x2a), // EQ
            bytes1(0x26) // MUL
        );

        // address(this).balance == 3 ether
        bytes memory balanceChecksA = abi.encodePacked(
            bytes1(0x14),
            bytes20(address(this)),
            bytes1(0x37), // BALANCE
            bytes1(0x20),
            uint256(3 ether),
            bytes1(0x2a), // EQ
            bytes1(0x26) // MUL
        );

        // LISA's own balance == 2 ether
        bytes memory balanceChecksB = abi.encodePacked(
            bytes1(0x36), // SELFBALANCE
            bytes1(0x20),
            uint256(2 ether),
            bytes1(0x2a), // EQ
            bytes1(0x26), // MUL
            // Ensure there is at least some reasonable amount of gas left:
            // 10_000 < gasleft()
            bytes1(0x02),
            bytes2(uint16(10_000)),
            bytes1(0x35), // GAS
            bytes1(0x29), // LT
            bytes1(0x26) // MUL
        );

        // At this point stack should contain [1].
        // Turn that into 99 and use it as the argument to setA().
        bytes memory result = abi.encodePacked(
            bytes1(0x01),
            bytes1(uint8(99)),
            bytes1(0x26) // MUL -> 99 if every check succeeded
        );

        bytes memory callSetA = abi.encodePacked(
            bytes1(0x14),
            bytes20(address(this)), // target
            bytes1(0x01),
            bytes1(0), // value = 0
            bytes1(0x2d),
            bytes2(uint16(36)), // BLOB setA(0)
            LISATest.setA.selector,
            bytes32(0)
        );

        bytes memory patchAndCall = abi.encodePacked(
            // stack:
            // [result, target, value, offset, len]
            bytes1(0x22),
            bytes1(0x02), // DUP2 offset
            bytes1(0x01),
            bytes1(0x04), // PUSH1 4
            bytes1(0x24), // ADD -> ABI argument offset
            bytes1(0x22),
            bytes1(0x06), // DUP6 -> result
            bytes1(0x2e), // MSTORE
            bytes1(0x30), // CALL
            bytes1(0x21), // POP success
            bytes1(0x21), // POP rdsize
            bytes1(0x00) // STOP
        );

        bytes memory program = bytes.concat(
            memoryChecksA,
            memoryChecksB,
            contextChecksA,
            contextChecksB,
            balanceChecksA,
            balanceChecksB,
            result,
            callSetA,
            patchAndCall
        );

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 99);
    }

    function _writeTopToA() internal view returns (bytes memory) {
        bytes memory setup = abi.encodePacked(
            bytes1(0x14),
            bytes20(address(this)), // PUSH20 target
            bytes1(0x01),
            bytes1(0x00), // PUSH1 value=0
            bytes1(0x2d),
            bytes2(uint16(36)), // BLOB setA(0)
            LISATest.setA.selector,
            bytes32(0)
        );

        bytes memory patch = abi.encodePacked(
            // stack: [result, target, value, offset, len]
            bytes1(0x22),
            bytes1(0x02), // DUP2 offset
            bytes1(0x01),
            bytes1(0x04), // PUSH1 4
            bytes1(0x24), // ADD -> argument offset
            bytes1(0x22),
            bytes1(0x06), // DUP6 result
            bytes1(0x2e), // MSTORE
            bytes1(0x30), // CALL
            bytes1(0x00) // STOP
        );

        return bytes.concat(setup, patch);
    }

    function test_Program_MemoryRoundTrip() public {
        bytes memory memoryOps = abi.encodePacked(
            bytes1(0x2d),
            bytes2(uint16(32)),
            bytes32(0), // BLOB
            bytes1(0x21), // POP len -> [offset]
            bytes1(0x22),
            bytes1(0x01), // DUP1 offset
            bytes1(0x20),
            uint256(0x123456), // PUSH32 value
            bytes1(0x2e), // MSTORE
            bytes1(0x2f) // MLOAD -> value
        );

        bytes memory program = bytes.concat(memoryOps, _writeTopToA());

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 0x123456);
    }

    function test_Program_Keccak() public {
        bytes32 value = bytes32(uint256(0x123456));
        uint256 expected = uint256(keccak256(abi.encodePacked(value)));

        bytes memory hashOps = abi.encodePacked(
            bytes1(0x2d),
            bytes2(uint16(32)),
            value, // BLOB -> [offset, len]
            bytes1(0x28) // KECCAK256 -> [hash]
        );

        bytes memory program = bytes.concat(hashOps, _writeTopToA());

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, expected);
    }

    function test_Program_Context() public {
        bytes memory selfCheck = abi.encodePacked(
            bytes1(0x33), // SELF
            bytes1(0x14),
            bytes20(target), // expected
            bytes1(0x2a) // EQ
        );

        bytes memory callerCheck = abi.encodePacked(
            bytes1(0x34), // CALLER
            bytes1(0x14),
            bytes20(address(this)),
            bytes1(0x2a), // EQ
            bytes1(0x26) // MUL -> both true
        );

        bytes memory program = bytes.concat(selfCheck, callerCheck, _writeTopToA());

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 1);
    }

    function test_Program_Balances() public {
        address account = address(0xBEEF);

        vm.deal(target, 2 ether);
        vm.deal(account, 3 ether);

        bytes memory selfCheck = abi.encodePacked(
            bytes1(0x36), // SELFBALANCE
            bytes1(0x20),
            uint256(2 ether),
            bytes1(0x2a) // EQ
        );

        bytes memory accountCheck = abi.encodePacked(
            bytes1(0x14),
            bytes20(account),
            bytes1(0x37), // BALANCE
            bytes1(0x20),
            uint256(3 ether),
            bytes1(0x2a), // EQ
            bytes1(0x26) // MUL
        );

        bytes memory program = bytes.concat(selfCheck, accountCheck, _writeTopToA());

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 1);
    }

    function test_Program_TimestampAndGas() public {
        vm.warp(123456);

        bytes memory timestampCheck = abi.encodePacked(
            bytes1(0x38), // TIMESTAMP
            bytes1(0x20),
            uint256(123456),
            bytes1(0x2a) // EQ
        );

        bytes memory gasCheck = abi.encodePacked(
            bytes1(0x02),
            bytes2(uint16(10_000)), // PUSH2 10k
            bytes1(0x35), // GAS
            bytes1(0x29), // 10k < gas
            bytes1(0x26) // MUL with timestamp result
        );

        bytes memory program = bytes.concat(timestampCheck, gasCheck, _writeTopToA());

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 1);
    }

    function test_Program_FullIntegration() public {
        a = 11;
        vm.warp(123456);
        vm.deal(target, 2 ether);

        bytes32 value = bytes32(uint256(0x1234));
        bytes32 expectedHash = keccak256(abi.encodePacked(value));

        // ------------------------------------------------------------
        // 1. Memory:
        // BLOB -> MLOAD check -> KECCAK check
        //
        // Leaves:
        // [1] if both checks succeed
        // ------------------------------------------------------------

        bytes memory memoryPart = bytes.concat(
            abi.encodePacked(
                bytes1(0x2d),
                bytes2(uint16(32)),
                value, // BLOB -> [offset,len]
                bytes1(0x22),
                bytes1(0x02), // DUP2 offset
                bytes1(0x2f), // MLOAD
                bytes1(0x02),
                bytes2(0x1234),
                bytes1(0x2a) // EQ
                    // [offset,len,memoryOk]
            ),
            abi.encodePacked(
                // [offset,len,memoryOk]
                // -> [memoryOk,offset,len]
                bytes1(0x23),
                bytes1(0x03), // SWAP3
                bytes1(0x23),
                bytes1(0x02), // SWAP2
                bytes1(0x28), // KECCAK256(offset,len)
                bytes1(0x20),
                expectedHash,
                bytes1(0x2a), // EQ
                bytes1(0x26) // MUL => combined bool
            )
        );

        // ------------------------------------------------------------
        // 2. Context:
        // SELF, CALLER, TIMESTAMP
        //
        // Existing boolean remains on stack and each result is ANDed
        // using MUL.
        // ------------------------------------------------------------

        bytes memory contextAndEnvPart = bytes.concat(
            abi.encodePacked(
                bytes1(0x33), // SELF
                bytes1(0x14),
                bytes20(target),
                bytes1(0x2a), // EQ
                bytes1(0x26), // MUL
                bytes1(0x34), // CALLER
                bytes1(0x14),
                bytes20(address(this)),
                bytes1(0x2a), // EQ
                bytes1(0x26) // MUL
            ),
            abi.encodePacked(
                bytes1(0x38), // TIMESTAMP
                bytes1(0x20),
                uint256(123456),
                bytes1(0x2a), // EQ
                bytes1(0x26), // MUL
                bytes1(0x36), // SELFBALANCE
                bytes1(0x20),
                uint256(2 ether),
                bytes1(0x2a), // EQ
                bytes1(0x26) // MUL
            )
        );

        // ------------------------------------------------------------
        // 3. STATICCALL:
        // getA() -> returndata -> check == 11
        // ------------------------------------------------------------

        // ------------------------------------------------------------
        // 4. Check GAS > 10k.
        //
        // Stack ends with:
        // [1] if every check succeeded.
        //
        // Multiply that by 77 -> [77].
        // ------------------------------------------------------------

        bytes memory readAandFinalChecks = bytes.concat(
            abi.encodePacked(
                bytes1(0x14),
                bytes20(address(this)), // target
                bytes1(0x2d),
                bytes2(uint16(4)),
                LISATest.getA.selector,
                bytes1(0x31), // STATICCALL
                bytes1(0x21), // POP success
                bytes1(0x21) // POP rdsize
            ),
            abi.encodePacked(
                bytes1(0x01),
                bytes1(0x00),
                bytes1(0x32), // RDLOAD(0)
                bytes1(0x01),
                bytes1(0x0b),
                bytes1(0x2a), // EQ
                bytes1(0x26) // MUL with accumulated result
            ),
            abi.encodePacked(
                bytes1(0x02),
                bytes2(uint16(10_000)),
                bytes1(0x35), // GAS
                bytes1(0x29), // LT: 10_000 < gas
                bytes1(0x26), // MUL
                bytes1(0x01),
                bytes1(uint8(77)),
                bytes1(0x26) // result = allChecks * 77
            )
        );

        bytes memory program = bytes.concat(memoryPart, contextAndEnvPart, readAandFinalChecks, _writeTopToA());

        (bool ok,) = target.call(program);

        assertTrue(ok);
        assertEq(a, 77);
    }
}
