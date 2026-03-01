# Plan: Fix RMBG-2.0 Runtime "Unsupported input type: object"

## Strategy

Instead of passing a PNG `Buffer` to `RawImage.read()`, we will use `sharp` to provide raw pixels as a `Uint8Array` directly to the `RawImage` constructor. This avoids internal decoding and format checks within Transformers.js that are currently failing.

## Steps

### 1. Modify `_removeBgRMBG2` in `vertex.service.ts`

- **What**: Change image loading from `RawImage.read(resizedBuffer)` to `new RawImage(data, info.width, info.height, info.channels)`.
- **Why**: Bypasses the failing input-type check and ensures `transformers.js` receives raw, consistent dimensions.
- **Verification**: Run `npm run dev` and check for `[RMBG-2.0] ✅ Done` or errors.

### 2. Verify with Warmup

- **What**: Ensure the `warmupRMBG2` call (which uses `_removeBgRMBG2`) no longer logs `Failed: Error: Unsupported input type`.
- **Why**: Confirms the fix at start-up.
- **Verification**: Check terminal output of `npm run dev`.
