.PHONY: help install test test-py test-js parity parity-full lint dev build clean demo sweep

help:
	@echo "Boarding Lab — airplane boarding simulator"
	@echo ""
	@echo "  make install     Install Python + Node dependencies"
	@echo "  make test        Run every test (python, js, parity)"
	@echo "  make test-py     pytest only"
	@echo "  make test-js     vitest only"
	@echo "  make parity      Fast gate: RNG vectors + 15 fixture digests (seconds)"
	@echo "  make parity-full 384 scenarios, COMPLETE results, exact (under a minute)"
	@echo "  make lint        ESLint the web app"
	@echo "  make dev         Start the web app on http://localhost:5173"
	@echo "  make build       Production build of the web app"
	@echo "  make demo        Rank all 16 strategies on an A320neo through one door"
	@echo "  make sweep       Boarding time vs how far forward status sits"

install:
	cd web && npm install --no-audit --no-fund
	cd python && python3 -m pip install -e ".[dev]" --quiet

test: test-py test-js parity
	@echo ""
	@echo "All test suites passed."

test-py:
	cd python && python3 -m pytest -q

test-js:
	cd web && npm run test

parity:
	python3 parity/compare.py

# The digest `make parity` compares is a hash of a SUMMARY: it catches gross
# divergence in seconds, which is why it is the gate, but it can pass while
# individual per-passenger records differ. This is the check that actually
# proved the port -- 16 strategies x 6 aircraft x 4 configurations, complete
# RunResults compared field by field with no tolerance. Takes wall-clock tens of
# seconds; run it before a release and after any change to the engine.
parity-full:
	python3 parity/compare.py --full

lint:
	cd web && npm run lint

dev:
	cd web && npm run dev

build:
	cd web && npm run build

# Single door, because that is the configuration the field regression the model
# is calibrated against describes, and the one the README quotes.
demo:
	cd python && python3 -m plane_boarding.cli compare --aircraft a320neo --doors 1L --runs 40

# The sweep that turns "does selling priority boarding cost time?" into a curve.
sweep:
	cd python && python3 -m plane_boarding.cli sweep --param eliteForwardBias \
		--aircraft a320neo --doors 1L --strategies priority_5tier random --runs 20

clean:
	rm -rf web/dist web/node_modules python/**/__pycache__ python/.pytest_cache
