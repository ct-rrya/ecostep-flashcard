# EcoStep Defense Prep — Team Flashcards & Struggle Analytics

Mobile-first flashcard & oral-defense review web app for the **6 EcoStep BSIT Capstone team members** at CTU – Daanbantayan Campus.

## Features
- **6 Pre-Configured Team Accounts** with 4-digit PIN sign-in (changeable anytime in Account tab)
- **74 Verified Flashcards** organized sequentially from Research Gaps to Major Findings:
  - **28 Manuscript Fact Cards** (exact verified statistics, tables, formulas, circuit stages, SOP 1–6 results, conclusions & recommendations)
  - **46 Oral Defense Q&A Cards** (from your attached Q&A Defense Guide, Q1–Q46)
- **Mobile-First Simple UI**: Tap-to-flip cards, key-fact hints, spaced-repetition prioritization, instant search lookup, and thumb-friendly bottom navigation
- **Team Struggle Analytics Dashboard**:
  - Team readiness score & #1 struggling topic callout
  - Topic-by-topic mastery and struggle bars
  - **6 × 6 Team × Topic Heatmap** showing which member is struggling on which section
  - **Hardest Cards Across the Team** with 1-tap "Drill All"

## Default Starter PINs (Change in Account Tab)
| Member | Starter PIN |
| :--- | :--- |
| Merry Apple G. Edaño | `1111` |
| Lord Jason G. Riveral | `2222` |
| Jerome M. Magdadaro | `3333` |
| Jhemarsh Lee Conde | `4444` |
| Alyza G. Pitogo | `5555` |
| Francis Keith Banan | `6666` |

## Run Locally (Share on Same Wi-Fi / Hotspot)
```bash
npm install
npm run build
npm start
```
Open `http://localhost:4000` on your laptop, or share the Wi-Fi LAN link printed in the terminal (and visible inside the **Account** tab) with all 6 team members on their phones.

## Deploy Online (Render Free Web Service)
Push the `ecostep-flashcards` folder to GitHub and deploy as a Node Web Service on Render (a `render.yaml` is already included):
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
