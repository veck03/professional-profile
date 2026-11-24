#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const FILES = ["profile.json", "education.json", "skills.json", "projects.json"];
const isUrl = (v) => typeof v === "string" && /^https?:\/\//.test(v);
const duplicates = (list) => list.filter((v, i) => list.indexOf(v) !== i);
const need = (obj, keys, where) =>
  keys.forEach((k) => {
    if (obj?.[k] === undefined || obj[k] === "") fail(`${where}: missing "${k}"`);
  });

function loadJson(name) {
  const path = join(ROOT, "data", name);
  if (!existsSync(path)) { fail(`data/${name} does not exist`); return null; }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${name}: ${e.message}`);
    return null;
  }
}

// 1. nothing private in public files
const PHONE = /(?:\+?\d{1,3}[\s-]?)?\d{5}[\s-]?\d{5}\b/;
for (const f of FILES) {
  const path = join(ROOT, "data", f);
  if (existsSync(path) && PHONE.test(readFileSync(path, "utf8"))) {
    fail(`${f}: looks like it contains a phone number. Keep it in private/contact.private.json`);
  }
}

const profile = loadJson("profile.json");
const education = loadJson("education.json");
const skills = loadJson("skills.json");
const projects = loadJson("projects.json");

// 2. profile
if (profile) {
  need(profile, ["name", "display_name", "headline", "email", "links", "avatar", "summary", "about"], "profile.json");
  need(profile.links, ["linkedin", "github", "portfolio"], "profile.json links");
  Object.entries(profile.links || {}).forEach(([k, v]) => {
    if (!isUrl(v)) fail(`profile.json: links.${k} is not a URL`);
  });
  need(profile.about, ["one_liner", "short", "cta"], "profile.json about");
  if (profile.avatar?.file && !existsSync(join(ROOT, "assets", profile.avatar.file))) {
    warn(`avatar file missing: assets/${profile.avatar.file}`);
  }
  if (profile.resume?.file && !existsSync(join(ROOT, "assets", profile.resume.file))) {
  warn(`resume file missing: assets/${profile.resume.file}`);
}
}

// 3. education
if (education) {
  const list = education.education;
  if (!Array.isArray(list) || !list.length) {
    fail("education.json: 'education' must be a non-empty array");
  } else {
    duplicates(list.map((e) => e.id)).forEach((id) => fail(`education.json: duplicate id "${id}"`));
    list.forEach((e, i) => {
      need(e, ["id", "institution", "degree", "status", "start_date"], `education[${i}]`);
      if (!["in_progress", "completed"].includes(e.status)) {
        fail(`education[${i}]: status must be "in_progress" or "completed"`);
      }
    });
  }
}

// 4. skills
if (skills) {
  const flat = ["programming", "ai_ml", "libraries_frameworks", "tools"].flatMap((k) => {
    if (!Array.isArray(skills[k])) { fail(`skills.json: "${k}" must be an array`); return []; }
    return skills[k];
  });
  const grouped = new Set();
  (skills.display_groups || []).forEach((g) => {
    need(g, ["id", "title", "blurb", "items"], `display group "${g.id ?? "?"}"`);
    (g.items || []).forEach((item) => {
      grouped.add(item);
      if (!flat.includes(item)) fail(`skills.json: "${item}" (group "${g.id}") is not in the flat lists`);
    });
    (g.highlight || []).forEach((h) => {
      if (!(g.items || []).includes(h)) fail(`skills.json: highlight "${h}" is not in the items of "${g.id}"`);
    });
  });
  flat.filter((s) => !grouped.has(s)).forEach((s) => warn(`skills.json: "${s}" is not shown in any display group`));
}

// 5. projects
if (projects) {
  const list = projects.projects;
  if (!Array.isArray(list)) {
    fail("projects.json: 'projects' must be an array");
  } else {
    duplicates(list.map((p) => p.id)).forEach((id) => fail(`projects.json: duplicate id "${id}"`));
    duplicates(list.map((p) => p.portfolio_priority)).forEach((n) => fail(`projects.json: portfolio_priority ${n} is used more than once`));
    duplicates(list.map((p) => p.resume_priority)).forEach((n) => fail(`projects.json: resume_priority ${n} is used more than once`));

    list.forEach((p) => {
      const w = `project "${p.id}"`;
      need(p, ["id", "title", "tagline", "category", "status", "image", "technologies",
               "short_description", "resume_bullets", "portfolio_description", "links"], w);
      if (!["completed", "in_progress"].includes(p.status)) fail(`${w}: status must be "completed" or "in_progress"`);
      if (!Array.isArray(p.technologies) || !p.technologies.length) fail(`${w}: technologies must be a non-empty array`);
      if (p.tagline && p.tagline.length > 40) warn(`${w}: tagline is ${p.tagline.length} chars (40 or fewer fits the folder caption)`);
      ["github", "live_demo"].forEach((k) => {
        const v = p.links?.[k];
        if (v !== null && v !== undefined && !isUrl(v)) fail(`${w}: links.${k} must be a URL or null`);
      });
      [p.image, ...(p.gallery || [])].forEach((img) => {
        if (img && !existsSync(join(ROOT, "assets", "projects", img))) warn(`${w}: image missing: assets/projects/${img}`);
      });
    });
  }
}

warnings.forEach((w) => console.warn(`warn   ${w}`));
if (errors.length) {
  errors.forEach((e) => console.error(`error  ${e}`));
  console.error(`\n${errors.length} error(s). Fix them before pushing.`);
  process.exit(1);
}
console.log("Profile data is valid.");