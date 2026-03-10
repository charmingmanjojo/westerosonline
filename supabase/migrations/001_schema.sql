-- ============================================================
-- WESTEROS RPG — SUPABASE SCHEMA
-- Run this in your Supabase SQL editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── ENUMS ────────────────────────────────────────────────────

CREATE TYPE health_status AS ENUM ('Hale', 'Wounded', 'Grievously Wounded', 'Dead');
CREATE TYPE npc_disposition AS ENUM ('friendly', 'neutral', 'suspicious', 'hostile');
CREATE TYPE event_type AS ENUM ('player_action', 'world_event', 'npc_event', 'combat', 'death', 'alliance');

-- ── HOUSES ───────────────────────────────────────────────────

CREATE TABLE houses (
  id TEXT PRIMARY KEY,                   -- 'targaryen', 'stark', etc.
  name TEXT NOT NULL,
  words TEXT NOT NULL,
  seat TEXT NOT NULL,
  color TEXT NOT NULL,
  max_player_slots INTEGER NOT NULL DEFAULT 8,
  description TEXT,
  stat_bonus JSONB DEFAULT '{}'::jsonb,  -- {"martial": 1}
  starting_traits TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CHARACTERS ───────────────────────────────────────────────

CREATE TABLE characters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_id TEXT UNIQUE,                -- for discord bot users

  -- Identity
  name TEXT NOT NULL,
  age INTEGER NOT NULL DEFAULT 20,
  house_id TEXT REFERENCES houses(id),
  relation TEXT NOT NULL,                -- "Son of the Lord", etc.
  gender TEXT,

  -- Description
  appearance TEXT,
  backstory TEXT,
  personality TEXT,

  -- Stats (1-10)
  martial INTEGER NOT NULL DEFAULT 3 CHECK (martial BETWEEN 1 AND 10),
  diplomacy INTEGER NOT NULL DEFAULT 3 CHECK (diplomacy BETWEEN 1 AND 10),
  intrigue INTEGER NOT NULL DEFAULT 3 CHECK (intrigue BETWEEN 1 AND 10),
  stewardship INTEGER NOT NULL DEFAULT 3 CHECK (stewardship BETWEEN 1 AND 10),
  learning INTEGER NOT NULL DEFAULT 3 CHECK (learning BETWEEN 1 AND 10),

  -- Traits (array of trait IDs)
  traits TEXT[] DEFAULT '{}',

  -- World state
  health health_status DEFAULT 'Hale',
  location_id TEXT DEFAULT 'kings_landing',
  gold INTEGER DEFAULT 100,
  is_dead BOOLEAN DEFAULT FALSE,
  died_at TIMESTAMPTZ,
  death_summary TEXT,

  -- Session
  current_season TEXT DEFAULT 'Early Spring, 250 AC',
  message_history JSONB DEFAULT '[]'::jsonb,  -- Claude conversation history

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── LOCATIONS ────────────────────────────────────────────────

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  description TEXT,
  map_x FLOAT NOT NULL,
  map_y FLOAT NOT NULL,
  controlling_house TEXT REFERENCES houses(id),
  danger_level INTEGER DEFAULT 1 CHECK (danger_level BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── NPC REGISTRY ─────────────────────────────────────────────

CREATE TABLE npcs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  title TEXT,
  house_id TEXT REFERENCES houses(id),
  location_id TEXT REFERENCES locations(id),
  is_major BOOLEAN DEFAULT FALSE,        -- major = NPC controlled (King, etc.)
  is_alive BOOLEAN DEFAULT TRUE,
  description TEXT,
  personality TEXT,
  motivations TEXT,
  stats JSONB DEFAULT '{}'::jsonb,
  traits TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── NPC MEMORIES (per-character) ─────────────────────────────

CREATE TABLE npc_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  npc_id UUID REFERENCES npcs(id) ON DELETE CASCADE,
  npc_name TEXT NOT NULL,                -- denormalized for speed
  character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
  memory TEXT NOT NULL,
  disposition_change INTEGER DEFAULT 0,  -- -3 to +3
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup
CREATE INDEX idx_npc_memories_character ON npc_memories(character_id);
CREATE INDEX idx_npc_memories_npc ON npc_memories(npc_id);

-- ── WORLD EVENTS (shared timeline) ───────────────────────────

CREATE TABLE world_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type event_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  character_id UUID REFERENCES characters(id),    -- who caused it (nullable for world events)
  character_name TEXT,                            -- denormalized
  location_id TEXT REFERENCES locations(id),
  is_public BOOLEAN DEFAULT TRUE,                 -- false = secret (only nearby players see it)
  affects_world BOOLEAN DEFAULT FALSE,            -- true = changes background world state
  metadata JSONB DEFAULT '{}'::jsonb,
  season TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_world_events_location ON world_events(location_id);
CREATE INDEX idx_world_events_created ON world_events(created_at DESC);

-- ── HOUSE SLOTS VIEW ─────────────────────────────────────────

CREATE VIEW house_slot_counts AS
SELECT
  h.id AS house_id,
  h.name AS house_name,
  h.max_player_slots,
  COUNT(c.id) AS filled_slots,
  h.max_player_slots - COUNT(c.id) AS available_slots
FROM houses h
LEFT JOIN characters c ON c.house_id = h.id AND c.is_dead = FALSE
GROUP BY h.id, h.name, h.max_player_slots;

-- ── ALLIANCES / RELATIONSHIPS ────────────────────────────────

CREATE TABLE character_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_a UUID REFERENCES characters(id) ON DELETE CASCADE,
  character_b UUID REFERENCES characters(id) ON DELETE CASCADE,
  disposition INTEGER DEFAULT 0 CHECK (disposition BETWEEN -100 AND 100),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(character_a, character_b)
);

-- ── TRIGGERS ─────────────────────────────────────────────────

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER characters_updated BEFORE UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER npcs_updated BEFORE UPDATE ON npcs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Log death to world_events automatically
CREATE OR REPLACE FUNCTION log_character_death()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_dead = TRUE AND OLD.is_dead = FALSE THEN
    INSERT INTO world_events (type, title, description, character_id, character_name, location_id, is_public, affects_world, season)
    VALUES (
      'death',
      NEW.name || ' is dead',
      COALESCE(NEW.death_summary, NEW.name || ' met their end in ' || COALESCE(NEW.location_id, 'unknown lands') || '.'),
      NEW.id,
      NEW.name,
      NEW.location_id,
      TRUE,
      TRUE,
      NEW.current_season
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER character_death_trigger AFTER UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION log_character_death();

-- ── ROW LEVEL SECURITY ────────────────────────────────────────

ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE npc_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_events ENABLE ROW LEVEL SECURITY;

-- Characters: users can only edit their own
CREATE POLICY "Users read all characters" ON characters FOR SELECT USING (true);
CREATE POLICY "Users insert own character" ON characters FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own character" ON characters FOR UPDATE USING (auth.uid() = user_id);

-- NPC memories: anyone can read, only owner can write
CREATE POLICY "Read all memories" ON npc_memories FOR SELECT USING (true);
CREATE POLICY "Insert own memories" ON npc_memories FOR INSERT WITH CHECK (
  character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
);

-- World events: all readable
CREATE POLICY "Read all events" ON world_events FOR SELECT USING (true);
CREATE POLICY "Insert own events" ON world_events FOR INSERT WITH CHECK (
  character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  OR character_id IS NULL
);

-- ── REALTIME ─────────────────────────────────────────────────

-- Enable realtime on these tables
ALTER PUBLICATION supabase_realtime ADD TABLE world_events;
ALTER PUBLICATION supabase_realtime ADD TABLE characters;
ALTER PUBLICATION supabase_realtime ADD TABLE npc_memories;

-- ── SEED DATA ────────────────────────────────────────────────

INSERT INTO houses (id, name, words, seat, color, max_player_slots, description, stat_bonus, starting_traits) VALUES
('targaryen', 'House Targaryen', 'Fire and Blood', 'King''s Landing', '#c0392b', 5, 'The dragon lords of old Valyria. Royal blood runs in your veins.', '{"learning": 1}', '{"Valyrian Heritage"}'),
('stark', 'House Stark', 'Winter Is Coming', 'Winterfell', '#7f8c8d', 8, 'The Kings of Winter. Old gods, old blood, old honour.', '{"martial": 1}', '{"Northern Blood"}'),
('lannister', 'House Lannister', 'Hear Me Roar', 'Casterly Rock', '#f39c12', 8, 'The wealthiest house in Westeros. Gold buys armies.', '{"stewardship": 1}', '{"Affluent Upbringing"}'),
('baratheon', 'House Baratheon', 'Ours is the Fury', 'Storm''s End', '#8e44ad', 8, 'Born of Targaryen blood and Durrandon fury.', '{"martial": 1}', '{"Stormborn Fury"}'),
('tully', 'House Tully', 'Family, Duty, Honour', 'Riverrun', '#1a6891', 8, 'The heart of Westeros. Everyone passes through the Riverlands.', '{"diplomacy": 1}', '{"Trident-Born"}'),
('tyrell', 'House Tyrell', 'Growing Strong', 'Highgarden', '#27ae60', 8, 'The breadbasket of Westeros. Old money, old roses.', '{"diplomacy": 1}', '{"Reach-Born"}'),
('martell', 'House Martell', 'Unbowed, Unbent, Unbroken', 'Sunspear', '#e67e22', 8, 'The sand and sun of Dorne. They play the long game.', '{"intrigue": 1}', '{"Dornish Blood"}'),
('arryn', 'House Arryn', 'As High as Honour', 'The Eyrie', '#3498db', 8, 'The sky and stone of the Vale. Old money, old pride.', '{"learning": 1}', '{"Vale-Born"}'),
('greyjoy', 'House Greyjoy', 'We Do Not Sow', 'Pyke', '#2c3e50', 8, 'The ironborn do not kneel. They take.', '{"martial": 1}', '{"Ironborn"}'),
('no_house', 'No Great House', '—', 'Various', '#5d4037', 999, 'No great name. No great inheritance. Only yourself.', '{}', '{}');

INSERT INTO locations (id, name, region, map_x, map_y, controlling_house, danger_level) VALUES
('kings_landing', 'King''s Landing', 'Crownlands', 340, 380, 'targaryen', 2),
('winterfell', 'Winterfell', 'The North', 310, 120, 'stark', 1),
('casterly_rock', 'Casterly Rock', 'The Westerlands', 170, 310, 'lannister', 1),
('highgarden', 'Highgarden', 'The Reach', 220, 430, 'tyrell', 1),
('storms_end', 'Storm''s End', 'The Stormlands', 390, 470, 'baratheon', 2),
('riverrun', 'Riverrun', 'The Riverlands', 250, 270, 'tully', 1),
('dragonstone', 'Dragonstone', 'Crownlands', 440, 350, 'targaryen', 2),
('the_wall', 'The Wall', 'The North', 280, 60, NULL, 4),
('oldtown', 'Oldtown', 'The Reach', 180, 490, 'tyrell', 1),
('the_eyrie', 'The Eyrie', 'The Vale', 420, 210, 'arryn', 2),
('sunspear', 'Sunspear', 'Dorne', 380, 540, 'martell', 2),
('pyke', 'Pyke', 'The Iron Islands', 100, 240, 'greyjoy', 3),
('harrenhal', 'Harrenhal', 'The Riverlands', 300, 300, NULL, 3),
('the_twins', 'The Twins', 'The Riverlands', 270, 230, NULL, 2);

-- Major NPCs for 250 AC (Jaehaerys I era)
INSERT INTO npcs (name, title, house_id, location_id, is_major, description, personality, motivations) VALUES
('Jaehaerys I Targaryen', 'King of the Seven Kingdoms', 'targaryen', 'kings_landing', TRUE, 'The Old King. Silver-haired, wise-eyed, a monarch who has ruled longer than most men have lived.', 'Patient, calculating, deeply intelligent. He has seen too much to be surprised by anything.', 'Stability. Legacy. The realm above all else.'),
('Alysanne Targaryen', 'Queen Consort', 'targaryen', 'kings_landing', TRUE, 'Good Queen Alysanne. Silver-haired, sharp-minded, beloved by the smallfolk.', 'Warm but not soft. Her kindness is a choice, not a limitation.', 'Justice for the smallfolk. Her husband''s happiness. Her children''s futures.'),
('Septon Barth', 'Hand of the King', 'no_house', 'kings_landing', TRUE, 'A septon who became the most trusted man in the realm. Learned beyond any man alive.', 'Precise, humorous, unfailingly honest in private and carefully diplomatic in public.', 'The realm''s welfare. Knowledge. The separation of faith from politics.');
