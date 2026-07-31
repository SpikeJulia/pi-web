# Just-in-time upload: the client holds File objects until send

Attachments are held in the browser as `File` objects until the user sends the message; only then are they uploaded (multipart POST) and the returned paths composed into the prompt. Selecting or dragging a file performs zero network I/O.

This reverses an earlier design (Q6) that called `ensureNewSession()` the moment the user clicked the paperclip so paths could be finalized up-front. It was changed after studying hermes-studio, which keeps `File` objects client-side and uploads at send. Benefits: no phantom sessions are created by merely opening the file picker; files the user discards never touch disk; and upload failures are surfaced at exactly the moment they matter (send), matching the existing prompt-error flow. The stored path does not need to be finalized until the message is actually going out.

Consequences: send latency includes upload time for large files. Upload failure aborts the whole send (no partial sends). The client must hold `File` objects in memory while composing, which is bounded by the per-message attachment limits.
