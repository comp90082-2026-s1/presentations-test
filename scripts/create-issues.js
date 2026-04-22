require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Octokit } = require("@octokit/rest");
const { graphql } = require("@octokit/graphql");
const { parse } = require("csv-parse/sync");
const { getOwnerRepo } = require("./_repo");

const LABEL = "presentation-slot";
const MARKER_FIELD_NAME = "Marker";

function buildTitle({ date, time, marker_name }) {
  return `Presentation Slot — ${date} ${time} | Marker: ${marker_name}`;
}

function buildBody({ date, time, marker_name, marker_github, location }) {
  const locationLine = location ? `**Location:** ${location}\n` : "";
  return [
    `**Date:** ${date}`,
    `**Time:** ${time}`,
    `**Marker:** ${marker_name} (@${marker_github})`,
    locationLine.trimEnd(),
    "",
    "Students: assign yourself to this issue to claim this slot for your team.",
    "",
    `<!-- marker-handle: ${marker_github} -->`,
  ]
    .filter((l) => l !== "")
    .concat([""])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

async function fetchExistingTitles(octokit, owner, repo) {
  const titles = new Set();
  for await (const { data } of octokit.paginate.iterator(
    octokit.issues.listForRepo,
    { owner, repo, labels: LABEL, state: "all", per_page: 100 },
  )) {
    for (const issue of data) {
      if (!issue.pull_request) titles.add(issue.title);
    }
  }
  return titles;
}

async function resolveProject(gql, owner, number) {
  const query = `
    query($owner: String!, $number: Int!) {
      organization(login: $owner) {
        projectV2(number: $number) {
          id
          fields(first: 50) {
            nodes {
              __typename
              ... on ProjectV2Field { id name dataType }
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
          }
        }
      }
    }`;
  const res = await gql(query, { owner, number });
  const project = res.organization?.projectV2;
  if (!project) throw new Error(`Project v2 #${number} not found on org ${owner}`);
  const field = project.fields.nodes.find(
    (n) => n?.name?.toLowerCase() === MARKER_FIELD_NAME.toLowerCase(),
  );
  if (!field) console.warn(`⚠  No '${MARKER_FIELD_NAME}' field on project — continuing without it.`);
  return { projectId: project.id, markerField: field || null };
}

async function addToProject(gql, projectId, contentId) {
  const mutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`;
  const res = await gql(mutation, { projectId, contentId });
  return res.addProjectV2ItemById.item.id;
}

async function setMarkerField(gql, { projectId, itemId, field, markerName }) {
  let value;
  if (field.__typename === "ProjectV2SingleSelectField") {
    const option = field.options.find(
      (o) => o.name.toLowerCase() === markerName.toLowerCase(),
    );
    if (!option) {
      console.warn(`   ⚠ No single-select option matches '${markerName}' — skipping field.`);
      return;
    }
    value = { singleSelectOptionId: option.id };
  } else {
    value = { text: markerName };
  }
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value
      }) { projectV2Item { id } }
    }`;
  await gql(mutation, { projectId, itemId, fieldId: field.id, value });
}

async function main() {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");
  const projectOwner = process.env.PROJECT_OWNER;
  const projectNumber = Number(process.env.PROJECT_NUMBER);
  if (!projectOwner || !projectNumber) {
    throw new Error("PROJECT_OWNER and PROJECT_NUMBER must be set in .env");
  }

  const { owner, repo } = getOwnerRepo();
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const gql = graphql.defaults({
    headers: { authorization: `token ${process.env.GITHUB_TOKEN}` },
  });

  const csvPath = path.join(__dirname, "..", "data", "slots.csv");
  const rows = parse(fs.readFileSync(csvPath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const existingTitles = await fetchExistingTitles(octokit, owner, repo);
  const { projectId, markerField } = await resolveProject(gql, projectOwner, projectNumber);

  let created = 0;
  let skipped = 0;
  for (const row of rows) {
    const title = buildTitle(row);
    if (existingTitles.has(title)) {
      console.log(`⏭  Skipped (already exists): ${title}`);
      skipped++;
      continue;
    }
    const { data: issue } = await octokit.issues.create({
      owner,
      repo,
      title,
      body: buildBody(row),
      labels: [LABEL],
    });
    try {
      const itemId = await addToProject(gql, projectId, issue.node_id);
      if (markerField) {
        await setMarkerField(gql, {
          projectId,
          itemId,
          field: markerField,
          markerName: row.marker_name,
        });
      }
    } catch (err) {
      console.warn(`   ⚠ Project wiring failed for #${issue.number}: ${err.message}`);
    }
    console.log(`✅ Created: ${issue.html_url}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}, Total: ${rows.length}`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
