// generateOutput.js
const fs = require("fs");
const xlsx = require("xlsx");
const { v4: uuidv4 } = require("uuid");

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function loadJSON(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`Failed to read ${path}:`, e.message);
    process.exit(1);
  }
}

// ---------- STEP 1: Build skeleton from entities.json ----------
const entities = loadJSON("entities.json");
const eventsSrc = entities?.entitiesDefinitions?.events || [];
const output = {
  ocpmRelations: {
    events: eventsSrc.map(ev => ({
      id: ev.id,
      name: String(ev.name || "").replace(/\s+/g, ""), // keep prior normalization
      objects: []
    }))
  }
};

// ---------- STEP 2: Read Excel (PE2) and fill objects ----------
const workbook = xlsx.readFile("input.xlsx");
const sheet = workbook.Sheets["PE2"];
if (!sheet) {
  console.error("Sheet 'PE2' not found in input.xlsx");
  process.exit(1);
}
const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
if (!data.length) {
  console.error("Sheet 'PE2' appears to be empty.");
  process.exit(1);
}
const headers = data[0];

for (let r = 1; r < data.length; r++) {
  const row = data[r];
  const activityRaw = row[0] || "";
  const activityKey = normalize(activityRaw); // ignore spaces/special chars
  const matchEvent = output.ocpmRelations.events.find(
    ev => normalize(ev.name) === activityKey
  );
  if (!matchEvent) continue;

  // Skip column B (index 1). Start from index 2.
  for (let c = 2; c < row.length; c++) {
    const val = Number(row[c]);
    if (!val || val <= 0) continue;

    let rangeVal = val > 9 ? 9 : val;
    const type = rangeVal === 1 ? "HAS_ONE" : "HAS_MANY";

    matchEvent.objects.push({
      id: uuidv4(),
      ocpmObjectId: headers[c], // temporarily keep NAME/HEADER; will swap to ID later
      type,
      rangeMin: rangeVal,
      rangeMax: rangeVal
    });
  }
}

// Write the intermediate output (with ocpmObjectId as NAMES)
fs.writeFileSync("eventObjects.json", JSON.stringify(output, null, 2));
console.log("✅ Step 1 done: eventObjects.json generated (names in ocpmObjectId).");

// ---------- STEP 3: Replace ocpmObjectId (names) with object IDs from entities.json ----------
const outputJson = loadJSON("eventObjects.json");

// Build a lookup from entitiesDefinitions.objects (name → id)
const objectsSrc = entities?.entitiesDefinitions?.objects || [];
if (!Array.isArray(objectsSrc) || objectsSrc.length === 0) {
  console.warn(
    "⚠️  No entitiesDefinitions.objects found in entities.json. Skipping ocpmObjectId→ID replacement."
  );
} else {
  const nameToId = new Map();
  for (const obj of objectsSrc) {
    const n = normalize(obj?.name);
    if (n) nameToId.set(n, obj.id);
  }

  // Walk through output and replace
  for (const ev of outputJson.ocpmRelations.events) {
    for (const obj of ev.objects) {
      const current = obj.ocpmObjectId;

      // If it already looks like a UUID, leave it
      const maybeUuid = typeof current === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current);

      if (maybeUuid) continue;

      const key = normalize(current);
      const mappedId = nameToId.get(key);
      if (mappedId) {
        obj.ocpmObjectId = mappedId;
      } else {
        // If no match found, keep as-is but log once
        console.warn(`⚠️  No object ID found for header/name "${current}" (event: ${ev.name}). Keeping original value.`);
      }
    }
  }

  fs.writeFileSync("eventObjects.json", JSON.stringify(outputJson, null, 2));
  console.log("✅ Step 2 done: ocpmObjectId values replaced with IDs where found.");
}

/*
How to run:
1) npm install xlsx uuid
2) Place entities.json and input.xlsx alongside this script.
   - entities.json should contain: entitiesDefinitions.events[] and entitiesDefinitions.objects[] with {id, name}
3) node generateOutput.js
Result: eventObjects.json with ocpmObjectId replaced by corresponding object IDs.
*/
