# Forge installs the pinned compiler here. Override SOLC for custom installations.
SOLC ?= $(HOME)/.svm/0.8.29/solc-0.8.29
YUL_FLAGS ?=
TEST ?= test_Program_FullIntegration

.PHONY: build fixtures test test-ts test-opt debug trace snapshot fmt clean

build:
	forge build
	bash scripts/compile-yul.sh "$(SOLC)" $(YUL_FLAGS)

fixtures: build
	node ts/tools/gen-runtime-fixtures.ts

# Runtime-compatibility fixtures are generated before the Forge suite so
# test/LISATooling.t.sol executes the real Yul runtime against TS output.
test: fixtures
	forge test --offline -vvv

test-ts:
	cd ts && node --test test/*.test.ts

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
	rm -rf build/yul build/fixtures ts/dist
