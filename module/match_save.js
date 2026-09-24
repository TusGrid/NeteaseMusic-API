const {
  getOrCreateUser,
  saveMatch,
  getUserMatches,
  getSongLeaderboard,
  getMatchHistory,
  getSongDetail,
  getSongsStatistics,
} = require('../db')

module.exports = async (query, request) => {
  const action = query.action || 'save'

  try {
    switch (action) {
      case 'save': {
        const ipAddress = query.ip || 'unknown'
        const userId = `ip_${ipAddress}`
        const nickname = query.nickname || '匿名用户'

        let matchData
        try {
          const rawMatchData = query.matchData || (query.cookie && query.cookie.matchData)

          if (!rawMatchData && query.body && typeof query.body === 'object') {
            matchData = query.body.matchData || query.body
          } else if (rawMatchData) {
            matchData = typeof rawMatchData === 'string'
              ? JSON.parse(rawMatchData)
              : rawMatchData
          } else {
            throw new Error('缺少比赛数据')
          }
        } catch (e) {
          return {
            status: 400,
            body: {
              code: 400,
              success: false,
              message: '比赛数据格式错误: ' + e.message,
            },
          }
        }

        if (!matchData.champion || !matchData.rounds) {
          return {
            status: 400,
            body: {
              code: 400,
              success: false,
              message: '比赛数据结构错误',
            },
          }
        }

        const dbUserId = await getOrCreateUser(userId, nickname, ipAddress)
        const matchId = await saveMatch(dbUserId, matchData)

        return {
          status: 200,
          body: {
            code: 200,
            success: true,
            matchId,
            message: '比赛记录保存成功',
          },
        }
      }

      case 'user_matches': {
        const ipAddress = query.ip || 'unknown'
        const userId = `ip_${ipAddress}`
        const matches = await getUserMatches(userId)

        return {
          status: 200,
          body: {
            code: 200,
            success: true,
            data: matches,
            count: matches.length,
          },
        }
      }

      case 'leaderboard': {
        const limit = parseInt(query.limit) || 50
        const leaderboard = await getSongLeaderboard(limit)

        return {
          status: 200,
          body: {
            code: 200,
            success: true,
            data: leaderboard,
            count: leaderboard.length,
          },
        }
      }

      case 'history': {
        const page = parseInt(query.page) || 1
        const limit = parseInt(query.limit) || 20
        const history = await getMatchHistory(page, limit)

        return {
          status: 200,
          body: {
            code: 200,
            success: true,
            data: history,
            page,
            limit,
          },
        }
      }

      case 'song_detail': {
        const songId = query.songId
        if (!songId) {
          return {
            status: 400,
            body: {
              code: 400,
              success: false,
              message: '缺少歌曲ID参数',
            },
          }
        }
        const detail = await getSongDetail(songId)

        return {
          status: 200,
          body: {
            code: 200,
            success: true,
            data: detail,
          },
        }
      }

      case 'songs_statistics': {
        const songIds = query.songIds ? query.songIds.split(',').map(id => parseInt(id)) : []
        if (songIds.length === 0) {
          return {
            status: 400,
            body: {
              code: 400,
              success: false,
              message: '缺少歌曲ID列表',
            },
          }
        }
        const statistics = await getSongsStatistics(songIds)

        return {
          status: 200,
          body: {
            code: 200,
            success: true,
            data: statistics,
            count: statistics.length,
          },
        }
      }

      default:
        return {
          status: 400,
          body: {
            code: 400,
            success: false,
            message: '无效的操作类型',
          },
        }
    }
  } catch (error) {
    console.error('Database API error:', error)
    return {
      status: 500,
      body: {
        code: 500,
        success: false,
        message: error.message || '服务器错误',
      },
    }
  }
}
