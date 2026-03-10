# Westeros RPG

A multiplayer Game of Thrones text RPG set in 250 AC. Players create characters, build the world through their actions, and die permanently when they make fatal choices. Built with React, Node.js, Supabase, and Claude.

---

## What This Is

- **Shared persistent world.** Every player's action is real. Deaths are logged. Alliances shift. The world moves.
- **AI Game Master.** Claude narrates in GRRM's voice — third person past tense, maester's chronicle style. It can kill you. It will kill you.
- **NPC memory system.** Named NPCs remember what you do. Betray someone in public; they remember it for the rest of the game. Telltale-style "X will remember this" toasts surface in real time.
- **CK3-style stat system.** Martial, Diplomacy, Intrigue, Stewardship, Learning. Stats affect outcomes. Dice rolls surface inline in the narrative.
- **House slot limits.** Only 5 Targaryens. 8 Starks. House slots tracked in the database in real time.
- **Full character creation.** Name, age, appearance, backstory, personality, traits, stats, position within house.
- **Custom actions.** Write your own action instead of choosing from generated options. The GM resolves it honestly even if it kills you.
- **Discord bot.** Full `/create`, `/play`, `/act`, `/status`, `/map`, `/world`, `/memories` commands. Same world as the web app.
- **SVG Westeros map.** All players visible by location. Updates in real time via Supabase Realtime.

---

## Stack

| Layer | Tech |
|---|---|
| Database | Supabase (Postgres + Realtime + Auth) |
| Backend API | Node.js + Express |
| Frontend | React + Vite |
| AI | Anthropic Claude (claude-sonnet-4-20250514) |
| Discord | Discord.js v14 |
| Deploy (backend) | Railway / Render / Fly.io |
| Deploy (frontend) | Vercel / Netlify |

---

## Setup — Step by Step

### 1. Supabase

1. Go to [supabase.com](https://supabase.com) → New Project
2. Once created, go to **SQL Editor**
3. Paste the entire contents of `supabase/migrations/001_schema.sql` and run it
4. Go to **Settings → API** and copy:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `VITE_SUPABASE_ANON_KEY` (frontend)
   - `service_role` key → `SUPABASE_SERVICE_KEY` (backend + bot, never expose to client)
5. Go to **Authentication → Providers** and enable Email/Password

### 2. Anthropic API

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Copy it → `ANTHROPIC_API_KEY`

### 3. Discord Bot (optional)

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. New Application → Bot → Reset Token → copy → `DISCORD_TOKEN`
3. Copy Application ID → `DISCORD_CLIENT_ID`
4. Under OAuth2 → URL Generator: select `bot` + `applications.commands`
5. Bot permissions: Send Messages, Use Slash Commands, Read Message History
6. Invite the bot to your server with the generated URL

### 4. Environment Files

**Backend** (`backend/.env`):
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-your-key
FRONTEND_URL=http://localhost:5173
PORT=3001
```

**Frontend** (`frontend/.env`):
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:3001
```

**Discord Bot** (`discord-bot/.env`):
```
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-your-key
```

### 5. Install & Run

```bash
# Install all dependencies
cd backend && npm install
cd ../frontend && npm install
cd ../discord-bot && npm install

# Run backend (separate terminal)
cd backend && npm run dev

# Run frontend (separate terminal)
cd frontend && npm run dev

# Run Discord bot (separate terminal, optional)
cd discord-bot && npm run dev
```

Frontend will be at `http://localhost:5173`

---

## Deploying to Production

### Backend → Railway

1. Push repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select the `backend` folder as root
4. Add all environment variables
5. Copy the Railway URL → set as `VITE_API_URL` in frontend env

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
2. Set Root Directory to `frontend`
3. Add environment variables
4. Deploy

### Discord Bot → Railway (second service)

Same as backend but point at `discord-bot` folder.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     SUPABASE                             │
│  characters · npcs · npc_memories · world_events        │
│  locations · houses · character_relationships           │
│                                                          │
│  Realtime channels:                                      │
│    world_events → all clients                           │
│    characters → map updates                             │
└──────────────────┬───────────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
   ┌────▼────┐ ┌───▼────┐ ┌──▼──────────┐
   │ BACKEND │ │   BOT  │ │  FRONTEND   │
   │ Express │ │Discord │ │  React+Vite │
   │         │ │ .js    │ │             │
   │ /start  │ │/create │ │ Auth screen │
   │ /action │ │/play   │ │ Char create │
   │ /world  │ │/act    │ │ Game view   │
   │ /houses │ │/status │ │ Map (SVG)   │
   └────┬────┘ └───┬────┘ │ NPC memory  │
        │          │      │ World feed  │
        └────┬─────┘      └─────────────┘
             │
      ┌──────▼──────┐
      │  ANTHROPIC  │
      │   Claude    │
      │ (GM engine) │
      └─────────────┘
```

---

## Adding Your SVG Map

Replace the `WesterosMap` component in `frontend/src/App.jsx` with your own SVG:

```jsx
function WesterosMap({ myLocation, allPlayers }) {
  return (
    <svg viewBox="0 0 800 600" style={{ width: "100%", height: "100%" }}>
      {/* YOUR SVG HERE */}

      {/* Overlay player dots */}
      {LOCATIONS.map(loc => {
        const playersHere = allPlayers.filter(p => p.location_id === loc.id);
        const isMe = loc.id === myLocation;
        return (
          <g key={loc.id}>
            {isMe && <circle cx={loc.x} cy={loc.y} r="8" fill="#d4a853"/>}
            {playersHere.map((p, i) => (
              <circle key={i} cx={loc.x + i*6} cy={loc.y - 8} r="4"
                fill={HOUSE_META[p.house_id]?.color || "#888"}/>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
```

Adjust the `x` and `y` coordinates in the `LOCATIONS` array in `App.jsx` to match your map's pixel positions.

---

## The GM Rules (system prompt)

The AI narrator is instructed to:

1. Write in GRRM's style — third person past tense, maester's voice
2. **Kill characters if the player makes fatal choices.** No protection.
3. Keep consequences permanent.
4. Name every NPC. Give them faces, motives, reasons to be dangerous.
5. Include at least one trap per set of choices that looks reasonable.
6. Use stat checks with dice rolls for uncertain outcomes.
7. Tag NPC memories inline for the memory system.
8. Log public actions as world events visible to all players.
9. Use the character's backstory and traits to colour available options.

You can edit the system prompt in `backend/lib/gm.js` → `buildSystemPrompt()`.

---

## Customising the Era

The default era is **250 AC, Jaehaerys I**. To change it:

1. Edit `ERA` in `App.jsx`
2. Update the NPC seed data in `supabase/migrations/001_schema.sql`
3. Update the system prompt in `backend/lib/gm.js`

The schema supports any Westerosi era. The Targaryen slot limit of 5 is set in the `houses` table seed data — change `max_player_slots` there.

---

## Database: Key Tables

| Table | Purpose |
|---|---|
| `characters` | All player characters, stats, location, message history |
| `houses` | House configs with slot limits |
| `locations` | Map locations with coordinates |
| `npcs` | Named NPCs (created dynamically as the AI names them) |
| `npc_memories` | What each NPC remembers about each character |
| `world_events` | Shared world timeline, visible to all |
| `character_relationships` | Disposition between two characters |

The `message_history` column on `characters` stores the full Claude conversation as JSON (last 40 messages). This is what gives each player their own persistent story thread.

---

## Cost Estimate

Per active player per session (30 turns):
- Claude: ~30 API calls × ~1000 tokens = ~30K tokens ≈ $0.09 (Sonnet pricing)
- Supabase: free tier handles ~500 MAU

For a small Discord server (20-50 active players), expect $5-15/month in AI costs.

---

## Roadmap / What's Not Built Yet

- [ ] Character-to-character interaction (two players in same location can interact)
- [ ] Combat between players
- [ ] Political alliance tracking UI
- [ ] Admin panel (GM can override world state, introduce events)
- [ ] Mobile-responsive layout
- [ ] Character portraits (image generation)
- [ ] Export your chronicle to PDF
- [ ] House leadership — one player per house is "Lord", controls house decisions

Pull requests welcome.
