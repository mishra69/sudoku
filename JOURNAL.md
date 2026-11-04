# Journal

What we tried, where we stumbled, what we learned. Newest first, ~100 words a day.

## 2026-11-04 — The test push said "Unauthorized"

Push wasn't broken; the session was. Tokens expire 30 days after sign-in, and
the client only ever checked that one was *stored*, so a month later every save,
score and test push 401'd quietly while the app looked signed in. Now the
worker reissues tokens past half-life on any response, the client drops an
expired token at boot and on any 401, and the offline queue survives to be
replayed after signing back in.

**Lesson:** an expiry nobody handles is a time bomb with a 30-day fuse — and it
went off after the feature had been "verified".

## 2026-09-05 — Praising a hard move

Wanted a compliment when the player cracks a tough spot. Detecting "tough" was
the whole problem. First attempt looked for deduction beyond scanning — but a
survey of full solves showed these puzzles are *all* solvable by singles, so it
fired once in four games. Rebuilt on how empty a cell's neighbourhood is
(Abhishek's idea), which turned out to measure "early in the game" until made
relative to board fill. Then telemetry showed zero events across three real
games: every threshold had been tuned against simulations assuming five taps
per move. Real play is one.

**Lesson:** simulate the player wrong and you tune to a fiction. Log rejections,
not just successes — zero rows told us nothing.

## 2026-09-03 — Same-digit highlight

Tapping a filled cell now lights every instance of that digit. Made it persist
when tapping an empty cell, so "where can this 3 go?" survives the tap on the
gap you found.

## 2026-08-23 — Insane difficulty from a pre-generated pool

26-given puzzles take ~71s of CPU each — impossible in a browser. Generated 99
offline, seeded D1, served least-used-first. Retired Master: it only existed
because insane couldn't be generated client-side, and at 32 givens it made the
ladder lopsided. Added a device-side buffer so the level still works offline;
bringing Master back for offline would have been a worse answer, since it's
barely harder than Expert.

## 2026-08-15 — Web Push, end to end

Worked on the first try on iPhone. Two things broke first: the VAPID *public*
key was behind auth (it can't be — the browser needs it to subscribe), and the
vendored client sent bare fetches that couldn't carry a bearer token. Fixed
upstream in webpush-edge v1.1.0.

**Lesson:** I saw the 401 in my own test output and labelled it "requires auth"
— the bug was sitting in the verification.

## 2026-08-13 — Wake lock and idle timeout

Screen slept mid-game. Added a wake lock held only while playing. iOS silently
drops it on backgrounding, so intent is tracked separately and re-acquired on
visibility change. Idle timeout 2min → 5min: only touches counted as activity,
so thinking looked like absence.

## 2026-08-08 — Google sign-in

Replaced the 4-digit PIN. Verifying the token signature isn't enough — without
checking `aud`, a token minted for any other app passes. Players key on Google's
immutable `sub`, never email.

## 2026-08-06 — PWA conversion

Consolidated Pages + Worker into one Worker, which made the API same-origin and
deleted all the CORS code. Icons didn't exist despite being referenced. Vendored
a CDN script that made "offline" a lie.

**Lesson:** `cache.addAll()` is atomic — one 404 kills offline support silently,
and the error is usually swallowed at registration.
