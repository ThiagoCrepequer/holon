FROM docker.io/cloudflare/sandbox:0.13.0-next.751.1@sha256:712d12b2bd6f91ae66d83cebd9f7a0bfa684ae3e3100299c315d20d2ce38b8b1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ripgrep=13.0.0-2ubuntu0.1 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global @ast-grep/cli@0.45.2 \
    && git --version \
    && realpath --version \
    && sed --version \
    && rg --version \
    && ast-grep --version
