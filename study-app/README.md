# 🎓 Study Buddy — Year 10 Study App

A simple, friendly study app for Year 10 (GCSE-level) covering **Science, Maths,
English, Geography, Business and Design & Technology**, with an AI teacher and
tutor you can talk to.

## How to use it

Just open `index.html` in your browser (double-click it), or serve the folder:

```sh
cd study-app
python3 -m http.server 8080
# then visit http://localhost:8080
```

That's it — no build step, no install.

## What's inside

Pick a subject → pick a topic → choose one of **four ways to learn**:

| Mode | What it does | Needs AI key? |
|------|--------------|:---:|
| 📚 **Study Mode** | Clear, exam-ready notes | No |
| 🎧 **Listening Mode** | Reads the notes aloud (text-to-speech) with highlighting and a speed control | No |
| ✏️ **Question Mode** | Multiple-choice + written questions, auto-marked, with model answers | No* |
| 👩‍🏫 **Teacher Mode** | Chat with an AI teacher that knows the topic — ask for explanations, examples or a quiz | Yes |
| 💬 **AI Tutor** | Ask about *any* subject or homework, any time (button on the home screen) | Yes |

\* Written answers can be **marked by AI** if a key is set; otherwise you get the model answer.

Your progress (topics read, best quiz scores) is saved on your device.

## Connecting the AI (optional but recommended)

The AI teacher, tutor and written-answer marking are powered by **Claude**.
Tap **⚙️ AI Setup** and paste an Anthropic API key:

1. Get a key at <https://console.anthropic.com/settings/keys>
2. Paste it into AI Setup and pick a model (Haiku = fastest, Sonnet = best all-round).

Your key is stored **only in your browser** (localStorage) and is sent directly
to Anthropic — it never goes to any other server.

> Everything except the AI chat works with **no key at all** — notes, listening
> mode and multiple-choice quizzes are fully offline.

## Files

- `index.html` — the whole app (UI + logic)
- `curriculum.js` — the study notes and questions (easy to edit / add topics)
- `README.md` — this file
