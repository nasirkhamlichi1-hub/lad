# LAD rental-dispute courses (M2–M4)

Three separate Arabic (RTL) courses, each delivered two ways: an Articulate Rise 360 build and a 1-2-1 session with the AI Trainer.

| Course | Rise build spec | AI Trainer seed | Handout |
|---|---|---|---|
| M2 — المستندات الأساسية في معاملات المنازعات الإيجارية | `lad-m2/LAD-M2-rise-build-spec.md` | `backend/scripts/seed-trainer-lad-m2.js` | `lad-m2/LAD-M2-checklist.docx` |
| M3 — تنفيذ عقد الإيجار، وأسباب وإجراءات إنهائه أو فسخه | `lad-m3/LAD-M3-rise-build-spec.md` | `backend/scripts/seed-trainer-lad-m3.js` | `lad-m3/LAD-M3-notice-quick-reference.docx` |
| M4 — إخلاء المستأجر ومقترحات حماية حقوق الجهات الحكومية | `lad-m4/LAD-M4-rise-build-spec.md` | `backend/scripts/seed-trainer-lad-m4.js` | `lad-m4/LAD-M4-protective-measures-checklist.docx` |

**Word documents (upload these):** each course folder has `LAD-Mx-Articulate-Rise-course.docx` (the full Rise build, for Articulate) and `LAD-Mx-AI-Trainer-instructions.docx` (the full instruction set for the AI trainer / AI builder). They are generated from the build spec and the seed script, so edit those and regenerate.

**Rise:** open each spec and build it block by block in Rise (set course language to Arabic first). Every block, its type and its final copy are given; `[ASSET NEEDED]` lines are listed in each spec's asset table.

**AI Trainer:** `cd backend && node scripts/seed-trainer-lad-m2.js` (likewise for `-m3`, `-m4`). Each lesson carries its key elements (objectives), teaching notes, and a teaching brief: teach in Arabic, practitioner/mentor persona, scenario questions, and house rules that keep the trainer to the source material.

**Before go-live:** confirm the article text against the current consolidated law; M3 Lessons 3 and 7 and M4's objective and Article 19 need the module author's review (the sources were outline-only or truncated there). Two M2 source images (registration certificate, returned cheque) still show personal data and were left out of the repo — re-redact them before using them in Rise.
