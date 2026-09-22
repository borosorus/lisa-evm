/*
    IDEAS to improve

    Could use real stack
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
            function STACK_BASE() -> v {
                v := 0x140
            }
            function STACK_SIZE() -> v {
                v := 16
            }

            function MEM_BASE() -> v {
                v := add(STACK_BASE(),mul(0x20,STACK_SIZE()))
            }

            mstore(0x00, STACK_BASE())
            mstore(0x20, MEM_BASE())
            mstore(0x40, 0x60)

            // OK NOW PC IS RELATIVE

            let size := calldatasize()

            let word := calldataload(0)
            let instr := 0
            instr := read_instr(word, 0)

            // we start at one byte, first instr has already been read

            for { let pc_ := 0x1 } lt(pc_, size) {} 
            {
                word, pc_ := execute(instr, word, pc_)

                let pc_offset := mul(div(pc_, 0x20), 0x20)

                let mod_pc := mod(pc_, 0x20)

                switch mod_pc
                case 0 {
                    // we consumed exactly what was left in the word
                    word := calldataload(pc_offset)
                    instr := read_instr(word, 0)
                }
                case 0x19 {
                    // only next instruction left to consume, have to load next word
                    instr := read_instr(word, 0x19)
                    word := calldataload(add(pc_offset, 0x20))
                }
                default {
                    // more than a byte left to consume
                    instr := read_instr(word, mod_pc)                    
                }
                pc_ := add(pc_, 1)
            }

                

            // *** PC MANIP ****
            function read_instr(word, mod_pc) -> instr {
                instr := shr(248, shl(mul(mod_pc, 8), word))
            }

            // moving locally in existing word.
            // `by` is in bytes
            function move_word_by(word, by) -> new_word {
                by_bits := mul(by, 8)
                new_word := shl(by_bites, word)
            }

            // fetch next word, increase offset
            // DOES NOT UPDATE REL_PC !! need to do manually
            function next_word(pc_offset) -> word {
                new_pc_offset := add(pc_offset, 0x20)
                word := calldata(new_pc_offset)
            }

            // move pc to next word and fetch it
            function fetch_move(rel_pc, pc_offset) -> new_word, new_rel_pc {
                new_rel_pc := add(rel_pc, sub(0x20, mod(rel_pc, 0x20)))
                new_word := next_word(pc_offset)
            }

            // *** END PC MANIP ****

            function execute(instr, word, pc_) -> new_word, new_pc {
                if gt(instr, 0x38) {invalid()}
                if iszero(instr) {stop()} //STOP
                new_pc := pc_

                switch instr
                case 0x21 {
                    pop_()
                }
                case 0x22 {
                    word := move_word_by(word, mod(pc_, 0x20))
                    dup_(word)
                    new_pc := add(pc_, 1) // n
                }
                case 0x23 {
                    word := move_word_by(word, mod(pc_, 0x20))
                    swap_(word)
                    new_pc := add(pc_, 1) // n
                }
                case 0x24 {
                    add_()
                }
                case 0x25 {
                    sub_()
                }
                case 0x26 {
                    mul_()
                }
                case 0x27 {
                    div_()
                }
                case 0x28 {
                    lt_()
                }
                case 0x29 {
                    eq_()
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
                    new_word := push_(instr, word, pc_)
                    new_pc := add(pc_, instr)
                }
            }
            function push_(size_, word, pc_) -> new_word {
                new_word := word

                word := move_word_by(word, mod(pc_, 0x20))

                mod_pc := mod(pc_, 0x20)

                if gt(add(mod_pc, size_), 0x20) {
                    // new_word is the next offset calldata (pc_offset + 0x20)
                    next_pc_offset := add(sub(pc_, mod_pc), 0x20)
                    new_word := calldataload(next_pc_offset)

                    // word now contains the immediate data for push
                    word := and(word, shr(mul(mod_pc,8),new_word))
                }

                let value := shr(sub(256, mul(size_,8)), word)
                push_to_stack(value)
            }

            function push_to_stack(value) {
                let _new_stack := add(mload(0x00), 0x20) //TODO figure out start of stack
                if eq(_new_stack, MEM_BASE()) {
                    invalid() // stack has overgrown
                }
                mstore(_new_stack, value)
                mstore(0x00, _new_stack)
            }

            function pop_() {
                pop(pop_from_stack())
            }

            function pop_from_stack() -> value {
                let _stack := mload(0x00)
                value := mload(_stack)
                if not(eq(_stack,STACK_BASE())) {
                    mstore(0x00, sub(_stack,0x20))
                }
            }

            function dup_(word) {
                let n := shr(248, word)

                if iszero(n) {invalid()}

                let _stack := mload(0x00)
                let stack_size := add(div(sub(_stack, STACK_BASE()),0x20), 1)
                if gt(n,stack_size) {invalid()}
                let value := mload(sub(_stack, mul(sub(n,1),0x20)))
                push_to_stack(value)
            }

            function swap_(word) {
                let n := shr(248, word)

                if iszero(n) {invalid()}

                let _stack := mload(0x00)
                let stack_size := add(div(sub(_stack, STACK_BASE()),0x20), 1)
                if gt(n,stack_size) {invalid()}
                let _stack_n := sub(_stack, mul(sub(n,1),0x20))

                let value_n := mload(_stack_n)
                let value_t := mload(_stack)

                mstore(_stack_n, value_t)
                mstore(_stack, value_n)
            }

            function add_() {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(add(a,b))
            }
            function sub_()  {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(sub(a,b))
            }
            function mul_() {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(mul(a,b))
            }
            function div_() {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(div(a,b))
            }
            function lt_() {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(lt(a,b))
            }
            function eq_() {
                let a := pop_from_stack()
                let b := pop_from_stack()
                push_to_stack(eq(a,b))
            }

            // REL FROM PC_
            function jmp_(pc_, word) -> new_pc, new_word {
                new_word := word

                let mod_pc := mod(pc_, 0x20)
                if eq(mod_pc, 0x19) {
                    new_word := calldataload(add(pc_, 1))
                    word := and(word, shr(8, new_word))
                }
                let sint16 := shr(240,word)
                new_pc := add_signed16(pc_, sint16)

                let current_offset := sub(pc_, mod_pc)
                let next_offset := div(new_pc, 0x20)

                if iszero(eq(current_offset, next_offset)) {
                    new_word := calldataload(next_offset)
                }
            }

            function jz_(pc_, word) -> new_pc, new_word {
                let value := pop_from_stack()

                switch value
                case 0 {
                    new_pc, new_word := jmp_(pc_, word)
                }
                default {
                    new_word := word
                    let mod_pc := mod(pc_, 0x20)
                    if eq(mod_pc, 0x19) {
                        new_word := calldataload(add(pc_, 1))
                    }
                    new_pc := add(pc_, 2)
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
