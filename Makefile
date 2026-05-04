SHELL := /bin/bash
.PHONY: build deploy

DOMAIN ?= browse-beta00
MODALITY ?= spa

build:
	./scripts/build.sh

deploy:
	. ./.env && \
	cd app && ../scripts/deploy.sh $(DOMAIN) $(MODALITY)
