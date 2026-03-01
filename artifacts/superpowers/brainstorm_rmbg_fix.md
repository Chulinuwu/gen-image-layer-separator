# Brainstorm: Fixing RMBG-2.0 "Unsupported input type: object"

## Goal

Fix the runtime error `Unsupported input type: object` when calling `RawImage.read(resizedBuffer)` in `AIService._removeBgRMBG2`.

## Constraints

- Must stay within the Node.js environment.
- Must avoid temporary files (per previous requirement for stability).
- Must work with `@huggingface/transformers`.

## Risks

- Converting to `Uint8Array` might still fail if the library expects a different format (e.g. standard Web Blob).
- `RawImage.read` might not support `Buffer` directly in the specific version installed.

## Options

### Option 1: Convert Buffer to Uint8Array

`RawImage.read` usually prefers standard `Uint8Array`. Node `Buffer` is a subclass of `Uint8Array`, but checking `instanceof` can sometimes fail across different contexts or if the library is strict.

```typescript
const image = await RawImage.read(new Uint8Array(resizedBuffer));
```

### Option 2: Use `RawImage.fromBlob` (if environment supports it)

Transformers.js v3 introduced better blob support.

```typescript
const blob = new Blob([resizedBuffer], { type: "image/png" });
const image = await RawImage.fromBlob(blob);
```

_(Note: requires Node 18+ for global Blob or an import)_

### Option 3: Use sharp to provide raw pixels directly

Instead of letting `RawImage` decode the PNG, we can use `sharp` to get raw RGBA pixels and then create a `RawImage` manually.
This is the most "low-level" and stable way as it bypasses PNG decoding inside transformers.js.

```typescript
const { data, info } = await sharp(imageBuffer)
  .resize(1024, 1024, { fit: "inside" })
  .raw()
  .toBuffer({ resolveWithObject: true });
const image = new RawImage(data, info.width, info.height, info.channels);
```

## Recommendation

**Option 3** is the most robust. It bypasses the need for the library to "sniff" the input type or decode the image format, which is exactly where it's failing. We already use `sharp`, so it adds no new dependencies.

## Acceptance Criteria

- `npm run dev` starts without immediately failing on warmup.
- `RMBG-2.0` successfully processes an image and returns a masked buffer.
- No `404` or `Unsupported input type` errors.
