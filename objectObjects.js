"use strict";
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const { v4: uuidv4 } = require("uuid");

// ---- Config ----
const ENTITIES_JSON_PATH = path.resolve("entities.json");
const INPUT_XLSX_PATH    = path.resolve("input.xlsx");
const SHEET_NAME         = "O2O";
const OUTPUT_JSON_PATH   = path.resolve("objectObjects.json");

// ---- Utils ----
const normalize = s => String(s || "").toLowerCase().replace(/\s|_/g, "");

// Safely read JSON
function readJson(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Get object definitions (where names like "SalesOrder" live)
function getObjectDefs(entities) {
  // Try a few likely locations
  const candidates = [
    entities?.objects,
    entities?.entitiesDefinitions?.objects,
    entities?.entities?.objects
  ];
  for (const arr of candidates) {
    if (Array.isArray(arr)) return arr;
  }
  return []; // none found
}

// ---- Step 1: Build base ocpmRelations from entities.json (events) ----
function buildBaseFromEntities(entities) {
  const events = entities?.entitiesDefinitions?.events || [];
  const objects = events.map(ev => ({
    id: ev.id,
    items: [],
    relations: [],
    name: ev.name
  }));
  return {
    ocpmRelations: {
      events: [],
      objects
    }
  };
}

// ---- Step 2: Add relations from input.xlsx (O2O) ----
function addRelationsFromExcel(doc) {
  if (!fs.existsSync(INPUT_XLSX_PATH)) {
    console.warn(`⚠️ ${INPUT_XLSX_PATH} not found. Skipping Excel-based relations.`);
    return;
  }
  const wb = xlsx.readFile(INPUT_XLSX_PATH);
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    console.warn(`⚠️ Sheet "${SHEET_NAME}" not found. Skipping Excel-based relations.`);
    return;
  }
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
  if (!rows.length) {
    console.warn(`⚠️ Sheet "${SHEET_NAME}" is empty. Skipping Excel-based relations.`);
    return;
  }

  const header = rows[0].map(h => String(h).trim());
  if (!header.length) return;

  // Map ocpm objects by normalized name
  const byName = new Map();
  for (const obj of doc.ocpmRelations.objects) {
    byName.set(normalize(obj.name), obj);
    if (!Array.isArray(obj.relations)) obj.relations = [];
  }

  // Dedup per object
  const seenByObj = new Map();
  for (const obj of doc.ocpmRelations.objects) {
    const set = new Set(
      obj.relations.map(r => `${r.sourceEntityId}|${r.targetEntityId}|${r.cardinality}`)
    );
    seenByObj.set(obj.id, set);
  }

  // Process data rows
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const activityRaw = row[0];
    const activityNorm = normalize(activityRaw);
    if (!activityNorm) continue;

    let obj = byName.get(activityNorm);
    if (!obj) {
      const soft = activityNorm.replace(/[^a-z0-9]/g, "");
      const fallback = [...byName.entries()].find(([k]) => k.replace(/[^a-z0-9]/g, "") === soft);
      if (!fallback) continue;
      obj = fallback[1];
    }

    const sources = [];
    const targets = [];

    for (let c = 1; c < header.length; c++) {
      const colHeader = String(header[c]).trim();
      if (!colHeader) continue;

      const v = String(row[c] ?? "").trim().toLowerCase();
      if (v === "1") sources.push(colHeader);
      if (v === "n") targets.push(colHeader);
    }

    if (!sources.length || !targets.length) continue;

    const seen = seenByObj.get(obj.id);
    for (const s of sources) {
      for (const t of targets) {
        const card = "HAS_MANY";
        const key = `${s}|${t}|${card}`;
        if (seen.has(key)) continue;

        obj.relations.push({
          id: uuidv4(),
          sourceEntityId: s,      // names for now (will be mapped to IDs in Step 3)
          targetEntityId: t,
          cardinality: card
        });
        seen.add(key);
      }
    }
  }
}

// ---- Step 3 (NEW): Replace source/target names with IDs from entities.json.objects ----
function applyEntityIdMapping(doc, entities) {
  const objectDefs = getObjectDefs(entities);
  if (!objectDefs.length) {
    console.warn("⚠️ No objects array found in entities.json. Skipping name→ID mapping.");
    return;
  }

  // Build name→id map (case/space/underscore-insensitive)
  const nameToId = new Map();
  for (const o of objectDefs) {
    if (!o || !o.name || !o.id) continue;
    nameToId.set(normalize(o.name), String(o.id));
  }

  for (const obj of doc.ocpmRelations.objects) {
    if (!Array.isArray(obj.relations)) continue;

    for (const rel of obj.relations) {
      // If value already looks like a UUID/id string we leave it, but try mapping if not found.
      const srcKey = normalize(rel.sourceEntityId);
      const tgtKey = normalize(rel.targetEntityId);

      const srcId = nameToId.get(srcKey);
      const tgtId = nameToId.get(tgtKey);

      if (srcId) rel.sourceEntityId = srcId;
      if (tgtId) rel.targetEntityId = tgtId;
    }
  }
}

// ---- Main ----
(function main() {
  try {
    const entities = readJson(ENTITIES_JSON_PATH);
    const doc = buildBaseFromEntities(entities);  // Step 1
    addRelationsFromExcel(doc);                   // Step 2
    applyEntityIdMapping(doc, entities);          // Step 3 (NEW)
    fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(doc, null, 2), "utf8");
    console.log("✅ objectObjects.json generated & mapped successfully.");
  } catch (e) {
    console.error("❌ Error:", e.message);
    process.exit(1);
  }
})();
