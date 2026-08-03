# Dependency Risk Register

| Risk | Control | Evidence |
|---|---|---|
| Vulnerable transitive package | lockfile policy, CI security scan and advisory review | `pnpm-lock.yaml`, CI logs |
| Unreviewed release dependency | workspace lockfile and SBOM generation | `artifacts/sprint18/sbom.cyclonedx.json` |
| Supply-chain script execution | reviewed package scripts, frozen lockfile in CI | workflow logs |

High/critical advisories block release until triaged and accepted by the security owner.
