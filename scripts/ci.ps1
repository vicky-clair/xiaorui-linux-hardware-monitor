#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

Write-Host "==> [1/5] TypeScript typecheck"
bun run typecheck

Write-Host "==> [2/5] Bun tests (Protocol + API + Web)"
bun run test

Write-Host "==> [3/5] Web production build"
bun run build:web

Write-Host "==> [4/5] Rust fmt + clippy + tests"
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

Write-Host "==> [5/5] Haskell build + tests"
Push-Location core/health-engine
try {
    cabal build all
    cabal test all --test-show-details=direct
} finally {
    Pop-Location
}

Write-Host "All L0 CI checks passed."
