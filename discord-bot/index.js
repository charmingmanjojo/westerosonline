// ============================================================
// WESTEROS RPG — DISCORD BOT
// Discord.js v14 + Supabase
// Commands: /create, /play, /action, /status, /map, /world
// ============================================================

import { Client, GatewayIntentBits, SlashCommandBuilder,
         EmbedBuilder, ActionRowBuilder, ButtonBuilder,
         ButtonStyle, ModalBuilder, TextInputBuilder,
         TextInputStyle, REST, Routes } from "discord.js";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, parseGMResponse } from "../backend/lib/gm.js";
import * as dotenv from "dotenv";
dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── SLASH COMMAND DEFINITIONS ─────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("create")
    .setDescription("Create your character in Westeros"),

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Begin or continue your story"),

  new SlashCommandBuilder()
    .setName("act")
    .setDescription("Take a custom action")
    .addStringOption(o => o.setName("action").setDescription("What do you do?").setRequired(true)),

  new SlashCommandBuilder()
    .setName("choose")
    .setDescription("Choose from generated options")
    .addIntegerOption(o => o.setName("number").setDescription("Choice number (1-4)").setRequired(true).setMinValue(1).setMaxValue(4)),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("View your character sheet"),

  new SlashCommandBuilder()
    .setName("map")
    .setDescription("See where players are across Westeros"),

  new SlashCommandBuilder()
    .setName("world")
    .setDescription("See recent events across the realm"),

  new SlashCommandBuilder()
    .setName("memories")
    .setDescription("See what NPCs remember about you"),
];

// ── REGISTER COMMANDS ─────────────────────────────────────────

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );
  console.log("Commands registered.");
}

// ── HELPERS ───────────────────────────────────────────────────

async function getCharacter(discordId) {
  const { data } = await supabase
    .from("characters")
    .select("*, houses(name, words)")
    .eq("discord_id", discordId)
    .single();
  return data;
}

function healthColor(health) {
  const colors = {
    "Hale": 0x7aaa60,
    "Wounded": 0xc09030,
    "Grievously Wounded": 0xc04030,
    "Dead": 0x606060,
  };
  return colors[health] || 0x7a6040;
}

function statBar(val, max = 10) {
  const filled = Math.round((val / max) * 8);
  return "█".repeat(filled) + "░".repeat(8 - filled);
}

// Truncate narrative for Discord embed (max 4096 chars)
function truncate(text, max = 1800) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

// Build narrative embed
function narrativeEmbed(char, narrative, status, choices, rolls, memories) {
  const embed = new EmbedBuilder()
    .setColor(0x8B6914)
    .setTitle(`📜 ${char.name}`)
    .setDescription(truncate(narrative))
    .setFooter({ text: `${status.season || "250 AC"} · ${status.location || char.location_id} · ${status.health || char.health}` });

  // Dice rolls
  if (rolls?.length) {
    const rollText = rolls.map(r => {
      const total = r.rolls.reduce((a, b) => a + b, 0) + (r.bonus || 0);
      const success = total >= r.difficulty;
      return `${success ? "✅" : "❌"} **${r.stat}** check: [${r.rolls.join(", ")}] +${r.bonus} = **${total}** vs DC ${r.difficulty}`;
    }).join("\n");
    embed.addFields({ name: "🎲 Dice", value: rollText, inline: false });
  }

  // NPC memories
  if (memories?.length) {
    const memText = memories.map(m => `*${m.npc}* — ${m.memory}`).join("\n");
    embed.addFields({ name: "👁 They Will Remember", value: truncate(memText, 300), inline: false });
  }

  return embed;
}

// Build choice buttons
function choiceButtons(choices) {
  if (!choices?.length) return [];
  const rows = [];
  const row = new ActionRowBuilder();

  choices.slice(0, 4).forEach((choice, i) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`choice_${i}`)
        .setLabel(`${["I", "II", "III", "IV"][i]}. ${choice.slice(0, 60)}${choice.length > 60 ? "…" : ""}`)
        .setStyle(ButtonStyle.Secondary)
    );
  });

  rows.push(row);
  return rows;
}

// ── CORE: PROCESS ACTION ──────────────────────────────────────

async function processAction(discordId, action, interaction) {
  const char = await getCharacter(discordId);
  if (!char) {
    await interaction.reply({ content: "❌ No character found. Use `/create` first.", ephemeral: true });
    return;
  }
  if (char.is_dead) {
    await interaction.reply({ content: `⚰️ **${char.name} is dead.** Use \`/create\` to begin again.`, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  // Load context
  const { data: memories } = await supabase
    .from("npc_memories")
    .select("npc_name, memory, disposition_change")
    .eq("character_id", char.id)
    .order("created_at", { ascending: false })
    .limit(15);

  const { data: worldEvents } = await supabase
    .from("world_events")
    .select("title, description, character_name, location_id")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(8);

  const { data: nearbyPlayers } = await supabase
    .from("characters")
    .select("name, house_id, health, relation")
    .eq("location_id", char.location_id)
    .eq("is_dead", false)
    .neq("discord_id", discordId);

  const history = (char.message_history || []);
  const newMsg = { role: "user", content: action };
  const messages = [...history, newMsg].slice(-20);

  const systemPrompt = buildSystemPrompt(char, memories || [], worldEvents || [], nearbyPlayers || []);

  let raw;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    });
    raw = response.content[0].text;
  } catch (e) {
    await interaction.editReply({ content: `❌ GM error: ${e.message}` });
    return;
  }

  const parsed = parseGMResponse(raw);

  // Update character
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
    const { data: locData } = await supabase
      .from("locations")
      .select("id")
      .ilike("name", `%${parsed.status.location}%`)
      .single();
    if (locData) updates.location_id = locData.id;
  }

  await supabase.from("characters").update(updates).eq("id", char.id);

  // Save NPC memories
  for (const mem of (parsed.memories || [])) {
    let { data: npc } = await supabase.from("npcs").select("id").ilike("name", mem.npc).single();
    if (!npc) {
      const { data: newNpc } = await supabase.from("npcs").insert({ name: mem.npc, location_id: char.location_id }).select("id").single();
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

  // Log world event
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

  // Store current choices for /choose
  await supabase.from("characters")
    .update({ message_history: updates.message_history })
    .eq("id", char.id);

  // Store choices in a temp key on the character record
  // We'll use a simple global map for this (in production use Redis or DB)
  pendingChoices.set(discordId, parsed.choices || []);

  // Build response
  if (parsed.status.isDead) {
    const deathEmbed = new EmbedBuilder()
      .setColor(0x2c2c2c)
      .setTitle(`⚰️ ${char.name} is Dead`)
      .setDescription(truncate(parsed.narrative))
      .addFields({ name: "Epitaph", value: parsed.status.summary || "They died as they lived." })
      .setFooter({ text: `${parsed.status.season || "250 AC"} · Use /create to begin again` });

    await interaction.editReply({ embeds: [deathEmbed] });
    return;
  }

  const embed = narrativeEmbed(
    { ...char, ...updates },
    parsed.narrative,
    parsed.status,
    parsed.choices,
    parsed.rolls,
    parsed.memories
  );

  const components = choiceButtons(parsed.choices);

  await interaction.editReply({ embeds: [embed], components });
}

// Pending choices cache (in production: use Redis)
const pendingChoices = new Map();

// ── COMMAND HANDLERS ─────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {

  // ── BUTTON: choice selection
  if (interaction.isButton() && interaction.customId.startsWith("choice_")) {
    const idx = parseInt(interaction.customId.replace("choice_", ""));
    const choices = pendingChoices.get(interaction.user.id) || [];
    if (!choices[idx]) {
      await interaction.reply({ content: "Choice not available.", ephemeral: true });
      return;
    }
    await processAction(interaction.user.id, choices[idx], interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

  // ── /create
  if (commandName === "create") {
    const existing = await getCharacter(user.id);
    if (existing && !existing.is_dead) {
      await interaction.reply({
        content: `❌ You already have a character: **${existing.name}**. They must die before you can create another.`,
        ephemeral: true,
      });
      return;
    }

    // Show modal for character creation
    const modal = new ModalBuilder()
      .setCustomId("create_char")
      .setTitle("Create Your Character — 250 AC");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Character Name").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("age_house").setLabel("Age / House (e.g. '22 / Stark')").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("22 / Stark")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("relation").setLabel("Your Position (e.g. 'Son of the Lord')").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("appearance").setLabel("Appearance").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("backstory").setLabel("Backstory & Personality").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
      ),
    );

    await interaction.showModal(modal);
    return;
  }

  // ── /play
  if (commandName === "play") {
    const char = await getCharacter(user.id);
    if (!char) {
      await interaction.reply({ content: "❌ No character found. Use `/create` first.", ephemeral: true });
      return;
    }
    if (char.is_dead) {
      await interaction.reply({ content: `⚰️ **${char.name} is dead.** Use \`/create\` to begin again.`, ephemeral: true });
      return;
    }

    // If already has history, just show current state
    if (char.message_history?.length > 0) {
      await interaction.reply({ content: "Your story is already in progress. Use `/act` to take an action.", ephemeral: true });
      return;
    }

    await processAction(user.id,
      "Begin the simulation. Open with a scene already in motion — a specific place, a specific moment, a problem already developing. Do not begin in safety. Name the NPCs I encounter immediately.",
      interaction
    );
    return;
  }

  // ── /act
  if (commandName === "act") {
    const action = interaction.options.getString("action");
    await processAction(user.id, action, interaction);
    return;
  }

  // ── /choose
  if (commandName === "choose") {
    const num = interaction.options.getInteger("number") - 1;
    const choices = pendingChoices.get(user.id) || [];
    if (!choices[num]) {
      await interaction.reply({ content: "❌ That choice is not available.", ephemeral: true });
      return;
    }
    await processAction(user.id, choices[num], interaction);
    return;
  }

  // ── /status
  if (commandName === "status") {
    const char = await getCharacter(user.id);
    if (!char) {
      await interaction.reply({ content: "❌ No character. Use `/create`.", ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(healthColor(char.health))
      .setTitle(char.name)
      .setDescription(`*${char.relation}${char.houses ? ` of ${char.houses.name}` : ""}*`)
      .addFields(
        { name: "⚔ Martial",      value: `${statBar(char.martial)} ${char.martial}`,       inline: true },
        { name: "🕊 Diplomacy",   value: `${statBar(char.diplomacy)} ${char.diplomacy}`,   inline: true },
        { name: "🗝 Intrigue",    value: `${statBar(char.intrigue)} ${char.intrigue}`,     inline: true },
        { name: "📜 Stewardship", value: `${statBar(char.stewardship)} ${char.stewardship}`, inline: true },
        { name: "📖 Learning",    value: `${statBar(char.learning)} ${char.learning}`,     inline: true },
        { name: "💰 Gold",        value: `${char.gold || 0} dragons`,                     inline: true },
        { name: "🏥 Health",      value: char.health,                                     inline: true },
        { name: "📍 Location",    value: char.location_id,                                inline: true },
        { name: "🎭 Traits",      value: (char.traits || []).join(", ") || "None",        inline: false },
      )
      .setFooter({ text: char.current_season || "250 AC" });

    if (char.appearance) embed.addFields({ name: "Appearance", value: char.appearance.slice(0, 200), inline: false });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // ── /map
  if (commandName === "map") {
    const { data: players } = await supabase
      .from("characters")
      .select("name, house_id, location_id, health, relation")
      .eq("is_dead", false)
      .order("created_at");

    const byLocation = {};
    (players || []).forEach(p => {
      if (!byLocation[p.location_id]) byLocation[p.location_id] = [];
      byLocation[p.location_id].push(p);
    });

    const embed = new EmbedBuilder()
      .setColor(0x8B6914)
      .setTitle("🗺 Westeros — 250 AC")
      .setDescription(`*${Object.values(byLocation).flat().length} souls abroad in the realm*`);

    Object.entries(byLocation).forEach(([loc, chars]) => {
      embed.addFields({
        name: `📍 ${loc.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}`,
        value: chars.map(c => `• **${c.name}** — ${c.relation} (${c.health})`).join("\n"),
        inline: true,
      });
    });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ── /world
  if (commandName === "world") {
    const { data: events } = await supabase
      .from("world_events")
      .select("title, description, character_name, location_id, created_at, type")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(10);

    const embed = new EmbedBuilder()
      .setColor(0x8B6914)
      .setTitle("📰 The Word from the Ravens — Recent Events");

    (events || []).forEach(e => {
      const icon = { death: "⚰️", combat: "⚔️", alliance: "🤝", world_event: "🌍", player_action: "📜" }[e.type] || "📜";
      embed.addFields({
        name: `${icon} ${e.title}`,
        value: e.description.slice(0, 200) + (e.character_name ? `\n*— ${e.character_name}*` : ""),
        inline: false,
      });
    });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ── /memories
  if (commandName === "memories") {
    const char = await getCharacter(user.id);
    if (!char) {
      await interaction.reply({ content: "❌ No character.", ephemeral: true });
      return;
    }

    const { data: memories } = await supabase
      .from("npc_memories")
      .select("npc_name, memory, disposition_change, created_at")
      .eq("character_id", char.id)
      .order("created_at", { ascending: false })
      .limit(15);

    if (!memories?.length) {
      await interaction.reply({ content: "No one remembers you yet.", ephemeral: true });
      return;
    }

    // Group by NPC
    const grouped = {};
    memories.forEach(m => {
      if (!grouped[m.npc_name]) grouped[m.npc_name] = [];
      grouped[m.npc_name].push(m);
    });

    const embed = new EmbedBuilder()
      .setColor(0x8B6914)
      .setTitle(`👁 What They Remember — ${char.name}`);

    Object.entries(grouped).forEach(([npc, mems]) => {
      const score = mems.reduce((sum, m) => sum + (m.disposition_change || 0), 0);
      const mood = score >= 3 ? "🟢 Friendly" : score <= -3 ? "🔴 Hostile" : score < 0 ? "🟡 Suspicious" : "⚪ Neutral";
      embed.addFields({
        name: `${npc} — ${mood}`,
        value: mems.map(m => `• ${m.memory}`).join("\n").slice(0, 400),
        inline: false,
      });
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
});

// ── MODAL SUBMIT: character creation ─────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit() || interaction.customId !== "create_char") return;

  await interaction.deferReply({ ephemeral: true });

  const name       = interaction.fields.getTextInputValue("name");
  const ageHouse   = interaction.fields.getTextInputValue("age_house");
  const relation   = interaction.fields.getTextInputValue("relation");
  const appearance = interaction.fields.getTextInputValue("appearance") || "";
  const backstory  = interaction.fields.getTextInputValue("backstory") || "";

  // Parse age and house
  const parts = ageHouse.split("/").map(s => s.trim());
  const age = parseInt(parts[0]) || 20;
  const houseRaw = (parts[1] || "no_house").toLowerCase().replace(/\s+/g, "_").replace("house_", "");
  const houseId = ["targaryen","stark","lannister","baratheon","tully","tyrell","martell","arryn","greyjoy"].includes(houseRaw)
    ? houseRaw : "no_house";

  // Check house slots
  if (houseId !== "no_house") {
    const { data: slotData } = await supabase
      .from("house_slot_counts")
      .select("available_slots")
      .eq("house_id", houseId)
      .single();

    if (slotData && slotData.available_slots <= 0) {
      await interaction.editReply({ content: `❌ No slots available in House ${houseRaw}. Choose another house.` });
      return;
    }
  }

  // Add house starting traits
  let traits = [];
  const { data: house } = await supabase.from("houses").select("starting_traits, seat, stat_bonus").eq("id", houseId).single();
  if (house?.starting_traits) traits = [...house.starting_traits];

  // Determine start location
  let startLoc = "kings_landing";
  if (house?.seat) {
    const { data: loc } = await supabase.from("locations").select("id").ilike("name", `%${house.seat}%`).single();
    if (loc) startLoc = loc.id;
  }

  // Stat bonus from house
  const bonus = house?.stat_bonus || {};

  const { data: char, error } = await supabase.from("characters").insert({
    discord_id: interaction.user.id,
    name, age, house_id: houseId, relation, appearance,
    backstory: backstory.slice(0, 1000),
    personality: backstory.slice(0, 200),
    traits,
    location_id: startLoc,
    martial: 3 + (bonus.martial || 0),
    diplomacy: 3 + (bonus.diplomacy || 0),
    intrigue: 3 + (bonus.intrigue || 0),
    stewardship: 3 + (bonus.stewardship || 0),
    learning: 3 + (bonus.learning || 0),
    message_history: [],
  }).select().single();

  if (error) {
    await interaction.editReply({ content: `❌ Error: ${error.message}` });
    return;
  }

  // Log to world events
  await supabase.from("world_events").insert({
    type: "player_action",
    title: `${name} enters the realm`,
    description: `${name}, ${relation}, has arrived in ${startLoc.replace(/_/g, " ")}.`,
    character_id: char.id,
    character_name: name,
    location_id: startLoc,
    season: "Early Spring, 250 AC",
    is_public: true,
  });

  const embed = new EmbedBuilder()
    .setColor(0x8B6914)
    .setTitle(`⚔ ${name} — Character Created`)
    .setDescription(`*${relation}${house ? ` · ${houseId.charAt(0).toUpperCase() + houseId.slice(1)}` : ""}*`)
    .addFields(
      { name: "Age", value: `${age}`, inline: true },
      { name: "Location", value: startLoc.replace(/_/g, " "), inline: true },
      { name: "Traits", value: traits.join(", ") || "None yet", inline: false },
    )
    .setFooter({ text: "Use /play to begin your story" });

  await interaction.editReply({ embeds: [embed] });
});

// ── START ─────────────────────────────────────────────────────

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.login(process.env.DISCORD_TOKEN);
