// ============================================================
// WESTEROS RPG — BACKEND API
// Node.js + Express + Supabase + Anthropic
// ============================================================

import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, parseGMResponse } from "./lib/gm.js";
import { rollDice } from "./lib/dice.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service key — never expose to client
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── MIDDLEWARE: auth ──────────────────────────────────────────

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid token" });

  req.user = user;
  next();
}

// ── CHARACTERS ───────────────────────────────────────────────

// GET /characters — all living characters (for the world map)
app.get("/characters", async (req, res) => {
  const { data, error } = await supabase
    .from("characters")
    .select("id, name, house_id, location_id, health, is_dead, relation")
    .eq("is_dead", false);

  if (error) return res.status(500).json({ error });
  res.json(data);
});

// GET /characters/me — your character
app.get("/characters/me", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("user_id", req.user.id)
    .single();

  if (error) return res.status(404).json({ error: "No character found" });
  res.json(data);
});

// POST /characters — create character
app.post("/characters", requireAuth, async (req, res) => {
  const { name, age, house_id, relation, appearance, backstory, personality,
          martial, diplomacy, intrigue, stewardship, learning, traits, gender } = req.body;

  // Validate: only one character per user
  const { data: existing } = await supabase
    .from("characters")
    .select("id")
    .eq("user_id", req.user.id)
    .single();

  if (existing) return res.status(400).json({ error: "You already have a character" });

  // Check house slots
  if (house_id && house_id !== "no_house") {
    const { data: slotData } = await supabase
      .from("house_slot_counts")
      .select("available_slots")
      .eq("house_id", house_id)
      .single();

    if (slotData && slotData.available_slots <= 0) {
      return res.status(400).json({ error: "No slots available in this house" });
    }
  }

  // Stat validation: total must be ≤ 30 (5 stats × base 3 + 15 bonus points)
  const statTotal = (martial || 3) + (diplomacy || 3) + (intrigue || 3) + (stewardship || 3) + (learning || 3);
  if (statTotal > 30) return res.status(400).json({ error: "Too many stat points allocated" });

  // Add house starting traits
  let allTraits = [...(traits || [])];
  if (house_id) {
    const { data: house } = await supabase.from("houses").select("starting_traits").eq("id", house_id).single();
    if (house?.starting_traits) allTraits = [...new Set([...allTraits, ...house.starting_traits])];
  }

  // Determine starting location
  const { data: house } = await supabase.from("houses").select("seat").eq("id", house_id || "no_house").single();
  const startLocation = house?.seat
    ? (await supabase.from("locations").select("id").ilike("name", `%${house.seat}%`).single()).data?.id || "kings_landing"
    : "kings_landing";

  const { data, error } = await supabase.from("characters").insert({
    user_id: req.user.id,
    name, age, house_id, relation, appearance, backstory, personality,
    martial: martial || 3, diplomacy: diplomacy || 3, intrigue: intrigue || 3,
    stewardship: stewardship || 3, learning: learning || 3,
    traits: allTraits,
    gender,
    location_id: startLocation,
    message_history: [],
  }).select().single();

  if (error) return res.status(500).json({ error });

  // Log creation as world event
  await supabase.from("world_events").insert({
    type: "player_action",
    title: `${name} enters the world`,
    description: `${name}, ${relation} of ${house_id || "unknown house"}, has arrived.`,
    character_id: data.id,
    character_name: name,
    location_id: startLocation,
    season: "Early Spring, 250 AC",
    is_public: true,
  });

  res.json(data);
});

// ── GAME: TAKE ACTION ─────────────────────────────────────────

// POST /action — main game loop
app.post("/action", requireAuth, async (req, res) => {
  const { action } = req.body;  // player's chosen action text

  // Load character with full context
  const { data: char, error: charErr } = await supabase
    .from("characters")
    .select("*, houses(name, words, description)")
    .eq("user_id", req.user.id)
    .single();

  if (charErr || !char) return res.status(404).json({ error: "Character not found" });
  if (char.is_dead) return res.status(400).json({ error: "Your character is dead" });

  // Load NPC memories for this character
  const { data: memories } = await supabase
    .from("npc_memories")
    .select("npc_name, memory, disposition_change, created_at")
    .eq("character_id", char.id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Load recent world events (last 10, to give the GM context)
  const { data: recentEvents } = await supabase
    .from("world_events")
    .select("title, description, character_name, location_id, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(10);

  // Load nearby players (same location)
  const { data: nearbyPlayers } = await supabase
    .from("characters")
    .select("name, house_id, health, relation")
    .eq("location_id", char.location_id)
    .eq("is_dead", false)
    .neq("id", char.id);

  // Build message history + new action
  const history = (char.message_history || []);
  const newMsg = { role: "user", content: action };
  const messages = [...history, newMsg];

  // Build system prompt with full world context
  const systemPrompt = buildSystemPrompt(char, memories, recentEvents, nearbyPlayers);

  // Call Claude
  let raw;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages.slice(-20),  // keep last 20 turns to stay within context
    });
    raw = response.content[0].text;
  } catch (e) {
    return res.status(500).json({ error: "AI error: " + e.message });
  }

  const parsed = parseGMResponse(raw);

  // ── PERSIST RESULTS ──

  // 1. Update character state
  const updates = {
    message_history: [...messages, { role: "assistant", content: raw }].slice(-40),
    current_season: parsed.status.season || char.current_season,
  };

  if (parsed.status.health) updates.health = parsed.status.health;
  if (parsed.status.isDead) {
    updates.is_dead = true;
    updates.died_at = new Date().toISOString();
    updates.death_summary = parsed.status.summary;
  }
  if (parsed.status.location) {
    // Resolve location name to ID
    const { data: locData } = await supabase
      .from("locations")
      .select("id")
      .ilike("name", `%${parsed.status.location}%`)
      .single();
    if (locData) updates.location_id = locData.id;
  }
  if (parsed.status.goldChange) {
    updates.gold = Math.max(0, (char.gold || 0) + parsed.status.goldChange);
  }

  await supabase.from("characters").update(updates).eq("id", char.id);

  // 2. Save NPC memories
  for (const mem of (parsed.memories || [])) {
    // Find or create NPC record
    let { data: npc } = await supabase.from("npcs").select("id").ilike("name", mem.npc).single();
    if (!npc) {
      const { data: newNpc } = await supabase.from("npcs").insert({
        name: mem.npc,
        location_id: char.location_id,
      }).select("id").single();
      npc = newNpc;
    }

    if (npc) {
      await supabase.from("npc_memories").insert({
        npc_id: npc.id,
        npc_name: mem.npc,
        character_id: char.id,
        memory: mem.memory,
        disposition_change: mem.disposition || 0,
      });
    }
  }

  // 3. Log to world events if it's a public action
  if (parsed.worldEvent) {
    await supabase.from("world_events").insert({
      type: parsed.worldEvent.type || "player_action",
      title: parsed.worldEvent.title,
      description: parsed.worldEvent.description,
      character_id: char.id,
      character_name: char.name,
      location_id: updates.location_id || char.location_id,
      is_public: parsed.worldEvent.isPublic !== false,
      affects_world: parsed.worldEvent.affectsWorld || false,
      season: updates.current_season,
    });
  }

  res.json({
    narrative: parsed.narrative,
    choices: parsed.choices,
    status: parsed.status,
    memories: parsed.memories,
    rolls: parsed.rolls,
    worldEvent: parsed.worldEvent,
  });
});

// ── WORLD FEED ────────────────────────────────────────────────

// GET /world — recent world events
app.get("/world", async (req, res) => {
  const { data, error } = await supabase
    .from("world_events")
    .select("*")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ── NPC MEMORIES ─────────────────────────────────────────────

// GET /memories/:characterId — all NPC memories for a character
app.get("/memories/:characterId", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("npc_memories")
    .select("npc_name, memory, disposition_change, created_at")
    .eq("character_id", req.params.characterId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ── HOUSES ───────────────────────────────────────────────────

app.get("/houses", async (req, res) => {
  const { data, error } = await supabase
    .from("house_slot_counts")
    .select("*");

  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ── START ─────────────────────────────────────────────────────

// POST /start — begin a new character's story
app.post("/start", requireAuth, async (req, res) => {
  const { data: char, error } = await supabase
    .from("characters")
    .select("*, houses(name, words)")
    .eq("user_id", req.user.id)
    .single();

  if (error || !char) return res.status(404).json({ error: "Character not found" });
  if (char.message_history?.length > 0) {
    return res.status(400).json({ error: "Story already started — use /action" });
  }

  const startMsg = {
    role: "user",
    content: `Begin the simulation. Open with a scene already in motion — a specific place, a specific moment, a problem already developing. Do not begin in safety or comfort. Name the NPCs I encounter immediately.`,
  };

  const systemPrompt = buildSystemPrompt(char, [], [], []);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: systemPrompt,
    messages: [startMsg],
  });

  const raw = response.content[0].text;
  const parsed = parseGMResponse(raw);

  await supabase.from("characters").update({
    message_history: [startMsg, { role: "assistant", content: raw }],
  }).eq("id", char.id);

  res.json({
    narrative: parsed.narrative,
    choices: parsed.choices,
    status: parsed.status,
    memories: parsed.memories || [],
    rolls: parsed.rolls || [],
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Westeros API running on :${PORT}`));
