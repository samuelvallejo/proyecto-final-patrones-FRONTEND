# Live viewer counter

The studio, watch page and floating publisher preview show an eye icon with the current
audience. `presence` WebSocket messages refresh every visible counter immediately when
connections join or leave. Dashboard snapshots seed and refresh the studio count, including
when the stream is being published by another device. Ended streams show zero.

This is the number of active viewer connections to the current stream, not total visits,
followers or unique accounts. The publishing connection is excluded by the existing live hub;
two viewing tabs can count as two connections. No viewer identity is exposed in this badge.
Singular/plural text and accessible live status use the same sanitized integer.

Run `npm run build`, start a local frontend, then `npm run test:viewers` to verify studio,
watch and floating updates with synthetic API responses, WebSockets and camera tracks.
The browser test never uses a real camera or creates production data.
