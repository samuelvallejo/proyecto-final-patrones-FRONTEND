# Gemini chat interface

The authenticated sidebar includes **Chat con Gemini**, separate from the channel editorial
assistant. It works without a channel. Provider banners identify the selected moderation
provider and its model, so configured Gemini no longer has an anonymous service label.

`GeminiChatView` owns an in-memory conversation. Navigation preserves it; reload, sign-out
or session expiry clears it. **Nueva conversacion** starts over. Only the last ten turns,
trimmed to a bounded context, accompany a question. Browser storage and application logs
never receive chat contents or API keys.

Questions stop at 2000 characters. During a response, input and duplicate sends are disabled,
a loading indicator appears, and navigation remains usable. A failed request restores the
question for retry. Plain-text rendering prevents generated HTML from running. Empty or
invalid provider responses become a safe translated error, not internal metadata.

The interface describes Google data handling, temporary history and model fallibility.
Availability means configuration exists; only a successful reply verifies the connection.
The UI never claims that local rules or Ollama produced a Gemini answer.

Run `npm run build`, start the local frontend, then run `npm run test:gemini-chat` for
deterministic browser coverage with synthetic responses. The test does not consume quota
or create production users/channels.
