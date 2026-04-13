require("dotenv").config();
const { Octokit } = require("@octokit/rest");
const { getOwnerRepo } = require("./_repo");

const LABEL = "presentation-slot";
const COLOR = "0075ca";
const DESCRIPTION = "Student presentation slot";

async function main() {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");
  const { owner, repo } = getOwnerRepo();
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  try {
    await octokit.issues.getLabel({ owner, repo, name: LABEL });
    console.log(`ℹ  Label '${LABEL}' already exists — skipping.`);
  } catch (err) {
    if (err.status !== 404) throw err;
    await octokit.issues.createLabel({
      owner,
      repo,
      name: LABEL,
      color: COLOR,
      description: DESCRIPTION,
    });
    console.log(`✅ Created label '${LABEL}' (#${COLOR}) on ${owner}/${repo}.`);
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
