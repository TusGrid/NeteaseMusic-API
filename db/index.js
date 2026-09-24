const { Pool } = require('pg')

let pool = null

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set')
    }

    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
    })

    pool.on('connect', () => {
      console.log('Database connected successfully')
    })

    pool.on('error', (err) => {
      console.error('Unexpected database error:', err)
      process.exit(-1)
    })
  }
  return pool
}

async function initDatabase() {
  const client = await getPool().connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) UNIQUE,
        nickname VARCHAR(100),
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        champion_id BIGINT,
        champion_name VARCHAR(200),
        champion_artist VARCHAR(200),
        champion_cover_url TEXT,
        total_songs INTEGER,
        total_rounds INTEGER,
        total_matches INTEGER,
        match_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS match_details (
        id SERIAL PRIMARY KEY,
        match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
        round_name VARCHAR(50),
        round_index INTEGER,
        song1_id BIGINT,
        song1_name VARCHAR(200),
        song1_artist VARCHAR(200),
        song1_cover_url TEXT,
        song2_id BIGINT,
        song2_name VARCHAR(200),
        song2_artist VARCHAR(200),
        song2_cover_url TEXT,
        winner_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS song_statistics (
        id SERIAL PRIMARY KEY,
        song_id BIGINT UNIQUE,
        song_name VARCHAR(200),
        artist VARCHAR(200),
        cover_url TEXT,
        total_matches INTEGER DEFAULT 0,
        total_wins INTEGER DEFAULT 0,
        win_rate NUMERIC(5, 2) DEFAULT 0,
        last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_matches_user_id ON matches(user_id);
      CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_match_details_match_id ON match_details(match_id);
      CREATE INDEX IF NOT EXISTS idx_song_statistics_song_id ON song_statistics(song_id);
      CREATE INDEX IF NOT EXISTS idx_song_statistics_win_rate ON song_statistics(win_rate DESC);
    `)
    console.log('Database tables initialized successfully')
  } catch (error) {
    console.error('Error initializing database:', error)
    throw error
  } finally {
    client.release()
  }
}

async function getOrCreateUser(userId, nickname, ipAddress) {
  const client = await getPool().connect()
  try {
    const result = await client.query(
      `INSERT INTO users (user_id, nickname, ip_address)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         nickname = EXCLUDED.nickname,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [userId, nickname, ipAddress]
    )
    return result.rows[0].id
  } finally {
    client.release()
  }
}

async function saveMatch(userId, matchData) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    const matchResult = await client.query(
      `INSERT INTO matches (
        user_id, champion_id, champion_name, champion_artist,
        champion_cover_url, total_songs, total_rounds, total_matches, match_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        userId,
        matchData.champion.id,
        matchData.champion.name,
        matchData.championArtist,
        matchData.championCoverUrl,
        matchData.totalSongs,
        matchData.totalRounds,
        matchData.totalMatches,
        JSON.stringify(matchData.rounds)
      ]
    )

    const matchId = matchResult.rows[0].id

    for (const round of matchData.rounds) {
      for (const match of round.matches) {
        if (!match.song1 || !match.song2) continue

        await client.query(
          `INSERT INTO match_details (
            match_id, round_name, round_index,
            song1_id, song1_name, song1_artist, song1_cover_url,
            song2_id, song2_name, song2_artist, song2_cover_url,
            winner_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            matchId,
            round.name,
            round.index,
            match.song1.id,
            match.song1.name,
            match.song1.artist,
            match.song1.coverUrl,
            match.song2.id,
            match.song2.name,
            match.song2.artist,
            match.song2.coverUrl,
            match.winner ? match.winner.id : null
          ]
        )

        await updateSongStatistics(match.song1, match.song2, match.winner)
      }
    }

    await client.query('COMMIT')
    return matchId
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error saving match:', error)
    throw error
  } finally {
    client.release()
  }
}

async function updateSongStatistics(song1, song2, winner) {
  const client = await getPool().connect()
  try {
    const songs = [song1, song2].filter(Boolean)

    for (const song of songs) {
      if (!song) continue

      await client.query(
        `INSERT INTO song_statistics (
          song_id, song_name, artist, cover_url,
          total_matches, total_wins, win_rate, last_played
        ) VALUES ($1, $2, $3, $4, 1, $5, $6, CURRENT_TIMESTAMP)
        ON CONFLICT (song_id) DO UPDATE SET
          song_name = EXCLUDED.song_name,
          artist = EXCLUDED.artist,
          cover_url = EXCLUDED.cover_url,
          total_matches = song_statistics.total_matches + 1,
          total_wins = song_statistics.total_wins + $5,
          win_rate = CASE
            WHEN (song_statistics.total_matches + 1) > 0
            THEN ROUND(((song_statistics.total_wins + $5)::numeric / (song_statistics.total_matches + 1)) * 100, 2)
            ELSE 0
          END,
          last_played = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP`,
        [
          song.id,
          song.name,
          song.artist,
          song.coverUrl,
          winner && winner.id === song.id ? 1 : 0,
          winner && winner.id === song.id
            ? ((song.totalWins || 0) + 1) / ((song.totalMatches || 0) + 1) * 100
            : 0
        ]
      )
    }
  } finally {
    client.release()
  }
}

async function getUserMatches(userId) {
  const client = await getPool().connect()
  try {
    const result = await client.query(
      `SELECT m.*, u.nickname
       FROM matches m
       JOIN users u ON m.user_id = u.id
       WHERE u.user_id = $1
       ORDER BY m.created_at DESC`,
      [userId]
    )
    return result.rows
  } finally {
    client.release()
  }
}

async function getSongLeaderboard(limit = 50) {
  const client = await getPool().connect()
  try {
    const result = await client.query(
      `SELECT * FROM song_statistics
       WHERE total_matches > 0
       ORDER BY win_rate DESC, total_wins DESC
       LIMIT $1`,
      [limit]
    )
    return result.rows
  } finally {
    client.release()
  }
}

async function getMatchHistory(page = 1, limit = 20) {
  const client = await getPool().connect()
  try {
    const offset = (page - 1) * limit
    const result = await client.query(
      `SELECT m.*, u.nickname
       FROM matches m
       JOIN users u ON m.user_id = u.id
       ORDER BY m.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    )
    return result.rows
  } finally {
    client.release()
  }
}

async function getSongDetail(songId) {
  const client = await getPool().connect()
  try {
    const result = await client.query(
      `SELECT * FROM song_statistics WHERE song_id = $1`,
      [songId]
    )
    return result.rows[0] || null
  } finally {
    client.release()
  }
}

async function getSongsStatistics(songIds) {
  const client = await getPool().connect()
  try {
    if (!songIds || songIds.length === 0) return []
    const placeholders = songIds.map((_, i) => `$${i + 1}`).join(',')
    const result = await client.query(
      `SELECT * FROM song_statistics WHERE song_id IN (${placeholders})`,
      songIds
    )
    return result.rows
  } finally {
    client.release()
  }
}

module.exports = {
  getPool,
  initDatabase,
  getOrCreateUser,
  saveMatch,
  getUserMatches,
  getSongLeaderboard,
  getMatchHistory,
  getSongDetail,
  getSongsStatistics,
}
