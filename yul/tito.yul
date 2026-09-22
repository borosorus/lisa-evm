object "tito" {
    code {
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    
    object "runtime" {
        code {

            // let pc_ := 0x11111
            mstore(0x00, 0x11111)

            
            verbatim_1i_0o(hex"5B", 0x55555)
            verbatim_0i_0o(hex"50")

            push_(0x777777777)

            mstore(0x20, 0x222222)

            //push pc_continue
            //push value
            //push pc_func
            //jmp

            //jmpdest
            function push_(value) {
                //dup1 value
                verbatim_1i_0o(hex"9190", value) //swap2, swap1
                //pop value // after pop we have [pc_continue, value]
            }
        }
    }
}
