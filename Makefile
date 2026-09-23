# Forge installs the pinned compiler here. Override SOLC for custom installations.
SOLC ?= $(HOME)/.svm/0.8.29/solc-0.8.29
YUL_FLAGS ?=
TEST ?= test_Program_FullIntegration

.PHONY: build test test-opt debug trace snapshot fmt clean

build:
	forge build
	bash scripts/compile-yul.sh "$(SOLC)" $(YUL_FLAGS)

test: build
	forge test --offline -vvv

test-opt:
	$(MAKE) test YUL_FLAGS='--optimize --optimize-runs 200'

debug: build
	forge test --offline --debug --match-contract LISATest --match-test '^$(TEST)$$'

trace: build
	forge test --offline -vvvvv --match-contract LISATest --match-test '^$(TEST)$$'

snapshot: build
	forge snapshot --offline

fmt:
	forge fmt

clean:
	forge clean
	rm -rf build/yul
