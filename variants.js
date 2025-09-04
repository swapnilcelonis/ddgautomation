// build-variants.js
// Usage:
//   1) npm i xlsx uuid fs
//   2) node build-variants.js input.xlsx entities.json
//
// If args omitted: defaults to ./input.xlsx and ./entities.json

const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

// ---------- Config / Paths ----------
const INPUT_XLSX = process.argv[2] || "input.xlsx";
const ENTITIES_FILE = process.argv[3] || "entities.json";
const TEMP_OUTPUT = "output.json";   // intermediate (pre-link)
const FINAL_OUTPUT = "variants.json";

// ---------- Helpers ----------
function formatVariantName(sheetName) {
  const parts = sheetName.split("_");
  return parts.length > 1 ? parts.slice(1).join("_") : sheetName;
}

// Remove everything except [A-Za-z0-9]
function sanitizeReferencedName(name) {
  return String(name).replace(/[^A-Za-z0-9]/g, "");
}

function getCellNumber(sheet, addr, fallback = 0) {
  const c = sheet[addr];
  if (!c || c.v === undefined || c.v === null || String(c.v).trim() === "") return fallback;
  const n = Number(c.v);
  return Number.isFinite(n) ? n : fallback;
}

function parseWorkbookToJson(filePath) {
  const workbook = XLSX.readFile(filePath);
  const variants = { items: [] };

  workbook.SheetNames.forEach((sheetName) => {
    if (!sheetName.startsWith("Variant_")) return;

    const sheet = workbook.Sheets[sheetName];
    const variantObj = {
      id: uuidv4(),
      name: formatVariantName(sheetName),
      frequency: 0,
      items: [],
    };

    // A2 -> frequency
    variantObj.frequency = getCellNumber(sheet, "A2", 0);

    // Column mapping in each "Variant_*" sheet:
    // B -> referencedName, C -> startDate, D -> endDate, E -> automation
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let r = 2; r <= range.e.r + 1; r++) {
      const bAddr = "B" + r;
      const bCell = sheet[bAddr];
      if (!bCell || String(bCell.v).trim() === "") continue;

      const referencedName = sanitizeReferencedName(String(bCell.v));
      let startDate = getCellNumber(sheet, "C" + r, 0);
      let endDate = getCellNumber(sheet, "D" + r, 0);
      let automation = getCellNumber(sheet, "E" + r, 80);

      // === CHANGE START: apply rules for automation, startDate, endDate ===
      // 1) automation: multiply by 100; if negative, treat as 0
      if (!Number.isFinite(automation)) automation = 0;
      automation = automation < 0 ? 0 : automation * 100;

      // 2) startDate & endDate: if any value is under 1, make it 1
      if (!Number.isFinite(startDate) || startDate < 1) startDate = 1;
      if (!Number.isFinite(endDate) || endDate < 1) endDate = 1;
      // === CHANGE END ===

      variantObj.items.push({
        id: uuidv4(),
        referencedId: "0",     // placeholder; filled in the linking phase
        activityId: null,
        automation,
        startDate,
        endDate,
        referencedName,
      });
    }

    variants.items.push(variantObj);
  });

  return { variants, randomConfigs: [] };
}

// Build lookup { sanitizedName -> eventId } from entities.entitiesDefinitions.events
function buildEventIndex(entities) {
  const events =
    entities?.entitiesDefinitions?.events && Array.isArray(entities.entitiesDefinitions.events)
      ? entities.entitiesDefinitions.events
      : [];

  const idx = new Map();
  for (const ev of events) {
    const key = sanitizeReferencedName(ev.name || "");
    if (key) idx.set(key, ev.id);
  }
  return idx;
}

function linkReferencedIds(tempJson, entities) {
  const index = buildEventIndex(entities);

  for (const variant of tempJson.variants.items) {
    for (const item of variant.items) {
      // normalize field name (in case any upstream used referenceId)
      const currentRefId = item.referencedId ?? item.referenceId ?? "0";

      if (!currentRefId || currentRefId === "0" || currentRefId === 0) {
        const key = sanitizeReferencedName(item.referencedName || "");
        const foundId = index.get(key);
        item.referencedId = foundId ? foundId : "0"; // keep "0" if not found
        if ("referenceId" in item) delete item.referenceId;
      } else {
        item.referencedId = String(currentRefId);
        if ("referenceId" in item) delete item.referenceId;
      }
    }
  }
  return tempJson;
}

// ---------- Main ----------
(function main() {
  try {
    // Phase 1: Parse XLSX -> TEMP_OUTPUT
    const parsed = parseWorkbookToJson(INPUT_XLSX);
    fs.writeFileSync(TEMP_OUTPUT, JSON.stringify(parsed, null, 2), "utf8");
    console.log(`Written intermediate JSON -> ${TEMP_OUTPUT}`);

    // Phase 2: Link with entities.json (entitiesDefinitions.events)
    if (!fs.existsSync(ENTITIES_FILE)) {
      throw new Error(`Missing entities file: ${path.resolve(ENTITIES_FILE)}`);
    }
    const entities = JSON.parse(fs.readFileSync(ENTITIES_FILE, "utf8"));

    const tempJson = JSON.parse(fs.readFileSync(TEMP_OUTPUT, "utf8"));
    const finalJson = linkReferencedIds(tempJson, entities);

    fs.writeFileSync(FINAL_OUTPUT, JSON.stringify(finalJson, null, 2), "utf8");
    console.log(`Written final JSON -> ${FINAL_OUTPUT}`);

    // Cleanup: delete TEMP_OUTPUT
    try {
      fs.unlinkSync(TEMP_OUTPUT);
      console.log(`Deleted intermediate file ${TEMP_OUTPUT}`);
    } catch (e) {
      console.warn(`Could not delete ${TEMP_OUTPUT}:`, e.message);
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
