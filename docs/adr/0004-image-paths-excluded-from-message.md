# Image paths are excluded from message text

For image-channel attachments, the base64 payload is sent via the prompt's dedicated images field, and no `@path` reference is added to the message text. Only path-channel attachments get a `@.pi-uploads/...` reference inline.

This avoids the model seeing both a rendered image and a path to the same file, which invites confused double-processing ("should I look at the image or read the path?"). The image is still written to disk under the upload directory (ADR-0001) so cleanup and history remain consistent; the agent can still be pointed at the file if it ever needs the bytes.

Consequences: image attachments are invisible in the raw message text — they exist only in the images field and in history via the attachment rendering layer. Parsing message text alone cannot reconstruct image chips; history must also consult the message's images payload.
