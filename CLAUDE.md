# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install deps (Node, no build step).
- `npm run setup` — create the `presentation-slot` label on the repo (idempotent).
- `npm run seed` — create one GitHub issue per row in `data/slots.csv`, add each to Project v2, and populate the **Marker** field. Idempotent: skips issues whose title already exists.

Both scripts require `.env` with `GITHUB_TOKEN`, `PROJECT_OWNER`, `PROJECT_NUMBER` (see `.env.example`). Owner/repo for issue creation is auto-derived from `git remote get-url origin` (see `scripts/_repo.js`) — the `PROJECT_*` vars are only for the Project v2 board, which may live in a different org.

There are no tests, no linter, and no build. Work is validated by running the seed script against a test repo, or by observing the GitHub Action on a real assignment event.

## Architecture

This is not a typical application — it's a **GitHub-native workflow**. The "runtime" is GitHub itself:

- **Seeding (local, one-shot):** `scripts/create-issues.js` reads `data/slots.csv` and creates one labelled issue per slot. The marker's GitHub handle is embedded in the issue body as an HTML comment: `<!-- marker-handle: {handle} -->`. This comment is the **only** source of truth the Action uses to identify the slot's marker.
- **Validation (GitHub Actions, per assignment):** `.github/workflows/validate-slot-assignment.yml` triggers on `issues.assigned` for `presentation-slot` issues. It's a single inline `actions/github-script` block containing all validation logic; there is no separate JS module for the action.

### The two sources of truth

The system has an intentional split that is easy to get wrong:

1. `data/teams.csv` — maps **team name** → **mentor GitHub handle**. Committed to the repo; read by the Action on every run via `fs.readFileSync`. Team names must match the GitHub org team's `name` (compared case-insensitively).
2. **GitHub org teams** — source of truth for *which students belong to which team*. The Action resolves team membership by paging `GET /orgs/{org}/teams` and calling `getMembershipForUserInOrg` per team. It does **not** trust any local list of students.

So: a new student is added via the GitHub org UI (no repo change needed). A mentor change or a new team requires editing `data/teams.csv`.

### Validation order and multi-team semantics

The workflow runs four checks in order; the first failure removes the assignee and comments. Full spec in `docs/workflow-checks.md`.

1. **Single assignee** — reject if anyone else was already assigned (one slot = one claimant).
2. **Team membership** — assignee must belong to at least one org team. All matching teams are collected.
3. **Self-marking** — reject if **any** of the assignee's teams has a mentor whose handle matches the slot's `marker-handle`.
4. **Double-booking** — reject if **any** other open `presentation-slot` issue has an assignee who shares **any** team with the new assignee.

Checks 3 and 4 intentionally iterate over *all* of the assignee's teams, not just the first match. This is load-bearing: a user in two teams could otherwise bypass self-marking or double-booking by the "first match wins" ordering. When editing the workflow, preserve this semantic.

### Project v2 wiring

`resolveProject` in `create-issues.js` looks up a field literally named **"Marker"** on the Project v2 board. If that field is a single-select, the `marker_name` from the CSV must match one of the option names (case-insensitive) or the field is silently skipped. If the field is a text field, the value is written as text. If the field is missing entirely, the script warns and continues. Changing the field name on the board will silently disable marker population — update `MARKER_FIELD_NAME` in the script to match.

### The `PROJECT_PAT` secret vs. the default `GITHUB_TOKEN`

The workflow uses `secrets.PROJECT_PAT`, not the default `GITHUB_TOKEN`. This is required because the default token cannot list org teams or check team membership. The PAT needs `repo` and `read:org` scopes.
