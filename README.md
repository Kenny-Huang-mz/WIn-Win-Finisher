# 代代共荣 Generation Co-prosperity

## 项目介绍
这是一个跨代共融的非牟利组织官方网站，包含会员注册、登录系统及邮箱验证功能。

## 技术栈
- **前端**: HTML5 + Tailwind CSS + Vanilla JavaScript
- **后端**: Node.js + Express
- **邮件服务**: Nodemailer

## 功能特性
✅ 响应式设计，适配桌面端和移动端  
✅ 会员注册与登录系统  
✅ **邮箱验证码功能**（5位数字，2分钟有效期）  
✅ 倒计时重发功能  
✅ 用户数据本地存储（JSON 文件）

---

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 启动后端服务器
```bash
node server.js
```
服务器将运行在 `http://localhost:3000`

### 3. 启动前端服务器
在另一个终端窗口运行：
```bash
python3 -m http.server 8080
```
或使用任何你喜欢的静态文件服务器。

### 4. 访问网站
打开浏览器访问：`http://localhost:8080`

---

## 验证码功能使用流程

### 用户注册流程：
1. 点击 **"會員註冊"**
2. 填写姓氏、名字、电子邮件
3. 点击 **"發送驗證碼"** 按钮
4. 查看终端控制台获取验证码（开发环境）
5. 在 **"驗證碼"** 输入框中输入5位数字
6. 设定密码后点击 **"創建帳戶"**

### 验证码规则：
- ✅ 5位数字随机生成
- ✅ 有效期为 **2分钟**
- ✅ 每个邮箱同一时间只能有一个有效验证码
- ✅ 使用后自动失效
- ⏱️ 倒计时期间不可重复发送（120秒）

---

## 配置真实邮件发送（可选）

目前验证码通过**控制台打印**方便开发测试。如需真实发送邮件，请按以下步骤操作：

### 步骤 1：获取邮箱 SMTP 配置

#### 使用 Gmail
1. 登录 Google 账户
2. 开启「两步骤验证」
3. 生成「应用程序密码」（16位）
4. 记录下该密码

#### 使用 QQ 邮箱
1. 登录 QQ 邮箱设置
2. 开启 POP3/SMTP 服务
3. 获取授权码

### 步骤 2：修改 server.js

在 `server.js` 中找到以下注释部分并取消注释：

```javascript
// 取消下面这段的注释
const transporter = nodemailer.createTransport({
    service: 'gmail', // 或 'qq'
    auth: {
        user: 'your-email@gmail.com',  // 替换成你的邮箱
        pass: 'your-app-password'       // 替换成应用密码
    }
});
```

然后在 `/api/send-verification-code` 路由中：
```javascript
// 取消这段的注释
transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        console.error('邮件发送失败:', error);
        return res.status(500).json({ success: false, message: '驗證碼發送失敗' });
    }
    res.json({ success: true, message: '驗證碼已發送到您的郵箱' });
});
```

并**注释掉**临时的返回语句：
```javascript
// 注释掉这一行
// res.json({ success: true, message: '驗證碼已發送（請查看控制台）' });
```

### 步骤 3：重启服务器
```bash
# 按 Ctrl+C 停止服务器
node server.js
```

---

## 文件结构
```
Generation Co-prosperity/
├── index.html          # 前端页面
├── server.js           # 后端 API 服务器
├── users.json          # 用户数据存储（自动生成）
├── package.json        # Node.js 依赖配置
└── README.md           # 项目说明文档
```

---

## 安全提示
⚠️ **当前密码以明文存储，仅供演示使用**  
⚠️ 生产环境必须使用 `bcrypt` 等加密库对密码进行哈希处理  
⚠️ 建议使用真实数据库（如 MongoDB、PostgreSQL）替代 JSON 文件

---

## 后续扩展建议
- [ ] 集成真实数据库
- [ ] 密码加密存储（bcrypt）
- [ ] JWT Token 验证
- [ ] 邮箱验证后才能启用账号
- [ ] 忘记密码功能
- [ ] 用户个人资料管理

---

## 联系方式
如有问题或建议，欢迎联系开发团队。

© 2025 Generation Co-prosperity Limited. All Rights Reserved.
