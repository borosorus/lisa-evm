#!/usr/bin/env bash
set -euo pipefail

compiler="$1"
shift
output=$("$compiler" --strict-assembly --evm-version cancun "$@" --bin yul/LISA.yul)
bytecode=$(printf '%s\n' "$output" | awk '/^Binary representation:$/ { getline; print; exit }')

if [[ ! "$bytecode" =~ ^([0-9a-fA-F]{2})+$ ]]; then
    printf 'Could not extract LISA creation bytecode from solc output.\n' >&2
    exit 1
fi

mkdir -p build/yul
printf '0x%s' "$bytecode" > build/yul/LISA.bin
