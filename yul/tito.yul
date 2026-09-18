object "tito" {
    code {
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    
    object "runtime" {
        code {

            mstore(0x40, 0x60)
            let a := 0x9999999
            verbatim_0i_0o(hex"6042")

            mstore(0x20, a)
            
        }
    }
}
