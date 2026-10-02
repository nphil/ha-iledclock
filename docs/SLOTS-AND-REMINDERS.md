# Screens A/B, named alarms & reminders, text as frames

Status: built 2026-10-02, **not yet verified on the real clock**. Everything the clock has not been seen doing is behind a
named capability flag with the conservative default (section 5). The live test plan is section 6, the boundaries (what this does
not do) section 7.

Evidence tags: [VENDOR file:line] decompiled CoolLED1248 2.7.7 under `/data/home/tmp/led1248/src/sources/com/jtkj/led1248/`;
[VECTOR] `tests/fixtures/golden/vectors.json` (vendor bytecode run on a JVM); [DEVICE] observed on the real clock;
[INFERENCE] reasoning, not observed.

## 1. The clock in one picture

The clock has **two screens behind its power button**. A short press on the clock toggles between them. Bluetooth has no
"show screen N" command and nothing can be read back, so Home Assistant changes a screen only by **uploading into it**; which
screen an upload lands in is decided by the kind byte of its start frame [VENDOR ILedClockUtils.java:4527-4640].

| | Screen A | Screen B |
|---|---|---|
| Store | program list (up to 9 programs) | clock-page store (clock / date / temperature pages) |
| Start-frame kind byte | `00` | `04` |
| Written by | every Home Assistant show by default, `set_playlist` | any show with `slot: "b"`, and every `date` show |
| Proven [DEVICE] | yes | a kind-04 date program replaced B and left A untouched (2026-10-01) |

Reminders are a third store (program type 14, trailer `05 <id>`), read and deleted with opcode `1a`. Timers and scoreboards use their
own special-page kinds (`01`/`02`/`03`); Home Assistant files them under screen A and screen B refuses them.

The clock cannot report what it holds, so Home Assistant keeps a **record per screen** (`slot_store.py`): what was sent, its
title, how many programs, the CRC and length of the first program as sent, and when. Pixel Studio shows it in the "Screen A /
Screen B" tiles. Pressing the clock's power button is invisible to Home Assistant, so the tiles say "Sent last", never
"Showing now". The record is written only after the clock accepted the upload.

## 2. Screens A and B

- `slot: "a" | "b"` (default `a`) on `iledclock.show_text`, `show_design`, `show_image`, `show_generative`, `clock_face` and on the
  websocket `iledclock/show`. `set_playlist` is always screen A.
- **A date page always goes to screen B**, whichever screen was asked for: the vendor start frame for program type 6 carries the
  kind-04 trailer, so the clock files it in the clock-page store [DEVICE: a date item in `set_playlist` replaced B]. Home Assistant
  records and answers it as a screen B write (`now_showing.slot == "b"`); in a playlist the date item goes to B's record and A's record
  counts only the list programs.
- Screen B builds the show as a standalone clock-page program (`is_clock_in_list=False`, kind `04`): clock = background + clock
  (type 7, `04 01 <10>`), date = background + date (type 6, `04 01 <5>`), temperature/humidity = one type-19 page
  (`04 01 <5>`), "Icon with clock" design = art + clock (type 7). Plain art is allowed only while
  `hardware.SLOT_B_ACCEPTS_ART` is True (then forced to type 7, standalone). Timers and scoreboards are refused on B, as is a timed
  message (`duration_s`): it needs screen A's program list to come back to.
- Pixel Studio remembers the last choice per clock; the **A | B** control sits on every "Show on clock" action. B is disabled with a
  one-line reason when the content is not allowed, and a date shows B selected with A disabled. Nothing is ever sent to a screen the
  user did not see selected.
- Undo (`{restore:"previous"}`) goes back to the previous item **on the same screen**.
- `sensor.<name>_program_count` is the number of programs in screen A's last upload (unknown before Home Assistant has sent one),
  with per-screen attributes.
- Fixed: a timed `show_text` (`duration_s`) started while no playlist existed never restored anything (`[]` is falsy). It now
  re-shows what screen A held before.
- Storage: the playlist file now carries `format: 2`; a file without it has its text items upgraded once on load (the old 0-255 text
  `speed` is dropped, `color_mode` becomes `effect`). A timed message's restore re-sends the whole stored playlist (so a date item in it
  rewrites screen B then, as `set_playlist` itself does); the reminder re-send after a restart sends screen A's list programs only.

### Switching screens from Home Assistant (optional, one-way)

Stock payload `20 01` is the clock's own power-key event. Sent once through `send_raw` on 2026-10-02 it switched the clock from
screen A (an animation) to screen B (a clock) [DEVICE, one observation]. The clock never replies, so `send_raw` times out; the
dedicated command `iledclock.switch_screen` (ws `switch_screen`) writes it once without waiting for an answer and never retries (a
toggle is not safe to repeat). Boundaries: it is a **toggle** (there is no "go to B"); Home Assistant **cannot know which screen is
showing** and does not guess; what it does with the display off or in night mode is unknown (Pixel Studio disables the button while
the display is off). It is not part of the screen-selection design (upload by kind stays the primary mechanism) and it does not
touch the firmware pomodoro.

## 3. Alarms & reminders

One list for both; `kind` (alarm | reminder) is presentation only. On the clock both are the same thing: a **reminder slot**
(program type 14) that rings and shows art on its own, **without Home Assistant** (the clock keeps time itself; Home Assistant syncs
its clock daily at 03:30). Home Assistant keeps the definition (name, schedule, art choice, on/off) in `reminder_store.py` because the
clock cannot return the attached art.

### What the clock stores [VENDOR ILedClockUtils.java:4344-4375, VECTOR]
Header (tag `0x13`): sound (always 1), year-2000, month, day, hour, minute, repeat type, week mask, duration (u16, seconds), title
(UTF-8, length byte). Repeat type: 0 once, 1 every day (mask 0x7F), 2 every week (mask = weekday of the date), 3 every month,
4 every year. There is no enabled flag, so **disabled = deleted on the clock** (definition kept in Home Assistant); **edit =
upload again with the same id**. Times have minute resolution.

### Write sequence (`reminder_manager.py`)
1. Validate; **persist the definition first** (what the user typed is never lost).
2. Fresh `1a 01` read, allocate lowest-free ids in `REMINDER_ID_MIN..MAX` (preferring the item's own, or its previous ones on
   re-enable), never an id another enabled item holds.
3. One ordinary program upload per clock reminder: start frame (index 0, count 1, trailer `05 <id>`), LZSS data chunks (program data
   = header + the attachment: a Library design of at most 40 frames, or the name drawn as scrolling text).
4. Wait `REMINDER_SAVE_SETTLE_S`, read the list and every reminder back and compare hour, minute, title, repeat type, duration
   (and date). Only then delete surplus ids of a plan that shrank (each delete acknowledgement is checked, then re-listed).
5. Store `device_ids`; unless `REMINDER_UPLOAD_PRESERVES_SLOTS`, re-send screen A's last program list.
All of it runs under the same lock as shows and playlists. A failure after step 1 keeps the definition, records `last_error` in plain
words, publishes the list and raises; the row then says "Couldn't send" and offers **Re-send**.

### Repeat mapping
| Item repeat | Clock slots (default) | With week-mask support |
|---|---|---|
| once / daily / weekly / monthly / yearly | 1 | 1 |
| weekdays (Mon-Fri) | 5 (one weekly reminder per day) | 1 |
| weekends | 2 | 1 |
| custom (k days) | k | 1 |

Monthly uses days 1-28 and yearly never Feb 29, so every occurrence exists.

### Statuses (first match wins)
`disabled` (off, no slot held); `error` (off but a slot is still held because the delete failed); `done` (one-time, its moment has
passed, whether or not the clock still lists it); `error` (on and the last send failed); `pending` (on, never sent); `synced` (on,
sent, clock not read yet: trust the last send); `missing` (a held slot is not on the clock: "Re-send"); `changed` (all slots there but
time, name, repeat, ring length or date differ, or the slot count no longer matches, e.g. edited in the vendor app); otherwise
`synced`. Reminders on the clock that no definition holds (made in the vendor app) are listed read-only with delete.
The periodic refresh only reads and reconciles; it never writes.

### Other fixes in this build
The 2-digit year bug (the clock reports 26, the UI showed `26-10-01`), delete acknowledgements are checked, the content-count byte
of text programs follows the vendor sum rule, reminder wire validation, stale "reminders can only be created on the clock" text.

## 4. Blank `show_text` (text as frames)

Cause [BlankText report]: the native text upload (`TextContent`) is wrong on the wire in two independent ways (glyph layer without the
vendor header and with the wrong cell format; content count byte 1 where the vendor sends 2). A start ack of 1 only means the clock
already held identical bytes, so a re-show replayed the blank. Fix = Option A: text is **drawn to pixel frames** with our bundled
fonts and sent through the graffiti/animation path that every design already uses. `TextContent` stays in `protocol/programs.py`,
documented as not matching the vendor glyph layer.

- Text that fits 32 columns: **one centred frame**. Longer: a marquee that enters at the right edge and leaves at the left, loops with
  one blank frame, about 24 pixels a second whatever the step; the step is `ceil((32 + width) / 40)` pixels so it never exceeds **40
  frames** (a long message scrolls in bigger steps). 120 characters at most.
- `speed` is the same 0-100 playback speed as every other show (absent = Original, `smooth` accepted). The old 0-255 text speed is
  gone; values above 100 are refused.
- Effects: `color_mode` 1 one colour, 2 rainbow along the text, 4 a different colour per letter; every other number (3, 5-28) draws one
  colour. `is_bold` thickens every letter by one column and is **off by default** (5x7 strokes are one pixel, so bold fills M, W, N
  and makes more messages scroll). Colours are snapped to the middle of each panel level so the upload keeps exactly the level asked
  for (`Canvas.to_frame`'s x17 snapping would be re-quantised by the vendor curve; images and generative frames still use that path).
- The preview (`iledclock/render` text) and the upload call the same function, so what Pixel Studio shows is what is sent.

## 5. Capability flags (`hardware.py`, read at call time)

| Flag | Default | Meaning | Test that decides it |
|---|---|---|---|
| `SLOT_B_ACCEPTS_ART` | False | screen B takes plain art / animation / text as a standalone type-7 program | slot-B art test |
| `SLOT_B_ACCEPTS_ART_WITH_CLOCK` | True | screen B takes "Icon with clock" (the vendor Clock tab's own page shape) | slot-B art test |
| `REMINDER_ID_MIN` / `REMINDER_ID_MAX` | 1 / 16 | ids the clock accepts (the vendor app makes 1-16; a vendor-app reminder read back as id 0) | T6 |
| `REMINDER_WEEK_MASK_SUPPORTED` | False | one reminder may carry several weekdays (repeat 1 + partial mask) | T7 |
| `REMINDER_UPLOAD_PRESERVES_SLOTS` | False | a reminder upload leaves screens A and B untouched; while False every reminder write is followed by re-sending screen A's last program list (an unchanged program is answered "already present", no data goes out, but the clock may switch to screen A) | T3 |
| `REMINDER_SAVE_SETTLE_S` | 1.0 | seconds to wait before reading a reminder back | T1 |

Flip a flag in `hardware.py` and nothing else changes; Pixel Studio learns the values from `capabilities` in the `iledclock/state`
payload. Tests run under the defaults and flip each flag once.

## 6. Live tests (with Nitin at the clock; set the clock time first with `sync_time`)

Order: **T3 first** (it decides whether a reminder write can disturb the rotation).
- **T3 playlist safety**: `set_playlist` with 3 items (5 s each), watch a full cycle; save one alarm; watch another cycle (still 3
  items, the alarm is not in the loop); confirm `1a 01` lists the alarm. Flip `REMINDER_UPLOAD_PRESERVES_SLOTS` if nothing was lost
  and the automatic re-send was not needed. If the rotation was wiped, the re-send is what repairs it: keep the flag False.
- **T1 create**: a one-time alarm 2 minutes ahead with art; expect start ack 0, chunk acks 0, the list has the id, the readback
  matches (the row turns "On the clock").
- **T2 ring**: it rings loudly and shows the art; the middle button stops it; does a finished one-time item disappear from the list?
- **T4 edit**: change the name and time; exactly one id remains with the new fields; an identical re-save answers "already present".
- **T6 id range**: create at the first and last id; does the list echo 1 and 16? Is id 0 accepted? Set `REMINDER_ID_MIN/MAX`.
- **T7 week mask**: type 1 with a mask that excludes today (must not ring), includes today (must ring), and type 2 with several bits.
  Set `REMINDER_WEEK_MASK_SUPPORTED`.
- **Slot-B art**: show a still, then an animation, then an "Icon with clock" design on screen B with `slot: "b"`; press the power
  button; screen A must still hold its own content. Set the two `SLOT_B_ACCEPTS_*` flags to what the clock did.
- **Text**: `show_text` with `A1` (the original blank case), a long sentence, `color_mode` 2 and 4, `is_bold: true`, speed 0 / Original / 100.
- **Screen switch (optional)**: `iledclock.switch_screen` once with the display on; confirm it toggles and the display stays on; do not
  test with the display off until the firmware analysis says what it does.

## 7. What this build does NOT do (boundaries)
- It does not replace the clock's built-in pomodoro. The pomodoro runs inside the firmware, is started and paused only by the clock's
  buttons (which send nothing over Bluetooth), and Home Assistant can only change its list of durations (`set_pomodoro`). Reminders
  are scheduled alerts at fixed wall-clock minutes (no pause, no start button on the clock); a fixed work/break session could be
  pre-loaded as up to 16 one-time reminders, which is a separate design. The `20 01` key event only toggles screens; whether other
  `20 xx` values reach other keys is untested.
- It cannot see which screen is showing, or react to presses of the clock's buttons.
- Reminder times have minute resolution; the clock has no timezone (Home Assistant syncs local time once a day, so a daylight-saving
  change is wrong until the next 03:30 sync).
- The 5x7 font covers ASCII letters, digits and a few symbols; other characters (accents, brackets) draw blank in text and in the
  name-as-text art of an alarm.
- Deleting a Library design that an alarm uses makes that alarm's next Re-send fail until another picture is chosen.
