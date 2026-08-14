# UI reference bundle

Screenshots are numbered so matching files pair up across the two folders.

| # | `zoom/` (target) | `ours/` (current) | State |
|---|---|---|---|
| 01 | dashboard | dashboard-**BROKEN** | Completely unstyled — main gap |
| 02 | dashboard-profile-menu | — | Not built |
| 03 | signin | signin | Close; needs polish |
| 04 | signup-code | signup-code | Close; needs polish |
| 05 | signup-create-account | signup-create-account | Close; needs polish |
| 06 | signup-password-rules | — | Tooltip not built |
| 07 | signup-password-validation | — | Live validation not built |
| 08 | meeting-with-screenshare | meeting-room | Already good — leave alone |

## Important

`ours/01-dashboard-BROKEN.png` shows the dashboard rendering with no styling at
all. This is almost certainly not a design problem — a stylesheet, CSS module, or
class-name set went missing during an earlier revert. **Diagnose before
redesigning.** Do not rebuild the dashboard from scratch if the styling still
exists somewhere in git history.

`ours/08-meeting-room.png` is already close to Zoom. Do not touch it.
