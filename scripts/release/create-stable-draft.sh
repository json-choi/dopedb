#!/usr/bin/env bash
# Creates the owner-attributed annotated tag and draft release before the
# protected stable build is approved. GitHub Actions intentionally cannot
# bypass the owner-only tag ruleset to create this release on its own.
set -euo pipefail

project_root="$(cd "$(dirname "$0")/../.." && pwd)"
readonly project_root
readonly repository="json-choi/dopedb"

fail() {
  echo "stable-draft: $*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: pnpm release:stable:draft -- [X.Y.Z]

Creates an annotated app-vX.Y.Z tag and its draft GitHub release from the
clean, pushed main HEAD. Run only after an explicit stable-release request.
Approve the stable-release environment only after this command succeeds.
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if (( $# > 1 )); then
  usage
  exit 64
fi

cd "$project_root"

if (( $# == 1 )); then
  version="$1"
else
  version="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
fi
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  fail "version must be a stable X.Y.Z value"
fi
readonly version
readonly tag="app-v$version"

if [[ "$(git branch --show-current)" != "main" ]]; then
  fail "stable releases must start from main"
fi
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  fail "the worktree must be clean before creating a stable release"
fi

node scripts/release/verify-release-version.mjs "$version"
pnpm check:agent-runtime:published
git fetch origin main --tags

head_sha="$(git rev-parse HEAD)"
remote_main_sha="$(git rev-parse origin/main)"
readonly head_sha remote_main_sha
if [[ "$head_sha" != "$remote_main_sha" ]]; then
  fail "HEAD must exactly match origin/main"
fi
if git show-ref --verify --quiet "refs/tags/$tag"; then
  fail "tag $tag already exists"
fi
if gh release view "$tag" --repo "$repository" >/dev/null 2>&1; then
  fail "release $tag already exists"
fi

notes_path="$(mktemp "${TMPDIR:-/tmp}/dopedb-release-notes.XXXXXX")"
readonly notes_path
cleanup() {
  rm -f "$notes_path"
}
trap cleanup EXIT

notes_args=(
  render
  --version "$version"
  --tag "$tag"
  --to "$head_sha"
  --output "$notes_path"
)
if [[ "$(node scripts/release/generate-release-notes.mjs mode)" == "active" ]]; then
  previous_tag="$(gh api "repos/$repository/releases/latest" --jq .tag_name)"
  if [[ ! "$previous_tag" =~ ^app-v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "latest published release does not have a stable app-v tag"
  fi
  notes_args+=(--from "$previous_tag")
fi
node scripts/release/generate-release-notes.mjs "${notes_args[@]}"

pnpm repo:owner-identity -- git tag -a "$tag" -m "DopeDB $version" "$head_sha"

if ! pnpm gh:owner -- git push origin "refs/tags/$tag"; then
  fail "tag push failed; inspect local and remote $tag before retrying"
fi

if ! pnpm gh:owner -- gh release create "$tag" \
  --repo "$repository" \
  --verify-tag \
  --draft \
  --title "dopedb v$version" \
  --notes-file "$notes_path"; then
  fail "tag was pushed but draft creation failed; do not approve the release workflow until the draft exists"
fi

echo "stable-draft: created $tag and its draft release"
echo "stable-draft: review the draft, then approve the stable-release environment"
