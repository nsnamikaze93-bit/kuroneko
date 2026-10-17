// Uso: node scripts/diagnose.js "Noragami"
const { diagnose } = require('../utils/diagnose');
diagnose(process.argv[2] || 'Noragami').then((r) => console.log(JSON.stringify(r, null, 2)));
