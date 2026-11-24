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
const SECTION_TYPES = ["text", "list", "steps", "metrics", "pipeline", "image"];

const isUrl = (v) => typeof v === "string" && /^https?:\/\//.test(v);
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isArr = (v) => Array.isArray(v) && v.length > 0;
const duplicates = (list) => list.filter((v, i) => list.indexOf(v) !== i);
const need = (obj, keys, where) =>
  keys.forEach((k) => {
    if (obj?.[k] === undefined || obj[k] === "") fail(`${where}: missing "${k}"`);
  });

function loadJson(rel) {
  const path = join(ROOT, "data", rel);
  if (!existsSync(path)) { fail(`data/${rel} does not exist`); return null; }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${rel}: ${e.message}`);
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

// 5. case studies
function validateCaseStudy(id, rel) {
  const w = `case study "${id}"`;
  if (!/^case-studies\/[\w-]+\.json$/.test(rel)) {
    fail(`${w}: case_study must look like "case-studies/<name>.json" (got "${rel}")`);
    return;
  }
  const cs = loadJson(rel);
  if (!cs) return;

  if (cs.kind !== undefined && !["project", "case_study"].includes(cs.kind)) {
    fail(`${w}: "kind" must be "project" or "case_study"`);
  }

  if (!isStr(cs.summary)) fail(`${w}: "summary" is required`);
  else if (cs.summary.length > 450) warn(`${w}: summary is ${cs.summary.length} characters (450 or fewer reads best)`);

  if (cs.stack !== undefined && !(Array.isArray(cs.stack) && cs.stack.every(isStr))) {
    fail(`${w}: "stack" must be a list of strings`);
  }
  if (cs.facts !== undefined) {
    if (!Array.isArray(cs.facts)) fail(`${w}: "facts" must be a list`);
    else cs.facts.forEach((f, i) => need(f, ["label", "value"], `${w} fact ${i + 1}`));
  }
  if (cs.images !== undefined) {
    if (!Array.isArray(cs.images)) fail(`${w}: "images" must be a list`);
    else {
      cs.images.forEach((img, i) => {
        need(img, ["file", "alt"], `${w} image ${i + 1}`);
        if (img.file && !existsSync(join(ROOT, "assets", "case-studies", img.file))) {
          warn(`${w}: image missing: assets/case-studies/${img.file}`);
        }
      });
    }
  }

  if (!isArr(cs.sections)) { fail(`${w}: "sections" must be a non-empty array`); return; }

  cs.sections.forEach((s, i) => {
    const sw = `${w}, section ${i + 1}`;
    if (!SECTION_TYPES.includes(s?.type)) {
      fail(`${sw}: unknown type "${s?.type}" (use one of: ${SECTION_TYPES.join(", ")})`);
      return;
    }
    if (s.type !== "image" && !isStr(s.title)) fail(`${sw}: "title" is required`);

    switch (s.type) {
      case "text":
        if (!isArr(s.body) || !s.body.every(isStr)) fail(`${sw}: "body" must be a list of non-empty paragraphs`);
        break;
      case "list":
        if (!isArr(s.items) || !s.items.every(isStr)) fail(`${sw}: "items" must be a list of non-empty strings`);
        break;
      case "steps":
        if (!isArr(s.steps)) fail(`${sw}: "steps" must be a non-empty list`);
        else s.steps.forEach((st, j) => { if (!isStr(st?.title)) fail(`${sw}, step ${j + 1}: "title" is required`); });
        break;
      case "metrics":
        if (!isArr(s.items)) fail(`${sw}: "items" must be a non-empty list`);
        else s.items.forEach((m, j) => need(m, ["value", "label"], `${sw}, metric ${j + 1}`));
        break;
        case "pipeline": {
        const nodes = Array.isArray(s.nodes) ? s.nodes : [];
        const ids = nodes.map((n) => n?.id);
        if (!nodes.length) fail(`${sw}: "nodes" must be a non-empty list`);
        nodes.forEach((n, j) => need(n, ["id", "title"], `${sw}, node ${j + 1}`));
        duplicates(ids).forEach((d) => fail(`${sw}: duplicate node id "${d}"`));

        if (!Array.isArray(s.layers) || !s.layers.length) {
          fail(`${sw}: "layers" must be a non-empty list of rows`);
        } else {
          s.layers.forEach((row, j) => {
            if (!Array.isArray(row) || row.length < 1 || row.length > 3) {
              fail(`${sw}, layer ${j + 1}: each row needs 1 to 3 cells`);
            }
          });
          const placed = s.layers.flat().filter(Boolean);
          placed.forEach((id) => {
            if (!ids.includes(id)) fail(`${sw}: layers mention unknown node "${id}"`);
          });
          ids.filter((id) => !placed.includes(id)).forEach((id) =>
            fail(`${sw}: node "${id}" is not placed in any layer`)
          );
        }

        if (!isArr(s.routes)) {
          fail(`${sw}: "routes" must be a non-empty list`);
        } else {
          const rowOf = (id) =>
            (s.layers || []).findIndex((row) => Array.isArray(row) && row.includes(id));
          s.routes.forEach((r, j) => {
            const rw = `${sw}, route ${j + 1}`;
            if (!isStr(r?.label)) fail(`${rw}: "label" is required`);
            if (!isArr(r?.paths)) { fail(`${rw}: "paths" must be a non-empty list`); return; }
            r.paths.forEach((path, k) => {
              if (!isArr(path) || path.length < 2) { fail(`${rw}, path ${k + 1}: needs at least 2 nodes`); return; }
              path.forEach((id) => {
                if (!ids.includes(id)) fail(`${rw}, path ${k + 1}: unknown node "${id}"`);
              });
              for (let m = 1; m < path.length; m++) {
                if (rowOf(path[m]) <= rowOf(path[m - 1])) {
                  fail(`${rw}, path ${k + 1}: "${path[m]}" must be in a lower row than "${path[m - 1]}"`);
                }
              }
            });
          });
        }
        break;
      }
      case "image":
        need(s, ["file", "alt"], sw);
        if (s.file && !existsSync(join(ROOT, "assets", "case-studies", s.file))) {
          warn(`${sw}: image missing: assets/case-studies/${s.file}`);
        }
        break;
    }
  });
}

// 6. projects
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
      if (p.case_study) validateCaseStudy(p.id, p.case_study);
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