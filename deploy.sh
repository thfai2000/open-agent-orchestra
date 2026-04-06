#!/usr/bin/env bash
# ============================================================================
# deploy.sh — Deploy Agent Orchestration Platform to Kubernetes via Helm
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELM_DIR="${SCRIPT_DIR}/helm"

# ─── Pre-flight checks ──────────────────────────────────────────────────────

if ! command -v kubectl &>/dev/null; then
  echo "Error: kubectl not found. Install it first." >&2
  exit 1
fi

if ! command -v helm &>/dev/null; then
  echo "Error: helm not found. Install it first." >&2
  echo "  brew install helm" >&2
  exit 1
fi

if ! kubectl cluster-info &>/dev/null 2>&1; then
  echo "Error: Cannot connect to Kubernetes cluster." >&2
  echo "Make sure Docker Desktop Kubernetes or another cluster is running." >&2
  exit 1
fi

if [ ! -f "${HELM_DIR}/agent-platform/values.yaml" ]; then
  echo "Error: helm/agent-platform/values.yaml not found." >&2
  echo "" >&2
  echo "Create it from the template:" >&2
  echo "  cp helm/agent-platform/values.yaml.template helm/agent-platform/values.yaml" >&2
  echo "  # Then edit helm/agent-platform/values.yaml with your real credentials" >&2
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Deploying Agent Orchestration Platform to Kubernetes (Helm)"
echo "═══════════════════════════════════════════════════════════════"

# ─── Deploy Agent Platform (API + UI + PostgreSQL + Redis) ───────────────────

echo ""
echo "▸ [1/1] Deploying Agent Orchestration Platform ..."
helm upgrade --install agent-platform "${HELM_DIR}/agent-platform" \
  -f "${HELM_DIR}/agent-platform/values.yaml" \
  --namespace agent-orchestra --create-namespace

echo "▸ Waiting for redis to be ready ..."
kubectl -n agent-orchestra rollout status deployment/redis --timeout=60s 2>/dev/null || true

echo "▸ Waiting for postgres to be ready ..."
kubectl -n agent-orchestra rollout status statefulset/postgres --timeout=120s 2>/dev/null || true

echo "▸ Waiting for agent-api to be ready ..."
kubectl -n agent-orchestra rollout status deployment/agent-api --timeout=120s 2>/dev/null || true

echo "▸ Waiting for agent-ui to be ready ..."
kubectl -n agent-orchestra rollout status deployment/agent-ui --timeout=120s 2>/dev/null || true

# ─── Database schema push ─────────────────────────────────────────────────────

echo ""
echo "▸ [3/3] Running database schema push (Drizzle)..."

kubectl -n agent-orchestra port-forward pod/postgres-0 15432:5432 &>/dev/null &
PF_PID=$!
sleep 3

echo "▸ Pushing agent DB schema..."
(cd "${SCRIPT_DIR}/packages/agent-api" && AGENT_DATABASE_URL="postgresql://ai_trader:ai_trader_dev@localhost:15432/agent_db" npx drizzle-kit push 2>&1 || true)

kill $PF_PID 2>/dev/null || true

# ─── Port forwards ────────────────────────────────────────────────────────────

echo ""
echo "▸ Setting up port-forwards for localhost access..."

pkill -f "kubectl.*port-forward.*agent-orchestra" 2>/dev/null || true
sleep 1

kubectl -n agent-orchestra port-forward svc/agent-ui 3002:3002 &>/dev/null &
kubectl -n agent-orchestra port-forward svc/agent-api 4002:4002 &>/dev/null &
sleep 2

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Deployment complete"
echo ""
echo "  Helm release:"
echo "    agent-platform      — Agent API + UI + PostgreSQL + Redis"
echo ""
echo "  Access (via port-forward):"
echo "    Agent UI:   http://localhost:3002"
echo "    Agent API:  http://localhost:4002"
echo ""
echo "  Useful commands:"
echo "    kubectl -n agent-orchestra get pods"
echo "    kubectl -n agent-orchestra logs -f deployment/agent-api"
echo "    helm list -n agent-orchestra"
echo "    helm uninstall agent-platform -n agent-orchestra"
echo "═══════════════════════════════════════════════════════════════"
