const fs = require('fs');
const path = require('path');

const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
const buf = fs.readFileSync(iconPath);
console.log('File size:', buf.length);
console.log('Header:', buf.subarray(0, 8).toString('hex'));
