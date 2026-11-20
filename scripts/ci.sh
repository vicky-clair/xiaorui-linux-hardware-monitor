#!/usr/bin/env bash
set -euo pipefail

echo "==> Rust fmt + clippy + tests"
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

if command -v bun >/dev/null 2>&1; then
  echo "==> Bun typecheck + test + web build"
  bun run typecheck
  bun run test
  bun run build:web
else
  echo "==> Skipping Bun checks (bun not installed on this host)"
fi

if command -v cabal >/dev/null 2>&1; then
  echo "==> Haskell build + tests"
  (cd core/health-engine && cabal build all && cabal test all --test-show-details=direct)
else
  echo "==> Skipping Haskell checks (cabal not installed on this host)"
fi

echo "Linux CI checks completed."
