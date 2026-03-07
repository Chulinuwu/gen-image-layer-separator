# Plan: Fix Corrupted `gemini` CLI

## Background

The `package.json` for `chalk` (a dependency of `ink`, which is a dependency of `@google/gemini-cli`) is empty (0 bytes), causing `ERR_INVALID_PACKAGE_CONFIG`.

## Steps

1. **Uninstall current package**: Remove the potentially corrupted global installation.
   - `npm uninstall -g @google/gemini-cli`
2. **Clear npm cache**: Ensure no corrupted files are cached.
   - `npm cache clean --force`
3. **Reinstall package**: Perform a fresh global installation.
   - `npm install -g @google/gemini-cli`
4. **Verification**: Run the command to ensure it works.
   - `gemini --version` (or just `gemini`)

## Verification Steps

- Run `gemini` in the terminal and confirm the error no longer appears.
