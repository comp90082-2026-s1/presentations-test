# COMP90082 — Presentation Slot Allocation

Students claim presentation slots by assigning themselves to a GitHub Issue. A GitHub Action validates each assignment against org team membership and prevents double-booking or self-marking.

## Roles

- **Students** — members of org teams named `<TutorialCode>-<AnimalName>` (e.g. `AB-Koala`).
- **Mentors** — each team has one mentor. Mapped in `data/teams.csv`.
- **Markers** — grade the presentations. A marker is always a mentor of *another* team; no team is ever marked by their own mentor.

Issues only show the **marker**. The mentor-of-team mapping is resolved at validation time to enforce the self-marking rule.

## Repo layout

```
.github/workflows/validate-slot-assignment.yml   # validates issue assignments
scripts/setup-labels.js                          # creates the 'presentation-slot' label
scripts/create-issues.js                         # seeds issues + adds to Project v2
data/slots.csv                                   # one row per slot
data/teams.csv                                   # team -> mentor GitHub handle
```

## Setup (local)

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `GITHUB_TOKEN` — classic or fine-grained PAT with scopes `repo`, `read:org`, `project`
   - `PROJECT_OWNER` — org that owns the Project v2 board (default: `comp90082-2026-s1`)
   - `PROJECT_NUMBER` — project number (default: `61`)
3. Edit `data/slots.csv` — one row per presentation slot
4. Edit `data/teams.csv` — every student team plus their mentor's GitHub handle
5. `npm run setup` — creates the `presentation-slot` label (idempotent)
6. `npm run seed` — creates one issue per slot, adds each to Project v2 #61, and populates the **Marker** field. Re-runs are idempotent (skips existing titles).

Each created issue URL is printed to the console.

## GitHub Action — `validate-slot-assignment.yml`

Triggers on `issues.assigned` for issues labelled `presentation-slot` and runs three checks:

1. **Team membership** — if the assignee isn't in any org team, the assignment is removed and a rejection comment posted.
2. **Self-marking** — if the assignee's team's mentor is the slot's marker, the assignment is removed.
3. **Double-booking** — if the assignee's team already holds another open slot, the assignment is removed.

On success the action posts `✅ Slot confirmed for {TeamName}.`

### `PROJECT_PAT` secret

The workflow authenticates with a PAT stored as the repo secret `PROJECT_PAT`. Required scopes:

- `repo` — read/write issues, post comments
- `read:org` — list org teams and check membership
- `project` — only if you extend the action to touch Project v2 fields (not required by the current workflow)

Add it at **Settings → Secrets and variables → Actions → New repository secret** with name `PROJECT_PAT`.

## How students claim a slot

1. Open the Issues tab and find an unassigned `presentation-slot` issue.
2. One team member assigns themselves (right sidebar → Assignees).
3. Within seconds the action comments:
   - `✅ Slot confirmed for {TeamName}.` — you're booked.
   - `⚠️ …` — the assignment was removed; read the comment for the reason.

## Maintaining `data/teams.csv`

Whenever the student↔mentor mapping changes, edit `data/teams.csv` and commit via PR. The workflow reads it on every run.

## Notes

- A student in multiple matching org teams: the first match from `GET /orgs/{org}/teams` wins. Document team membership to avoid this.
- Changing a team's mentor mid-semester: edit `data/teams.csv`.
