# Forge installs the pinned compiler here. Override SOLC for custom installations.
SOLC ?= $(HOME)/.svm/0.8.29/solc-0.8.29
YUL_FLAGS ?=

.PHONY: build test debug trace snapshot

build:
	forge build
	bash scripts/compile-yul.sh "$(SOLC)" $(YUL_FLAGS)

test: build
	forge test --offline -vvv

debug: build
	forge test --offline --debug --match-contract LISATest --match-test '^test_Deploy\(\)$$'

trace: build
	forge test --offline --match-contract LISATest --match-test '^test_Deploy\(\)$$' -vvvvv

snapshot: build
	forge snapshot --offline
