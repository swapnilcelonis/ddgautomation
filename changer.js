// replace-and-clear.js
import fs from "fs";

// ---------- Step 1: Load input ----------
let text = fs.readFileSync("output.json", "utf8");

// ---------- Step 2: Replace exact words with word+1 ----------
// const words = ["Customer", "Material", "Organization", "NetValue", "SignalLink", "Region"];

// for (const word of words) {
//   const regex = new RegExp(`\\b${word}\\b`, "gi"); // exact word, ignore case
//   text = text.replace(regex, (match) => match + "1");
// }

// ---------- Step 3: Parse JSON and clear targetObjects ----------
let data;
try {
  data = JSON.parse(text);
} catch (e) {
  console.error("❌ Error parsing JSON. Make sure input.json is valid JSON.");
  process.exit(1);
}

// Recursive function to walk through all objects/arrays
// function clearTargetObjects(obj) {
//   if (Array.isArray(obj)) {
//     obj.forEach(clearTargetObjects);
//   } else if (obj && typeof obj === "object") {
//     for (const key of Object.keys(obj)) {
//       if (key === "targetObjects" && Array.isArray(obj[key])) {
//         obj[key] = []; // <-- clear the array
//       } else {
//         clearTargetObjects(obj[key]);
//       }
//     }
//   }
// }

// clearTargetObjects(data);

// ---------- Step 4: Save to output ----------
fs.writeFileSync("final.json", JSON.stringify(data, null, 2), "utf8");

console.log("✅ Replacement done and targetObjects cleared. Output written to output.json");
