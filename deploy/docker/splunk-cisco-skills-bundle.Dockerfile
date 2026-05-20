# syntax=docker/dockerfile:1.7

FROM python:3.13-slim AS deps

WORKDIR /src
COPY requirements-agent.txt /src/requirements-agent.txt

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir --target /vendor/python -r /src/requirements-agent.txt

FROM busybox:1.36.1

ARG BUNDLE_SOURCE_REPO="https://github.com/chambear2809/splunk-cisco-skills"
ARG BUNDLE_SOURCE_COMMIT
ARG BUNDLE_BUILD_URL
ARG BUNDLE_BUILD_TIMESTAMP
ARG BUNDLE_SBOM_DIGEST

LABEL org.opencontainers.image.title="splunk-cisco-skills-bundle" \
      org.opencontainers.image.description="Pinned Splunk/Cisco skills, guarded MCP server, and vendored Python dependencies for DefenseClaw/OpenClaw" \
      org.opencontainers.image.source="${BUNDLE_SOURCE_REPO}" \
      org.opencontainers.image.revision="${BUNDLE_SOURCE_COMMIT}" \
      org.opencontainers.image.created="${BUNDLE_BUILD_TIMESTAMP}" \
      org.opencontainers.image.url="${BUNDLE_BUILD_URL}" \
      io.defenseclaw.bundle.sbom.digest="${BUNDLE_SBOM_DIGEST}"

WORKDIR /bundle

COPY skills/ /bundle/skills/
COPY agent/ /bundle/agent/
COPY .mcp.json README.md requirements-agent.txt bundle-manifest.json /bundle/
COPY --from=deps /vendor /bundle/vendor

RUN test -n "${BUNDLE_SOURCE_COMMIT}" \
    && test -d /bundle/skills \
    && test -d /bundle/agent \
    && test -s /bundle/.mcp.json \
    && test -s /bundle/requirements-agent.txt \
    && echo "${BUNDLE_SOURCE_COMMIT}" > /bundle/.revision \
    && chmod -R a+rX /bundle \
    && chmod 0755 /bundle/agent/run-splunk-cisco-skills-mcp.py
