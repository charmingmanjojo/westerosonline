import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase, getMyCharacter, createCharacter, getAllCharacters,
  startStory, takeAction, getWorldEvents, getMyMemories,
  getHouseSlots, subscribeToWorld, subscribeToCharacters
} from "./lib/api.js";

// ── WORLD DATA ───────────────────────────────────────────────

const HOUSE_META = {
  targaryen: { color: "#c0392b", words: "Fire and Blood" },
  stark:     { color: "#7f8c8d", words: "Winter Is Coming" },
  lannister: { color: "#f39c12", words: "Hear Me Roar" },
  baratheon: { color: "#8e44ad", words: "Ours is the Fury" },
  tully:     { color: "#1a6891", words: "Family, Duty, Honour" },
  tyrell:    { color: "#27ae60", words: "Growing Strong" },
  martell:   { color: "#e67e22", words: "Unbowed, Unbent, Unbroken" },
  arryn:     { color: "#3498db", words: "As High as Honour" },
  greyjoy:   { color: "#2c3e50", words: "We Do Not Sow" },
  no_house:  { color: "#5d4037", words: "—" },
};

const LOCATIONS = [
  { id: "kings_landing",  name: "King's Landing",  x: 340, y: 380 },
  { id: "winterfell",     name: "Winterfell",       x: 310, y: 120 },
  { id: "casterly_rock",  name: "Casterly Rock",    x: 170, y: 310 },
  { id: "highgarden",     name: "Highgarden",       x: 220, y: 430 },
  { id: "storms_end",     name: "Storm's End",      x: 390, y: 470 },
  { id: "riverrun",       name: "Riverrun",         x: 250, y: 270 },
  { id: "dragonstone",    name: "Dragonstone",      x: 440, y: 350 },
  { id: "the_wall",       name: "The Wall",         x: 280, y: 60  },
  { id: "oldtown",        name: "Oldtown",          x: 180, y: 490 },
  { id: "the_eyrie",      name: "The Eyrie",        x: 420, y: 210 },
  { id: "sunspear",       name: "Sunspear",         x: 380, y: 540 },
  { id: "pyke",           name: "Pyke",             x: 100, y: 240 },
  { id: "harrenhal",      name: "Harrenhal",        x: 300, y: 300 },
  { id: "the_twins",      name: "The Twins",        x: 270, y: 230 },
];

const TRAITS_ALL = {
  positive: [
    { id: "just",         name: "Just",         desc: "Honourable NPCs trust you instantly.", stat: "diplomacy" },
    { id: "brave",        name: "Brave",        desc: "+2 combat rolls. You don't flee.",     stat: "martial"   },
    { id: "shrewd",       name: "Shrewd",       desc: "AI gives you extra context clues.",   stat: "intrigue"  },
    { id: "charming",     name: "Charming",     desc: "+1 all social rolls.",                 stat: "diplomacy" },
    { id: "scholar",      name: "Scholar",      desc: "+2 learning. People seek you out.",   stat: "learning"  },
    { id: "strategist",   name: "Strategist",   desc: "Battle planning at advantage.",        stat: "martial"   },
    { id: "patient",      name: "Patient",      desc: "Long-game options available to you.", stat: null        },
    { id: "diligent",     name: "Diligent",     desc: "+1 stewardship.",                      stat: "stewardship"},
    { id: "compassionate",name: "Compassionate",desc: "Smallfolk love you. Lords don't.",    stat: null        },
    { id: "zealous",      name: "Zealous",      desc: "Faith gives strength and blindspots.",stat: null        },
  ],
  negative: [
    { id: "wrathful",     name: "Wrathful",     desc: "Anger checks in tense scenes.",       stat: null  },
    { id: "greedy",       name: "Greedy",       desc: "Gold temptation checks.",              stat: null  },
    { id: "paranoid",     name: "Paranoid",     desc: "You see plots. Some are real.",        stat: null  },
    { id: "craven",       name: "Craven",       desc: "-2 combat. You can flee. You want to.",stat:"martial"},
    { id: "arbitrary",    name: "Arbitrary",    desc: "Unpredictable. Hard to trust.",        stat: null  },
    { id: "ambitious",    name: "Ambitious",    desc: "Ambition drives you to wrong rooms.",  stat: null  },
    { id: "lustful",      name: "Lustful",      desc: "Temptation checks. Blackmail risk.",  stat: null  },
    { id: "deceitful",    name: "Deceitful",    desc: "+2 intrigue, -1 diplomacy.",           stat:"intrigue"},
  ],
};

const STATS = [
  { key: "martial",     name: "Martial",     icon: "⚔" },
  { key: "diplomacy",   name: "Diplomacy",   icon: "🕊" },
  { key: "intrigue",    name: "Intrigue",    icon: "🗝" },
  { key: "stewardship", name: "Stewardship", icon: "📜" },
  { key: "learning",    name: "Learning",    icon: "📖" },
];

// ── SVG MAP ──────────────────────────────────────────────────

function WesterosMap({ myLocation, allPlayers }) {
  const byLoc = {};
  (allPlayers || []).forEach(p => {
    if (!byLoc[p.location_id]) byLoc[p.location_id] = [];
    byLoc[p.location_id].push(p);
  });

  return (
    <svg viewBox="0 0 600 580" style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <pattern id="grain" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.4" fill="rgba(180,140,60,0.05)"/>
          <circle cx="3" cy="3" r="0.4" fill="rgba(180,140,60,0.04)"/>
        </pattern>
      </defs>

      <rect width="600" height="580" fill="#080c16"/>
      {[...Array(14)].map((_,i)=><path key={i} d={`M ${i*46} 0 Q ${i*46+18} 290 ${i*46} 580`} stroke="rgba(15,35,75,0.4)" strokeWidth="0.5" fill="none"/>)}

      {/* Landmass */}
      <path d="M140,30 L200,20 L280,15 L350,25 L410,40 L450,70 L480,110 L490,150 L470,190 L490,220 L500,260 L480,300 L500,340 L510,380 L490,420 L460,460 L420,500 L380,530 L330,545 L280,540 L240,520 L200,500 L160,470 L130,440 L110,400 L100,360 L90,320 L95,280 L80,240 L85,200 L100,160 L110,120 L120,80 Z"
        fill="#191208" stroke="rgba(180,140,60,0.2)" strokeWidth="1.5"/>
      <rect width="600" height="580" fill="url(#grain)" opacity="0.6"/>

      {/* Region tints */}
      <path d="M140,30 L350,25 L410,40 L420,110 L340,140 L220,140 L130,110 L120,80 Z" fill="rgba(80,100,110,0.12)"/>
      <path d="M100,360 L200,340 L240,430 L200,500 L160,470 L130,440 L110,400 Z" fill="rgba(40,120,60,0.1)"/>
      <path d="M90,280 L170,260 L180,340 L110,360 L95,340 Z" fill="rgba(200,150,20,0.08)"/>
      <path d="M300,330 L390,330 L420,400 L360,440 L290,400 Z" fill="rgba(180,40,40,0.1)"/>

      {/* Rivers */}
      <path d="M255,215 Q242,270 218,320 Q200,355 190,400" stroke="rgba(50,110,180,0.3)" strokeWidth="1.5" fill="none"/>

      {/* Wall */}
      <path d="M118,113 L422,93" stroke="rgba(180,200,220,0.5)" strokeWidth="2" strokeDasharray="7,4"/>
      <text x="258" y="86" fill="rgba(180,200,220,0.35)" fontSize="8" fontFamily="serif" textAnchor="middle">THE WALL</text>

      {/* Location markers */}
      {LOCATIONS.map(loc => {
        const isMe = loc.id === myLocation;
        const here = byLoc[loc.id] || [];
        const houseColors = [...new Set(here.map(p => HOUSE_META[p.house_id]?.color || "#8B6914"))];
        return (
          <g key={loc.id}>
            {isMe && (
              <circle cx={loc.x} cy={loc.y} r="13" fill="none" stroke="rgba(212,168,83,0.4)" strokeWidth="1">
                <animate attributeName="r" values="9;16;9" dur="2.2s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.8;0.1;0.8" dur="2.2s" repeatCount="indefinite"/>
              </circle>
            )}
            <circle cx={loc.x} cy={loc.y} r={isMe ? 5 : 4}
              fill={isMe ? "#d4a853" : "rgba(160,120,50,0.7)"}
              stroke={isMe ? "#f0c060" : "rgba(100,75,25,0.9)"}
              strokeWidth="1"
              filter={isMe ? "url(#glow)" : "none"}/>
            {here.length > 0 && here.map((p, pi) => (
              <circle key={pi} cx={loc.x + 7 + pi * 5} cy={loc.y - 7}
                r="3.5" fill={HOUSE_META[p.house_id]?.color || "#8B6914"}
                stroke="rgba(0,0,0,0.6)" strokeWidth="0.5" title={p.name}/>
            ))}
            <text x={loc.x} y={loc.y + 14} fill="rgba(160,130,55,0.6)" fontSize="7.5"
              fontFamily="IM Fell English,serif" textAnchor="middle">{loc.name}</text>
          </g>
        );
      })}

      <g transform="translate(558,28)">
        <text fill="rgba(160,130,55,0.35)" fontSize="9" fontFamily="serif" textAnchor="middle" x="0" y="-10">N</text>
        <path d="M0,-8 L3,4 L0,2 L-3,4 Z" fill="rgba(160,130,55,0.35)"/>
      </g>
      <text x="10" y="572" fill="rgba(90,70,30,0.35)" fontSize="7" fontFamily="serif">WESTEROS · 250 AC</text>
    </svg>
  );
}

// ── DICE ROLL DISPLAY ────────────────────────────────────────

function DiceRoll({ stat, rolls, bonus, difficulty, result }) {
  const total = (rolls || []).reduce((a, b) => a + b, 0) + (bonus || 0);
  const success = total >= difficulty;
  return (
    <div style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${success ? "rgba(100,180,60,0.35)" : "rgba(180,60,40,0.35)"}`, padding: "10px 14px", marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "rgba(180,140,60,0.5)", letterSpacing: "0.2em", marginBottom: 6, textTransform: "uppercase" }}>{stat} Check — DC {difficulty}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: result ? 6 : 0 }}>
        {(rolls || []).map((r, i) => (
          <div key={i} style={{ width: 28, height: 28, border: "1px solid rgba(180,140,60,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "#c9b483", fontSize: 14, fontWeight: "bold" }}>{r}</div>
        ))}
        {bonus !== 0 && <span style={{ color: "rgba(180,140,60,0.5)", fontSize: 13 }}>{bonus > 0 ? `+${bonus}` : bonus}</span>}
        <span style={{ color: "rgba(180,140,60,0.4)", fontSize: 13, margin: "0 2px" }}>=</span>
        <span style={{ fontSize: 20, fontWeight: "bold", color: success ? "#7aaa60" : "#c04030" }}>{total}</span>
        <span style={{ fontSize: 12, color: success ? "rgba(120,180,80,0.7)" : "rgba(180,80,60,0.7)", marginLeft: 6 }}>
          {success ? "✓ Success" : "✗ Failure"}
        </span>
      </div>
      {result && <div style={{ fontSize: 13, fontStyle: "italic", color: "rgba(150,120,70,0.8)" }}>{result}</div>}
    </div>
  );
}

// ── STYLES ───────────────────────────────────────────────────

const css = `
@import url('https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=Cinzel:wght@400;600&display=swap');

*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#09070404;--s:rgba(255,255,255,0.025);--b:rgba(180,140,60,0.18);
  --gold:#d4a853;--g2:#f0c060;--dim:#7a6040;--dim2:#4a3520;--tx:#bfaa7e;
  --red:#bf3a2b;--green:#7aaa60;
}
body{background:#09070a;color:var(--tx);font-family:'IM Fell English',Georgia,serif;min-height:100vh}

/* ── AUTH SCREEN ── */
.auth-screen{
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 40% 40%,rgba(50,30,8,0.5),transparent 65%),
             radial-gradient(ellipse at 70% 70%,rgba(30,15,5,0.5),transparent 65%), #09070a;
}
.auth-box{max-width:400px;width:100%;padding:0 24px;text-align:center}
.auth-title{font-family:'Cinzel',serif;font-size:38px;color:var(--gold);margin-bottom:6px;text-shadow:0 0 40px rgba(180,120,30,0.3)}
.auth-sub{font-size:14px;font-style:italic;color:var(--dim2);margin-bottom:48px;line-height:1.6}
.auth-btn{
  width:100%;padding:13px;background:transparent;border:1px solid rgba(180,140,60,0.35);
  color:var(--gold);font-family:'Cinzel',serif;font-size:12px;letter-spacing:0.2em;
  text-transform:uppercase;cursor:pointer;transition:all 0.25s;margin-bottom:10px;
}
.auth-btn:hover{background:rgba(180,140,60,0.08);border-color:var(--gold)}
.auth-btn.discord{border-color:rgba(88,101,242,0.4);color:#8892f0}
.auth-btn.discord:hover{background:rgba(88,101,242,0.08);border-color:#8892f0}
.auth-input{
  width:100%;background:rgba(255,255,255,0.03);border:none;
  border-bottom:1px solid rgba(180,140,60,0.3);color:var(--tx);
  font-family:'IM Fell English',serif;font-size:16px;padding:10px 2px;
  outline:none;margin-bottom:12px;transition:border-color 0.2s;
}
.auth-input:focus{border-bottom-color:var(--gold)}
.auth-input::placeholder{color:rgba(60,45,25,0.8)}

/* ── LAYOUT ── */
.app-shell{display:grid;grid-template-rows:42px 1fr 32px;height:100vh;overflow:hidden}
.top-bar{
  display:flex;justify-content:space-between;align-items:center;
  padding:0 18px;border-bottom:1px solid var(--b);background:rgba(0,0,0,0.5);flex-shrink:0;
}
.top-title{font-family:'Cinzel',serif;font-size:14px;color:var(--gold);letter-spacing:0.18em}
.top-meta{font-size:11px;font-style:italic;color:var(--dim2)}
.top-health{font-family:'IM Fell English SC',serif;font-size:10px;padding:2px 8px;border:1px solid;letter-spacing:0.12em}
.h-Hale{color:var(--green);border-color:rgba(120,180,80,0.3)}
.h-Wounded{color:#c09030;border-color:rgba(180,140,60,0.3)}
.h-Grievously{color:var(--red);border-color:rgba(180,60,40,0.3)}
.h-Dead{color:#666;border-color:rgba(80,80,80,0.25)}

.main-grid{display:grid;grid-template-columns:260px 1fr 256px;overflow:hidden}

/* ── LEFT PANEL ── */
.left-panel{
  border-right:1px solid var(--b);display:flex;flex-direction:column;
  overflow:hidden;background:rgba(0,0,0,0.25);
}
.panel-label{font-family:'IM Fell English SC',serif;font-size:10px;letter-spacing:0.25em;color:var(--dim2);text-transform:uppercase;display:block}
.char-block{padding:12px 14px;border-bottom:1px solid rgba(100,80,40,0.12)}
.char-name{font-family:'Cinzel',serif;font-size:16px;color:var(--gold);line-height:1.2}
.char-house{font-size:11px;font-style:italic;color:var(--dim2);margin-top:2px}
.char-pos{font-size:11px;color:rgba(140,110,60,0.55);margin-top:1px}
.stat-list{padding:10px 14px;display:flex;flex-direction:column;gap:5px}
.stat-row{display:grid;grid-template-columns:68px 1fr 22px;align-items:center;gap:6px}
.stat-label{font-size:11px;color:var(--dim)}
.stat-track{height:3px;background:rgba(100,80,40,0.18);border-radius:2px}
.stat-fill{height:3px;background:linear-gradient(90deg,var(--gold),var(--g2));border-radius:2px}
.stat-num{font-size:11px;color:var(--gold);text-align:right}
.trait-strip{display:flex;flex-wrap:wrap;gap:3px;padding:6px 14px 8px}
.trait-pip{font-size:9px;padding:2px 6px;border:1px solid rgba(180,140,60,0.18);color:var(--dim2);background:rgba(180,140,60,0.04)}
.trait-pip.neg{border-color:rgba(180,60,40,0.18);color:rgba(150,80,60,0.7);background:rgba(180,60,40,0.04)}
.map-wrap{flex:1;min-height:0;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.map-box{flex:1;min-height:0;background:rgba(0,0,0,0.4);border:1px solid rgba(100,80,40,0.18)}

/* ── CENTER PANEL ── */
.center-panel{display:flex;flex-direction:column;overflow:hidden}
.narrative-scroll{flex:1;overflow-y:auto;padding:20px 22px}
.history-entry{margin-bottom:24px;opacity:0.38}
.history-choice{font-family:'IM Fell English SC',serif;font-size:10px;letter-spacing:0.18em;color:var(--dim2);margin-bottom:8px;display:block}
.history-choice::before{content:"↳ "}
.scene-text{font-size:16px;line-height:1.85;color:var(--tx)}
.scene-text p{margin-bottom:1em}
.scene-text p:first-child::first-letter{font-family:'Cinzel',serif;font-size:42px;float:left;line-height:0.85;margin:4px 6px -4px 0;color:var(--gold)}
.scene-sep{border:none;border-top:1px solid rgba(100,80,40,0.1);margin:20px 0}

/* ── CHOICES ── */
.choices-bar{
  border-top:1px solid var(--b);padding:12px 18px 14px;
  flex-shrink:0;background:rgba(0,0,0,0.35);
}
.choices-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.choices-lbl{font-family:'IM Fell English SC',serif;font-size:10px;letter-spacing:0.25em;color:var(--dim2);text-transform:uppercase}
.custom-link{font-size:11px;font-style:italic;color:rgba(110,85,45,0.55);cursor:pointer;background:transparent;border:none;font-family:inherit;text-decoration:underline;text-underline-offset:2px}
.custom-link:hover{color:var(--dim)}
.choices-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.choice-btn{
  background:transparent;border:1px solid rgba(180,140,60,0.13);border-left:2px solid rgba(180,140,60,0.18);
  color:rgba(130,105,60,0.75);font-family:'IM Fell English',Georgia,serif;font-size:13px;font-style:italic;
  padding:8px 11px;cursor:pointer;text-align:left;transition:all 0.2s;line-height:1.4;
}
.choice-btn:hover:not(:disabled){border-left-color:var(--gold);color:var(--tx);background:rgba(180,140,60,0.04);padding-left:14px}
.choice-btn:disabled{opacity:0.28;cursor:not-allowed}
.custom-row{display:flex;gap:7px;margin-top:5px}
.custom-ta{
  flex:1;background:rgba(255,255,255,0.025);border:1px solid rgba(180,140,60,0.18);
  border-bottom-color:rgba(180,140,60,0.45);color:var(--tx);font-family:'IM Fell English',serif;
  font-size:14px;padding:8px 10px;outline:none;resize:none;
}
.custom-ta:focus{border-bottom-color:var(--gold)}
.act-btn{
  background:transparent;border:1px solid rgba(180,140,60,0.28);color:var(--gold);
  font-family:'IM Fell English SC',serif;font-size:10px;letter-spacing:0.2em;
  padding:8px 13px;cursor:pointer;align-self:flex-end;transition:all 0.2s;flex-shrink:0;
}
.act-btn:hover:not(:disabled){background:rgba(180,140,60,0.07);border-color:var(--gold)}
.act-btn:disabled{opacity:0.25;cursor:not-allowed}

/* ── RIGHT PANEL ── */
.right-panel{border-left:1px solid var(--b);display:flex;flex-direction:column;overflow:hidden;background:rgba(0,0,0,0.25)}
.r-section{padding:10px 13px;border-bottom:1px solid rgba(100,80,40,0.1);flex-shrink:0}
.world-item{font-size:12px;font-style:italic;color:rgba(95,75,38,0.65);padding:5px 0;border-bottom:1px solid rgba(100,80,40,0.07);line-height:1.4}
.world-item:last-child{border:none}
.world-item.fresh{color:rgba(155,125,58,0.85)}
.npc-scroll{flex:1;overflow-y:auto;padding:0 13px 12px}
.npc-card{padding:9px 0;border-bottom:1px solid rgba(100,80,40,0.08)}
.npc-name{font-size:13px;color:var(--gold);margin-bottom:2px}
.npc-mem{font-size:11px;font-style:italic;color:rgba(95,75,38,0.6);line-height:1.4}
.npc-mem::before{content:"· "}

/* ── LOADING ── */
.loading{display:flex;align-items:center;gap:7px;color:var(--dim2);font-style:italic;font-size:14px;padding:14px 0}
.dot{animation:dp 1.4s ease-in-out infinite;opacity:0}
.dot:nth-child(2){animation-delay:.2s}
.dot:nth-child(3){animation-delay:.4s}
@keyframes dp{0%,80%,100%{opacity:0}40%{opacity:1}}

/* ── BOTTOM TICKER ── */
.ticker{
  border-top:1px solid rgba(180,140,60,0.12);padding:0 16px;
  font-family:'IM Fell English',serif;font-size:12px;font-style:italic;
  color:rgba(95,75,38,0.6);display:flex;align-items:center;gap:10px;
  background:rgba(0,0,0,0.45);flex-shrink:0;
}
.ticker-lbl{font-family:'IM Fell English SC',serif;font-size:9px;letter-spacing:0.2em;color:var(--gold);flex-shrink:0;text-transform:uppercase}

/* ── CREATION ── */
.creation-wrap{
  position:fixed;inset:0;overflow-y:auto;z-index:100;
  background:radial-gradient(ellipse at 35% 35%,#1a0e06,transparent 60%),#09070a;
}
.creation-inner{max-width:740px;margin:0 auto;padding:44px 22px 80px}
.cr-title{font-family:'Cinzel',serif;font-size:10px;letter-spacing:0.35em;color:var(--dim2);text-transform:uppercase;margin-bottom:5px}
.cr-h1{font-family:'Cinzel',serif;font-size:32px;color:var(--gold);margin-bottom:5px}
.cr-sub{font-size:14px;font-style:italic;color:var(--dim2);margin-bottom:40px;line-height:1.6}
.cr-step{margin-bottom:32px}
.cr-lbl{font-family:'IM Fell English SC',serif;font-size:10px;letter-spacing:0.25em;color:var(--dim2);text-transform:uppercase;margin-bottom:10px;display:block}
.cr-input{
  width:100%;background:rgba(255,255,255,0.02);border:none;
  border-bottom:1px solid rgba(180,140,60,0.28);color:var(--tx);
  font-family:'IM Fell English',serif;font-size:19px;padding:7px 0;outline:none;
}
.cr-input:focus{border-bottom-color:var(--gold)}
.cr-input::placeholder{color:rgba(55,40,20,0.8)}
.cr-input.sm{font-size:14px}
.cr-ta{
  width:100%;background:rgba(255,255,255,0.02);border:1px solid rgba(180,140,60,0.12);
  color:var(--tx);font-family:'IM Fell English',serif;font-size:13px;padding:9px 11px;
  outline:none;resize:vertical;min-height:72px;line-height:1.6;
}
.cr-ta:focus{border-color:rgba(180,140,60,0.35)}
.cr-ta::placeholder{color:rgba(55,40,20,0.8);font-style:italic}
.house-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}
.house-card{
  background:rgba(255,255,255,0.02);border:1px solid rgba(100,80,40,0.18);
  padding:11px 9px;cursor:pointer;transition:all 0.18s;
}
.house-card:hover{background:rgba(180,140,60,0.04);border-color:rgba(180,140,60,0.28)}
.house-card.sel{background:rgba(180,140,60,0.07);border-color:rgba(180,140,60,0.5)}
.house-card.full{opacity:0.35;cursor:not-allowed;pointer-events:none}
.h-dot{width:9px;height:9px;border-radius:50%;margin-bottom:5px}
.h-name{font-size:11px;color:var(--tx);margin-bottom:2px;line-height:1.2}
.h-words{font-size:9px;font-style:italic;color:var(--dim2);margin-bottom:3px}
.h-slots{font-size:8px;color:rgba(100,80,40,0.45);letter-spacing:0.08em}
.cr-select{
  width:100%;background:rgba(255,255,255,0.02);border:1px solid rgba(180,140,60,0.18);
  color:var(--tx);font-family:'IM Fell English',serif;font-size:14px;padding:8px 10px;outline:none;
}
.cr-select option{background:#140e06}

/* Stat allocation */
.stat-alloc{display:flex;flex-direction:column;gap:9px}
.sa-row{display:grid;grid-template-columns:80px 1fr 80px;align-items:center;gap:10px}
.sa-name{font-size:12px;color:var(--dim)}
.sa-controls{display:flex;align-items:center;gap:7px}
.sa-bar{flex:1;height:5px;background:rgba(100,80,40,0.18);border-radius:2px;overflow:hidden}
.sa-fill{height:100%;background:linear-gradient(90deg,var(--gold),var(--g2));border-radius:2px;transition:width 0.2s}
.sa-btn{
  width:20px;height:20px;background:transparent;border:1px solid rgba(180,140,60,0.22);
  color:var(--dim);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;
  transition:all 0.15s;flex-shrink:0;
}
.sa-btn:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.sa-btn:disabled{opacity:0.18;cursor:not-allowed}
.sa-val{font-size:15px;color:var(--gold);text-align:center;min-width:18px}
.sa-desc{font-size:10px;font-style:italic;color:var(--dim2)}
.pool-left{font-family:'IM Fell English SC',serif;font-size:11px;letter-spacing:0.14em;color:var(--dim);padding:6px 0}
.pool-left span{color:var(--gold);font-size:14px}

/* Trait selector */
.trait-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:10px}
.trc-lbl{font-family:'IM Fell English SC',serif;font-size:9px;letter-spacing:0.2em;color:var(--dim2);text-transform:uppercase;margin-bottom:7px;display:block}
.trait-opt{
  display:flex;align-items:flex-start;gap:7px;padding:7px;
  border:1px solid rgba(100,80,40,0.13);cursor:pointer;transition:all 0.18s;margin-bottom:3px;
}
.trait-opt:hover{background:rgba(180,140,60,0.03);border-color:rgba(180,140,60,0.22)}
.trait-opt.sel{background:rgba(180,140,60,0.07);border-color:rgba(180,140,60,0.4)}
.trait-opt.sel.neg{background:rgba(180,60,40,0.06);border-color:rgba(180,60,40,0.28)}
.tcheck{width:13px;height:13px;border:1px solid rgba(180,140,60,0.28);flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center}
.tcheck.on{background:var(--gold);border-color:var(--gold)}
.tcheck.on::after{content:"✓";font-size:8px;color:#1a0e06}
.tcheck.neg.on{background:var(--red);border-color:var(--red)}
.t-name{font-size:12px;color:var(--tx);margin-bottom:2px}
.t-desc{font-size:10px;font-style:italic;color:var(--dim2);line-height:1.35}

.begin-btn{
  width:100%;background:transparent;border:1px solid rgba(180,140,60,0.38);
  color:var(--gold);font-family:'Cinzel',serif;font-size:11px;letter-spacing:0.2em;
  padding:13px;cursor:pointer;transition:all 0.28s;margin-top:6px;text-transform:uppercase;
}
.begin-btn:hover:not(:disabled){background:rgba(180,140,60,0.07);border-color:var(--gold)}
.begin-btn:disabled{opacity:0.2;cursor:not-allowed}

/* ── DEATH ── */
.death-overlay{position:fixed;inset:0;background:rgba(4,2,0,0.97);display:flex;align-items:center;justify-content:center;z-index:200}
.death-box{max-width:520px;padding:52px 28px;text-align:center}
.d-orn{font-size:24px;color:rgba(70,50,20,0.4);letter-spacing:0.3em;margin-bottom:24px}
.d-cap{font-family:'IM Fell English SC',serif;font-size:10px;letter-spacing:0.3em;color:rgba(70,50,20,0.55);text-transform:uppercase;margin-bottom:14px}
.d-name{font-family:'Cinzel',serif;font-size:28px;color:rgba(110,90,50,0.65);margin-bottom:18px}
.d-prose{font-size:14px;line-height:1.8;color:rgba(90,70,40,0.65);font-style:italic;text-align:left;margin-bottom:28px}
.d-prose p{margin-bottom:0.85em}
.d-epi{font-family:'IM Fell English SC',serif;font-size:12px;color:rgba(70,50,20,0.45);border:1px solid rgba(70,50,20,0.14);padding:14px 18px;margin-bottom:32px}
.d-restart{background:transparent;border:1px solid rgba(90,70,30,0.22);color:rgba(110,90,50,0.55);font-family:'Cinzel',serif;font-size:10px;letter-spacing:0.2em;padding:10px 26px;cursor:pointer;transition:all 0.28s;text-transform:uppercase}
.d-restart:hover{border-color:rgba(180,140,60,0.35);color:var(--dim)}

/* ── TOAST ── */
.toast{position:fixed;bottom:52px;right:14px;background:rgba(7,5,1,0.97);border:1px solid rgba(180,140,60,0.22);padding:9px 13px;max-width:240px;z-index:300;animation:tIn 0.28s ease}
.toast-lbl{font-family:'IM Fell English SC',serif;font-size:9px;letter-spacing:0.17em;color:rgba(180,140,60,0.48);margin-bottom:3px;text-transform:uppercase}
.toast-txt{font-size:12px;font-style:italic;color:rgba(110,88,45,0.75);line-height:1.4}
@keyframes tIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}
@keyframes fi{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.fi{animation:fi 0.5s ease forwards}

::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(180,140,60,0.13)}
`;

// ── MAIN APP ─────────────────────────────────────────────────

export default function App() {
  const [session, setSession]     = useState(null);
  const [authMode, setAuthMode]   = useState("login"); // login | signup
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [screen, setScreen]       = useState("loading"); // loading | creation | game | dead
  const [char, setChar]           = useState(null);
  const [houseSlots, setHouseSlots] = useState([]);

  // Creation form
  const [form, setForm] = useState({
    name: "", age: "20", house: "", relation: "", gender: "",
    appearance: "", backstory: "", personality: "",
    stats: { martial: 3, diplomacy: 3, intrigue: 3, stewardship: 3, learning: 3 },
    traits: new Set(),
  });

  // Game state
  const [history, setHistory]     = useState([]);
  const [current, setCurrent]     = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);
  const [worldEvents, setWorldEvents] = useState([]);
  const [npcMemories, setNpcMemories] = useState({});
  const [loading, setLoading]     = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");
  const [pendingChoices, setPendingChoices] = useState([]);
  const [toast, setToast]         = useState(null);
  const [tickerIdx, setTickerIdx] = useState(0);

  const bottomRef = useRef(null);

  // ── AUTH ──────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadGame(session);
      else setScreen("auth");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadGame(s);
      else setScreen("auth");
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleAuth(e) {
    e.preventDefault();
    setAuthLoading(true); setAuthError("");
    const fn = authMode === "signup" ? supabase.auth.signUp : supabase.auth.signInWithPassword;
    const { error } = await fn({ email, password });
    if (error) setAuthError(error.message);
    setAuthLoading(false);
  }

  // ── LOAD GAME ─────────────────────────────────────────────

  async function loadGame() {
    const [charData, slots, events, players] = await Promise.all([
      getMyCharacter(),
      getHouseSlots(),
      getWorldEvents(),
      getAllCharacters(),
    ]);

    setHouseSlots(slots || []);
    setWorldEvents((events || []).slice(0, 8));
    setAllPlayers(players || []);

    if (!charData) {
      setScreen("creation");
      return;
    }

    setChar(charData);

    if (charData.is_dead) {
      setCurrent({ narrative: charData.death_summary || "Your story ended.", choices: [], status: { isDead: true, health: "Dead", summary: charData.death_summary } });
      setScreen("dead");
      return;
    }

    // Load memories
    const mems = await getMyMemories(charData.id);
    const grouped = {};
    (mems || []).forEach(m => {
      if (!grouped[m.npc_name]) grouped[m.npc_name] = [];
      grouped[m.npc_name].push(m.memory);
    });
    setNpcMemories(grouped);

    // If no story yet, show start state
    if (!charData.message_history?.length) {
      setCurrent(null);
      setScreen("game");
    } else {
      // Extract last assistant message as current
      const msgs = charData.message_history;
      const lastAssistant = [...msgs].reverse().find(m => m.role === "assistant");
      if (lastAssistant) {
        const { parseGMResponse } = await import("./lib/gm.js").catch(() => ({ parseGMResponse: null }));
        // Inline mini-parser for display
        const narrativeRaw = lastAssistant.content.match(/<narrative>([\s\S]*?)<\/narrative>/)?.[1]?.trim() || "";
        const choicesRaw = lastAssistant.content.match(/<choices>([\s\S]*?)<\/choices>/)?.[1]?.trim() || "[]";
        const statusRaw = lastAssistant.content.match(/<status>([\s\S]*?)<\/status>/)?.[1]?.trim() || "{}";
        let choices = []; try { choices = JSON.parse(choicesRaw); } catch {}
        let status = {}; try { status = JSON.parse(statusRaw); } catch {}
        const narrative = narrativeRaw.replace(/\{[^}]+\}/g, "").trim();
        setCurrent({ narrative, choices, status });
        setPendingChoices(choices);
      }
      setScreen("game");
    }

    // Subscribe to realtime
    subscribeToWorld(payload => {
      const e = payload.new;
      setWorldEvents(prev => [e, ...prev.slice(0, 7)]);
    });
    subscribeToCharacters(payload => {
      setAllPlayers(prev => prev.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p));
    });
  }

  // ── CREATION ──────────────────────────────────────────────

  const statTotal = Object.values(form.stats).reduce((a, b) => a + b, 0);
  const statRemaining = 30 - statTotal;

  function setStat(key, val) {
    if (val < 1 || val > 10) return;
    const delta = val - form.stats[key];
    if (delta > 0 && statRemaining <= 0) return;
    setForm(f => ({ ...f, stats: { ...f.stats, [key]: val } }));
  }

  function toggleTrait(id) {
    setForm(f => {
      const t = new Set(f.traits);
      t.has(id) ? t.delete(id) : t.add(id);
      return { ...f, traits: t };
    });
  }

  const houseRelations = {
    targaryen: ["Son of the King","Daughter of the King","Prince (Cousin)","Princess (Cousin)","Bastard of Dragonstone","Legitimised Bastard"],
    stark:     ["Son of the Lord","Daughter of the Lord","Ward of Winterfell","Bastard Snow","Cousin of Winterfell","Knight of the North"],
    lannister: ["Son of the Lord","Daughter of the Lord","Cousin of the Rock","Bastard Hill","Lannister Ward","Bannerman's Heir"],
    baratheon: ["Son of the Lord","Daughter of the Lord","Cousin of Storm's End","Bastard Storm","Ward of the Stormlands"],
    tully:     ["Son of the Lord","Daughter of the Lord","Cousin of Riverrun","Bastard Rivers","Ward of the Trident"],
    tyrell:    ["Son of the Lord","Daughter of the Lord","Cousin of Highgarden","Bastard Flowers","Ward of the Reach"],
    martell:   ["Son of the Prince","Daughter of the Prince","Bastard Sand","Cousin of Sunspear","Ward of Dorne"],
    arryn:     ["Son of the Lord","Daughter of the Lord","Ward of the Eyrie","Bastard Stone","Cousin of the Vale"],
    greyjoy:   ["Son of the Lord","Daughter of the Lord","Bastard Pyke","Cousin of Pyke","Reaved Ward"],
    no_house:  ["Hedge Knight","Minor Lord's Heir","Wandering Septon","Craftsman's Child","Sellsword","Bastard of Unknown Blood"],
  };

  async function submitCreation() {
    if (!form.name || !form.house || !form.relation) return;
    setLoading(true);
    try {
      const char = await createCharacter({
        name: form.name, age: parseInt(form.age) || 20,
        house_id: form.house, relation: form.relation, gender: form.gender,
        appearance: form.appearance, backstory: form.backstory, personality: form.personality,
        martial: form.stats.martial, diplomacy: form.stats.diplomacy,
        intrigue: form.stats.intrigue, stewardship: form.stats.stewardship,
        learning: form.stats.learning,
        traits: [...form.traits],
      });
      setChar(char);
      setScreen("game");
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  }

  // ── GAME ACTIONS ──────────────────────────────────────────

  async function begin() {
    setLoading(true);
    try {
      const result = await startStory();
      setCurrent(result);
      setPendingChoices(result.choices || []);
    } catch (e) { alert(e.message); }
    setLoading(false);
  }

  async function act(text) {
    if (!text.trim() || loading) return;
    setLoading(true);
    setCustomText(""); setCustomMode(false);
    if (current) setHistory(h => [...h, { narrative: current.narrative, choiceMade: text, rolls: current.rolls }]);

    try {
      const result = await takeAction(text);
      setCurrent(result);
      setPendingChoices(result.choices || []);

      // NPC memories
      (result.memories || []).forEach(m => {
        setNpcMemories(prev => ({ ...prev, [m.npc]: [...(prev[m.npc] || []), m.memory].slice(-5) }));
        setToast({ npc: m.npc, memory: m.memory });
        setTimeout(() => setToast(null), 5000);
      });

      // Update world events
      if (result.worldEvent) {
        setWorldEvents(prev => [{
          title: result.worldEvent.title,
          description: result.worldEvent.description,
          created_at: new Date().toISOString(),
        }, ...prev.slice(0, 7)]);
      }

      if (result.status?.isDead) setScreen("dead");
    } catch (e) { alert(e.message); }

    setLoading(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  function restart() {
    setChar(null); setHistory([]); setCurrent(null); setNpcMemories({}); setPendingChoices([]);
    setForm({ name:"",age:"20",house:"",relation:"",gender:"",appearance:"",backstory:"",personality:"",stats:{martial:3,diplomacy:3,intrigue:3,stewardship:3,learning:3},traits:new Set() });
    setScreen("creation");
  }

  // Ticker
  useEffect(() => {
    const t = setInterval(() => setTickerIdx(i => (i + 1) % Math.max(worldEvents.length, 1)), 6000);
    return () => clearInterval(t);
  }, [worldEvents.length]);

  const houseM = char?.house_id ? HOUSE_META[char.house_id] : null;
  const healthClass = (current?.status?.health || char?.health || "Hale").replace(/\s/g, "");
  const negIds = new Set(TRAITS_ALL.negative.map(t => t.id));
  const charTraits = (char?.traits || []).map(id => {
    const all = [...TRAITS_ALL.positive, ...TRAITS_ALL.negative];
    return all.find(t => t.id === id) || { id, name: id };
  });

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════

  if (screen === "loading") return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "rgba(120,100,60,0.4)", fontStyle: "italic" }}>Loading...</div>;

  return (
    <>
      <style>{css}</style>

      {/* ── AUTH ── */}
      {screen === "auth" && (
        <div className="auth-screen">
          <div className="auth-box">
            <div className="auth-title">WESTEROS</div>
            <div className="auth-sub">250 AC · The Reign of Jaehaerys I<br/>A multiplayer chronicle of consequence</div>
            <form onSubmit={handleAuth}>
              <input className="auth-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required/>
              <input className="auth-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required/>
              {authError && <div style={{ color: "rgba(180,60,40,0.7)", fontSize: 12, fontStyle: "italic", marginBottom: 10 }}>{authError}</div>}
              <button className="auth-btn" type="submit" disabled={authLoading}>
                {authLoading ? "..." : authMode === "login" ? "Enter the Realm" : "Create Account"}
              </button>
            </form>
            <button className="auth-btn" style={{ fontSize: 12, opacity: 0.6, border: "none" }}
              onClick={() => setAuthMode(m => m === "login" ? "signup" : "login")}>
              {authMode === "login" ? "No account? Sign up" : "Have an account? Log in"}
            </button>
          </div>
        </div>
      )}

      {/* ── CREATION ── */}
      {screen === "creation" && (
        <div className="creation-wrap">
          <div className="creation-inner">
            <div className="cr-title">Westeros · 250 AC</div>
            <div className="cr-h1">Your Character</div>
            <div className="cr-sub">You are not the hero. You are a person.<br/>The world was here before you. It will be here after.</div>

            <div className="cr-step">
              <span className="cr-lbl">Name</span>
              <input className="cr-input" placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="cr-step">
                <span className="cr-lbl">Age</span>
                <input className="cr-input sm" placeholder="20" value={form.age} onChange={e => setForm(f => ({ ...f, age: e.target.value }))}/>
              </div>
              <div className="cr-step">
                <span className="cr-lbl">Gender</span>
                <input className="cr-input sm" placeholder="Optional" value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}/>
              </div>
            </div>

            <div className="cr-step">
              <span className="cr-lbl">House</span>
              <div className="house-grid">
                {Object.entries(HOUSE_META).map(([key, h]) => {
                  const slot = houseSlots.find(s => s.house_id === key);
                  const available = slot ? slot.available_slots : 8;
                  const full = available <= 0;
                  return (
                    <div key={key} className={`house-card ${form.house === key ? "sel" : ""} ${full ? "full" : ""}`}
                      onClick={() => !full && setForm(f => ({ ...f, house: key, relation: "" }))}>
                      <div className="h-dot" style={{ background: h.color }}/>
                      <div className="h-name">{key === "no_house" ? "No House" : key.charAt(0).toUpperCase() + key.slice(1)}</div>
                      <div className="h-words">{h.words}</div>
                      <div className="h-slots">{full ? "FULL" : `${available} open`}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {form.house && (
              <div className="cr-step">
                <span className="cr-lbl">Your Position</span>
                <select className="cr-select" value={form.relation} onChange={e => setForm(f => ({ ...f, relation: e.target.value }))}>
                  <option value="">Select...</option>
                  {(houseRelations[form.house] || []).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            )}

            <div className="cr-step">
              <span className="cr-lbl">Appearance</span>
              <textarea className="cr-ta" rows={2} placeholder="Describe how you look. What people notice. What they remember." value={form.appearance} onChange={e => setForm(f => ({ ...f, appearance: e.target.value }))}/>
            </div>

            <div className="cr-step">
              <span className="cr-lbl">Backstory</span>
              <textarea className="cr-ta" rows={4} placeholder="Who were you before the story begins. What happened. What drives you. What do you fear." value={form.backstory} onChange={e => setForm(f => ({ ...f, backstory: e.target.value }))}/>
            </div>

            <div className="cr-step">
              <span className="cr-lbl">Personality</span>
              <textarea className="cr-ta" rows={2} placeholder="How you move through the world. How you speak. What you hide." value={form.personality} onChange={e => setForm(f => ({ ...f, personality: e.target.value }))}/>
            </div>

            <div className="cr-step">
              <span className="cr-lbl">Attributes — {statRemaining} points remaining</span>
              <div className="pool-left">Pool: <span>{statRemaining}</span> / 15</div>
              <div className="stat-alloc">
                {STATS.map(s => (
                  <div key={s.key} className="sa-row">
                    <span className="sa-name">{s.icon} {s.name}</span>
                    <div className="sa-controls">
                      <button className="sa-btn" onClick={() => setStat(s.key, form.stats[s.key] - 1)} disabled={form.stats[s.key] <= 1}>−</button>
                      <div className="sa-bar"><div className="sa-fill" style={{ width: `${(form.stats[s.key] / 10) * 100}%` }}/></div>
                      <button className="sa-btn" onClick={() => setStat(s.key, form.stats[s.key] + 1)} disabled={statRemaining <= 0 || form.stats[s.key] >= 10}>+</button>
                      <span className="sa-val">{form.stats[s.key]}</span>
                    </div>
                    <span className="sa-desc">{s.key.charAt(0).toUpperCase() + s.key.slice(1)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="cr-step">
              <span className="cr-lbl">Traits</span>
              <div className="trait-cols">
                <div>
                  <span className="trc-lbl">Virtues</span>
                  {TRAITS_ALL.positive.map(t => (
                    <div key={t.id} className={`trait-opt ${form.traits.has(t.id) ? "sel" : ""}`} onClick={() => toggleTrait(t.id)}>
                      <div className={`tcheck ${form.traits.has(t.id) ? "on" : ""}`}/>
                      <div><div className="t-name">{t.name}</div><div className="t-desc">{t.desc}</div></div>
                    </div>
                  ))}
                </div>
                <div>
                  <span className="trc-lbl">Flaws — grants bonus options</span>
                  {TRAITS_ALL.negative.map(t => (
                    <div key={t.id} className={`trait-opt ${form.traits.has(t.id) ? "sel neg" : ""}`} onClick={() => toggleTrait(t.id)}>
                      <div className={`tcheck neg ${form.traits.has(t.id) ? "on" : ""}`}/>
                      <div><div className="t-name">{t.name}</div><div className="t-desc">{t.desc}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button className="begin-btn" disabled={!form.name || !form.house || !form.relation || loading} onClick={submitCreation}>
              {loading ? "Creating..." : "Enter the Realm — 250 AC"}
            </button>
          </div>
        </div>
      )}

      {/* ── GAME ── */}
      {(screen === "game" || screen === "dead") && char && (
        <div className="app-shell">
          <div className="top-bar">
            <div className="top-title">WESTEROS</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {current?.status?.health && <span className={`top-health h-${healthClass}`}>{current.status.health}</span>}
              {current?.status?.location && <span style={{ fontSize: 11, fontStyle: "italic", color: "rgba(90,70,35,0.55)" }}>{current.status.location}</span>}
            </div>
            <div className="top-meta">250 AC · {char.name}</div>
          </div>

          <div className="main-grid">
            {/* LEFT */}
            <div className="left-panel">
              <div className="char-block">
                <div className="char-name">{char.name}</div>
                <div className="char-house">{houseM ? `House ${char.house_id.charAt(0).toUpperCase() + char.house_id.slice(1)}` : "No House"}</div>
                <div className="char-pos">{char.relation}</div>
              </div>
              <div className="stat-list">
                {STATS.map(s => (
                  <div key={s.key} className="stat-row">
                    <span className="stat-label">{s.icon} {s.name}</span>
                    <div className="stat-track"><div className="stat-fill" style={{ width: `${(char[s.key] / 10) * 100}%` }}/></div>
                    <span className="stat-num">{char[s.key]}</span>
                  </div>
                ))}
              </div>
              <div className="trait-strip">
                {charTraits.map(t => (
                  <span key={t.id} className={`trait-pip ${negIds.has(t.id) ? "neg" : ""}`}>{t.name}</span>
                ))}
              </div>
              <div className="map-wrap">
                <span className="panel-label">The Realm</span>
                <div className="map-box">
                  <WesterosMap myLocation={char.location_id} allPlayers={allPlayers}/>
                </div>
              </div>
            </div>

            {/* CENTER */}
            <div className="center-panel">
              <div className="narrative-scroll">
                {current?.status?.summary && (
                  <div style={{ fontSize: 13, fontStyle: "italic", color: "rgba(80,63,35,0.65)", marginBottom: 20, paddingBottom: 14, borderBottom: "1px solid rgba(100,80,40,0.1)" }}>{current.status.summary}</div>
                )}

                {history.map((h, i) => (
                  <div key={i} className="history-entry">
                    <span className="history-choice">{h.choiceMade}</span>
                    {(h.rolls || []).map((r, ri) => <DiceRoll key={ri} {...r}/>)}
                    <div className="scene-text">
                      {h.narrative.split("\n\n").filter(Boolean).map((p, pi) => <p key={pi}>{p}</p>)}
                    </div>
                    <hr className="scene-sep"/>
                  </div>
                ))}

                {current && (
                  <div className="fi" key={history.length}>
                    {(current.rolls || []).map((r, ri) => <DiceRoll key={ri} {...r}/>)}
                    <div className="scene-text">
                      {current.narrative.split("\n\n").filter(Boolean).map((p, pi) => <p key={pi}>{p}</p>)}
                    </div>
                  </div>
                )}

                {!current && !loading && screen === "game" && (
                  <div style={{ padding: "40px 0", textAlign: "center" }}>
                    <button className="begin-btn" style={{ maxWidth: 300 }} onClick={begin}>Begin Your Story</button>
                  </div>
                )}

                {loading && (
                  <div className="loading">
                    <span>The maester writes</span>
                    <span className="dot">.</span><span className="dot">.</span><span className="dot">.</span>
                  </div>
                )}
                <div ref={bottomRef}/>
              </div>

              {!loading && current?.choices?.length > 0 && screen === "game" && (
                <div className="choices-bar">
                  <div className="choices-top">
                    <span className="choices-lbl">What do you do?</span>
                    <button className="custom-link" onClick={() => setCustomMode(m => !m)}>
                      {customMode ? "use generated choices" : "write your own action"}
                    </button>
                  </div>
                  {!customMode ? (
                    <div className="choices-grid">
                      {current.choices.map((c, i) => (
                        <button key={i} className="choice-btn" onClick={() => act(c)} disabled={loading}>{c}</button>
                      ))}
                    </div>
                  ) : (
                    <div className="custom-row">
                      <textarea className="custom-ta" rows={2}
                        placeholder="Describe exactly what you do. Be specific. This is your action."
                        value={customText} onChange={e => setCustomText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); act(customText); }}}/>
                      <button className="act-btn" onClick={() => act(customText)} disabled={loading || !customText.trim()}>ACT</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT */}
            <div className="right-panel">
              <div className="r-section">
                <span className="panel-label" style={{ marginBottom: 8, display: "block" }}>World Events</span>
                {worldEvents.slice(0, 5).map((e, i) => (
                  <div key={i} className={`world-item ${i === 0 ? "fresh" : ""}`}>
                    {e.title || e.description?.slice(0, 80)}
                  </div>
                ))}
              </div>
              <div style={{ padding: "8px 13px 6px", flexShrink: 0 }}>
                <span className="panel-label">Known Persons</span>
              </div>
              <div className="npc-scroll">
                {Object.keys(npcMemories).length === 0 && (
                  <div style={{ fontSize: 11, fontStyle: "italic", color: "rgba(70,55,28,0.4)", paddingTop: 4 }}>No one of note yet.</div>
                )}
                {Object.entries(npcMemories).map(([npc, mems]) => (
                  <div key={npc} className="npc-card">
                    <div className="npc-name">{npc}</div>
                    {mems.map((m, i) => <div key={i} className="npc-mem">{m}</div>)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ticker">
            <span className="ticker-lbl">Realm</span>
            <span>{worldEvents[tickerIdx]?.title || worldEvents[tickerIdx]?.description?.slice(0, 100) || "All is quiet in the realm."}</span>
          </div>
        </div>
      )}

      {/* ── DEATH ── */}
      {screen === "dead" && (
        <div className="death-overlay">
          <div className="death-box">
            <div className="d-orn">— ✦ —</div>
            <div className="d-cap">Here Ends the Account of</div>
            <div className="d-name">{char?.name}</div>
            <div className="d-prose">
              {(current?.narrative || "").split("\n\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
            </div>
            {current?.status?.summary && <div className="d-epi">{current.status.summary}</div>}
            <button className="d-restart" onClick={restart}>Begin Again</button>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div className="toast">
          <div className="toast-lbl">{toast.npc} will remember this</div>
          <div className="toast-txt">{toast.memory}</div>
        </div>
      )}
    </>
  );
}
