// 添加is_admin字段到现有数据库
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'users.db'));

try {
    // 检查is_admin字段是否已存在
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const hasAdminField = tableInfo.some(col => col.name === 'is_admin');
    
    if (!hasAdminField) {
        console.log('添加 is_admin 字段...');
        db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
        console.log('✅ is_admin 字段添加成功！');
    } else {
        console.log('is_admin 字段已存在');
    }
    
} catch (error) {
    console.error('迁移失败:', error);
} finally {
    db.close();
}
