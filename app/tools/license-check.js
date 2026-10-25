'use strict';
// Automated license compliance checker. Run: node tools/license-check.js
// Scans package.json dependencies, checks THIRD_PARTY_NOTICES.md coverage, and
// verifies that required license files exist. Exit code 1 on failure.
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..');
const ROOT = path.join(APP, '..');
const issues = [];
const warnings = [];

// 1. Required license files
const requiredFiles = [
  ['LICENSE', ROOT],
  ['NOTICE', ROOT],
  ['THIRD_PARTY_NOTICES.md', ROOT],
  ['docs/LICENSE_COMPLIANCE.md', ROOT],
  ['docs/SOURCE_ORIGINS.md', ROOT],
  ['docs/RELEASE_CHECKLIST.md', ROOT],
  ['app/src/renderer/globe/NOTICE.txt', ROOT],
];
for (const [file, dir] of requiredFiles) {
  if (!fs.existsSync(path.join(dir, file))) issues.push(`Missing required file: ${file}`);
}

// 2. Scan npm dependencies
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const deps = Object.entries(pkg.dependencies || {});
const notices = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8').toLowerCase();
for (const [name] of deps) {
  const pkgPath = path.join(APP, 'node_modules', name, 'package.json');
  if (!fs.existsSync(pkgPath)) { warnings.push(`Dependency ${name} not installed`); continue; }
  const depPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const license = depPkg.license || 'UNKNOWN';
  if (license === 'UNKNOWN') warnings.push(`Dependency ${name} has no license field`);
  if (!notices.includes(name.toLowerCase())) issues.push(`Dependency ${name} (${license}) not mentioned in THIRD_PARTY_NOTICES.md`);
}

// 3. Check the kernel binary exists
if (!fs.existsSync(path.join(APP, 'core', 'sing-box-windows-amd64.exe'))) {
  warnings.push('Kernel binary (core/sing-box-windows-amd64.exe) not found');
}

// 4. Check globe NOTICE
if (!fs.existsSync(path.join(APP, 'src', 'renderer', 'globe', 'NOTICE.txt'))) {
  issues.push('Globe NOTICE.txt is missing (required for MIT attribution)');
}

// 5. Check Electron licensing (LICENSES.chromium.html should be in the packaged app)
// This is handled by electron-packager automatically; we just note it.

// Output
console.log('=== License compliance check ===');
console.log(`Dependencies scanned: ${deps.length}`);
if (issues.length) { console.log('\nISSUES (must fix):'); issues.forEach(i => console.log(`  ❌ ${i}`)); }
if (warnings.length) { console.log('\nWARNINGS (review):'); warnings.forEach(w => console.log(`  ⚠️ ${w}`)); }
if (!issues.length && !warnings.length) console.log('\n✅ All checks passed.');
console.log(`\nResult: ${issues.length ? 'FAIL' : 'PASS'} (${issues.length} issues, ${warnings.length} warnings)`);
process.exit(issues.length ? 1 : 0);
