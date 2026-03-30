SHELL := /bin/bash
.PHONY: build deploy

build:
	./scripts/build.sh

deploy:
	. ./.env && \
	cd app && ../scripts/deploy.sh $(NAME)
