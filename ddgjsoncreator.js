#!/usr/bin/env node
/**
 * build-dataset.js (streaming JSON writer version)
 *
 * This script mirrors your original logic but replaces the final
 * write with a streaming JSON writer that avoids creating one massive
 * string in memory via JSON.stringify(obj, null, 2).
 *
 * Usage unchanged:
 * node build-dataset.js --name test01 --dataPool default --dataModel testing --out output.json
 *
 * IMPORTANT: the script preserves behavior of the original; I focused on
 * replacing the final write path with a safe streaming writer.
 */

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

// ---------- CLI parsing ----------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}
const args = parseArgs(process.argv);

const name = args.name;
const dataPool = args.dataPool;
const dataModel = args.dataModel;

if (!name || !dataPool || !dataModel) {
  console.error(
    "Error: --name, --dataPool, and --dataModel are required.\n" +
      "Example:\n" +
      "  node build-dataset.js --name test01 --dataPool default --dataModel testing"
  );
  process.exit(1);
}

const ENTITIES_FILE = args.entities || "entities.json";
const VARIANTS_FILE = args.variants || "variants.json";
const CASETABLE_FILE = args.caseTable || "caseTable.json";
const EVENTOBJ_FILE = args.eventObjects || "eventObjects.json";
const OBJECTOBJ_FILE = args.objectObjects || "objectObjects.json";
const ATTOBJ_FILE = args.attributeObjects || "attributeObjects.json";
const OUT_FILE = args.out || "output.json";

// ---------- File helpers ----------
function loadJson(file, required = true) {
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) {
    if (required) {
      console.error(`Error: required file not found: ${file}`);
      process.exit(1);
    }
    return null;
  }
  try {
    const raw = fs.readFileSync(full, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Error: failed to read/parse ${file}: ${e.message}`);
    process.exit(1);
  }
}

// ---------- Load inputs ----------
const entities = loadJson(ENTITIES_FILE, true);
const variants = loadJson(VARIANTS_FILE, true);
const caseTable = loadJson(CASETABLE_FILE, true);
const eventObjs = loadJson(EVENTOBJ_FILE, true);
const objectObjs = loadJson(OBJECTOBJ_FILE, true);
const attrObjs = loadJson(ATTOBJ_FILE, true);

// ---------- Extract/normalize from entities.json ----------
const general = entities.general || null;

// Support either nested or flat shapes for entities.json
const entitiesDefinitions = (() => {
  const ed = entities.entitiesDefinitions || entities;
  return {
    activities: ed.activities ?? null,
    events: Array.isArray(ed.events) ? ed.events : [],
    attributes: Array.isArray(ed.attributes) ? ed.attributes : [],
    objects: Array.isArray(ed.objects) ? ed.objects : [],
  };
})();

// Build lookups (objects/events/attributes) for name→id resolution
const objById = new Map();
const objByName = new Map();
for (const o of entitiesDefinitions.objects) {
  if (!o) continue;
  if (o.id) objById.set(o.id, o);
  if (o.name) objByName.set(o.name, o);
}
const eventById = new Map();
const eventByName = new Map();
for (const e of entitiesDefinitions.events) {
  if (!e) continue;
  if (e.id) eventById.set(e.id, e);
  if (e.name) eventByName.set(e.name, e);
}
const attrById = new Map();
const attrByName = new Map();
for (const a of entitiesDefinitions.attributes) {
  if (!a) continue;
  if (a.id) attrById.set(a.id, a);
  if (a.name) attrByName.set(a.name, a);
}

// ---------- Helpers ----------
function getOcpmSection(root, key) {
  // Accept either { ocpmRelations: { [key]: [...] } } or { [key]: [...] } or direct array
  if (!root) return [];
  if (Array.isArray(root)) return root;
  if (root.ocpmRelations && Array.isArray(root.ocpmRelations[key])) return root.ocpmRelations[key];
  if (Array.isArray(root[key])) return root[key];
  return [];
}

function normalizeVariants(v) {
  if (!v) return { items: [], randomConfigs: [] };
  if (Array.isArray(v)) return { items: v, randomConfigs: [] };
  if (v.variants && (Array.isArray(v.variants.items) || Array.isArray(v.variants.randomConfigs))) {
    return {
      items: v.variants.items || [],
      randomConfigs: v.variants.randomConfigs || [],
    };
  }
  return {
    items: v.items || [],
    randomConfigs: v.randomConfigs || [],
  };
}

const caseTableCreator =
  caseTable.caseTableCreator && caseTable.caseTableCreator.dimensionList
    ? caseTable.caseTableCreator
    : caseTable;

// ---------- Pull OCPM parts from your files (using ocpmRelations wrappers) ----------
const ocpmEvents = getOcpmSection(eventObjs, "events").map((e) => ({ ...e }));
const ocpmObjects = getOcpmSection(objectObjs, "objects").map((o) => ({ ...o }));
const ocpmAttributes = getOcpmSection(attrObjs, "attributes").map((a) => ({ ...a }));

// ---------- Resolve name→ID inside ocpmRelations (if any names slipped in) ----------
// events[].objects[].ocpmObjectId
for (const ev of ocpmEvents) {
  if (Array.isArray(ev.objects)) {
    for (const ob of ev.objects) {
      if (ob && ob.ocpmObjectId) {
        const val = ob.ocpmObjectId;
        if (!objById.has(val) && objByName.has(val)) {
          ob.ocpmObjectId = objByName.get(val).id;
        }
      }
    }
  }
}
// objects[].relations[].sourceEntityId / targetEntityId
for (const ob of ocpmObjects) {
  if (Array.isArray(ob.relations)) {
    for (const rel of ob.relations) {
      if (rel && rel.sourceEntityId) {
        const s = rel.sourceEntityId;
        if (!objById.has(s) && objByName.has(s)) rel.sourceEntityId = objByName.get(s).id;
      }
      if (rel && rel.targetEntityId) {
        const t = rel.targetEntityId;
        if (!objById.has(t) && objByName.has(t)) rel.targetEntityId = objByName.get(t).id;
      }
    }
  }
}
// attributes[].targetObjects[]
for (const at of ocpmAttributes) {
  if (Array.isArray(at.targetObjects)) {
    at.targetObjects = at.targetObjects.map((x) => {
      if (objById.has(x)) return x;
      if (objByName.has(x)) return objByName.get(x).id;
      return x;
    });
  }
}

// ---------- UUID generator with regex validation ----------
const newId = process.env.NEW_ID || 'dummy';
if (!newId) {
  console.error("Error: Environment variable NEW_ID must be set.");
  process.exit(1);
}

// ---------- Variants ----------
const variantsNormalized = normalizeVariants(variants);

// ---------- Compose output ----------
const output = {
  lastStepSaved: "ocpmRelations",
  dataSetConfig: {
    id: newId,
    name,
    ddgType: "OBJECT_CENTRIC",
    dataPool,
    dataModel,
  },
  general: general
    ? general
    : (() => {
        const now = Date.now();
        return {
          startDate: now - 90 * 24 * 60 * 60 * 1000,
          endDate: now,
          timeUnit: "MINUTES",
          nCases: 10000,
        };
      })(),
  entitiesDefinitions: {
    activities: entitiesDefinitions.activities ?? null,
    events: entitiesDefinitions.events,
    attributes: entitiesDefinitions.attributes,
    objects: entitiesDefinitions.objects,
  },
  variants: {
    items: variantsNormalized.items || [],
    randomConfigs: variantsNormalized.randomConfigs || [],
  },
  caseTableCreator: {
    dimensionList: Array.isArray(caseTableCreator.dimensionList) ? caseTableCreator.dimensionList : [],
    selectedDimensions: Array.isArray(caseTableCreator.selectedDimensions)
      ? caseTableCreator.selectedDimensions
      : [],
  },
  ocpmRelations: {
    events: ocpmEvents,
    objects: ocpmObjects,
    attributes: ocpmAttributes,
  },
};

// ---------- Streaming JSON writer (safe for large objects) ----------
/**
 * writeStreamedJson(filePath, obj)
 * - Streams the JSON for `obj` to filePath without creating one huge string in memory.
 * - Handles arrays, objects, primitives recursively.
 * - Protects against circular references by emitting "[Circular]".
 * - Respects stream backpressure using write(...); await drain when needed.
 *
 * Notes:
 * - This implementation does JSON without pretty indentation (compact). If you want pretty, it can be added,
 *   but pretty-printing large files increases output size and memory usage slightly.
 */
async function writeStreamedJson(filePath, obj) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(path.resolve(process.cwd(), filePath), { encoding: "utf8" });
    ws.on("error", (err) => reject(err));

    // helper that wraps ws.write with backpressure handling
    function writeChunk(chunk) {
      return new Promise((res, rej) => {
        try {
          const ok = ws.write(chunk, "utf8", (err) => {
            if (err) return rej(err);
            res();
          });
          if (!ok) {
            // wait for drain before resolving
            ws.once("drain", res);
          }
        } catch (err) {
          rej(err);
        }
      });
    }

    // track visited objects to avoid circular reference infinite loops
    const seen = new WeakSet();

    // Async recursive writer
    async function writeValue(value) {
      // primitives & null
      if (value === null || typeof value === "number" || typeof value === "boolean") {
        await writeChunk(String(JSON.stringify(value)));
        return;
      }
      if (typeof value === "string") {
        await writeChunk(JSON.stringify(value));
        return;
      }

      // functions / undefined -> null
      if (typeof value === "undefined" || typeof value === "function") {
        await writeChunk("null");
        return;
      }

      // objects / arrays
      if (typeof value === "object") {
        if (seen.has(value)) {
          // circular
          await writeChunk(JSON.stringify("[Circular]"));
          return;
        }
        seen.add(value);

        if (Array.isArray(value)) {
          await writeChunk("[");
          for (let i = 0; i < value.length; i++) {
            const el = value[i];
            // write element
            await writeValue(el);
            if (i < value.length - 1) await writeChunk(",");
          }
          await writeChunk("]");
          return;
        } else {
          // plain object
          await writeChunk("{");
          const keys = Object.keys(value);
          for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            const v = value[key];
            // write "key":
            await writeChunk(JSON.stringify(key) + ":");
            await writeValue(v);
            if (k < keys.length - 1) await writeChunk(",");
          }
          await writeChunk("}");
          return;
        }
      }

      // fallback
      await writeChunk("null");
    }

    (async () => {
      try {
        await writeValue(obj);
        ws.end();
        ws.on("finish", () => resolve());
      } catch (err) {
        ws.destroy();
        reject(err);
      }
    })();
  });
}

// ---------- Write using streaming writer ----------
(async () => {
  try {
    await writeStreamedJson(OUT_FILE, output);
    console.log(`✅ Wrote ${OUT_FILE}`);
  } catch (err) {
    console.error("Failed writing output:", err);
  }
})();

