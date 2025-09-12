// buildCaseTable_createMissingDimensions.js
// Usage:
//   npm install xlsx uuid fs
//   node buildCaseTable_createMissingDimensions.js
//
// Expects:
//   - input3.xlsx
//   - entities.json
//   - variants.json (optional, used for mapping distributionItems.referencedId)
// Outputs:
//   - caseTableOutput_beforeEntityMap.json
//   - zzz.json

const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const INPUT_XLSX = 'input3.xlsx';
const ENTITIES_FILE = 'entities.json';
const VARIANTS_FILE = 'variants.json';
const BACKUP_OUTPUT = 'caseTableOutput_beforeEntityMap.json';
const OUTPUT_FILE = 'zzz.json';

if (!fs.existsSync(INPUT_XLSX)) {
  console.error(`Missing ${INPUT_XLSX} in current folder. Aborting.`);
  process.exit(1);
}
if (!fs.existsSync(ENTITIES_FILE)) {
  console.error(`Missing ${ENTITIES_FILE} in current folder. Aborting.`);
  process.exit(1);
}

/* ---------- Helpers ---------- */

// Clean identifier-like strings: remove ALL whitespace, keep only [A-Za-z0-9_]
function cleanId(raw) {
  if (raw === undefined || raw === null) return '';
  let s = String(raw);
  s = s.replace(/\s+/g, '');            // remove ALL whitespace
  s = s.replace(/[^A-Za-z0-9_]/g, '');  // keep only letters, digits and underscore
  return s;
}

// Parse numeric cells robustly -> number or null
// New behavior elsewhere: if parsed numeric value is <= 0 (zero or negative), return 1
function parseNumberOrNullCell(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = raw;
    return (n <= 0) ? 1 : n;
  }
  if (typeof raw === 'boolean') return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const cleaned = s.replace(/[^0-9.\-eE+]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return (n <= 0) ? 1 : n;
}

// Preserve metadata cell value as trimmed string (if number, convert to string)
function metadataCellValue(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    // If metadata is numeric and <=0, convert to "1" per prior rule; otherwise stringified.
    const n = raw;
    const use = (n <= 0) ? 1 : n;
    return String(use);
  }
  const s = String(raw).trim();
  return s === '' ? null : s;
}

// skip-empty helper for rows/columns: return true if cell is considered empty
function isCellEmpty(raw) {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '') || raw === '';
}

// Recursively collect all arrays named 'distributionItems' inside an object
function collectDistributionItemsArrays(obj) {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (key === 'distributionItems' && Array.isArray(val)) {
      results.push(val);
    } else if (val && typeof val === 'object') {
      results.push(...collectDistributionItemsArrays(val));
    }
  }
  return results;
}

// UUID detection regex
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ---------- Read workbook and build selectedDimensions / metadata ---------- */

const wb = xlsx.readFile(INPUT_XLSX);
const sheetNames = wb.SheetNames || [];

const selectedDimensions = [];

// Build selectedDimensions from CaseTable_ sheets
for (const sheetName of sheetNames) {
  if (!sheetName.startsWith('CaseTable_')) continue;

  const dimNameRaw = sheetName.slice('CaseTable_'.length);
  const dimName = cleanId(dimNameRaw) || dimNameRaw;

  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true }) || [];

  if (rows.length === 0) {
    selectedDimensions.push({
      id: uuidv4(),
      name: dimName,
      defaultItem: false,
      items: [],
      distributionItems: [],
      attributeMetadataItems: [],
      referencedId: dimName
    });
    continue;
  }

  // header row cleaned and skip empty header columns
  const headerRowRaw = rows[0] || [];
  const headerRowClean = headerRowRaw.map(h => cleanId(h));
  // distribution headers are C onward, but skip empty ones
  const distributionHeaders = headerRowClean.slice(2).map((h, idx) => ({ hdr: h, rawIndex: 2 + idx })).filter(x => x.hdr);

  // create distributionItems from non-empty distributionHeaders
  const distributionItems = distributionHeaders.map(hinfo => {
    const hdrClean = hinfo.hdr || '';
    const up = hdrClean.toUpperCase();

    const dist = {
      id: uuidv4(),
      type: 'VARIANT',
      referencedId: null,
      referencedItemId: null,
      alias: hdrClean
    };

    if (up.startsWith('VARIANT_')) {
      const extracted = cleanId(hdrClean.slice('VARIANT_'.length));
      dist.type = 'VARIANT';
      dist.alias = extracted;
      dist.referencedId = extracted || null;
    } else if (up.startsWith('ATTRIBUTE_')) {
      const extracted = cleanId(hdrClean.slice('ATTRIBUTE_'.length));
      dist.type = 'ATTRIBUTE';
      dist.alias = extracted; // resolve later
    } else {
      const extracted = cleanId(hdrClean);
      dist.type = 'VARIANT';
      dist.alias = extracted;
      dist.referencedId = extracted || null;
    }

    return dist;
  });

  // Build items from rows (row 2 onwards), skipping empty rows
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    // skip row if all cells empty
    const rowEmpty = row.every(isCellEmpty);
    if (rowEmpty) continue;

    const rawValueCell = row[0];
    if (isCellEmpty(rawValueCell)) continue;
    const value = cleanId(rawValueCell);

    const stdDistribution = parseNumberOrNullCell(row[1]);

    // distributions: use distributionItems list and attempt to read corresponding cell (col index = 2 + index)
    const distributions = distributionItems.map((distItem, idx) => {
      const colIndex = 2 + idx;
      const cell = colIndex < row.length ? row[colIndex] : null;
      const parsed = parseNumberOrNullCell(cell);
      return {
        distributionItemId: distItem.id,
        value: parsed
      };
    });

    items.push({
      id: uuidv4(),
      value,
      stdDistribution,
      variants: [],
      distributions,
      attributesMetadata: []
    });
  }

  selectedDimensions.push({
    id: uuidv4(),
    name: dimName,
    defaultItem: false,
    items,
    distributionItems,
    attributeMetadataItems: [],
    referencedId: dimName
  });
}

// Resolve ATTRIBUTE distributionItems across selectedDimensions
function findDimensionByCleanName(dims, nameRaw) {
  const target = cleanId(nameRaw);
  if (!target) return null;
  return dims.find(sd => cleanId(sd.name).toUpperCase() === target.toUpperCase()) || null;
}
function findItemObjectInDimensionItems(dimension, valueRaw) {
  if (!dimension || !dimension.items) return null;
  const target = cleanId(valueRaw);
  if (!target) return null;
  return dimension.items.find(it => cleanId(it.value).toUpperCase() === target.toUpperCase()) || null;
}

for (const dim of selectedDimensions) {
  for (const dist of dim.distributionItems) {
    if (dist.type !== 'ATTRIBUTE') continue;

    const alias = dist.alias || '';
    if (!alias) {
      dist.referencedId = null;
      dist.referencedItemId = null;
      continue;
    }

    const upAlias = alias.toUpperCase();
    const whereIdx = upAlias.indexOf('WHEREIS');

    if (whereIdx >= 0) {
      const beforeRaw = alias.slice(0, whereIdx);
      const afterRaw = alias.slice(whereIdx + 'WHEREIS'.length);

      const targetDim = findDimensionByCleanName(selectedDimensions, beforeRaw);
      dist.referencedId = targetDim ? targetDim.id : null;

      if (targetDim) {
        const itemObj = findItemObjectInDimensionItems(targetDim, afterRaw);
        dist.referencedItemId = itemObj ? itemObj.id : null;
      } else {
        dist.referencedItemId = null;
      }

      dist.alias = alias;
    } else {
      const targetDim = findDimensionByCleanName(selectedDimensions, alias);
      dist.referencedId = targetDim ? targetDim.id : null;
      dist.referencedItemId = null;
    }
  }
}

// Read Metadata_ sheets: populate attributeMetadataItems (B..), skip empty columns; then fill item attributesMetadata from rows starting row 2
for (const sheetName of sheetNames) {
  if (!sheetName.startsWith('Metadata_')) continue;

  const metaNameRaw = sheetName.slice('Metadata_'.length);
  const metaName = cleanId(metaNameRaw) || metaNameRaw;

  const targetDim = findDimensionByCleanName(selectedDimensions, metaName);
  if (!targetDim) continue;

  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true }) || [];
  if (rows.length === 0) {
    targetDim.attributeMetadataItems = [];
    continue;
  }

  const headerRow = rows[0] || [];
  // collect non-empty headers from column B onward, maintain array of meta header info {colIndex, columnName, rawHdr}
  const attributeMetadataHeaders = [];
  for (let col = 1; col < headerRow.length; col++) {
    const rawHdr = headerRow[col];
    if (isCellEmpty(rawHdr)) continue;
    const columnName = cleanId(rawHdr);
    if (!columnName) continue;
    attributeMetadataHeaders.push({ colIndex: col, columnName, rawHdr });
  }

  // Validate uniqueness of cleaned columnName within this sheet
  const nameToOccurrences = new Map();
  for (const h of attributeMetadataHeaders) {
    const key = h.columnName.toUpperCase();
    if (!nameToOccurrences.has(key)) nameToOccurrences.set(key, []);
    nameToOccurrences.get(key).push(h);
  }
  const duplicates = [];
  for (const [name, occ] of nameToOccurrences.entries()) {
    if (occ.length > 1) duplicates.push({ name, occurrences: occ });
  }
  if (duplicates.length > 0) {
    console.error(`\nERROR: Duplicate attribute metadata column names found in sheet "${sheetName}".`);
    console.error(`You must ensure metadata column names (after cleaning) are unique within the sheet.\n`);
    for (const dup of duplicates) {
      console.error(`- Duplicated cleaned name: "${dup.name}" appears ${dup.occurrences.length} times:`);
      for (const occ of dup.occurrences) {
        // occ.colIndex is 0-based index in rows; convert to Excel-like 1-based index and column letter for clarity
        const colNumber = occ.colIndex + 1; // 1-based
        // compute column letter (A, B, C, ...)
        function colNumberToLetter(n) {
          let s = '';
          while (n > 0) {
            const rem = (n - 1) % 26;
            s = String.fromCharCode(65 + rem) + s;
            n = Math.floor((n - 1) / 26);
          }
          return s;
        }
        const colLetter = colNumberToLetter(colNumber);
        console.error(`    * Sheet: "${sheetName}", Column: ${colLetter} (index ${colNumber}), original header: "${occ.rawHdr}"`);
      }
      console.error('');
    }
    console.error('Please fix the duplicated header(s) in the Excel sheet and re-run the script.');
    process.exit(1);
  }

  // build attributeMetadataItems array (preserve order) -- safe because no duplicates
  const attributeMetadataItems = attributeMetadataHeaders.map(h => ({ id: uuidv4(), columnName: h.columnName }));
  targetDim.attributeMetadataItems = attributeMetadataItems;

  // now scan rows from row 2 (index 1) onward and populate item attributesMetadata
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    // skip empty row
    if (row.every(isCellEmpty)) continue;
    const firstCellRaw = row[0];
    if (isCellEmpty(firstCellRaw)) continue;
    const itemValueClean = cleanId(firstCellRaw);
    if (!itemValueClean) continue;

    const itemObj = findItemObjectInDimensionItems(targetDim, itemValueClean);
    if (!itemObj) continue;

    // build attributesMetadata array using attributeMetadataHeaders order
    const attrs = [];
    for (let i = 0; i < attributeMetadataHeaders.length; i++) {
      const colIndex = attributeMetadataHeaders[i].colIndex;
      const metaItem = attributeMetadataItems[i];
      const rawMetaCell = colIndex < row.length ? row[colIndex] : null;
      const value = metadataCellValue(rawMetaCell);
      // push even if null to keep alignment with attributeMetadataItems
      attrs.push({
        metadataItemId: metaItem.id,
        value: value
      });
    }

    // assign to actual item in the selectedDimensions structure
    const itemInDim = targetDim.items.find(it => it.id === itemObj.id);
    if (itemInDim) {
      itemInDim.attributesMetadata = attrs;
    }
  }
}

/* ---------- Backup before mapping ---------- */

const backupObj = { caseTableCreator: { dimensionList: [], selectedDimensions } };
fs.writeFileSync(BACKUP_OUTPUT, JSON.stringify(backupObj, null, 2), 'utf8');
console.log(`Backup written to ${BACKUP_OUTPUT}`);

/* ---------- Load entities.json and map selectedDimension.referencedId -> entitiesDefinitions.attributes[].id ---------- */

let entitiesData;
try {
  entitiesData = JSON.parse(fs.readFileSync(ENTITIES_FILE, 'utf8'));
} catch (err) {
  console.error(`Failed to parse ${ENTITIES_FILE}: ${err.message}`);
  process.exit(1);
}

const ed = entitiesData.entitiesDefinitions || entitiesData.entities_definitions || null;
const entitiesAttributes = ed && Array.isArray(ed.attributes) ? ed.attributes : null;
if (!Array.isArray(entitiesAttributes)) {
  console.error(`Could not find entitiesDefinitions.attributes array in ${ENTITIES_FILE}. Aborting mapping/dimensionList creation.`);
  const finalObj = { caseTableCreator: { dimensionList: [], selectedDimensions } };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalObj, null, 2), 'utf8');
  console.log(`Wrote ${OUTPUT_FILE} (no mapping/dimensionList applied).`);
  process.exit(1);
}

// Build lookup map: cleaned attribute name -> id
const attrNameToId = new Map();
for (const attr of entitiesAttributes) {
  if (!attr || typeof attr.name === 'undefined' || typeof attr.id === 'undefined') continue;
  const key = cleanId(attr.name).toUpperCase();
  if (!key) continue;
  attrNameToId.set(key, attr.id);
}

// Map selectedDimensions[].referencedId values (if not already UUID)
let mappedCount = 0;
let unresolved = new Set();

for (const sd of selectedDimensions) {
  if (!sd || typeof sd.referencedId === 'undefined' || sd.referencedId === null) continue;
  const maybe = String(sd.referencedId);
  if (uuidRegex.test(maybe)) continue; // already id-like
  const key = cleanId(maybe).toUpperCase();
  if (!key) continue;
  const mapped = attrNameToId.get(key);
  if (mapped) {
    sd.referencedId = mapped;
    mappedCount++;
  } else {
    unresolved.add(sd.referencedId);
  }
}

/* ---------- Build dimensionList: include only attributes that are NOT present in selectedDimensions ---------- */

function selectedDimensionHasName(cleanName) {
  return selectedDimensions.some(sd => cleanId(sd.name).toUpperCase() === cleanName.toUpperCase());
}

const dimensionList = [];
for (const attr of entitiesAttributes) {
  const key = cleanId(attr.name);
  if (!key) continue;
  // if attribute name NOT present in selectedDimensions, add to dimensionList
  if (!selectedDimensionHasName(key)) {
    dimensionList.push({
      id: uuidv4(),
      name: attr.name, // preserve original name for readability
      defaultItem: false,
      items: [],
      distributionItems: [],
      attributeMetadataItems: [],
      referencedId: attr.id // set to attribute id from entities.json
    });
  }
}

/* ---------- Load variants.json and map distributionItems.referencedId values to variant group ids (optional) ---------- */

let variantMappedCount = 0;
let variantUnresolved = new Set();

if (fs.existsSync(VARIANTS_FILE)) {
  try {
    const variantsData = JSON.parse(fs.readFileSync(VARIANTS_FILE, 'utf8'));
    // expect variantsData.variants.items
    const variantGroups = (variantsData && variantsData.variants && Array.isArray(variantsData.variants.items))
      ? variantsData.variants.items
      : null;
    if (Array.isArray(variantGroups)) {
      const variantNameToId = new Map();
      for (const vg of variantGroups) {
        if (!vg || typeof vg.name === 'undefined' || typeof vg.id === 'undefined') continue;
        const key = cleanId(vg.name).toUpperCase();
        if (!key) continue;
        variantNameToId.set(key, vg.id);
      }

      for (const sd of selectedDimensions) {
        const distArrays = collectDistributionItemsArrays(sd);
        for (const distArray of distArrays) {
          for (const dist of distArray) {
            if (!dist || typeof dist.referencedId === 'undefined' || dist.referencedId === null) continue;
            const maybe = String(dist.referencedId);
            if (uuidRegex.test(maybe)) continue; // already id-like
            const key = cleanId(maybe).toUpperCase();
            if (!key) continue;
            const mapped = variantNameToId.get(key);
            if (mapped) {
              dist.referencedId = mapped;
              variantMappedCount++;
            } else {
              variantUnresolved.add(dist.referencedId);
            }
          }
        }
      }
    } else {
      console.log(`variants.json found but structure not as expected (variants.variants.items). Skipping variants mapping.`);
    }
  } catch (err) {
    console.warn(`Failed to parse ${VARIANTS_FILE}: ${err.message}. Skipping variants mapping.`);
  }
} else {
  console.log(`${VARIANTS_FILE} not found — skipping variants mapping.`);
}

/* ---------- Sanitization: remove underscores from all string values in final JSON ---------- */

function sanitizeStringsInObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sanitizeStringsInObject);
  } else if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizeStringsInObject(v);
    }
    return out;
  } else if (typeof obj === 'string') {
    // Remove all underscores from string values
    return obj.replace(/_+/g, '').trim();
  } else {
    return obj;
  }
}

/* ---------- Final write (sanitize then write) ---------- */

const finalObj = {
  caseTableCreator: {
    dimensionList,
    selectedDimensions
  }
};

// sanitize copy of finalObj
const sanitizedFinalObj = sanitizeStringsInObject(finalObj);

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sanitizedFinalObj, null, 2), 'utf8');

console.log(`Wrote ${OUTPUT_FILE}.`);
console.log(`Mapped ${mappedCount} selectedDimensions.referencedId -> entities attribute ids.`);
console.log(`Added ${dimensionList.length} missing attribute(s) from entities.json into dimensionList.`);
console.log(`Mapped ${variantMappedCount} distributionItems.referencedId -> variant group ids.`);
if (unresolved.size > 0) {
  console.log(`Warning: ${unresolved.size} selectedDimensions.referencedId values were not found in entities.json attributes (left as original).`);
  Array.from(unresolved).slice(0, 50).forEach(u => console.log('  -', u));
}
if (variantUnresolved.size > 0) {
  console.log(`Warning: ${variantUnresolved.size} distributionItems.referencedId values were not found in ${VARIANTS_FILE} (left as original). Examples:`);
  Array.from(variantUnresolved).slice(0, 30).forEach(u => console.log('  -', u));
}
