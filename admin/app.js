const socket = io();

// UI Elements
const visitorList = document.getElementById('visitor-list');
const emptyState = document.getElementById('empty-state');
const chatHeader = document.getElementById('chat-header');
const chatMessages = document.getElementById('chat-messages');
const chatInputArea = document.getElementById('chat-input-area');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const fileInput = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const typingIndicator = document.getElementById('typing-indicator');
const readReceipt = document.getElementById('admin-read-receipt');
const exportChatBtn = document.getElementById('export-chat-btn');
const connectionStatus = document.getElementById('connection-status');
const notificationSound = document.getElementById('notification-sound');

let selectedVisitorId = null;
let visitors = new Map(); // Store visitor details

// Join as admin
socket.emit('admin_join');

socket.on('connect', () => {
    connectionStatus.innerHTML = '<span class="w-2.5 h-2.5 bg-green-500 rounded-full mr-2"></span> Online';
});

socket.on('disconnect', () => {
    connectionStatus.innerHTML = '<span class="w-2.5 h-2.5 bg-red-500 rounded-full mr-2"></span> Offline';
});

// Receive full visitor list
socket.on('admin_visitors_list', (visitorData) => {
    visitorList.innerHTML = '';
    visitors.clear();
    visitorData.forEach(v => {
        visitors.set(v.id, v);
        appendVisitorToUI(v);
    });
});

// Visitor joins or leaves
socket.on('admin_visitor_list_update', (data) => {
    if (data.action === 'join') {
        // We could fetch the fresh visitor obj, but for now just update the UI badge
        const el = document.getElementById(`visitor-${data.visitor_id}`);
        if (el) {
            el.querySelector('.status-dot').classList.replace('bg-gray-400', 'bg-green-500');
        } else {
            // A brand new visitor that wasn't previously in DB
            const vObj = { id: data.visitor_id, ip_address: 'Newly Connected', country: 'Unknown', city: 'Unknown' };
            visitors.set(data.visitor_id, vObj);
            appendVisitorToUI(vObj, true);
        }
        playNotification();
    } else if (data.action === 'leave') {
        const el = document.getElementById(`visitor-${data.visitor_id}`);
        if (el) {
            el.querySelector('.status-dot').classList.replace('bg-green-500', 'bg-gray-400');
        }
    }
});

// Receives history when clicking a visitor
socket.on('admin_receive_history', (data) => {
    if (data.visitor_id === selectedVisitorId) {
        chatMessages.innerHTML = '';

        let lastMsgFromVisitor = false;

        data.messages.forEach(msg => {
            appendMessageToUI(msg);
            if (msg.sender === 'visitor') lastMsgFromVisitor = true;
            if (msg.sender === 'admin' && msg.is_read) {
                readReceipt.classList.remove('hidden');
            }
        });
        scrollToBottom();

        // If the last message was from visitor and we just opened it, mark it read
        if (lastMsgFromVisitor) {
            socket.emit('mark_read', { visitor_id: selectedVisitorId, sender: 'admin' });

            // Clear unread badge
            const activeEl = document.getElementById(`visitor-${selectedVisitorId}`);
            if (activeEl) {
                const badge = activeEl.querySelector('.unread-badge');
                badge.classList.add('hidden');
                badge.innerText = '0';
            }
        }
    }
});

// Receive new message from a visitor
socket.on('admin_receive_message', (msg) => {
    if (msg.visitor_id === selectedVisitorId) {
        appendMessageToUI(msg);
        scrollToBottom();

        // Instantly mark read
        socket.emit('mark_read', { visitor_id: selectedVisitorId, sender: 'admin' });
    } else {
        // Show unread indicator on the sidebar
        const el = document.getElementById(`visitor-${msg.visitor_id}`);
        if (el) {
            const badge = el.querySelector('.unread-badge');
            badge.classList.remove('hidden');
            let count = parseInt(badge.innerText) || 0;
            badge.innerText = count + 1;
        }
    }
    playNotification();
});

// Handle typing events
let typingTimer;
messageInput.addEventListener('input', () => {
    if (!selectedVisitorId) return;
    socket.emit('typing', { visitor_id: selectedVisitorId, is_typing: true, sender: 'admin' });

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        socket.emit('typing', { visitor_id: selectedVisitorId, is_typing: false, sender: 'admin' });
    }, 2000);
});

socket.on('admin_user_typing', (data) => {
    if (data.visitor_id === selectedVisitorId) {
        if (data.is_typing) {
            typingIndicator.classList.remove('hidden');
        } else {
            typingIndicator.classList.add('hidden');
        }
    }
});

// Handle sending a message
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !selectedVisitorId) return;

    // Emit to server
    socket.emit('admin_message', {
        visitor_id: selectedVisitorId,
        message: text,
        type: 'text'
    });

    // Optimistically append to our own UI
    appendMessageToUI({ sender: 'admin', type: 'text', message: text, created_at: new Date().toISOString() });
    scrollToBottom();
    messageInput.value = '';
    readReceipt.classList.add('hidden'); // Reset read receipt for new message
});

// Handle file uploads
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedVisitorId) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.url) {
            socket.emit('admin_message', {
                visitor_id: selectedVisitorId,
                type: 'file',
                file_url: data.url,
                message: ''
            });
            appendMessageToUI({ sender: 'admin', type: 'file', file_url: data.url, message: '', created_at: new Date().toISOString() });
            scrollToBottom();
            readReceipt.classList.add('hidden');
        }
    } catch (err) {
        console.error('Upload failed', err);
    }
    fileInput.value = ''; // reset
});

// Handle Chat Export
exportChatBtn.addEventListener('click', async () => {
    if (!selectedVisitorId) return;

    // Default to visitor's email if available, else empty prompt
    const v = visitors.get(selectedVisitorId);
    let defaultEmail = v && v.email ? v.email : '';

    const email = prompt("Enter email address to send transcript:", defaultEmail);
    if (!email) return;

    exportChatBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
    exportChatBtn.disabled = true;

    try {
        const res = await fetch('/api/export-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitor_id: selectedVisitorId, email })
        });

        const data = await res.json();
        if (data.success) {
            alert('Transcript sent successfully!');
        } else {
            alert('Failed to send: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Export failed:', err);
        alert('An error occurred while sending the transcript.');
    } finally {
        exportChatBtn.innerHTML = '<i class="fa-solid fa-download"></i> Export';
        exportChatBtn.disabled = false;
    }
});

// --- Helper Functions ---

function selectVisitor(visitor_id) {
    selectedVisitorId = visitor_id;
    const v = visitors.get(visitor_id);

    // UI Updates
    document.querySelectorAll('.visitor-sidebar-item').forEach(el => el.classList.remove('bg-indigo-50', 'border-l-4', 'border-indigo-600'));
    const activeEl = document.getElementById(`visitor-${visitor_id}`);
    activeEl.classList.add('bg-indigo-50', 'border-l-4', 'border-indigo-600');

    // Clear unread badge
    const badge = activeEl.querySelector('.unread-badge');
    badge.classList.add('hidden');
    badge.innerText = '0';

    emptyState.classList.add('hidden');
    chatHeader.style.display = 'flex';
    chatInputArea.style.display = 'block';

    document.getElementById('current-visitor-id').innerText = `Visitor: ${visitor_id.substring(0, 8)}...`;
    document.getElementById('current-visitor-location').innerText = `${v.city}, ${v.country} - ${v.ip_address}`;

    // Clear current chat messages while history loads
    chatMessages.innerHTML = '<div class="text-center text-gray-400 text-sm mt-10"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading chat history...</div>';

    // Request history
    socket.emit('admin_get_history', visitor_id);
}

function appendVisitorToUI(v, prepend = false) {
    const isOnline = false; // We would need a real way to track exact initial online status, default grey
    const bgDot = isOnline ? 'bg-green-500' : 'bg-gray-400';

    const div = document.createElement('div');
    div.id = `visitor-${v.id}`;
    div.className = 'visitor-sidebar-item cursor-pointer p-4 border-b hover:bg-gray-50 flex items-center justify-between transition-colors';
    div.onclick = () => selectVisitor(v.id);

    div.innerHTML = `
        <div class="flex items-center space-x-3 w-full">
            <div class="relative flex-shrink-0">
                <div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                    <i class="fa-solid fa-user"></i>
                </div>
                <div class="status-dot absolute bottom-0 right-0 w-3 h-3 ${bgDot} border-2 border-white rounded-full"></div>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-gray-900 truncate">V-${v.id.substring(0, 6)}</p>
                <p class="text-xs text-gray-500 truncate">${v.city !== 'Unknown' ? v.city : v.ip_address}</p>
            </div>
            <div class="unread-badge hidden bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">0</div>
        </div>
    `;

    if (prepend) {
        visitorList.prepend(div);
    } else {
        visitorList.appendChild(div);
    }
}

function appendMessageToUI(msg) {
    const div = document.createElement('div');
    div.className = 'flex w-full';

    const dateStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let contentHtml = '';
    if (msg.type === 'file' && msg.file_url) {
        const isImg = msg.file_url.match(/\.(jpeg|jpg|gif|png)$/) != null;
        if (isImg) {
            contentHtml = `<img src="${msg.file_url}" class="max-w-full rounded-md mb-1 cursor-pointer hover:opacity-90" onclick="window.open('${msg.file_url}')" />`;
        } else {
            contentHtml = `<a href="${msg.file_url}" target="_blank" class="flex items-center gap-2 underline text-sm"><i class="fa-solid fa-file"></i> View Attachment</a>`;
        }
    } else {
        contentHtml = `<p class="text-sm">${escapeHTML(msg.message)}</p>`;
    }

    if (msg.sender === 'admin') {
        div.classList.add('justify-end');
        div.innerHTML = `
            <div class="bg-indigo-600 text-white rounded-2xl rounded-tr-none px-4 py-2 max-w-xs lg:max-w-md shadow-sm">
                ${contentHtml}
                <p class="text-[10px] text-indigo-200 text-right mt-1">${dateStr}</p>
            </div>
        `;
    } else {
        div.classList.add('justify-start');
        div.innerHTML = `
            <div class="flex space-x-2">
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 mt-auto">
                    <i class="fa-solid fa-user text-xs"></i>
                </div>
                <div class="bg-white border text-gray-800 rounded-2xl rounded-tl-none px-4 py-2 max-w-xs lg:max-w-md shadow-sm">
                    ${contentHtml}
                    <p class="text-[10px] text-gray-400 text-left mt-1">${dateStr}</p>
                </div>
            </div>
        `;
    }
    chatMessages.appendChild(div);
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function playNotification() {
    try {
        notificationSound.play().catch(e => { /* Ignore blocked autoplay */ });
    } catch (e) { }
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}
