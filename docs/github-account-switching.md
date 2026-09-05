# GitHub account and commit identity

The shared development machine keeps `jaesong-blip` as the default active
GitHub CLI account. For this repository, `jaesong-blip` and `json-choi`
represent the same human operator and both use the direct-`main` workflow.
Do not create a work branch or additional worktree unless the user explicitly
requests one.

Git commit authorship and the GitHub CLI actor are separate. Every contributor,
including an AI worker acting for that contributor, keeps their existing Git
`user.name` and `user.email`. Repository instructions and scripts must never
rewrite another contributor's commit to `json-choi`.

Only when the repository owner explicitly requests an owner-authored direct-`main`
commit may that one command use the owner identity:

```sh
pnpm repo:owner-identity -- git commit ...
```

The wrapper injects author and committer environment variables for that command
only, requires `main`, and never changes repository-local or global Git config.
Stable-release automation uses the same one-shot boundary to create its annotated
owner tag. Contributors and PR workers do not use this wrapper.

An operation that GitHub must attribute to the repository owner temporarily
uses `json-choi` only through the repository wrapper:

```sh
pnpm gh:owner -- gh issue edit 123 --add-label security
pnpm gh:owner -- git push origin main
```

Contributors and PR workers never use either owner wrapper. They keep their own
Git identity and push their branch with their own authenticated GitHub account.

The wrapper:

- accepts only a `gh` command or `git push`;
- rejects nested `gh auth` changes;
- verifies the active default account and repository owner;
- serializes account-scoped commands with a per-user lock;
- verifies `json-choi` before running the command;
- restores and verifies `jaesong-blip` on success, failure, or a handled signal;
- returns the wrapped command's original exit status unless restoration fails;
- never reads, prints, copies, or stores a token.

Normal reads and non-owner GitHub operations keep using `jaesong-blip`. Direct
`main` pushes, protected tags, stable releases, environment approvals, and
repository-administration calls use the wrapper so GitHub records
`json-choi` as the actor.

For an explicitly requested release, an agent may approve that release's
`stable-release` deployment after reviewing its exact draft, commit, artifacts,
and required checks. This includes required ACP adapter releases. The wrapper
does not grant authority for unrelated approvals or waive release checks.

If a process is killed before cleanup completes, first confirm that no wrapper
process is still active, then recover the default account and stale lock:

```sh
pnpm gh:restore
```

Do not use a raw `gh auth switch` for repository work. Do not run multiple
account-switching commands concurrently. The wrapper changes the host-wide
active GitHub CLI account briefly, so keep the wrapped operation minimal.
