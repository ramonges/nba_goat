import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://uvjelfhbqtvlsglrvdas.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2amVsZmhicXR2bHNnbHJ2ZGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MTkyMzMsImV4cCI6MjA4NjM5NTIzM30.kbFNdjmDZfSnbokyjFs1HREKU--Afb6Bif3TrIh6I_s";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const TABLE_NAME = "NBA_PLAYERS_official";

export const STAT_COLUMNS = {
  points: "Points",
  rebounds: "Rebounds",
  assists: "Assists",
  steals: "Steals",
  blocks: "Blocks",
  field_goal_percentage: "FG%",
  three_point_percentage: "3P%",
  free_throw_percentage: "FT%",
  true_shooting_percentage: "TS%",
  minutes: "Minutes",
  plus_minus: "Plus / Minus",
  turnovers: "Turnovers",
  offensive_rebounds: "Off. Rebounds",
  defensive_rebounds: "Def. Rebounds",
  field_goals_made: "FG Made",
  field_goals_attempted: "FG Attempted",
  three_pointers_made: "3P Made",
  three_pointers_attempted: "3P Attempted",
  free_throws_made: "FT Made",
  free_throws_attempted: "FT Attempted",
  personal_fouls: "Personal Fouls",
};

export const PLAYER_COLORS = [
  "#4a7fff",
  "#e8364f",
  "#34d399",
  "#f59e42",
  "#a78bfa",
  "#fbbf24",
  "#38bdf8",
  "#fb7185",
  "#4ade80",
  "#f97316",
];

export async function fetchPlayerNames() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("player_name")
    .order("player_name");

  if (error) throw error;

  const unique = [...new Set(data.map((r) => r.player_name))];
  return unique.sort();
}

export async function fetchPlayerData(playerName, gameType) {
  const selectCols = [
    "player_name",
    "season",
    "game_date",
    "game_type",
    ...Object.keys(STAT_COLUMNS),
  ].join(", ");

  let allRows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabase
      .from(TABLE_NAME)
      .select(selectCols)
      .eq("player_name", playerName)
      .range(offset, offset + pageSize - 1);

    if (gameType && gameType !== "all") {
      query = query.eq("game_type", gameType);
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
