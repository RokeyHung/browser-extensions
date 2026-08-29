# Makefile — repo-wide formatting for every extension in this folder.
#
# Prettier is pinned so the result is the same on every machine; npx fetches it
# on first run and caches it afterwards. Nothing is installed into the repo:
# these extensions have no package.json and no node_modules on purpose.
#
# Settings live in .prettierrc and were chosen to match the code that was
# already here — running `make format` on a clean checkout touches nothing but
# the files that had genuinely drifted.

PRETTIER_VERSION ?= 3.4.2
PRETTIER ?= npx --yes prettier@$(PRETTIER_VERSION)

.DEFAULT_GOAL := help
.PHONY: help format format-check

help: ## Show the available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

format: ## Format every JS, HTML, CSS, JSON and Markdown file in the repo
	$(PRETTIER) --write .

format-check: ## Fail if anything is unformatted, without changing files
	$(PRETTIER) --check .
