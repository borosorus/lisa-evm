/*
    IDEAS to improve

    Could use real stack
    Could have only push32
    (reading whole word anyway from calldata)
    safety not soo much of an issue
    improve opcode (calldata) consuming mechanism, not to read calldata 600 times
*/

object "LISA" {
    code {
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    /*
        An INSTRUCTION (OPCODE) is 1 byte (8 bits)
        STACK grows upwards

        Need a memory layout here
        0x00 -> current vm stack -> CURRENT IS USEd
        0x20 -> free vm mem -> FREE ISN'T USED
        0x40 -> free our mem (maxxed out at X) ??
        0x60 -> Start of our mem -
        0x80 -
        0xa0
        0xc0
        0xe0
        0x100 -
        0x120 -> up to here.
        0x140 -> start of vm stack STACK_BASE()
        0x160
        0x180
        0x1a0
        0x1c0
        0x1e0
        0x200
        0x220
        0x240
        0x260
        0x280
        0x2a0
        0x2c0
        0x2e0
        0x300
        0x320 -> end of vm stack (16 slots)
        0x340 -> VM mem base MEM_BASE()

        --- ISA ----
        Group	    Instruction	    Stack effect / role                                 OPCODE
        --------------------------------------------------------------------------------------------
        Constants	PUSHn	        [] → [x], n=1..32 encoded in opcode range           0x01-0x20
        Stack	    POP	            [x] → []                                            0x21
                    DUP n	        duplicate stack item                                0x22
                    SWAP n	        swap stack items                                    0x23
        Math	    ADD	            [a,b] → [a+b]                                       0x24
                    SUB	            [a,b] → [a-b]                                       0x25
                    MUL	            [a,b] → [a*b]                                       0x26
                    DIV	            [a,b] → [a/b]                                       0x27
        Compare	    LT	            [a,b] → [a<b]                                       0x28
                    EQ	            [a,b] → [a==b]                                      0x29
        Control	    JMP rel16	    relative jump                                       0x30
                    JZ rel16	    pop condition; jump if zero                         0x31
        Memory	    BLOB len,data	copy inline data → scratch, push [offset,len]       0x32
                    MSTORE	        [offset,value] → []                                 0x33
        Calls	    CALL	        [target,value,offset,len] → [rdsize, success]       0x34
                    STATICCALL	    [target,offset,len] → [rdsize, success]             0x35
        Return data	RDLOAD	        [offset] → [word]                                   0x36                                 
        Context	    SELF	        [] → [wallet address]                               0x37
        Halt	    STOP	        success                                             0x00
                    REVERT	        revert                                              0x38


    */
    object "runtime" {
        code {
            mstore(0x00, STACK_BASE())
            mstore(0x20, MEM_BASE())
            mstore(0x40, 0x60)

            // We'll make it expensive V0 for simplicity, just read the whole word each time, shift it, obtain opcode, execute and move pc
            let size := calldatasize()
            for { let pc_ := 0 } lt(pc_, calldatasize()) {} {
                let instr := parse_instr_at(pc_)
                pc_ := execute(instr, pc_)
            }

            function STACK_BASE() -> v {
                v := 0x140
            }
            function STACK_SIZE() -> v {
                v := 16
            }

            function MEM_BASE() -> v {
                v := add(STACK_BASE(),mul(0x20,STACK_SIZE()))
            }

            function parse_instr_at(calldata_offset) -> instr {
                let word := calldataload(calldata_offset)
                instr := shr(248,word)
            }
            function execute(instr, pc_) -> new_pc {
                if gt(instr, 0x38) {invalid()}

                if iszero(instr) {stop()} //STOP
                switch instr
                case 0x21 {
                    new_pc := pop_(pc_)
                }
                case 0x22 {
                    new_pc := dup_(pc_)
                }
                case 0x23 {
                    new_pc := swap_(pc_)
                }
                case 0x24 {
                    new_pc := add_(pc_)
                }
                case 0x25 {
                    new_pc := sub_(pc_)
                }
                case 0x26 {
                    new_pc := mul_(pc_)
                }
                case 0x27 {
                    new_pc := div_(pc_)
                }
                case 0x28 {
                    new_pc := lt_(pc_)
                }
                case 0x29 {
                    new_pc := eq_(pc_)
                }
                case 0x30 {
                    new_pc := jmp_(pc_)
                }
                case 0x31 {
                    new_pc := jz_(pc_)
                }
                case 0x32 {
                    new_pc := blob_(pc_)
                }
                case 0x33 {
                    new_pc := mstore_(pc_)
                }
                case 0x34 {
                    new_pc := call_(pc_)
                }
                case 0x35 {
                    new_pc := staticcall_(pc_)
                }
                case 0x36 {
                    new_pc := rdload_(pc_)
                }
                case 0x37 {
                    new_pc := self_(pc_)
                }
                case 0x38 {
                    stop()
                }
                default {
                    // PUSH bytes
                    new_pc := push_(instr, pc_)
                }
            }
            function push_(size_, pc_) -> new_pc {
                let value := calldataload(add(pc_, 1)) // value is at pc_ (instr) + 1 (byte)
                value := shr(sub(256,mul(size_,8)), value) // truncating to recover only value (given size)
                push_to_stack(value)
                new_pc := add(pc_,add(1, size_))
            }

            function push_to_stack(value) {
                let _new_stack := add(mload(0x00), 0x20) //TODO figure out start of stack
                if eq(_new_stack, MEM_BASE()) {
                    invalid() // stack has overgrown
                }
                mstore(_new_stack, value)
                mstore(0x00, _new_stack)
            }

            function pop_(pc_) -> new_pc {
                pop(pop_from_stack())
                new_pc := add(pc_,1)
            }

            function pop_from_stack() -> value {
                let _stack := mload(0x00)
                value := mload(_stack)
                if not(eq(_stack,STACK_BASE())) {
                    mstore(0x00, sub(_stack,0x20))
                }
            }

            function dup_(pc_) -> new_pc {
                let n := parse_instr_at(add(pc_,1)) // DUP n
                if iszero(n) {invalid()}
                let _stack := mload(0x00)
                let stack_size := add(div(sub(_stack, STACK_BASE()),0x20), 1)
                if gt(n,stack_size) {invalid()}
                let value := mload(sub(_stack, mul(sub(n,1),0x20)))
                push_to_stack(value)
                new_pc := add(pc_,2) // instr and n
            }

            function swap_(pc_) -> new_pc {
                let n := parse_instr_at(add(pc_,1)) // SWAP n
                if iszero(n) {invalid()}
                let _stack := mload(0x00)
                let stack_size := add(div(sub(_stack, STACK_BASE()),0x20), 1)
                if gt(n,stack_size) {invalid()}
                let _stack_n := sub(_stack, mul(sub(n,1),0x20))

                let value_n := mload(_stack_n)
                let value_t := mload(_stack)

                mstore(_stack_n, value_t)
                mstore(_stack, value_n)
                new_pc := add(pc_,2) // instr and n
            }

            function add_(pc_) -> new_pc {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(add(a,b))
                new_pc := add(pc_,1)
            }
            function sub_(pc_) -> new_pc {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(sub(a,b))
                new_pc := add(pc_,1)
            }
            function mul_(pc_) -> new_pc {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(mul(a,b))
                new_pc := add(pc_,1)
            }
            function div_(pc_) -> new_pc {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(div(a,b))
                new_pc := add(pc_,1)
            }
            function lt_(pc_) -> new_pc {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(lt(a,b))
                new_pc := add(pc_,1)
            }
            function eq_(pc_) -> new_pc {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(eq(a,b))
                new_pc := add(pc_,1)
            }

            // REL FROM PC_
            function jmp_(pc_) -> new_pc {
                let sint16 := shr(240,calldataload(add(pc_,1)))
                new_pc := add_signed16(pc_, sint16)
            }

            function jz_(pc_) -> new_pc {
                let sint16 := shr(240,calldataload(add(pc_,1)))
                let value := pop_from_stack()
                switch value
                case 0 {
                    new_pc := add_signed16(pc_, sint16)
                }
                default {
                    new_pc := add(pc_, 3) //instr and 16 bits signed
                }
            }

            // sign-magnitude add (16 bits)
            function add_signed16(uint256, sint16) -> res {
                sint16 := shr(240,shl(240,sint16))
                let sign := shr(15,sint16)
                switch sign
                case 0 {res := add(uint256,sint16)}
                case 1 {res := sub(uint256,sint16)}
            }

            function blob_(pc_) -> new_pc {
                let len := calldataload(add(pc_,1)) // len in bytes, must be div by 32
                pc_ := add(pc_,33) // instr and len
                let _mem_offset := mload(0x20)

                let _mem := _mem_offset
                for { let i := 0 } lt(i, len) { i := add(i, 0x20) }
                {
                    let value := calldataload(pc_)
                    mstore(_mem, value)
                    _mem := add(_mem,0x20)
                    pc_ := add(pc_,0x20)
                }
                push_to_stack(sub(_mem_offset, MEM_BASE())) // PUSHING VIRTUAL OFFSET 
                push_to_stack(len)

                mstore(0x20, _mem)
                new_pc := pc_
            }

            function mstore_(pc_) -> new_pc {
                let value := pop_from_stack()
                let offset := pop_from_stack()
                mstore(add(offset, MEM_BASE()), value) //STORING USING VIRTUAL OFFSET
            }

            function call_(pc_) -> new_pc {
                let len := pop_from_stack()
                let offset := pop_from_stack()
                let value := pop_from_stack()
                let target := pop_from_stack()
                let success := call(gas(),target,value,add(MEM_BASE(),offset),len,0,0) //VIRTUAL OFFSET
                push_to_stack(returndatasize())
                push_to_stack(success)
                new_pc := add(pc_,1)
            }
            function staticcall_(pc_) -> new_pc {
                let len := pop_from_stack()
                let offset := pop_from_stack()
                let target := pop_from_stack()
                let success := staticcall(gas(),target,add(MEM_BASE(),offset),len,0,0) //VIRTUAL OFFSET
                push_to_stack(returndatasize())
                push_to_stack(success)
                new_pc := add(pc_,1)
            }
            function rdload_(pc_) -> new_pc {
                let offset := pop_from_stack()
                let _free_mem := mload(0x40) //TODO manage free mem

                returndatacopy(_free_mem, offset, 0x20)
                let value := mload(_free_mem)
                push_to_stack(value)
                new_pc := add(pc_,1)
            }

            function self_(pc_) -> new_pc {
                push_to_stack(address())
                new_pc := add(pc_,1)
            }
        }
    }
}
