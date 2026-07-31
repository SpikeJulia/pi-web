# Upload storage layout: per-session `.pi-uploads` with random stored names and sidecar metadata

Every uploaded attachment lands at `<cwd>/.pi-uploads/<sessionId>/<storedName>`, where the stored name is 8 random bytes hex plus the original extension (e.g. `a1b2c3d4e5f6g7h8.pdf`), and a `.meta.json` sidecar records the original name, MIME type, size, and upload time.

We chose per-session directories because pi is session-oriented: the same cwd hosts many sessions, and scoping files to the session makes "clear this session's attachments" a directory delete and keeps fork/cleanup semantics obvious. We chose random stored names (over original names or `-1`/`-2` suffixes) so the disk never leaks the user's real filenames, collisions are effectively impossible, and a single flat directory can never explode. The sidecar exists because the random stored name is meaningless to a human: history rendering needs the original name back, and the server is the only place that record can survive page reloads.

Consequences: every upload writes two files (content + meta). Cleanup must delete both. History rendering depends on the sidecar being present — if it is missing, chips degrade to showing the stored name.
