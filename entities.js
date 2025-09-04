import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import { v4 as uuidv4 } from "uuid";

const workbookPath = path.resolve("input.xlsx");

// Utility to sanitize headers
function sanitizeHeaders(row) {
  const cleanedRow = {};
  for (const key in row) {
    const cleanedKey = key.trim().toLowerCase();
    cleanedRow[cleanedKey] = row[key];
  }
  return cleanedRow;
}

// Load worksheet as JSON
function parseSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(sheet, { defval: "" });
}

function sanitizeName(name) {
  if (!name) return "";
  return name.toString().replace(/[^A-Za-z0-9]/g, "").trim();
}


// Get sanitized headers
// function getHeaders(sheet) {
//   const headerRow = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0];
//   return headerRow
//     .map((h) => h.trim())
//     .filter((h) => h.toLowerCase() !== "attribute");
// }

// Build events from PE2 sheet
function buildEvents(data) {
  return data.map((rowRaw) => {
    const row = sanitizeHeaders(rowRaw);
    return {
      id: uuidv4(),
      name: sanitizeName(row["activity"] || ""), // fallback if 'activity' missing
      automation: row["automation"] !== "" ? row["automation"] * 100 : null,
    };
  });
}

// Build attributes from A2O
// function buildAttributes(data) {
//   return data.map((rowRaw) => {
//     const row = sanitizeHeaders(rowRaw);
//     return {
//       id: uuidv4(),
//       name: row["attributes"] || "", // fallback if 'attributes' missing
//       defaultItem: false,
//       items: [],
//       distributionItems: [],
//       attributeMetadataItems: [],
//     };
//   });
// }

// // Build objects from header row
// function buildObjects(objectNames) {
//   return objectNames.map((name) => ({
//     id: uuidv4(),
//     name,
//   }));
// }

function main() {
  const workbook = xlsx.readFile(workbookPath);

  // Parse PE2 sheet (events)
  const pe2Data = parseSheet(workbook, "PE2");

  // Parse A2O sheet (attributes + objects)
  const a2oSheet = workbook.Sheets["A2O"];

  const sheetName = "A2O";
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    console.error(`Sheet "${sheetName}" not found in workbook.`);
    process.exit(1);
  }

  // Convert the sheet to JSON array format
  const sheetData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

  // ===== Extract Attributes =====
  let attributeIndex = -1;
  const headerRow = sheetData[0];

  for (let i = 0; i < headerRow.length; i++) {
    if (headerRow[i]?.toLowerCase() === "attribute") {
      attributeIndex = i;
      break;
    }
  }

  if (attributeIndex === -1) {
    console.error(`Column "attributes" not found in sheet "${sheetName}".`);
    process.exit(1);
  }

  const attributes = [];

  for (let i = 1; i < sheetData.length; i++) {
    const row = sheetData[i];
    const attrValue = row[attributeIndex];
    if (attrValue && attrValue.toString().trim() !== "") {
      attributes.push({
        id: uuidv4(),
        name: sanitizeName(attrValue.toString().trim()),
        defaultItem: false,
        items: [],
        distributionItems: [],
        attributeMetadataItems: [],
      });
    }
  }

  const objectHeaders = headerRow.slice(1); // exclude first cell (A1)
  const objects = [];

  for (const objName of objectHeaders) {
    if (objName && objName.toString().trim() !== "") {
      objects.push({
        id: uuidv4(),
        name: sanitizeName(objName.toString().trim()),
      });
    }
  }

  // ✅ Parse "General" sheet
  const generalSheet = workbook.Sheets["General"];
  const generalData = xlsx.utils.sheet_to_json(generalSheet, { defval: "" });

  let general = {};
  if (generalData.length > 0) {
    const row = generalData[0]; // Assuming single row of values

    function toMillis(dateStr) {
      if (typeof dateStr === "number") {
        dateStr = dateStr.toString();
      }
      // Expecting YYYYMMDD format
      const year = parseInt(dateStr.slice(0, 4));
      const month = parseInt(dateStr.slice(4, 6)) - 1; // JS months are 0-based
      const day = parseInt(dateStr.slice(6, 8));
      return new Date(year, month, day).getTime();
    }

    general = {
      startDate: toMillis(row["Start"]),
      endDate: toMillis(row["End"]),
      timeUnit: row["Unit"].toUpperCase(),
      nCases: Number(row["Cases"]),
    };
  }

  // Build final output
  const result = {
    general,
    entitiesDefinitions: {
      activities: null,
      events: buildEvents(pe2Data),
      attributes,
      objects,
    },
  };

  // Write output
  const outputPath = path.resolve("entities.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`✅ Output saved to ${outputPath}`);
}

main();
