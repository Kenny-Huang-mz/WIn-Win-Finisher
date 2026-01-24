const db = require('./database');

console.log('\n========== 用户数据库 ==========\n');

// 查询所有用户
const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();

console.log(`总用户数: ${users.length}\n`);

// 格式化显示每个用户
users.forEach((user, index) => {
    console.log(`用户 #${index + 1}:`);
    console.log(`  ID:       ${user.id}`);
    console.log(`  姓名:     ${user.last_name}${user.first_name}`);
    console.log(`  邮箱:     ${user.email}`);
    console.log(`  密码哈希: ${user.password_hash.substring(0, 30)}...`);
    console.log(`  注册时间: ${new Date(user.created_at).toLocaleString('zh-CN')}`);
    console.log('');
});

console.log('===============================\n');

// 统计信息
const stats = db.prepare('SELECT COUNT(*) as total FROM users').get();
console.log(`📊 统计信息:`);
console.log(`   总用户数: ${stats.total}`);
console.log('');
