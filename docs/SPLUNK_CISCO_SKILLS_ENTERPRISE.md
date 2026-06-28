# Splunk/Cisco Skills Enterprise Integration

DefenseClaw loads Splunk/Cisco skills through a reviewed bundle image, not by
pulling mutable GitHub branches at runtime.

## Release Model

- Source repository: `https://github.com/chambear2809/splunk-cisco-skills`
- Current pinned source commit: `1c9925765fb033efda254577d04534c83226b8b2`
- Local source checkout: `make splunk-cisco-skills-source` clones or fetches
  `SPLUNK_CISCO_SKILLS_SOURCE` and checks out the pinned commit.
- Runtime release path:
  `/home/node/.openclaw/splunk-cisco-skills/releases/<source-sha>`
- Runtime pods do not install Python packages from PyPI. The bundle image
  vendors the MCP Python dependencies under `vendor/python`.
- The OpenClaw config points skills and MCP at the exact release path. There is
  no shared mutable `current` directory.

The `splunk-cisco-skills-bundle` workflow builds the image from a minimal
context containing only `skills/`, `agent/`, `.mcp.json`, `README.md`, and
`requirements-agent.txt`. The workflow runs MCP smoke tests, a DefenseClaw skill
scan smoke test, generates an SBOM, pushes to ECR, signs with Cosign, and opens
a follow-up PR to pin the published digest.

For a local bundle image:

```bash
make splunk-cisco-skills-source
make docker-splunk-cisco-skills-bundle
```

## Runtime Controls

- `automountServiceAccountToken: false` stays set on OpenClaw and DefenseClaw.
- Splunk/Cisco MCP mutation is enabled only in the OpenClaw autonomous profile
  through `SPLUNK_SKILLS_MCP_ALLOW_MUTATION=1`.
- Execution still requires MCP plan hash matching and `confirm=true`.
- DefenseClaw watcher is enabled in observe/allow mode first:
  `gateway.watcher.skill.take_action=false` and
  `gateway.watcher.mcp.take_action=false`.
- Splunk credentials are mounted from the `splunk-cisco-skills-credentials`
  Secret into an `emptyDir`, copied to
  `/var/run/splunk-cisco-skills/credentials`, set to `0600`, owned by UID
  `1000`, and verified by an init container running as UID `1000`.

If a future skill needs Kubernetes API access, add a separate scoped runner
profile with minimal RBAC. Do not add broad service-account credentials to the
main OpenClaw pod.

## Validation

After rollout:

```bash
kubectl -n defenseclaw rollout status deploy/defenseclaw
kubectl -n defenseclaw rollout status deploy/openclaw

kubectl -n defenseclaw exec deploy/openclaw -- \
  sh -c 'release=/home/node/.openclaw/splunk-cisco-skills/releases/1c9925765fb033efda254577d04534c83226b8b2; test -s "$release/.complete" && test "$(cat "$release/.revision")" = "1c9925765fb033efda254577d04534c83226b8b2"'
```

Then validate OpenClaw and the guarded MCP surface:

```bash
openclaw skills list --json
openclaw mcp show
```

Expected MCP tool checks are `list_skills`, `credential_status`,
`list_cisco_products`, `resolve_cisco_product`, and a read-only `plan_*` call.
Execution tools must reject calls without the returned plan hash and
`confirm=true`.

Rollback is a GitOps revert: pin the previous source SHA and signed bundle
digest, then roll the OpenClaw session.
