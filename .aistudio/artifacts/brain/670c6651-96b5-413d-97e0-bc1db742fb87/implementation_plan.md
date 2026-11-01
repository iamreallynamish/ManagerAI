# Kairo — Implementation Refinements Plan

Kairo is a clean, conversational personal awareness manager that answers: **“What do I need to know right now, and what is coming up next?”** It unifies verified Google Calendar events, Google Classroom deadlines, Spend IQ financial transactions, and personal life admin reminders into a quiet, single-page mobile experience.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The architectural plan has been refined to eliminate visual clutter, remove all stock placeholders, simplify the header, and present the daily briefing as natural inline text rather than a dashboard widget.

- **Minimal Header**: Stripped of live status pills, manual sync buttons, and administrative clutter. Contains only the understated `KAIRO` wordmark and a quiet settings icon for preferences and account connection.
- **Natural Inline Briefing (No Dashboard Card)**: The Daily Briefing is rendered as clean, human typography directly into the page canvas (no hero card, no colored banner, no nested borders).
- **Stocks Completely Removed**: The "Stocks" tab and placeholders are completely removed from the UI until stock monitoring is fully implemented in a future phase. The active filters are: `All`, `Calendar`, `Classroom`, and `Spend IQ`.
- **Centralized Server Data Pipeline**: All data fetching, Google Classroom coursework parsing, Calendar synchronization, and Spend IQ transaction normalization happen via secure backend routes (`server.ts`). The frontend receives clean, normalized timeline items and attention alerts.
- **Generic Firestore Personal Reminders**: Built as a general user schema (`users/{uid}/reminders`) supporting title, context, target action window, and completion status. Zero hardcoded trips or dates.
- **Spend IQ Verification**: Continues querying `https://spendiq-7de3d-default-rtdb.asia-southeast1.firebasedatabase.app/spendiq_family_ledger/transactions.json`, validating UTC `timestampMs`, sorting descending, and enforcing the dynamic 7-day rolling window without deleting older records.

---

## 1. Information Hierarchy & Experience Flow

```
┌────────────────────────────────────────────────────────┐
│  KAIRO                                             ⚙️   │
├────────────────────────────────────────────────────────┤
│  Good morning, Namish.                                 │
│  You have two classes today, starting at 10:00 AM.     │
│  Your Marketing assignment is due in two days.         │
│  Tomorrow, you have three classes.                     │
├────────────────────────────────────────────────────────┤
│  NEEDS YOUR ATTENTION (Appears only when action needed)│
│  • Economics Assignment due tomorrow at 11:59 PM       │
│  • Time to book India flights (Trip: Jan 5)            │
├────────────────────────────────────────────────────────┤
│  [All]  [Calendar]  [Classroom]  [Spend IQ]            │
│                                                        │
│  TOMORROW · PREVIEW                                    │
│  09:30  ●─ Tomorrow starts with Finance                │
│                                                        │
│  TODAY · ACTIVE                                        │
│  10:00  ●─ Macroeconomics Lecture                      │
│                                                        │
│  RECENT HISTORY                                        │
│  15:30  ●─ You spent ¥226 at 7-Eleven                  │
└────────────────────────────────────────────────────────┘
```

### 1. Header (Minimalist)
- 48px height, ultra-clean top row.
- Left: `KAIRO` in letterspaced medium-weight sans-serif.
- Right: Single quiet Settings icon (`⚙️`) opening the slide-over preferences modal.
- Zero badges, zero manual sync buttons, zero decorative cockpit indicators.

### 2. Personal Daily Briefing
- Integrated directly into the main reading flow without container borders or card boxes.
- 2–4 natural sentences composed from real calendar events, assignments due within 72 hours, and active life admin windows.
- Greets the user naturally based on time of day (`Good morning, Namish` / `Good afternoon, Namish` / `Good evening, Namish`).

### 3. Needs Your Attention
- Compact, unobtrusive section that renders **only** when items require immediate action:
  - Assignments due today or tomorrow.
  - Active life admin reminders within their action window.
  - Urgent schedule updates.
- If no urgent items exist, this section disappears completely, keeping the feed calm.

### 4. Recent Updates Timeline
- The verified chronological timeline continues to display:
  - Calendar updates & classes (Today & Tomorrow)
  - Google Classroom assignments
  - Spend IQ transactions within the rolling 7-day window
  - Life admin milestones
- Compact filter chips: `All`, `Calendar`, `Classroom`, `Spend IQ`.

---

## 2. Google Classroom & Calendar Server Pipeline

- **Google OAuth Scopes**:
  - `https://www.googleapis.com/auth/calendar.events.readonly`
  - `https://www.googleapis.com/auth/classroom.courses.readonly`
  - `https://www.googleapis.com/auth/classroom.coursework.me.readonly`
- **Backend Endpoints**:
  - `POST /api/calendar/sync`: Fetches and normalizes events for Today and Tomorrow in the user's timezone.
  - `POST /api/classroom/sync`: Fetches active courses and student coursework. Normalizes due dates, calculates urgency tiers, and formats assignment activities.
  - `GET /api/spendiq/transactions`: Fetches verified Realtime Database transactions within the dynamic 7-day rolling window, sorted descending by `timestampMs`.

---

## 3. Generic Personal Reminders Architecture

- **Database**: Cloud Firestore under `/users/{uid}/reminders/{reminderId}`.
- **Fields**:
  - `id`: string
  - `userId`: string
  - `title`: string (e.g. "Book India flights")
  - `context`: string (e.g. "Trip departs Jan 5, return Apr 5")
  - `targetWindowStart`: string / timestamp (start of action period)
  - `targetWindowEnd`: string / timestamp (end of action period)
  - `dueDate` / `importantDate`: string / timestamp
  - `completed`: boolean
  - `createdAt`: number
- **Evaluation**: The server/client engine inspects all active reminders. If `currentDate` falls between `targetWindowStart` and `targetWindowEnd`, it is flagged for the briefing and the "Needs Your Attention" section.

---

## 4. Implementation Steps

1. **OAuth Scopes**:
   - Register Classroom scopes alongside Calendar via `set_up_oauth`.
2. **Backend Services (`server.ts`)**:
   - Add `/api/classroom/sync` endpoint querying Google Classroom API (`/v1/courses`, `/v1/courses/{id}/courseWork`).
   - Standardize transaction timestamps, sort order, and dynamic rolling 7-day filter in `/api/spendiq/transactions`.
3. **Firestore Reminders Repository**:
   - Implement `src/services/reminders.ts` for adding, editing, completing, and querying user reminders from Firestore.
4. **Briefing & Attention Synthesizer**:
   - Implement `src/services/briefingEngine.ts` to compute:
     - 2–4 sentence conversational briefing.
     - Urgent items for "Needs Your Attention".
5. **UI Streamlining**:
   - Refactor `Header.tsx` to remove all sync/status badges, keeping only wordmark and settings button.
   - Remove Stocks filter chip entirely.
   - Build clean typography-driven `DailyBriefing.tsx`.
   - Build compact `NeedsAttention.tsx`.
   - Integrate Reminders modal into Settings / quick action.
6. **End-to-End Verification**:
   - Verify real Spend IQ transactions in 7-day rolling window.
   - Verify Classroom and Calendar sync.
   - Run compilation and lint tests.
