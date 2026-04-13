#!/usr/bin/env bash
# ============================================================================
# publish.sh — Publish Docker images & Helm chart to Docker Hub / OCI registry
# ============================================================================
# Usage:
#   DOCKER_USERNAME=myuser BUILD_TAG=v1.0 ./publish.sh
#
# Required env vars:
#   DOCKER_USERNAME   — Docker Hub username (or org)
#   BUILD_TAG         — Semantic version tag (e.g. v1.0, v2.3.1)
#
# Optional:
#   DOCKER_REGISTRY   — Registry hostname (default: docker.io)
#   HELM_REGISTRY     — OCI registry for Helm charts (default: oci://registry-1.docker.io)
#   SKIP_BUILD        — Set to "true" to skip Docker build (push existing images)
#   SKIP_HELM         — Set to "true" to skip Helm chart push
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Load .env if present ────────────────────────────────────────────────────
if [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a
  source "${SCRIPT_DIR}/.env"
  set +a
fi

# ─── Validate required inputs ────────────────────────────────────────────────

if [ -z "${DOCKER_USERNAME:-}" ]; then
  echo "Error: DOCKER_USERNAME is required." >&2
  echo "  Usage: DOCKER_USERNAME=myuser BUILD_TAG=v1.0 ./publish.sh" >&2
  exit 1
fi

TAG="${BUILD_TAG:-latest}"
REGISTRY="${DOCKER_REGISTRY:-docker.io}"
HELM_REGISTRY="${HELM_REGISTRY:-oci://registry-1.docker.io/${DOCKER_USERNAME}}"

CORE_IMAGE="${DOCKER_USERNAME}/oao-core"
UI_IMAGE="${DOCKER_USERNAME}/oao-ui"

echo "═══════════════════════════════════════════════════════════════"
echo "  Open Agent Orchestra — Publish to Docker Hub"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Docker Username : ${DOCKER_USERNAME}"
echo "  Registry        : ${REGISTRY}"
echo "  Tag             : ${TAG}"
echo "  Core Image      : ${CORE_IMAGE}:${TAG}"
echo "  UI Image        : ${UI_IMAGE}:${TAG}"
echo "  Helm Registry   : ${HELM_REGISTRY}"
echo ""

# ─── Pre-flight checks ──────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  echo "Error: docker not found." >&2
  exit 1
fi

if [ "${SKIP_HELM:-}" != "true" ] && ! command -v helm &>/dev/null; then
  echo "Error: helm not found. Install it or set SKIP_HELM=true." >&2
  exit 1
fi

# Check Docker login
if ! docker info 2>/dev/null | grep -q "Username"; then
  echo "▸ Logging in to Docker Hub..."
  docker login "${REGISTRY}"
fi

# ─── Step 1: Build Docker images (unless SKIP_BUILD) ────────────────────────

if [ "${SKIP_BUILD:-}" != "true" ]; then
  echo "▸ [1/4] Building Docker images..."
  echo ""

  echo "  Building oao-core:${TAG}..."
  docker build -t "oao-core:${TAG}" -f Dockerfile.core .

  echo "  Building oao-ui:${TAG}..."
  docker build -t "oao-ui:${TAG}" -f Dockerfile.ui .
else
  echo "▸ [1/4] Skipping build (SKIP_BUILD=true)"
  docker tag "oao-core:${TAG}" "oao-core:${TAG}" 2>/dev/null || true
  docker tag "oao-ui:${TAG}" "oao-ui:${TAG}" 2>/dev/null || true
fi

# ─── Step 2: Tag for registry ────────────────────────────────────────────────

echo ""
echo "▸ [2/4] Tagging images for registry..."

docker tag "oao-core:${TAG}" "${CORE_IMAGE}:${TAG}"
docker tag "oao-core:${TAG}" "${CORE_IMAGE}:latest"
docker tag "oao-ui:${TAG}" "${UI_IMAGE}:${TAG}"
docker tag "oao-ui:${TAG}" "${UI_IMAGE}:latest"

# ─── Step 3: Push Docker images ─────────────────────────────────────────────

echo ""
echo "▸ [3/4] Pushing Docker images..."

docker push "${CORE_IMAGE}:${TAG}"
docker push "${CORE_IMAGE}:latest"
docker push "${UI_IMAGE}:${TAG}"
docker push "${UI_IMAGE}:latest"

echo "  ✓ Docker images pushed"

# ─── Step 4: Package & Push Helm chart ───────────────────────────────────────

if [ "${SKIP_HELM:-}" != "true" ]; then
  echo ""
  echo "▸ [4/4] Packaging and pushing Helm chart..."

  CHART_DIR="${SCRIPT_DIR}/helm/oao-platform"

  # Update Chart.yaml version to match BUILD_TAG (strip 'v' prefix)
  CHART_VERSION="${TAG#v}"
  sed -i.bak "s/^version:.*/version: ${CHART_VERSION}/" "${CHART_DIR}/Chart.yaml"
  sed -i.bak "s/^appVersion:.*/appVersion: \"${TAG}\"/" "${CHART_DIR}/Chart.yaml"
  rm -f "${CHART_DIR}/Chart.yaml.bak"

  # Package the chart
  helm package "${CHART_DIR}" --destination /tmp/oao-helm/
  CHART_PKG="/tmp/oao-helm/oao-platform-${CHART_VERSION}.tgz"

  if [ -f "$CHART_PKG" ]; then
    # Push to OCI registry
    helm push "$CHART_PKG" "${HELM_REGISTRY}"
    echo "  ✓ Helm chart pushed: ${HELM_REGISTRY}/oao-platform:${CHART_VERSION}"
  else
    echo "  ⚠ Chart package not found at expected path, looking for alternatives..."
    CHART_PKG=$(ls /tmp/oao-helm/*.tgz 2>/dev/null | head -1)
    if [ -n "$CHART_PKG" ]; then
      helm push "$CHART_PKG" "${HELM_REGISTRY}"
      echo "  ✓ Helm chart pushed"
    else
      echo "  ✗ Failed to find packaged chart" >&2
    fi
  fi

  rm -rf /tmp/oao-helm/
else
  echo ""
  echo "▸ [4/4] Skipping Helm chart publish (SKIP_HELM=true)"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Publish complete"
echo ""
echo "  Docker Images:"
echo "    ${UI_IMAGE}:${TAG}          (OAO-UI — port 3002)"
echo "    ${API_IMAGE}:${TAG}         (OAO-API — port 4002)"
echo "    ${CONTROLLER_IMAGE}:${TAG}  (OAO-Controller — trigger poller + K8s provisioner)"
echo ""
echo "  Pull commands:"
echo "    docker pull ${UI_IMAGE}:${TAG}"
echo "    docker pull ${API_IMAGE}:${TAG}"
echo "    docker pull ${CONTROLLER_IMAGE}:${TAG}"
if [ "${SKIP_HELM:-}" != "true" ]; then
  echo ""
  echo "  Helm Chart:"
  echo "    helm pull ${HELM_REGISTRY}/oao-platform --version ${TAG#v}"
fi
echo "═══════════════════════════════════════════════════════════════"
