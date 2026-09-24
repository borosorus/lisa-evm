// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";

/// Runtime-compatibility suite for the TypeScript toolchain.
///
/// Programs are compiled by `ts/tools/gen-runtime-fixtures.ts` (via the public
/// TS API: AST -> compiler -> encoder) and executed here against the real
/// Yul runtime. This is the final cross-layer check: if the toolchain's byte
/// encoding ever drifts from `yul/LISA.yul`, these tests fail.
contract LISAToolingTest is Test {
    string internal constant FIXTURES = "build/fixtures/tooling.json";

    address internal target;
    uint256 public a;
    uint256 public setACalls;

    function setUp() public {
        bytes memory init = vm.parseBytes(vm.readFile("build/yul/LISA.bin"));
        address deployed;
        assembly {
            deployed := create(0, add(init, 32), mload(init))
        }
        require(deployed != address(0), "Deployment failed");
        target = deployed;
    }

    function test_Fixtures_GeneratedPrograms() public {
        // Never pass vacuously: this suite must always execute the generated
        // programs. Build them with `make fixtures` (or the generator directly).
        require(vm.exists(FIXTURES), "fixtures missing; run `make fixtures`");

        string memory json = vm.readFile(FIXTURES);
        uint256 count = vm.parseJsonUint(json, "$.count");
        assertGt(count, 0);

        for (uint256 i; i < count; i++) {
            string memory path = string.concat("$.programs[", vm.toString(i), "]");
            string memory name = vm.parseJsonString(json, string.concat(path, ".name"));
            bytes memory program = vm.parseBytes(vm.parseJsonString(json, string.concat(path, ".program")));
            string memory expect = vm.parseJsonString(json, string.concat(path, ".expect"));

            bool hasA = vm.keyExistsJson(json, string.concat(path, ".expectA"));
            if (hasA) {
                // Append the write-top-of-stack tail; the generated programs
                // are address-free, so the tail binds them to this contract.
                program = bytes.concat(program, _writeTopToA());
            }

            a = 0;
            setACalls = 0;
            (bool ok,) = target.call{gas: 10_000_000}(program);

            if (keccak256(bytes(expect)) == keccak256("revert")) {
                assertFalse(ok, string.concat(name, ": expected revert"));
            } else {
                assertTrue(ok, string.concat(name, ": expected success"));
                if (hasA) {
                    // The write-back must actually have run; otherwise an
                    // expectA of 0 would pass on an untouched `a` alone.
                    assertEq(setACalls, 1, string.concat(name, ": write-back ran"));
                    assertEq(a, vm.parseJsonUint(json, string.concat(path, ".expectA")), name);
                }
            }
        }
    }

    function setA(uint256 value) external {
        setACalls++;
        a = value;
    }

    /// CALL setA(stackTop): PUSH20 this; PUSH1 0; BLOB setA(0); DUP2, +4, DUP6, MSTORE, CALL,
    /// then revert if the CALL failed (JZ pops the success flag), else pop return size and STOP.
    function _writeTopToA() internal view returns (bytes memory) {
        bytes memory setup = abi.encodePacked(
            bytes1(0x14),
            bytes20(address(this)), // target
            bytes1(0x01),
            bytes1(0), // value = 0
            bytes1(0x2d),
            bytes2(uint16(36)), // BLOB setA(0)
            this.setA.selector,
            bytes32(0)
        );

        // DUP2 (offset), PUSH1 4, ADD -> argument word, DUP6 (stack top), MSTORE,
        // CALL -> [returndatasize, success]; JZ pops success: taken (failed write)
        // jumps +4 to the REVERT; on success falls through to POP, STOP.
        bytes memory patch = hex"220201042422062e302c0004210039";

        return bytes.concat(setup, patch);
    }
}
