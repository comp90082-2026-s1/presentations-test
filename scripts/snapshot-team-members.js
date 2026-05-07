require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Octokit } = require("@octokit/rest");
const { getOwnerRepo } = require("./_repo");

const OUT_PATH = path.join(__dirname, "..", "data", "team-members.json");

async function main() {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");

  const { owner: org } = getOwnerRepo();
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  console.log(`Snapshotting team memberships for org: ${org}`);

  const teams = [];
  for await (const { data } of octokit.paginate.iterator(
    octokit.teams.list,
    { org, per_page: 100 },
  )) {
    teams.push(...data);
  }
  teams.sort((a, b) => a.slug.localeCompare(b.slug));
  console.log(`Found ${teams.length} teams.`);

  const snapshotTeams = [];
  for (const t of teams) {
    const members = [];
    for await (const { data } of octokit.paginate.iterator(
      octokit.teams.listMembersInOrg,
      { org, team_slug: t.slug, per_page: 100 },
    )) {
      members.push(...data);
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
