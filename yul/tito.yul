object "tito" {
    code {
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    
    object "runtime" {
        code {

            let pc_ := 0x11
            mstore(0x00, pc_)
            
        }
    }
}
