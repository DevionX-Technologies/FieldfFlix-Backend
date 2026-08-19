const fs = require('fs');

const recoveryList = [
  'e40a2197-ff16-48cb-9837-e3204ca11d50',
  'b0077deb-267a-450a-93e1-65c83ab85301',
  'db9ac273-be1f-401a-803a-ce46021b1a88',
  'f94b609b-f468-4ca7-9f99-d793e558f892',
  'e3615784-f5db-46ce-9173-05e295c03dde',
  '68dc631a-b216-4769-a884-7153c73d79f9',
  '7742faee-b1f9-4ea8-806b-0aaa4e9788f0',
  '11218f05-c64e-4b9b-9dcd-9a8bf787d7f4',
  '8360ef6e-39a3-4cc5-b8ce-2481ec81a37f',
  '1e07deda-ce41-4cd5-8232-6a73d352b5ff',
  '12c01325-0984-46c7-ba86-f73bfebb71f9',
  '29f4422d-9b99-4893-9ef8-c0bd452e53b7',
  '161983c6-871d-4e9c-923c-54cca7c64532',
];

async function main() {
  const filePath = 'santacruz-audit.json';
  if (!fs.existsSync(filePath)) {
    console.log('santacruz-audit.json does not exist');
    return;
  }

  const content = fs.readFileSync(filePath, 'utf16le');
  console.log('File size:', content.length, 'characters');

  try {
    const data = JSON.parse(content);
    console.log('Loaded JSON successfully. Is array:', Array.isArray(data));

    // Search for matches
    const matches = data.filter((item) => {
      const itemStr = JSON.stringify(item);
      return recoveryList.some((id) => itemStr.includes(id));
    });

    console.log(`Found ${matches.length} matching rows in audit JSON`);
    if (matches.length > 0) {
      console.log(JSON.stringify(matches.slice(0, 5), null, 2));
    }
  } catch (err) {
    console.error('Failed to parse as JSON:', err.message);

    // Fallback: simple text search
    console.log('Running substring searches:');
    for (const id of recoveryList) {
      const idx = content.indexOf(id);
      if (idx !== -1) {
        console.log(`Found ${id} in audit text at character index ${idx}`);
        // print snippet
        console.log(content.substring(idx - 100, idx + 200));
        console.log('-----------------------------');
      }
    }
  }
}

main();
