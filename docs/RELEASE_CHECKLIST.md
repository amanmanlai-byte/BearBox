# Release Checklist

Run through this checklist before every public release of Bear Box.

## License and copyright

- [ ] `LICENSE` file exists at the project root and contains the MIT license text
- [ ] `NOTICE` file exists and mentions JiajiaBox, sing-box, Solar System Scope, and Electron
- [ ] `THIRD_PARTY_NOTICES.md` is up to date (run `node tools/license-check.js`)
- [ ] Globe renderer NOTICE (`app/src/renderer/globe/NOTICE.txt`) is present
- [ ] `app/package.json` has correct `"license": "MIT"` and `"version"` fields
- [ ] `dist/BearBox-win32-x64/resources/app/` contains LICENSE and NOTICE files
- [ ] Kernel source is publicly available (https://github.com/weilai090624-code/JiajiaBox → native-src/sing-box/)

## Code quality

- [ ] `npm test` passes (all tests green)
- [ ] `node --check` passes for all .js files in src/
- [ ] `npm run pack:win` completes without errors
- [ ] Packaged exe launches and renders all pages without JS errors

## Documentation

- [ ] `使用说明.txt` is updated with the current version number and changes
- [ ] `CHANGELOG.md` is updated
- [ ] Version number in `app/package.json` matches `app/src/renderer/index.html`

## About page

- [ ] About page loads without JS errors
- [ ] All external links point to the correct URLs
- [ ] Author information is filled in (no "待填写" placeholders)
- [ ] Version number matches package.json

## Distribution

- [ ] Release zip is named `BearBox-win32-x64.zip`
- [ ] Zip contains: `BearBox.exe`, `resources/app/core/` (kernel + wintun), `resources/app/geo/`, `resources/app/assets/`, `使用说明.txt`
- [ ] Zip size is reasonable (~132 MB)
- [ ] No test files, tools, or development files in the zip
- [ ] Kernel binary is included (users need it to run the proxy)
- [ ] If kernel source was modified: modified source is published under GPL-3.0
