#!/bin/bash
set -euo pipefail

RPC_URL="${SOROBAN_RPC_URL:-http://localhost:8000}"
FRIENDBOT_URL="${FRIENDBOT_URL:-http://localhost:8000/friendbot}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
MAX_RETRIES="${MAX_RETRIES:-30}"
RETRY_INTERVAL="${RETRY_INTERVAL:-2}"

echo "========================================="
echo "SoroMint Local Network Bootstrap Script"
echo "========================================="
echo "RPC URL:          ${RPC_URL}"
echo "Friendbot URL:    ${FRIENDBOT_URL}"
echo "Network Passphrase: ${NETWORK_PASSPHRASE}"
echo ""

wait_for_rpc() {
    echo "[1/${MAX_RETRIES}] Waiting for Stellar Quickstart RPC to be ready at ${RPC_URL}..."
    local attempt=1
    while [ "${attempt}" -le "${MAX_RETRIES}" ]; do
        if curl -sf "${RPC_URL}" > /dev/null 2>&1; then
            echo "RPC is ready after ${attempt} attempt(s)."
            return 0
        fi
        echo "  Attempt ${attempt}/${MAX_RETRIES} — RPC not ready, retrying in ${RETRY_INTERVAL}s..."
        sleep "${RETRY_INTERVAL}"
        attempt=$((attempt + 1))
    done
    echo "ERROR: RPC did not become ready after ${MAX_RETRIES} attempts." >&2
    return 1
}

fund_test_account() {
    local secret_key="$1"
    local public_key
    public_key=$(echo "${secret_key}" | sed 's/^S//')

    echo "Funding test account: ${public_key}"
    local response
    response=$(curl -sf -X POST "${FRIENDBOT_URL}" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "addr=${public_key}" 2>&1) || {
        echo "WARNING: Friendbot request failed for ${public_key}: ${response}" >&2
        return 1
    }
    echo "  Account funded successfully."
}

deploy_contract() {
    local contract_name="$1"
    local wasm_path="$2"

    if [ ! -f "${wasm_path}" ]; then
        echo "  WARNING: WASM file not found at ${wasm_path}, skipping ${contract_name}."
        return 1
    fi

    echo "Deploying ${contract_name} from ${wasm_path}..."

    local admin_secret="${ADMIN_SECRET_KEY:-}"
    if [ -z "${admin_secret}" ]; then
        echo "  WARNING: ADMIN_SECRET_KEY not set, cannot deploy ${contract_name}." >&2
        return 1
    fi

    local admin_public
    admin_public=$(echo "${admin_secret}" | sed 's/^S//')

    local build_cmd="soroban contract create \
        --wasm "${wasm_path}" \
        --source "${admin_secret}" \
        --network-passphrase "${NETWORK_PASSPHRASE}" \
        --rpc-url "${RPC_URL}""

    echo "  Running: ${build_cmd}"
    if eval "${build_cmd}" 2>&1; then
        echo "  ${contract_name} deployed successfully."
    else
        echo "  ERROR: Failed to deploy ${contract_name}." >&2
        return 1
    fi
}

echo ""
echo "--- Step 1: Wait for RPC ---"
wait_for_rpc

echo ""
echo "--- Step 2: Fund Test Accounts ---"
if [ -n "${ADMIN_SECRET_KEY:-}" ]; then
    fund_test_account "${ADMIN_SECRET_KEY}"
else
    echo "ADMIN_SECRET_KEY not set. Skipping account funding."
    echo "Set ADMIN_SECRET_KEY in your .env to fund test accounts."
fi

echo ""
echo "--- Step 3: Deploy Mock Contracts ---"

CONTRACTS_DIR="${CONTRACTS_DIR:-./contracts}"
if [ -d "${CONTRACTS_DIR}" ]; then
    for wasm_file in "${CONTRACTS_DIR}"/*/target/wasm32-unknown-unknown/release/*.wasm 2>/dev/null; do
        contract_dir=$(dirname "$(dirname "$(dirname "${wasm_file}")")")
        contract_name=$(basename "${contract_dir}")
        deploy_contract "${contract_name}" "${wasm_file}" || true
    done
else
    echo "Contracts directory ${CONTRACTS_DIR} not found. Skipping contract deployment."
fi

echo ""
echo "========================================="
echo "Bootstrap complete!"
echo "Local Soroban RPC is ready at ${RPC_URL}"
echo "========================================="