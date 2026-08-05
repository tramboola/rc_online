# RC Bench Throttle Limit Slider Design

## Purpose

Add a mouse-adjustable throttle limit to the existing Level 2 browser bench.
The limit reduces both forward and reverse output while preserving the
server-side PWM safety boundary. It does not expand the verified throttle
range or make the stand suitable for driving on the ground.

## User flow

1. Open the tokenized Level 2 browser page as usual.
2. Set **Throttle limit** anywhere from 10% to 100% with the slider. The
   default is 100% and the displayed value updates while dragging.
3. Arm the keyboard and use the existing controls.
4. Moving the slider while throttle is active applies the new limit on the
   next control request, without requiring disarm or key release.
5. The selected limit applies equally to forward and reverse.

The value is session-local and returns to 100% when the page is reloaded.

## Safety and pulse mapping

The percentage scales the existing verified deviation from the 1500
microsecond neutral pulse. It is not a percentage of the full 1000-2000
microsecond ESC range.

- 100% maps to the existing 1750 microsecond forward and 1250 microsecond
  reverse limits.
- 10% maps to 1525 microseconds forward and 1475 microseconds reverse.
- Intermediate integer percentages use nearest-integer microsecond rounding,
  with exact half-microsecond results rounded away from neutral so forward and
  reverse remain symmetric.
- Neutral remains exactly 1500 microseconds at every limit.
- The reverse brake and reverse drive phases use the same scaled reverse
  pulse; the intermediate neutral phase remains 1500 microseconds.
- Steering, watchdog timing, arming, client ownership, and emergency-stop
  behaviour do not change.

## Architecture and API

The browser includes `throttle_limit_percent` in every `/api/control` JSON
request. The field is an integer from 10 through 100. The existing request
coalescing prevents slider input from creating concurrent control requests.
Changing the slider while armed triggers an immediate control request;
otherwise the selected value is sent when the browser is next armed.

The HTTP server validates the field before publishing the frame. A missing
field defaults to 100% for compatibility with an older cached page or client.
Boolean, non-integer, and out-of-range values receive the existing
`invalid_request` response and never replace the last valid mailbox frame.

`InputFrame` carries the validated percentage to `LiveControl`. The control
layer performs the pulse calculation, keeping literal PWM limits out of the
browser and ensuring the Raspberry Pi remains the authority for output
safety. The returned state continues to expose the actual throttle pulse, so
the existing telemetry confirms the applied result.

## UI

Place the slider in the keyboard control panel above the arm and stop
buttons. It contains a visible label, a numeric percentage readout, and a
native range input with `min=10`, `max=100`, `step=1`, and `value=100`.

The slider stays available while armed. Its value and fill update immediately
on mouse or keyboard input, with a short colour transition that respects
`prefers-reduced-motion`. The label explicitly communicates that 100% means
the stand's current safe cap, not the ESC's full electrical output.

## Documentation and verification

- Unit tests verify 10%, an intermediate percentage, 100%, symmetric forward
  and reverse scaling, the reverse sequence, and unchanged neutral output.
- Mailbox and HTTP tests verify propagation, the 100% compatibility default,
  rejection of invalid values, and preservation of the last valid frame.
- The browser document test verifies the slider bounds, default, request
  field, and immediate-send wiring without adding JavaScript dependencies.
- The README documents the runtime control and the exact meaning of 100%.
- The complete local test suite must pass. Browser behaviour is then checked
  in `--dry-run`; no real GPIO output is required for this feature check.
