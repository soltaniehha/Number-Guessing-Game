.PHONY: help install test test-py test-js parity lint dev build clean demo

help:
	@echo "Boarding Lab — airplane boarding simulator"
	@echo ""
	@echo "  make install    Install Python + Node dependencies"
	@echo "  make test       Run every test (python, js, parity)"
	@echo "  make test-py    pytest only"
	@echo "  make test-js    vitest only"
	@echo "  make parity     Verify the Python and JS engines agree exactly"
	@echo "  make lint       ESLint the web app"
	@echo "  make dev        Start the web app on http://localhost:5173"
	@echo "  make build      Production build of the web app"
	@echo "  make demo       Run the CLI benchmark across all strategies"

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

lint:
	cd web && npm run lint

dev:
	cd web && npm run dev

build:
	cd web && npm run build

demo:
	cd python && python3 -m plane_boarding.cli compare --aircraft a320neo --runs 30

clean:
	rm -rf web/dist web/node_modules python/**/__pycache__ python/.pytest_cache
