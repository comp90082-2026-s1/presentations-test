require("dotenv").config();
const { Octokit } = require("@octokit/rest");
const { getOwnerRepo } = require("./_repo");

const SLOT_LABEL = "presentation-slot";

async function main() {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");

  const sprintRaw = process.env.SPRINT || process.argv[2];
  if (!sprintRaw || !/^\d+$/.test(String(sprintRaw).trim())) {
    throw new Error(
      "Sprint number required. Set SPRINT=2 in env or pass as argument: node scripts/mark-sprint.js 2"
    );
  }
  const sprint = String(sprintRaw).trim();
  const sprintLabel = `sprint-${sprint}`;

  const { owner, repo } = getOwnerRepo();
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN, headers: { "X-GitHub-Api-Version": "2022-11-28" } });

  try {
    await octokit.issues.getLabel({ owner, repo, name: sprintLabel });
    console.log(`ℹ  Label '${sprintLabel}' already exists.`);
  } catch (err) {
    if (err.status !== 404) throw err;
    await octokit.issues.createLabel({
      owner, repo, name: sprintLabel,
      color: "e4e669",
      description: `Sprint ${sprint} presentation slots`,
    });
    console.log(`✅ Created label '${sprintLabel}' on ${owner}/${repo}.`);
  }

  const issues = [];
  for await (const { data } of octokit.paginate.iterator(
    octokit.issues.listForRepo,
    { owner, repo, labels: SLOT_LABEL, state: "closed", per_page: 100 }
  )) {
    for (const issue of data) {
      if (!issue.pull_request) issues.push(issue);
    }
  }
  console.log(`Found ${issues.length} closed '${SLOT_LABEL}' issue(s).`);

  let labeled = 0;
  let alreadyLabeled = 0;
  for (const issue of issues) {
    if (issue.labels.some((l) => l.name === sprintLabel)) {
      alreadyLabeled++;
      continue;
    }
    await octokit.issues.addLabels({
      owner, repo,
      issue_number: issue.number,
      labels: [sprintLabel],
    });
    console.log(`  ✅ Labeled #${issue.number}: ${issue.title}`);
    labeled++;
  }

  console.log(
    `\nDone. Labeled: ${labeled}, Already had label: ${alreadyLabeled}, Total checked: ${issues.length}`
  );
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
