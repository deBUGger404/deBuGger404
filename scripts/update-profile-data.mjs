import { readFile, writeFile } from "node:fs/promises";

const username = process.env.GITHUB_USER || "deBUGger404";
const token = process.env.GITHUB_TOKEN;
const bannerPath = new URL("../rakesh-banner.svg", import.meta.url);
const activityPath = new URL("../rakesh-github-activity.svg", import.meta.url);

if (!token) throw new Error("GITHUB_TOKEN is required to update profile metrics.");

const now = new Date();
const oneYearAgo = new Date(now);
oneYearAgo.setUTCFullYear(now.getUTCFullYear() - 1);

const query = `
  query ProfileMetrics($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      followers { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { contributionCount contributionLevel date weekday }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": `${username}-profile-readme`,
  },
  body: JSON.stringify({
    query,
    variables: { login: username, from: oneYearAgo.toISOString(), to: now.toISOString() },
  }),
});

if (!response.ok) throw new Error(`GitHub GraphQL request failed: ${response.status}`);
const payload = await response.json();
if (payload.errors?.length) throw new Error(`GitHub GraphQL error: ${payload.errors[0].message}`);
const user = payload.data?.user;
if (!user) throw new Error(`GitHub user ${username} was not found.`);

const calendar = user.contributionsCollection.contributionCalendar;
const stars = user.repositories.nodes.reduce((sum, repository) => sum + repository.stargazerCount, 0);
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const replaceText = (svg, id, value) => {
  const pattern = new RegExp(`(<text id="${id}"[^>]*>)[^<]*(</text>)`);
  if (!pattern.test(svg)) throw new Error(`Text element ${id} is missing.`);
  return svg.replace(pattern, `$1${value}$2`);
};

const replaceAttribute = (svg, id, attribute, value) => {
  const pattern = new RegExp(`(<[^>]+id="${id}"[^>]*\\s${attribute}=")[^"]*(")`);
  if (!pattern.test(svg)) throw new Error(`${attribute} on ${id} is missing.`);
  return svg.replace(pattern, `$1${value}$2`);
};

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const days = calendar.weeks.flatMap((week) => week.contributionDays)
  .sort((a, b) => a.date.localeCompare(b.date));
let longestStreak = 0;
let runningStreak = 0;
for (const day of days) {
  runningStreak = day.contributionCount > 0 ? runningStreak + 1 : 0;
  longestStreak = Math.max(longestStreak, runningStreak);
}
let currentIndex = days.length - 1;
if (days[currentIndex]?.date === now.toISOString().slice(0, 10)
  && days[currentIndex]?.contributionCount === 0) currentIndex -= 1;
let currentStreak = 0;
while (currentIndex >= 0 && days[currentIndex].contributionCount > 0) {
  currentStreak += 1;
  currentIndex -= 1;
}

const languageTotals = new Map();
for (const repository of user.repositories.nodes) {
  for (const edge of repository.languages.edges) {
    const current = languageTotals.get(edge.node.name) || { color: edge.node.color || "#8b5cf6", size: 0 };
    current.size += edge.size;
    languageTotals.set(edge.node.name, current);
  }
}
const languages = [...languageTotals.entries()]
  .map(([name, data]) => ({ name, ...data }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 5);
const languageSize = languages.reduce((sum, language) => sum + language.size, 0) || 1;

let banner = await readFile(bannerPath, "utf8");
const bannerMetrics = {
  "metric-repos": compact.format(user.repositories.totalCount),
  "metric-stars": compact.format(stars),
  "metric-followers": compact.format(user.followers.totalCount),
  "metric-commits": compact.format(calendar.totalContributions),
};
for (const [id, value] of Object.entries(bannerMetrics)) banner = replaceText(banner, id, value);
await writeFile(bannerPath, banner, "utf8");

let activity = await readFile(activityPath, "utf8");
const activityMetrics = {
  "activity-repos": user.repositories.totalCount.toLocaleString("en-US"),
  "activity-stars": stars.toLocaleString("en-US"),
  "activity-followers": user.followers.totalCount.toLocaleString("en-US"),
  "activity-contributions": calendar.totalContributions.toLocaleString("en-US"),
  "activity-current-streak": `${currentStreak} ${currentStreak === 1 ? "day" : "days"}`,
  "activity-longest-streak": `${longestStreak} ${longestStreak === 1 ? "day" : "days"}`,
  "activity-date-range": `${days[0]?.date || ""}  →  ${days.at(-1)?.date || ""}`,
  "activity-sync-note": "",
};
for (const [id, value] of Object.entries(activityMetrics)) activity = replaceText(activity, id, value);

let languageX = 586;
for (let index = 0; index < 5; index += 1) {
  const language = languages[index] || { name: "—", color: "#334155", size: 0 };
  const percent = (language.size / languageSize) * 100;
  const width = (percent / 100) * 442;
  const number = index + 1;
  activity = replaceText(activity, `lang-name-${number}`, escapeXml(language.name));
  activity = replaceText(activity, `lang-percent-${number}`, `${percent.toFixed(1)}%`);
  activity = replaceAttribute(activity, `lang-dot-${number}`, "fill", language.color);
  activity = replaceAttribute(activity, `lang-bar-${number}`, "x", languageX.toFixed(2));
  activity = replaceAttribute(activity, `lang-bar-${number}`, "width", width.toFixed(2));
  activity = replaceAttribute(activity, `lang-bar-${number}`, "fill", language.color);
  languageX += width;
}

const levelColors = {
  NONE: "#1e2a4a",
  FIRST_QUARTILE: "#1e3a8a",
  SECOND_QUARTILE: "#2563eb",
  THIRD_QUARTILE: "#7c3aed",
  FOURTH_QUARTILE: "#22d3ee",
};
const weekGap = 18.25;
const heatmap = calendar.weeks.flatMap((week, weekIndex) => week.contributionDays.map((day) => {
  const x = 64 + weekIndex * weekGap;
  const y = 487 + day.weekday * 11;
  const color = levelColors[day.contributionLevel] || levelColors.NONE;
  return `<rect x="${x.toFixed(2)}" y="${y}" width="9" height="9" rx="2" fill="${color}"><title>${day.date}: ${day.contributionCount} contributions</title></rect>`;
})).join("");
const gridPattern = /(<g id="contribution-grid">)[\s\S]*?(<\/g>)/;
if (!gridPattern.test(activity)) throw new Error("Contribution grid is missing.");
activity = activity.replace(gridPattern, `$1${heatmap}$2`);

await writeFile(activityPath, activity, "utf8");
console.log(`Updated banner and GitHub activity dashboard for ${username}.`);
