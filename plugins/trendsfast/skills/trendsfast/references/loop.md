# The weekly loop

Each run starts from the last one. Keep a log of what was tested and how it did, and read it
before every paid call. The log is the user's and stays with you: TrendsFast never sees it.

## 1. Read the log first

Open the log: a project document called Loop log, or wherever you keep notes for this user. Fill in every
test whose check date has passed before starting a new one: ask the user for the number, or
measure a video (step 4). Do more of what won and drop what lost; never repeat a lost test
without saying what changed.

## 2. Read the market, once

One product call for the week's question, from the router in SKILL.md, at its quoted price.
`trendsfast_read_result` (free) rereads last week's result instead of paying for it again.

## 3. Decide one test

From the result's `brief` and its CORE items: one change, one place, one success signal the
user can measure, and a date to check it. If the evidence supports no test, say so rather than
invent one. Draft it inside the community's rules (its brief: `trendsfast_community_brief`,
free). The user posts; TrendsFast never does.

Add one line to the log, with the result ID as the evidence:

```json
{"date":"2026-11-09","test":"First-person post on r/indiehackers about finding first users","evidence":"<result_id>","success_signal":"signups from the post within 7 days","check_after":"2026-11-16","outcome":null,"verdict":null}
```

## 4. Measure, then judge

- A video the user posted: `trendsfast_video_outlier` (5 credits), charged only when the
  video is found. It scores the video against the user's own median.
- Anything else: the number from the user's analytics. Never guess one.

Write the verdict as WON, LOST or UNCLEAR, as a new line; never rewrite one. One post is not a
pattern: call something a winner only when the log shows it twice.
