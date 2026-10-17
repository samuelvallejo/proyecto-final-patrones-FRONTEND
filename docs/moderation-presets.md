# Moderation presets and design-pattern integration

The frontend is TypeScript built with Vite. Visible copy remains in the Spanish locale
file. The backend adds Singleton, Prototype, Decorator and Facade to the five existing
patterns; these changes require no database migration or new paid service.

## Creator workflow

1. Open **Configuracion** as the channel owner.
2. Select a moderation level. The form obtains its thresholds from backend templates,
   rather than duplicating threshold constants in TypeScript.
3. Choose **Aplicar plantilla del nivel seleccionado** to preview that level's automatic
   hiding, automatic muting and mute duration.
4. Review the existing blocked words, blocked topics, link permission, slow mode and
   automatic clips. Applying a template keeps these form values, including unsaved edits.
5. Choose the existing save button to persist the complete policy. Applying a template
   alone never saves anything.

The existing activity indicator and async-button spinner cover preview requests. Related
controls and saving remain disabled until the request finishes. A response received after
navigation cannot modify the new screen or another channel's form. Errors use Spanish
messages and do not display raw API responses or internal exception details.

## Policy data boundary

`frontend/src/moderation-policy.ts` defines `ModerationPolicyDraft`. It accepts untrusted
JSON only after checking the level, boolean flags, finite ordered thresholds, whole-number
mute duration, restriction counts and individual restriction lengths. Only approved fields
enter its snapshot; unknown metadata is discarded. Both `copy()` and `snapshot()` isolate
their arrays from the source and from each other.

The dashboard facade adds `moderationPresets` to the existing dashboard response. An
explicit preview calls `GET /api/channels/{channel}/policy-presets/{level}`. The existing
`PUT /api/channels/{channel}/policy` remains the only save operation used by this workflow.
The backend rechecks ownership and validates every saved policy.

## Pattern responsibilities

| Pattern | Observable effect |
| --- | --- |
| Singleton | Ollama and Gemini share a reusable backend HTTP pool without sharing credentials. |
| Prototype | Each level produces an independent policy draft before customization. |
| Decorator | Local restrictions run before the provider; unavailable models fall back to local rules. |
| Facade | One authorized studio entry point assembles dashboard data, templates and AI capability information. |

The original Builder, Factory Method, Abstract Factory, Adapter and Bridge remain active
in the backend. A configured provider is distinct from a provider currently being reachable.

## Tests

Run `npm run build` for localization checks, strict TypeScript checking and production
bundling. Run `npm run test:patterns` for the 140 shared policy contracts plus malformed
response, metadata exclusion and independent-copy checks. The test runner compiles the
actual TypeScript module with the project's compiler; it does not duplicate its logic.
The GitHub workflow runs both commands for pushes and pull requests.

The 96 valid fixtures cover all three levels, eight combinations of the three boolean
flags, four durations and empty, custom, maximum-length and maximum-count restriction
lists. The 44 invalid fixtures cover unsupported levels, duration bounds, unordered or
out-of-range thresholds, blank/null restrictions and count/length overflow. Each fixture
is an independently reviewable coverage change in version control, not a separate feature.
