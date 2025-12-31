export interface Player {
  id: number
  name: string
  email: string
  phone: string
  position: string
  created_at: string
  total_goals_scored: number
  total_matches_played: number
  win_rate: number
}

export interface Match {
  id: number
  match_date: string
  team_blue_score: number
  team_orange_score: number
  winning_team: string
  duration_minutes: number
  blue_players: number[]
  orange_players: number[]
  orange_win_streak: number
}

export interface Sunday {
  id: number
  sunday_date: string
  status: 'scheduled' | 'in_progress' | 'completed'
  total_players: number
  created_at: string
}

export interface DashboardStats {
  total_players: number
  total_matches: number
  total_sundays: number
  avg_goals_per_match: number
}

export interface TeamSortingRequest {
  player_ids: number[]
}

export interface TeamSortingResponse {
  blue_team: number[]
  orange_team: number[]
  orange_win_streak: number
}