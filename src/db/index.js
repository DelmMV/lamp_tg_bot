/**
 * Модуль для работы с базой данных
 * @module db
 */

const { MongoClient, ObjectId } = require('mongodb');
const { MONGO_URL, DB_NAME, ADMIN_CHAT_ID, LAMP_THREAD_ID } = require('../config');

/** @type {import('mongodb').Db} */
let db = null;

/**
 * Устанавливает соединение с базой данных
 * @async
 * @returns {Promise<import('mongodb').Db>} Экземпляр подключения к БД
 * @throws {Error} Ошибка подключения к БД
 */
async function connectToDatabase() {
  try {
    // Удалены устаревшие опции useNewUrlParser и useUnifiedTopology
    // Эти опции включены по умолчанию начиная с MongoDB Driver 4.0.0
    const client = new MongoClient(MONGO_URL);
    
    await client.connect();
    db = client.db(DB_NAME);
    console.log("Connected to MongoDB");
    return db;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

/**
 * Удаляет комментарий по ID
 * @async
 * @param {string} commentId - ID комментария для удаления
 * @returns {Promise<{success: boolean, message: string}>} Результат операции
 */
async function deleteComment(commentId) {
  try {
    const commentsCollection = db.collection('comments');
    const result = await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });
    
    return {
      success: result.deletedCount === 1,
      message: result.deletedCount === 1
        ? `Комментарий с ID ${commentId} успешно удален.`
        : `Комментарий с ID ${commentId} не найден.`
    };
  } catch (error) {
    console.error('Error deleting comment:', error);
    return {
      success: false,
      message: 'Произошла ошибка при удалении комментария.'
    };
  }
}

/**
 * Обновляет статус запроса на вступление с дополнительными данными
 * @async
 * @param {string} userId - ID пользователя
 * @param {string} status - Новый статус запроса
 * @param {Object} additionalData - Дополнительные данные для сохранения
 * @returns {Promise<boolean>} - Результат операции
 */
async function updateJoinRequestStatusWithData(userId, status, additionalData = {}) {
  try {
    const joinRequestsCollection = db.collection('joinRequests');
    const result = await joinRequestsCollection.updateOne(
      { userId: parseInt(userId, 10) },
      { 
        $set: { 
          status: status,
          updatedAt: new Date(),
          ...additionalData
        } 
      },
      { sort: { createdAt: -1 } }
    );
    
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error updating join request status with data:', error);
    return false;
  }
}

/**
 * Закрывает соединение с базой данных
 * @async
 * @returns {Promise<void>}
 */
async function closeDatabase() {
  if (db) {
    try {
      const client = db.client;
      await client.close();
      console.log("Disconnected from MongoDB");
    } catch (error) {
      console.error("Error closing MongoDB connection:", error);
    }
  }
}

/**
 * Сохраняет информацию о запросе на вступление в чат
 * @async
 * @param {Object} requestData - Данные запроса на вступление
 * @returns {Promise<string>} - ID созданной записи
 */
async function saveJoinRequest(requestData) {
  try {
    const joinRequestsCollection = db.collection('joinRequests');
    const result = await joinRequestsCollection.insertOne({
      ...requestData,
      status: 'pending',
      createdAt: new Date(),
      replies: []
    });
    
    return result.insertedId.toString();
  } catch (error) {
    console.error('Error saving join request:', error);
    throw error;
  }
}

/**
 * Обновляет статус запроса на вступление
 * @async
 * @param {string} userId - ID пользователя
 * @param {string} status - Новый статус запроса
 * @returns {Promise<boolean>} - Результат операции
 */
async function updateJoinRequestStatus(userId, status) {
  try {
    const joinRequestsCollection = db.collection('joinRequests');
    const result = await joinRequestsCollection.updateOne(
      { userId: parseInt(userId, 10) },
      { 
        $set: { 
          status: status,
          updatedAt: new Date()
        } 
      },
      { sort: { createdAt: -1 } }
    );
    
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error updating join request status:', error);
    return false;
  }
}

/**
 * Добавляет сообщение в историю диалога с пользователем
 * @async
 * @param {string} userId - ID пользователя
 * @param {string} message - Текст сообщения
 * @param {string} sender - Отправитель (admin или user)
 * @returns {Promise<boolean>} - Результат операции
 */
async function addMessageToJoinRequest(userId, message, sender) {
  try {
    const joinRequestsCollection = db.collection('joinRequests');
    const result = await joinRequestsCollection.updateOne(
      { userId: parseInt(userId, 10) },
      { 
        $push: { 
          replies: {
            message,
            sender,
            timestamp: new Date()
          }
        } 
      },
      { sort: { createdAt: -1 } }
    );
    
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error adding message to join request:', error);
    return false;
  }
}

/**
 * Получает информацию о запросе на вступление по ID пользователя
 * @async
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object|null>} - Данные о запросе или null
 */
async function getJoinRequestByUserId(userId) {
  try {
    const joinRequestsCollection = db.collection('joinRequests');
    return await joinRequestsCollection.findOne(
      { userId: parseInt(userId, 10) },
      { sort: { createdAt: -1 } }
    );
  } catch (error) {
    console.error('Error getting join request:', error);
    return null;
  }
}

module.exports = {
  connectToDatabase,
  closeDatabase,
  deleteComment,
  saveJoinRequest, 
  updateJoinRequestStatus, 
  addMessageToJoinRequest, 
  getJoinRequestByUserId,
  updateJoinRequestStatusWithData,
  getDb: () => db
};