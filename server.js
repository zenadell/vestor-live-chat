const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const db = require('./database');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Setup Multer Storage for File Sharing
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, ''));
    }
});
const upload = multer({ storage: storage });

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: process.env.SMTP_PORT || 465,
    secure: true,
    auth: {
        user: process.env.SMTP_USER || 'no-reply@vestor-globalpro.com',
        pass: process.env.SMTP_PASS || 'YOUR_PASSWORD_HERE'
    }
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@vestor-globalpro.com';

// API Route: File Upload Endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    // Construct public URL
    const fileUrl = `/widget/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, type: req.file.mimetype });
});

// API Route: Export Chat History
app.post('/api/export-chat', (req, res) => {
    const { visitor_id, email } = req.body;
    if (!visitor_id || !email) return res.status(400).json({ error: 'Missing visitor_id or email.' });

    // Fetch visitor details
    db.get('SELECT * FROM visitors WHERE id = ?', [visitor_id], (err, visitor) => {
        if (err || !visitor) return res.status(404).json({ error: 'Visitor not found.' });

        // Fetch messages
        db.all('SELECT * FROM messages WHERE visitor_id = ? ORDER BY created_at ASC', [visitor_id], (err, messages) => {
            if (err || !messages.length) return res.status(400).json({ error: 'No messages found.' });

            // Build HTML Transcript
            let htmlContent = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #4f46e5; color: white; padding: 20px; text-align: center;">
                    <h2 style="margin: 0;">Live Chat Transcript</h2>
                    <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">Session: ${visitor.id.substring(0, 8)}</p>
                </div>
                <div style="padding: 20px; background-color: #f9fafb;">`;

            messages.forEach(msg => {
                const date = new Date(msg.created_at).toLocaleString();
                const isAdmin = msg.sender === 'admin';
                const senderName = isAdmin ? 'Support Agent' : (visitor.name || 'Visitor');
                const align = isAdmin ? 'right' : 'left';
                const bg = isAdmin ? '#4f46e5' : '#ffffff';
                const color = isAdmin ? '#ffffff' : '#1f2937';
                const floatObj = isAdmin ? 'float: right;' : 'float: left;';

                let contentHtml = '';
                if (msg.type === 'file' && msg.file_url) {
                    contentHtml = `<p style="margin:0;"><a href="https://vestor-globalpro.com${msg.file_url}" style="color:${color};text-decoration:underline;">View Attachment</a></p>`;
                } else {
                    contentHtml = `<p style="margin:0;">${msg.message}</p>`;
                }

                htmlContent += `
                    <div style="margin-bottom: 20px; overflow: hidden;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px; text-align: ${align};">
                            <strong>${senderName}</strong> • ${date}
                        </div>
                        <div style="background-color: ${bg}; color: ${color}; padding: 12px 16px; border-radius: 12px; max-width: 75%; ${floatObj} border: ${isAdmin ? 'none' : '1px solid #e5e7eb'}; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            ${contentHtml}
                        </div>
                    </div><div style="clear:both;"></div>
                `;
            });

            htmlContent += `</div>
                <div style="background-color: #f3f4f6; color: #6b7280; text-align: center; padding: 15px; font-size: 12px;">
                    <p style="margin:0;">Thank you for contacting Vestor Global Pro Support.</p>
                </div>
            </div>`;

            const mailOptions = {
                from: process.env.SMTP_USER,
                to: email,
                subject: `Live Chat Transcript - Vestor Global Pro Support`,
                html: htmlContent
            };

            // Assuming transporter is available above
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error sending transcript:', error);
                    return res.status(500).json({ error: 'Failed to send email.' });
                }
                res.json({ success: true, message: 'Transcript sent successfully!' });
            });
        });
    });
});

// Serve static files for the embedded widget
app.use('/widget', express.static(path.join(__dirname, 'public')));
// Serve static files for the admin dashboard
app.use('/admin', express.static(path.join(__dirname, 'admin')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // For testing, allow all
        methods: ['GET', 'POST']
    }
});

// Keep track of connected sockets
const onlineUsers = new Map(); // socket.id => visitor_id
let isAdminOnline = false;
const lastAutoReply = new Map(); // visitor_id => timestamp

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Visitor connects and passes their unique UUID token
    socket.on('visitor_join', (data) => {
        const { visitor_id, url, title } = data;
        onlineUsers.set(socket.id, visitor_id);

        // Fetch or create visitor in DB
        db.get('SELECT * FROM visitors WHERE id = ?', [visitor_id], (err, row) => {
            if (!row) {
                const ip = socket.handshake.headers['x-forwarded-for'] || socket.request.connection.remoteAddress;
                const parseName = data.name || 'Visitor';
                const parseEmail = data.email || '';
                db.run('INSERT INTO visitors (id, name, email, ip_address, country, city) VALUES (?, ?, ?, ?, ?, ?)',
                    [visitor_id, parseName, parseEmail, ip, 'Unknown', 'Unknown']);
            } else {
                // If they provided name/email now but didn't before, update it
                if (data.name && row.name === 'Visitor') {
                    db.run('UPDATE visitors SET name = ?, email = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?', [data.name, data.email, visitor_id]);
                } else {
                    db.run('UPDATE visitors SET last_active = CURRENT_TIMESTAMP WHERE id = ?', [visitor_id]);
                }
            }

            // Notify admin
            io.emit('admin_visitor_list_update', { action: 'join', visitor_id });

            // Send chat history back to the visitor
            db.all('SELECT * FROM messages WHERE visitor_id = ? ORDER BY created_at ASC', [visitor_id], (err, rows) => {
                socket.emit('visitor_history', rows || []);
            });
        });
    });

    // Admin connects
    socket.on('admin_join', () => {
        isAdminOnline = true;
        console.log('Admin joined the chat.');

        // Send list of all unique visitors to admin
        db.all('SELECT * FROM visitors ORDER BY last_active DESC', [], (err, rows) => {
            socket.emit('admin_visitors_list', rows || []);
        });
    });

    // Handle messages from visitors
    socket.on('visitor_message', (data) => {
        const { visitor_id, message, type = 'text', file_url = null } = data;

        // Save to DB
        db.run('INSERT INTO messages (visitor_id, sender, type, message, file_url) VALUES (?, ?, ?, ?, ?)',
            [visitor_id, 'visitor', type, message, file_url], function (err) {

                const msgObj = { id: this.lastID, visitor_id, sender: 'visitor', type, message, file_url, created_at: new Date().toISOString() };

                // Forward to admin if online
                if (isAdminOnline) {
                    io.emit('admin_receive_message', msgObj);
                } else {
                    // Admin is offline, send an email alert
                    const mailOptions = {
                        from: process.env.SMTP_USER,
                        to: ADMIN_EMAIL,
                        subject: `New Live Chat Message from ${visitor_id.substring(0, 8)} `,
                        text: `You received a new message on the live chat: \n\n"${message}"\n\nLogin to the admin dashboard to reply.`
                    };
                    transporter.sendMail(mailOptions).catch(console.error);

                    // Auto-reply logic to not keep visitors waiting
                    const now = Date.now();
                    const lastReplyTime = lastAutoReply.get(visitor_id) || 0;
                    if (now - lastReplyTime > 5 * 60 * 1000) { // 5 minutes throttle
                        lastAutoReply.set(visitor_id, now);

                        // Show "Admin is typing..." indicator to the visitor first
                        io.emit('visitor_admin_typing', { visitor_id, is_typing: true });

                        setTimeout(() => {
                            const autoReplyMsg = "Thank you for reaching out! We are currently away, but we will reply to you as soon as possible.";
                            db.run('INSERT INTO messages (visitor_id, sender, type, message, file_url) VALUES (?, ?, ?, ?, ?)',
                                [visitor_id, 'admin', 'text', autoReplyMsg, null], function (err2) {
                                    const adminMsgObj = { id: this.lastID, visitor_id, sender: 'admin', type: 'text', message: autoReplyMsg, file_url: null, created_at: new Date().toISOString() };

                                    // Turn off typing indicator and send the auto-reply message
                                    io.emit('visitor_admin_typing', { visitor_id, is_typing: false });
                                    io.emit('visitor_receive_message', adminMsgObj);
                                });
                        }, 2500); // 2.5 seconds artificial delay
                    }
                }
            });
    });

    // Handle messages from Admin to a specific visitor
    socket.on('admin_message', (data) => {
        const { visitor_id, message, type = 'text', file_url = null } = data;

        db.run('INSERT INTO messages (visitor_id, sender, type, message, file_url) VALUES (?, ?, ?, ?, ?)',
            [visitor_id, 'admin', type, message, file_url], function (err) {

                const msgObj = { id: this.lastID, visitor_id, sender: 'admin', type, message, file_url, created_at: new Date().toISOString() };

                // Forward to the specific visitor's socket(s)
                // A more robust approach would track visitor_id to socket.ids array,
                // but for simplicity we broadcast and let the client filter by its ID.
                io.emit('visitor_receive_message', msgObj);
            });
    });

    // Handle fetching specific user history for admin
    socket.on('admin_get_history', (visitor_id) => {
        db.all('SELECT * FROM messages WHERE visitor_id = ? ORDER BY created_at ASC', [visitor_id], (err, rows) => {
            socket.emit('admin_receive_history', { visitor_id, messages: rows || [] });
        });
    });

    // Handle Typing Indicators
    socket.on('typing', (data) => {
        const { visitor_id, is_typing, sender } = data;
        if (sender === 'visitor' && isAdminOnline) {
            io.emit('admin_user_typing', { visitor_id, is_typing });
        } else if (sender === 'admin') {
            io.emit('visitor_admin_typing', { visitor_id, is_typing });
        }
    });

    // Handle Read Receipts
    socket.on('mark_read', (data) => {
        const { visitor_id, sender } = data; // sender who read it
        if (sender === 'admin') {
            db.run("UPDATE messages SET is_read = 1 WHERE visitor_id = ? AND sender = 'visitor'", [visitor_id]);
        } else if (sender === 'visitor') {
            db.run("UPDATE messages SET is_read = 1 WHERE visitor_id = ? AND sender = 'admin'", [visitor_id]);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id} `);
        const vId = onlineUsers.get(socket.id);
        if (vId) {
            onlineUsers.delete(socket.id);
            io.emit('admin_visitor_list_update', { action: 'leave', visitor_id: vId });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Live Chat Server running on http://localhost:${PORT}`);
});
