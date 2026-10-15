const fs = require('fs');
const path = require('path');

const chartSource = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
const chartDestination = path.join(__dirname, '..', 'public', 'vendor', 'chart.js', 'chart.umd.js');

if (!fs.existsSync(chartSource)) {
  throw new Error('Chart.js browser bundle is missing. Run npm install before building.');
}

fs.mkdirSync(path.dirname(chartDestination), { recursive: true });
fs.copyFileSync(chartSource, chartDestination);
console.log('Prepared Chart.js browser bundle for deployment.');
