// generateAttributes.js
const fs = require("fs");
const xlsx = require("xlsx");

// ---------- Helpers ----------
function readJSON(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}
function uniq(arr) {
  return Array.from(new Set(arr));
}

// ---------- Step 1: Load entities.json ----------
const entities = readJSON("entities.json");
const defs = entities.entitiesDefinitions || {};
const attributesSrc = defs.attributes || [];

// Some files place objects under entitiesDefinitions.objects; fall back gracefully if needed
const objectsSrc =
  defs.objects ||
  entities.objects ||
  [];

// Build quick lookup: name -> id for objects
const objectNameToId = new Map(
  objectsSrc
    .filter(o => o && typeof o.name === "string" && typeof o.id === "string")
    .map(o => [o.name.trim(), o.id])
);

// ---------- Step 2: Base output structure ----------
let output = {
  ocpmRelations: {
    attributes: attributesSrc.map(attr => ({
      id: attr.id,
      name: attr.name,
      targetObjects: [],
      available: true // will be set after Excel parse
    }))
  }
};

// ---------- Step 3: Load Excel and map names ----------
const workbook = xlsx.readFile("input.xlsx");
const sheet = workbook.Sheets["A2O"];
if (!sheet) {
  console.error("❌ Sheet 'A2O' not found in input.xlsx");
  process.exit(1);
}
const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

// Header row (A1..): first cell is the label for column A, the rest are object NAMES
const headers = (data[0] || []).slice(1).map(h => (typeof h === "string" ? h.trim() : h));

// For each data row, collect target object NAMES where the cell == 1
for (let i = 1; i < data.length; i++) {
  const row = data[i] || [];
  const attrName = (row[0] || "").toString().trim();
  if (!attrName) continue;

  const attrEntry = output.ocpmRelations.attributes.find(a => a.name === attrName);
  if (!attrEntry) continue;

  const targets = [];
  for (let j = 1; j < row.length; j++) {
    const cell = row[j];
    if (cell === 1 || cell === "1") {
      const objName = headers[j - 1];
      if (objName) targets.push(objName);
    }
  }
  attrEntry.targetObjects = uniq(targets);
  attrEntry.available = attrEntry.targetObjects.length > 0;
}

// ---------- Step 4 (NEW FEATURE): Replace target object NAMES with IDs ----------
for (const attr of output.ocpmRelations.attributes) {
  const replaced = [];
  for (const name of attr.targetObjects) {
    const key = typeof name === "string" ? name.trim() : name;
    const id = objectNameToId.get(key);
    if (id) {
      replaced.push(id);
    } else {
      // If no match, keep the original value but warn once
      console.warn(`⚠️ No matching object.id for name "${key}" in entities.json objects[]`);
      replaced.push(key);
    }
  }
  // De-duplicate again in case multiple names mapped to same id
  attr.targetObjects = uniq(replaced);
}

// ---------- Step 5: Write output ----------
fs.writeFileSync("attributeObjects.json", JSON.stringify(output, null, 2), "utf8");
console.log("✅ attributeObjects.json generated successfully with targetObjects mapped to IDs (when available).");
