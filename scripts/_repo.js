const { execSync } = require("node:child_process");

function getOwnerRepo() {
  const url = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
  const ssh = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = url.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (https) return { owner: https[1], repo: https[2] };
  throw new Error(`Could not parse owner/repo from remote URL: ${url}`);
}

module.exports = { getOwnerRepo };
