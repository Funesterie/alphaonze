# Publishing @funeste38/qflash

Checklist before publishing:

- Bump `version` in `package.json` if republishing.
- Ensure `dist/index.js` exists and starts with `#!/usr/bin/env node`.
- Run `npm run build` and verify `dist` contains compiled JS and `.d.ts` files.
- Run `node dist/index.js --help` to verify CLI runs.
- Run `npm pack` to inspect the tarball contents before publishing.
- Ensure `package.json` `bin` points to `dist/index.js`.
- If using `.npmignore`, ensure it does not exclude `dist`.
- Confirm `prepare` script in `package.json` is present to auto-build on publish.

Publish steps:

1. Login to npm: `npm login` (use account that owns `@funeste38` scope)
2. From project root `cd qflash`
3. Build: `npm run build`
4. Publish: `npm publish --access public`

Testing globally without publishing:

- Link locally: `cd qflash && npm link`
- Test: `qflash --help` or `qflash start`
- Remove link: `npm unlink -g @funeste38/qflash`

Notes on 2FA:
- If your npm account requires 2FA for publishing, you'll be prompted for the OTP.

Troubleshooting:
- If publish fails due to package name, ensure the scope `@funeste38` exists and you have permission.
- If `dist` missing on publish, `prepare` should build, but check logs for errors.
