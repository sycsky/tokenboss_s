# SQLite WAL/SHM cleanup from version control

**Date:** 2026-04-23
**Status:** Approved, pending implementation

## Context

Upstream commit `5d26b54` ("12", authored by `您的yh <359672322@qq.com>`) was pushed
to `origin/main` while our local dev backend was running. The commit accidentally
tracks two SQLite runtime artifacts alongside legitimate changes:

| File | Keep? | Reason |
|---|---|---|
| `pack-router.mjs` | yes | Automates ClawRouter → install tarball rebuild |
| `backend/zbpack.json` | yes | Zeabur build/start config |
| `frontend/zbpack.json` | yes | Zeabur build/output config |
| `frontend/vite.config.ts` (port 5173 → 5179) | yes | Upstream's dev port preference |
| `backend/data/tokenboss.db-shm` | **no** | SQLite shared-memory file, regenerated on open |
| `backend/data/tokenboss.db-wal` | **no** | SQLite write-ahead log, regenerated on open |

Tracking WAL/SHM is wrong because they are transient, binary, and only meaningful
alongside a specific `.db` byte-state. Any future commit that modifies
`tokenboss.db` without also committing consistent WAL/SHM will leave the repo in
an inconsistent state on fresh clones.

## Constraint

`您的yh` is a collaborator, not the same person on another machine. We must not
rewrite `origin/main` history. Cleanup has to happen in a new forward commit.

## Design

### Steps

1. **Stop the local backend** (background task `buapz8qba`) so SQLite releases
   its exclusive hold on the WAL/SHM files.
2. **Move local untracked WAL/SHM aside** (`.bak` suffix) so the pull isn't
   blocked by the "would overwrite untracked files" check. Don't delete — keep
   as safety net in case we need to inspect.
3. **`git pull --rebase origin main`** to fold upstream `5d26b54` under our
   local spec commit. `--ff-only` would have worked before the spec was
   committed; rebase is needed now that the branches have diverged by one
   commit each. No conflicts are expected since the spec touches
   `docs/superpowers/specs/` only.
4. **Cleanup commit**:
   - `git rm --cached backend/data/tokenboss.db-shm backend/data/tokenboss.db-wal`
   - Append to `backend/.gitignore`:
     ```
     *.db-shm
     *.db-wal
     *.db-journal
     ```
     (Chose broad patterns so any SQLite file in the backend — not just
     `tokenboss.db` — is protected.)
   - Commit message explains why, so the collaborator sees the reason when they
     pull next.
5. **Push** the cleanup commit.
6. **Restart the backend** (`npm run dev` in `backend/`). SQLite will recreate
   WAL/SHM on first write.
7. **Discard the `.bak` files** once the server is confirmed healthy.

### Non-goals

- **No pre-commit hook** to enforce the gitignore (YAGNI; the mistake happened
  once). Reconsider if it recurs.
- **No rewrite of upstream history.** The WAL/SHM blobs will remain in git
  history forever; that's the cost of catching this after-the-fact.
- **No discussion with collaborator up-front.** The commit message serves as
  async notification.

## Risk & rollback

- Lost WAL data = the one unflushed write from today's earlier auto-heal test
  (user `u_e41e143f8a54461e8d05` gained `newapiUserId: 30`). That code change
  has since been reverted, so losing the DB-level side effect is consistent.
- If the pull or push fails, `.bak` files can be moved back and the backend
  restarted with no net change.

## Acceptance

- `git status` shows clean tree
- `backend/.gitignore` contains `*.db-shm`, `*.db-wal`, `*.db-journal`
- `origin/main` has exactly two new commits beyond the pre-pull state: the
  pulled `5d26b54`, plus our cleanup commit
- Backend running, `GET /hello` returns 200
