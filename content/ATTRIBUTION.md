# Attribution

## Tears of Steel
© Blender Foundation | mango.blender.org
Licensed under Creative Commons Attribution 3.0 (CC-BY 3.0):
https://creativecommons.org/licenses/by/3.0/
- Video mirror used: Internet Archive, item `Tears-of-Steel` (https://archive.org/details/Tears-of-Steel), file `tears_of_steel_720p.mp4`.
- Subtitles: official English `.srt` from https://download.blender.org/demo/movies/ToS/subtitles/TOS-en.srt (linked from https://mango.blender.org/download/).
- Poster: originally https://archive.org/download/Tears-of-Steel/tos-poster.jpg (same
  archive.org item, Blender Foundation release assets); mirrored locally at
  `content/posters/tears-of-steel.jpg` (re-encoded ≤300KB JPEG) for a robust Fire TV
  image load.
- Attribution requirement: credit "(CC) Blender Foundation | mango.blender.org" wherever the film is shown.

## Sintel
© Blender Foundation | durian.blender.org
Licensed under Creative Commons Attribution 3.0 (CC-BY 3.0):
https://creativecommons.org/licenses/by/3.0/
- Video mirror used: Internet Archive, item `Sintel` (https://archive.org/details/Sintel), file `sintel-2048-stereo_512kb.mp4`.
- Subtitles: official English `.srt` from https://durian.blender.org/wp-content/content/subtitles/sintel_en.srt (linked from https://durian.blender.org/download/).
- Poster: originally https://archive.org/download/Sintel/Poster.jpg (same archive.org
  item, Blender Foundation release assets); mirrored locally at
  `content/posters/sintel.jpg` (re-encoded ≤300KB JPEG) for a robust Fire TV image load.
- Attribution requirement: credit "(CC) Blender Foundation | durian.blender.org" wherever the film is shown.

## Night of the Living Dead (1968)
Directed by George A. Romero. Distributed by the Walter Reade Organization.
**Public domain in the United States** — the theatrical distributor removed the
copyright notice ("Night of the Flesh Eaters") from prints before release, and
under the Copyright Act of 1909 (in force at the time) this forfeited copyright
protection entirely. This is a well-documented, widely cited PD status (see
Wikipedia: https://en.wikipedia.org/wiki/Night_of_the_Living_Dead and The Public
Domain Review: https://publicdomainreview.org/collection/night-of-the-living-dead/).
No trademark or other IP claims apply to the 1968 original film itself.

- Video + captions source: Internet Archive item
  `mmcmor-Public_Domain_Classics_-_Night_of_the_Living_Dead_1968`
  (https://archive.org/details/mmcmor-Public_Domain_Classics_-_Night_of_the_Living_Dead_1968),
  uploaded by McMinnville Community Media (a PEG/public-access broadcaster) as
  part of a "Public Domain Classics" cable program. The uploaded file is a full
  broadcast package: ~6.5 min host introduction, then the complete film, then a
  host outro/commentary segment. Total file runtime 1:40:09 (6009s).
- Subtitles: English auto-generated captions (`*.en.asr.srt` from the same
  archive.org item) were **cleaned and re-cut for this project**:
  - The untouched original download is preserved for provenance at
    `content/subtitles/raw/night-of-the-living-dead-1968.asr.raw.srt`
    (3153 cues, includes inline per-word ASR timing tags, the host intro, and
    the host outro).
  - `content/scripts/clean-rollup-srt.mjs` (Node, zero dependencies) turns
    that raw file into the shipped `.en.srt`:
    1. Strips inline word-level ASR timing tags (e.g. `<00:00:02.320>`) and
       decodes HTML entities.
    2. Drops all cues in the three non-film ranges listed in
       `content/subtitles/night-of-the-living-dead-1968.host-segments.json`
       (passed via `--exclude=...json`, the reproducible source of truth):
       the host intro (0–00:04:20), a SECOND host interlude spliced into the
       middle of the film at 00:40:57–00:42:52 (a "critics/reviews/director/
       franchise legacy" digression that names the director — a genuine
       world-knowledge-leak vector, found on a careful linear re-read after an
       initial keyword-only pass missed it), and the host
       outro/commentary (01:38:40–end, which explicitly narrates the ending —
       a real, checked-in spoiler in the raw file). The same three ranges are
       mirrored into `content/titles.json` as `skipRanges` so the player can
       auto-skip them at playback time (the video FILE itself is left
       untouched, per instruction — only the subtitle track is cut).
    3. **De-duplicates YouTube-style roll-up captions**: each cue originally
       repeated the tail of the previous cue's text (e.g. cue N ends "...spend
       good money on these", cue N+1 reads "Each year we spend good money on
       these things. We come out here...") — the script strips the longest
       token-level overlap between each cue and the one before it, so every
       cue now contains only its genuinely new words.
    4. Splits `>>`/"—" speaker-change markers into their own cues, merges
       leftover 1–2 word fragments into a neighboring cue, and re-segments any
       cue over ~90 characters on sentence punctuation — all time slicing done
       proportionally by character length, and cues are only ever pushed
       LATER than their original recognition time, never earlier (preserves
       the product's spoiler-ceiling invariant).
    5. Fixes two known ASR typos: "highle" → "high-level", "morgs" →
       "morgues".
  - Result: `content/subtitles/night-of-the-living-dead-1968.en.srt`, 1176
    cues (down from 3153 raw / 1273 in an earlier, non-deduplicated cleanup
    pass that also mistakenly cut the film's real opening ~2 minutes of
    dialogue — this pass recovered that content and cut total character count
    from ~128K to ~40K by removing duplicated text), first cue at 00:04:20,
    last cue at 01:38:40.
  - Caveat: this is still machine-generated (ASR) transcription of a print's
    audio track, not an official/studio subtitle file — expect occasional
    misheard words, and some choppiness where two people originally spoke over
    each other in the source captioning (the de-dup heuristic is line-linear
    and doesn't attempt speaker diarization). Good enough for a hackathon
    demo; flagged here for transparency.
- Poster: title-screen frame from the film itself, originally hosted on Wikimedia
  Commons, public domain (same US no-notice rationale):
  https://commons.wikimedia.org/wiki/File:Night_of_the_Living_Dead_(1968)_Title_Screen.png
  original file: https://upload.wikimedia.org/wikipedia/commons/7/7d/Night_of_the_Living_Dead_%281968%29_Title_Screen.png
  Mirrored locally at `content/posters/night-of-the-living-dead-1968.jpg` (resized/re-encoded
  to a ≤300KB JPEG) because Wikimedia blocks the generic HTTP user agent Fire TV's image
  loader sends.

No trademarks are used from any of the above works beyond the films' own titles,
which is standard descriptive/nominative use.
