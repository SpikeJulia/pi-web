# No server-side text extraction: image inline, everything else path-referenced

Uploaded files are split into two attachment channels: images are sent inline to the model (base64 in the prompt's images field), and every other file is path-referenced — the composed message text contains `@.pi-uploads/<sessionId>/<storedName>` and the agent reads it with its own tools.

We deliberately do not extract text from PDFs, DOCX, or other documents on the server. This is a reversal of an earlier design (Q2) that routed text/PDF/DOCX through an `extracted` channel using `pdf-parse` and `mammoth`. It was dropped after studying hermes-studio, which does no server-side extraction at all. Reasons: no new npm dependencies, no extraction failure surface, no size inflation in the prompt, and the agent already has read/bash tools capable of handling documents (the CLI treats `@report.pdf` the same way). The cost — the model cannot "instantly see" a PDF without a tool round-trip — is acceptable for a coding agent whose core workflow is tool use anyway.

Consequences: prompt size for attachments is tiny (just path text). The `extracted` channel, its size limits, and its dependencies are gone. Agent behavior when handed an unknown binary is the agent's responsibility (it may error, and that is fine).
