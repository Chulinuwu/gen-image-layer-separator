# Superpowers Review - 2026-03-01

## 🚫 Blockers

- **RMBG-2.0 Runtime Error (ONNX Conflict)**: The method `_removeBgRMBG2` in `backend/src/services/vertex.service.ts` is failing with:
  `Error: Preferred output locations must have the same size as output names.`
  This is a critical failure in the ONNX Runtime backend. Although there is a partial fix attempting to set `preferredOutputLocation = null` at line 1868, it appears ineffective, possibly due to it being applied to `(env as any).onnx` instead of the correct `env.backends.onnx` path or being evaluated too late. This prevents the high-quality background removal hybrid strategy from functioning.
- **Environment Process Congestion**: Multiple orphan `npm run dev` processes (at least 5 observed) are active in the background. This has led to port shifting (Vite running on 5174 instead of 5173) and contributes to inconsistent behavior and resource exhaustion.

## ⚠️ Majors

- **Desynchronized Progress Documentation**: The `progress.md` file is severely outdated (last entry 2026-02-25), missing critical entries for the RMBG-2.0 implementation attempt and the current migration to Gemini 3.x models.
- **Sharp Dependency Conflict**: The backend logs continue to warn about multiple `sharp` versions being loaded. This risk, though noted in the journal, remains a major technical debt that can cause intermittent image processing crashes.

## ℹ️ Minors

- **ONNX Shape Mismatch**: Frequent warnings about `Error merging shape info for output` suggest that the image dimensions being fed into ONNX (1024x1024) might not align perfectly with the model's preferred internal shapes, forcing a "lenient merge" fallback.
- **Environment Configuration Typo**: `GOOGLE_SERVICE_ACCOUNT_CLIENT_X509_CERT_URL` in `.env` is prefixed with `ttps://` (missing 'h').

## ✨ Nits

- **Warmup Logic**: The RMBG-2.0 warmup logic logs a hard error to the console on every server start. This should be silenced or handled with a clearer diagnostic message while the model is being fixed.
- **Duplicate Comments**: Multiple redundant comments throughout `vertex.service.ts` (e.g., duplicate "RMBG-2.0 model singleton" lines).

---

## 📝 Summary & Next Actions

Current state: **Broken Core Functionality**. The system is failing its primary ML-based layer separation goal due to an ONNX backend mismatch.

### Immediate Next Actions:

1. **Process Cleanup**: Kill all active `node` and `npm` processes and restart fresh.
2. **Correct ONNX Fix**: Update the `env` configuration in `vertex.service.ts` to use `env.backends.onnx.preferredOutputLocation = null` (ensuring it's imported from `@huggingface/transformers` correctly).
3. **Update Progress Log**: Re-sync `progress.md` with the current blockers and the "Option 3" strategy implemented in `vertex.service.ts`.
4. **Credential Audit**: Fix the malformed URL in `.env`.
