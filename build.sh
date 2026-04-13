#!/usr/bin/env bash
# ============================================================================
# build.sh — Build Docker images for Open Agent Orchestra (OAO)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TAG="${BUILD_TAG:-latest}"

echo "═══════════════════════════════════════════════════════════════"
echo "  Building Open Agent Orchestra images  (tag: ${TAG})"
echo "═══════════════════════════════════════════════════════════════"

echo ""
echo "▸ [1/2] Building OAO-Core image: oao-core:${TAG}"
docker build -t "oao-core:${TAG}" -f Dockerfile.core .

echo ""
echo "▸ [2/2] Building OAO-UI image: oao-ui:${TAG}"
docker build -t "oao-ui:${TAG}" -f Dockerfile.ui .

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ All images built successfully"
echo ""
echo "  Images:"
echo "    oao-core:${TAG}  (API / Controller / Agent — single image, override CMD)"
echo "    oao-ui:${TAG}    (OAO-UI)"
echo "═══════════════════════════════════════════════════════════════"
