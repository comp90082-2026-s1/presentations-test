require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Octokit } = require("@octokit/rest");
const { parse } = require("csv-parse/sync");
const { getOwnerRepo } = require("./_repo");

const OUT_PATH = path.join(__dirname, "..", "data", "team-members.json");
const TEAMS_CSV = path.join(__dirname, "..", "data", "teams.csv");

function readRegisteredTeamNames() {
  const rows = parse(fs.readFileSync(TEAMS_CSV, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  return new Set(rows.map((r) => r.team_name.toLowerCase()));
}

async function main() {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");

  const { owner: org } = getOwnerRepo();
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN, headers: { "X-GitHub-Api-Version": "2022-11-28" } });

  // Only snapshot teams declared in data/teams.csv. The org may contain test,
  // admin, or unrelated teams; including them in the snapshot would let
  // members of those teams pass the validation's team-membership check.
  const registered = readRegisteredTeamNames();
  console.log(`Snapshotting team memberships for org: ${org}`);
  console.log(`Filtering to ${registered.size} teams declared in data/teams.csv.`);

  const allTeams = [];
  for await (const { data } of octokit.paginate.iterator(
    octokit.teams.list,
    { org, per_page: 100 },
  )) {
    allTeams.push(...data);
  }
  const teams = allTeams
    .filter((t) => registered.has(t.name.toLowerCase()))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const matched = new Set(teams.map((t) => t.name.toLowerCase()));
  const missing = [...registered].filter((n) => !matched.has(n));
  if (missing.length > 0) {
    console.warn(`⚠ ${missing.length} team(s) in teams.csv had no matching org team: ${missing.join(", ")}`);
  }

  const snapshotTeams = [];
  for (const t of teams) {
    let members;
    try {
      members = [];
      for await (const { data } of octokit.paginate.iterator(
        octokit.teams.listMembersInOrg,
        { org, team_slug: t.slug, per_page: 100 },
      )) {
        members.push(...data);
      }
    } catch (err) {
      if (err.status === 404 || err.status === 403) {
        console.warn(`  ${t.slug}: skipped (status ${err.status} — PAT cannot read members)`);
        continue;
      }
      throw err;
    }
    const logins = members.map((m) => m.login).sort((a, b) => a.localeCompare(b));
    snapshotTeams.push({ name: t.name, slug: t.slug, members: logins });
    console.log(`  ${t.slug}: ${logins.length} members`);
  }

  const out = {
    snapshot_at: new Date().toISOString(),
    org,
    teams: snapshotTeams,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n✅ Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
