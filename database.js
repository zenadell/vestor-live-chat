const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'chat.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        // Define schemas
        db.serialize(() => {
            // Visitors table: tracks a unique user session by UUID
            db.run(`CREATE TABLE IF NOT EXISTS visitors (
                id TEXT PRIMARY KEY,
                name TEXT DEFAULT 'Visitor',
                email TEXT,
                ip_address TEXT,
                country TEXT,
                city TEXT,
                last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Messages table: stores chat history permanently
            db.run(`CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                visitor_id TEXT,
                sender TEXT, -- 'visitor' or 'admin'
                type TEXT DEFAULT 'text', -- 'text' or 'file'
                message TEXT,
                file_url TEXT,
                is_read BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (visitor_id) REFERENCES visitors (id)
            )`);
        });
    }
});

module.exports = db;
