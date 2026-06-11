FROM openclaw-sandbox:bookworm-slim

USER root

# OpenClaw's pinned edit/write helpers require Python inside the sandbox.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*
