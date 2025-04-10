const { MongoClient } = require('mongodb')
const requestCheckHandler = require('../requestCheckHandler')
const {
	MONGO_URL,
	DB_NAME,
	ADMIN_CHAT_ID,
	LAMP_THREAD_ID,
	MONO_PITER_CHAT_ID,
} = require('../../config')

// Моки для MongoDB
jest.mock('mongodb', () => ({
	MongoClient: jest.fn().mockImplementation(() => ({
		connect: jest.fn().mockResolvedValue(),
		db: jest.fn().mockReturnValue({
			collection: jest.fn().mockReturnValue({
				find: jest.fn().mockReturnValue({
					toArray: jest.fn().mockResolvedValue([]),
				}),
				updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
			}),
		}),
	})),
}))

// Мок для Telegraf бота
const mockBot = {
	telegram: {
		getChatMember: jest.fn(),
		declineChatJoinRequest: jest.fn(),
		sendMessage: jest.fn(),
		banChatMember: jest.fn(),
		approveChatJoinRequest: jest.fn(),
	},
}

describe('requestCheckHandler', () => {
	beforeEach(() => {
		// Очищаем все моки перед каждым тестом
		jest.clearAllMocks()
	})

	describe('connectToDatabase', () => {
		it('should connect to MongoDB successfully', async () => {
			const db = await requestCheckHandler.connectToDatabase()
			expect(MongoClient).toHaveBeenCalledWith(MONGO_URL)
			expect(db).toBeDefined()
		})

		it('should handle connection error', async () => {
			MongoClient.mockImplementationOnce(() => ({
				connect: jest.fn().mockRejectedValue(new Error('Connection failed')),
			}))

			await expect(requestCheckHandler.connectToDatabase()).rejects.toThrow(
				'Connection failed'
			)
		})
	})

	describe('checkAndCancelExpiredRequests', () => {
		it('should handle empty expired requests', async () => {
			const result = await requestCheckHandler.checkAndCancelExpiredRequests(
				mockBot
			)
			expect(result).toEqual([])
		})

		it('should process expired requests correctly', async () => {
			// Настраиваем моки для теста с просроченными заявками
			const mockExpiredRequest = {
				_id: '123',
				userId: '456',
				status: 'pending',
				createdAt: new Date(Date.now() - 1000 * 60 * 60), // 1 час назад
				username: 'test_user',
			}

			// Мокаем MongoDB коллекцию
			const mockCollection = {
				find: jest.fn().mockReturnValue({
					toArray: jest.fn().mockResolvedValue([mockExpiredRequest]),
				}),
				updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
			}

			// Мокаем MongoDB db
			const mockDb = {
				collection: jest.fn().mockReturnValue(mockCollection),
			}

			// Мокаем MongoDB client
			MongoClient.mockImplementationOnce(() => ({
				connect: jest.fn().mockResolvedValue(),
				db: jest.fn().mockReturnValue(mockDb),
			}))

			// Настраиваем моки для Telegram API
			mockBot.telegram.getChatMember.mockResolvedValue({ status: 'left' })
			mockBot.telegram.declineChatJoinRequest.mockResolvedValue(true)
			mockBot.telegram.sendMessage.mockResolvedValue(true)

			// Подключаемся к базе данных
			await requestCheckHandler.connectToDatabase()

			const result = await requestCheckHandler.checkAndCancelExpiredRequests(
				mockBot
			)
			expect(result).toBeDefined()
			expect(mockBot.telegram.declineChatJoinRequest).toHaveBeenCalledWith(
				MONO_PITER_CHAT_ID,
				mockExpiredRequest.userId
			)
		})
	})

	describe('startRequestCheckTimer', () => {
		it('should start the timer correctly', () => {
			// Мокаем setInterval
			const mockSetInterval = jest.spyOn(global, 'setInterval')

			requestCheckHandler.startRequestCheckTimer(mockBot)

			expect(mockSetInterval).toHaveBeenCalled()
			expect(mockSetInterval).toHaveBeenCalledWith(
				expect.any(Function),
				expect.any(Number)
			)
		})
	})

	describe('stopRequestCheckTimer', () => {
		it('should stop the timer correctly', () => {
			// Мокаем clearInterval
			const mockClearInterval = jest.spyOn(global, 'clearInterval')

			// Сначала запускаем таймер
			requestCheckHandler.startRequestCheckTimer(mockBot)

			// Затем останавливаем
			requestCheckHandler.stopRequestCheckTimer()

			expect(mockClearInterval).toHaveBeenCalled()
		})
	})

	describe('handleBanButton', () => {
		it('should send confirmation message', async () => {
			const mockCtx = {
				callbackQuery: {
					data: 'ban_user:123',
				},
				reply: jest.fn(),
			}

			await requestCheckHandler.handleBanButton(mockCtx)
			expect(mockCtx.reply).toHaveBeenCalled()
		})
	})

	describe('handleConfirmBan', () => {
		it('should ban user successfully', async () => {
			const userId = '123'
			const mockCtx = {
				callbackQuery: {
					data: `confirm_ban:${userId}`,
				},
				from: {
					id: '456',
					first_name: 'Admin',
					last_name: 'User',
				},
				telegram: {
					getChatMember: jest.fn().mockResolvedValue({
						status: 'left',
						user: {
							first_name: 'Test',
							last_name: 'User',
						},
					}),
					banChatMember: jest.fn().mockResolvedValue(true),
					sendMessage: jest.fn().mockResolvedValue(true),
					declineChatJoinRequest: jest.fn().mockResolvedValue(true),
				},
				editMessageText: jest.fn(),
			}

			await requestCheckHandler.handleConfirmBan(mockCtx)

			expect(mockCtx.telegram.banChatMember).toHaveBeenCalledWith(
				MONO_PITER_CHAT_ID,
				userId
			)
			expect(mockCtx.telegram.declineChatJoinRequest).toHaveBeenCalledWith(
				MONO_PITER_CHAT_ID,
				userId
			)
			expect(mockCtx.editMessageText).toHaveBeenCalled()
		})
	})

	describe('handleAcceptButton', () => {
		it('should send confirmation message', async () => {
			const mockCtx = {
				callbackQuery: {
					data: 'accept_user:123',
				},
				reply: jest.fn(),
			}

			await requestCheckHandler.handleAcceptButton(mockCtx)
			expect(mockCtx.reply).toHaveBeenCalled()
		})
	})

	describe('handleConfirmAccept', () => {
		it('should accept user successfully', async () => {
			const mockCtx = {
				callbackQuery: {
					data: 'confirm_accept:123',
				},
				telegram: {
					approveChatJoinRequest: jest.fn().mockResolvedValue(true),
					sendMessage: jest.fn().mockResolvedValue(true),
				},
				editMessageText: jest.fn(),
			}

			await requestCheckHandler.handleConfirmAccept(mockCtx)
			expect(mockCtx.telegram.approveChatJoinRequest).toHaveBeenCalled()
		})
	})
})
