#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: prepare-splunk-cisco-skills-bundle-context.sh SOURCE_REPO_DIR OUTPUT_DIR EXPECTED_SHA

Create a minimal Docker build context for the Splunk/Cisco skills bundle.
Only skills/, agent/, .mcp.json, README.md, and requirements-agent.txt are
copied. The script refuses to continue if SOURCE_REPO_DIR is not at
EXPECTED_SHA.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -ne 3 ]; then
  usage >&2
  exit 2
fi

source_dir="$1"
output_dir="$2"
expected_sha="$3"

if [ ! -d "${source_dir}/.git" ]; then
  echo "source repo is not a git checkout: ${source_dir}" >&2
  exit 1
fi

actual_sha="$(git -C "${source_dir}" rev-parse HEAD)"
if [ "${actual_sha}" != "${expected_sha}" ]; then
  echo "source SHA mismatch: got ${actual_sha}, expected ${expected_sha}" >&2
  exit 1
fi

for required in skills agent .mcp.json README.md requirements-agent.txt; do
  if [ ! -e "${source_dir}/${required}" ]; then
    echo "missing required source path: ${required}" >&2
    exit 1
  fi
done

rm -rf "${output_dir}"
mkdir -p "${output_dir}"

cp -R "${source_dir}/skills" "${output_dir}/skills"
cp -R "${source_dir}/agent" "${output_dir}/agent"
cp "${source_dir}/.mcp.json" "${output_dir}/.mcp.json"
cp "${source_dir}/README.md" "${output_dir}/README.md"
cp "${source_dir}/requirements-agent.txt" "${output_dir}/requirements-agent.txt"

find "${output_dir}" \
  \( -type d \( -name __pycache__ -o -name .pytest_cache -o -name .ruff_cache -o -name .mypy_cache \) -prune \) \
  -exec rm -rf {} +

skill_count="$(find "${output_dir}/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')"
cat > "${output_dir}/bundle-manifest.json" <<EOF
{
  "source_repo": "$(git -C "${source_dir}" config --get remote.origin.url || true)",
  "source_sha": "${actual_sha}",
  "skill_count": ${skill_count}
}
EOF

echo "Prepared ${output_dir} from ${actual_sha} with ${skill_count} skills"
