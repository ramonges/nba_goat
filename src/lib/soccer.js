/**
 * Soccer GOAT Lab — Supabase helpers (mirrors src/lib/supabase.js for NBA).
 * Table: soccer_player_official
 */
import { supabase } from "./supabase";

export const SOCCER_TABLE = "soccer_player_official";

export const SOCCER_STAT_COLUMNS = {
  goals: "Goals",
  assists: "Assists",
  xg: "xG",
  xa: "xA",
  shots: "Shots",
  shots_on_target: "Shots on Target",
  dribbles: "Dribbles",
  dribble_pct: "Dribble %",
  touches: "Touches",
  touches_in_box: "Touches in Box",
  penalties: "Penalties",
  big_chances_missed: "Big Chances Missed",
  minutes: "Minutes",
  rating: "Rating",
};

export const SOCCER_PLAYER_COLORS = [
  "#4ab5e8",
  "#e05a6d",
  "#3fbf9b",
  "#f2c14e",
  "#b86ce0",
  "#e8894a",
  "#6c7ae0",
  "#7ac74f",
];

export async function fetchSoccerPlayerNames() {
  const names = new Set();
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(SOCCER_TABLE)
      .select("player_name")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) if (r.player_name) names.add(r.player_name);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export async function fetchSoccerPlayerData(playerName, competition) {
  const selectCols = [
    "player_name",
    "season",
    "game_date",
    "competition",
    "club",
    "opponent",
    "result",
    ...Object.keys(SOCCER_STAT_COLUMNS),
  ].join(", ");

  let allRows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabase
      .from(SOCCER_TABLE)
      .select(selectCols)
      .eq("player_name", playerName)
      .range(offset, offset + pageSize - 1);

    if (competition && competition !== "all") {
      query = query.eq("competition", competition);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    allRows = allRows.concat(rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return allRows;
}
