// frontend/src/lib/api.js
// All API calls go through here

import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function getMyCharacter() {
  const headers = await authHeaders();
  const res = await fetch(`${API}/characters/me`, { headers });
  if (!res.ok) return null;
  return res.json();
}

export async function createCharacter(data) {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const res = await fetch(`${API}/characters`, { method: "POST", headers, body: JSON.stringify(data) });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

export async function getAllCharacters() {
  const res = await fetch(`${API}/characters`);
  return res.json();
}

export async function startStory() {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const res = await fetch(`${API}/start`, { method: "POST", headers });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

export async function takeAction(action) {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const res = await fetch(`${API}/action`, {
    method: "POST", headers,
    body: JSON.stringify({ action }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

export async function getWorldEvents() {
  const res = await fetch(`${API}/world`);
  return res.json();
}

export async function getMyMemories(characterId) {
  const headers = await authHeaders();
  const res = await fetch(`${API}/memories/${characterId}`, { headers });
  return res.json();
}

export async function getHouseSlots() {
  const res = await fetch(`${API}/houses`);
  return res.json();
}

// Subscribe to world events (Supabase Realtime)
export function subscribeToWorld(callback) {
  return supabase
    .channel("world_events")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "world_events" }, callback)
    .subscribe();
}

// Subscribe to character changes (for other players moving on the map)
export function subscribeToCharacters(callback) {
  return supabase
    .channel("characters")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "characters" }, callback)
    .subscribe();
}
