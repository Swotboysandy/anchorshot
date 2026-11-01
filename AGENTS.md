# AnchorShot reference coding

Before writing or changing nontrivial code, search this project and the closest indexed upstream reference with XERJ.

1. Start if needed: `pwsh -File scripts/reference-coding.ps1 start`. Without PowerShell 7, use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`; add `-Endpoint http://127.0.0.1:9200` to use an already-running node.
2. Refresh current code: `pwsh -File scripts/reference-coding.ps1 index -Corpus anchorshot`.
3. Search local behavior: `pwsh -File scripts/reference-coding.ps1 search -Corpus anchorshot -Query "applyDreamSelections"`.
4. Search a relevant peer: `pwsh -File scripts/reference-coding.ps1 search -Corpus ref-prompt-kit -Query "PromptInputTextarea"`.
5. Read the returned source around its file/line location. Record the query, repo, pinned commit, file/lines and what is reused or deliberately rejected in the work note. Check the installed dependency version against the reference pin before copying; preserve licenses.
6. Implement and test the smallest fitting change. If retrieval misses, try actual symbols and narrower terms, then inspect source directly. Report unavailable indices honestly.

References: prompt-kit (prompt composition), shadcn-ui (UI controls), opencut (editor/timeline organization), motion (transitions/reduced motion), sam2 (mask correction/tracking). SAM 2 is an architectural reference, not proof of the hackathon gateway API.

Pins: docs/reference-repositories.json. Setup and evidence: docs/REFERENCE_CODING.md.

Keep original Fylmer/Nikku separate. No paid model calls for local work. Preserve existing masks and behavior unless the request replaces them. Do not index credentials, environment files, media, weights, dependencies or Git internals. Keep index storage outside source trees and loopback-only. Do not enable external reranking, proxy embeddings, feedback submissions or automatic public reports. Do not create codex-prefixed branches.


## UI reference coding
This workflow also applies to every UI change. Search `ref-prompt-kit`, `ref-shadcn-ui`, `ref-motion`, and `ref-beui` before building interface components. Prefer complete authored blocks over assembling a new look from unstyled primitives.

- Preserve the selected upstream block's markup, spacing, typography, radii, states, and motion. Do not draw an approximation or override its appearance with custom descendant CSS.
- Inspect the upstream preview and capture a reference screenshot before integration. Compare the local result at desktop and mobile sizes.
- Keep copied primitives unchanged where possible. Adapt only imports, content, accessible labels, and app callbacks; record necessary deviations explicitly.
- Connect every displayed action to real existing behavior. Omit unsupported actions or label them unavailable; never preserve demo timeouts or fake transcription as working product behavior.
- Retain the requested monochrome theme, offline operation, and protected cup/umbrella masks.
- Keep the source URL, pinned revision and license next to the implementation notes. A primitive copied from a library is not a copied complete layout: report the actual scope accurately.
