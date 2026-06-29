# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:20.20.2-bookworm-slim
ARG UV_VERSION=0.11.19

FROM ${NODE_IMAGE}
ARG APP_VERSION
ARG UV_VERSION

ENV PYTHONUNBUFFERED=1 \
    PATH=/usr/local/bin:/app/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    DEFENSECLAW_CONFIG=/config/config.yaml

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        make \
        python3 \
        python3-pip \
        rsync \
        tini \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --break-system-packages --no-cache-dir "uv==${UV_VERSION}"

COPY pyproject.toml uv.lock README.md LICENSE Makefile ./
COPY cli ./cli
COPY internal/configs ./internal/configs
COPY policies ./policies
COPY schemas ./schemas
COPY scripts ./scripts
COPY skills ./skills
COPY bundles ./bundles
COPY extensions/defenseclaw/package*.json ./extensions/defenseclaw/
COPY extensions/defenseclaw/openclaw.plugin.json ./extensions/defenseclaw/
COPY extensions/defenseclaw/tsconfig.json ./extensions/defenseclaw/
COPY extensions/defenseclaw/typings ./extensions/defenseclaw/typings
COPY extensions/defenseclaw/src ./extensions/defenseclaw/src
COPY defenseclaw-gateway-galileo-linux-amd64 /usr/local/bin/defenseclaw-gateway

RUN set -eux; \
    if [ -n "${APP_VERSION:-}" ]; then scripts/stamp-version.sh "${APP_VERSION}"; fi; \
    cp internal/configs/providers.json extensions/defenseclaw/src/providers.json; \
    cd extensions/defenseclaw; \
    npm ci --include=dev; \
    npm run build; \
    npm prune --omit=dev; \
    find dist -type d -name __tests__ -prune -exec rm -rf '{}' +; \
    find dist -type f \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.js.map' \) -delete; \
    rm -rf src typings tsconfig.json node_modules/.cache; \
    rm -f package-lock.json node_modules/.package-lock.json; \
    cd /app; \
    make _bundle-data; \
    uv sync --frozen --no-default-groups --no-managed-python --python /usr/bin/python3 --link-mode copy --no-cache; \
    printf '%s\n' '#!/bin/sh' 'exec defenseclaw plugin scan --json "$@"' > /usr/local/bin/defenseclaw-plugin-scanner; \
    chmod 0755 /usr/local/bin/defenseclaw-gateway /usr/local/bin/defenseclaw-plugin-scanner; \
    mkdir -p /opt; \
    ln -s /app /opt/defenseclaw; \
    test -s /opt/defenseclaw/extensions/defenseclaw/dist/index.js; \
    test -s /opt/defenseclaw/policies/rego/data.json; \
    rm -rf /app/cli/tests /app/build /app/cli/*.egg-info /root/.cache /tmp/*

EXPOSE 18970
ENTRYPOINT ["tini", "--"]
CMD ["defenseclaw-gateway"]

USER 1000:1000
