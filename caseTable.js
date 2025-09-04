const fs = require('fs');
const { v4: uuidv4 } = require('uuid'); // npm install uuid

// Load entities.json
const entities = JSON.parse(fs.readFileSync('entities.json', 'utf-8'));

// Make sure attributes exist
const attributes = entities.entitiesDefinitions?.attributes || [];

// Transform attributes into dimensionList
const dimensionList = attributes.map(attr => ({
  id: uuidv4(), // generate new unique id
  name: attr.name,
  defaultItem: attr.defaultItem || false,
  items: attr.items || [],
  distributionItems: attr.distributionItems || [],
  attributeMetadataItems: attr.attributeMetadataItems || [],
  referencedId: attr.id // keep original id as referencedId
}));

// Final JSON structure
const output = {
  caseTableCreator: {
    dimensionList,
    selectedDimensions: []
  }
};

// Write to caseTable.json
fs.writeFileSync('caseTable.json', JSON.stringify(output, null, 2), 'utf-8');

console.log('✅ caseTable.json generated successfully!');
