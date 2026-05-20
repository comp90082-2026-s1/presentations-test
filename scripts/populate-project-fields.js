require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { graphql } = require("@octokit/graphql");
const { getOwnerRepo } = require("./_repo");

const SLOT_LABEL = "presentation-slot";
const ASSIGNED_TEAM_FIELD = "Assigned Team";
const SIX_STUDENTS_FIELD = "6 Students";
const SIX_STUDENTS_VALUE = "V";

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

  const findField = (name) =>
    project.fields.nodes.find((n) => n?.name?.toLowerCase() === name.toLowerCase()) || null;

  const assignedTeamField = findField(ASSIGNED_TEAM_FIELD);
  const sixStudentsField = findField(SIX_STUDENTS_FIELD);

  if (!assignedTeamField) console.warn(`⚠  No '${ASSIGNED_TEAM_FIELD}' field on project — will skip.`);
  if (!sixStudentsField) console.warn(`⚠  No '${SIX_STUDENTS_FIELD}' field on project — will skip.`);

  return { projectId: project.id, assignedTeamField, sixStudentsField };
}

async function setField(gql, { projectId, itemId, field, value }) {
  let gqlValue;
  if (field.__typename === "ProjectV2SingleSelectField") {
    const option = field.options.find((o) => o.name.toLowerCase() === value.toLowerCase());
    if (!option) {
      console.warn(`   ⚠ No single-select option matches '${value}' on field '${field.name}' — skipping.`);
      return;
    }
    gqlValue = { singleSelectOptionId: option.id };
  } else {
    gqlValue = { text: value };
  }
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value
      }) { projectV2Item { id } }
    }`;
  await gql(mutation, { projectId, itemId, fieldId: field.id, value: gqlValue });
}

async function fetchProjectItems(gql, projectId) {
  const query = `
    query($projectId: ID!, $cursor: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              content {
                ... on Issue {
                  number
                  state
                  assignees(first: 10) { nodes { login } }
                  labels(first: 20) { nodes { name } }
                }
              }
            }
          }
        }
      }
    }`;
  const items = [];
  let cursor = null;
  do {
    const res = await gql(query, { projectId, cursor });
    const page = res.node.items;
    items.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return items;
}

function loadTeamData() {
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "team-members.json"), "utf8")
  );
  const memberSets = new Map(snapshot.teams.map((t) => [t.slug, new Set(t.members)]));
  return { teams: snapshot.teams, memberSets };
}

function findTeamsFor(login, teams, memberSets) {
  return teams.filter((t) => memberSets.get(t.slug)?.has(login));
}

async function main() {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");
  const projectOwner = process.env.PROJECT_OWNER;
  const projectNumber = Number(process.env.PROJECT_NUMBER);
  if (!projectOwner || !projectNumber) {
    throw new Error("PROJECT_OWNER and PROJECT_NUMBER must be set in .env");
  }

  const gql = graphql.defaults({
    headers: { authorization: `token ${process.env.GITHUB_TOKEN}` },
  });

  const { projectId, assignedTeamField, sixStudentsField } =
    await resolveProject(gql, projectOwner, projectNumber);

  if (!assignedTeamField && !sixStudentsField) {
    throw new Error("Neither target field found on project — nothing to do.");
  }

  const { teams, memberSets } = loadTeamData();
  const allItems = await fetchProjectItems(gql, projectId);

  const targetItems = allItems.filter((item) => {
    const issue = item.content;
    if (!issue || issue.state !== "CLOSED") return false;
    if (!issue.labels.nodes.some((l) => l.name === SLOT_LABEL)) return false;
    if (issue.assignees.nodes.length === 0) return false;
    return true;
  });

  console.log(`Found ${targetItems.length} closed assigned slot(s) to process.`);

  let updated = 0;
  let skipped = 0;

  for (const item of targetItems) {
    const issue = item.content;
    const assignee = issue.assignees.nodes[0].login;
    const assigneeTeams = findTeamsFor(assignee, teams, memberSets);

    if (assigneeTeams.length === 0) {
      console.warn(`  ⚠ #${issue.number}: assignee '${assignee}' not in any team — skipping.`);
      skipped++;
      continue;
    }

    if (assigneeTeams.length > 1) {
      console.warn(`  ⚠ #${issue.number}: '${assignee}' is in ${assigneeTeams.length} teams — using first: '${assigneeTeams[0].name}'.`);
    }

    const team = assigneeTeams[0];
    const memberCount = memberSets.get(team.slug).size;

    try {
      if (assignedTeamField) {
        await setField(gql, { projectId, itemId: item.id, field: assignedTeamField, value: team.name });
      }
      if (sixStudentsField && memberCount === 6) {
        await setField(gql, { projectId, itemId: item.id, field: sixStudentsField, value: SIX_STUDENTS_VALUE });
      }
      console.log(
        `  ✅ #${issue.number}: team='${team.name}' members=${memberCount}${memberCount === 6 ? " → 6 Students=V" : ""}`
      );
      updated++;
    } catch (err) {
      console.warn(`  ⚠ #${issue.number}: field update failed — ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}, Total: ${targetItems.length}`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
