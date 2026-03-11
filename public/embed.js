(function () {
    const SOCKET_SERVER = window.VGP_CHAT_URL || 'http://localhost:3000';

    // 1. CSS is now already loaded by Laravel master.blade.php, so we skip injecting it here to avoid duplication or bad paths.

    // 2. Load Socket.io script dynamically from the backend server
    const script = document.createElement('script');
    script.src = `${SOCKET_SERVER}/socket.io/socket.io.js`;
    script.onload = initChat;
    document.body.appendChild(script);

    function initChat() {
        // --- 3. Persistent User ID ---
        let visitorId = localStorage.getItem('vgp_chat_id');
        if (!visitorId) {
            visitorId = 'v_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
            localStorage.setItem('vgp_chat_id', visitorId);
        }

        // --- 4. Build UI ---
        const container = document.createElement('div');
        container.id = 'vgp-chat-widget';
        container.innerHTML = `
            <div id="vgp-greeting-popup">Hello there! Can we help you?</div>
            
            <div id="vgp-chat-window">
                <div class="vgp-header">
                    <div>
                        <h3>Live Support</h3>
                        <p id="vgp-header-subtitle">We typically reply in a few minutes</p>
                    </div>
                    <button class="vgp-close-btn" id="vgp-close-chat">&times;</button>
                </div>
                
                <div id="vgp-prechat-form" class="vgp-prechat">
                    <p>Please introduce yourself before chatting:</p>
                    <input type="text" id="vgp-name-input" placeholder="Your Name" required>
                    <input type="email" id="vgp-email-input" placeholder="Your Email" required>
                    <button id="vgp-start-btn">Start Chat</button>
                </div>

                <div class="vgp-messages hidden" id="vgp-messages-container"></div>
                
                <div id="vgp-typing-indicator" class="hidden">Admin is typing...</div>

                <form class="vgp-input-area hidden" id="vgp-chat-form">
                    <input type="file" id="vgp-file-input" style="display:none;" accept="image/*, application/pdf">
                    <button type="button" id="vgp-attach-btn" style="background:transparent;color:#6b7280;border:none;cursor:pointer;"><i class="fa-solid fa-paperclip"></i></button>
                    <input type="text" id="vgp-chat-input" placeholder="Type a message..." autocomplete="off">
                    <button type="submit"><i class="fa-solid fa-paper-plane"></i></button>
                </form>
            </div>

            <div id="vgp-chat-btn">
                <i class="fa-solid fa-comment-dots"></i>
                <div id="vgp-badge">0</div>
            </div>
            <audio id="vgp-notification-sound" src="http://localhost:3000/widget/pop.mp3" preload="auto"></audio>
        `;
        document.body.appendChild(container);

        // --- 5. DOM Elements ---
        const chatBtn = document.getElementById('vgp-chat-btn');
        const chatWindow = document.getElementById('vgp-chat-window');
        const closeBtn = document.getElementById('vgp-close-chat');
        const greetingPopup = document.getElementById('vgp-greeting-popup');
        const badge = document.getElementById('vgp-badge');
        const chatForm = document.getElementById('vgp-chat-form');
        const chatInput = document.getElementById('vgp-chat-input');
        const messagesContainer = document.getElementById('vgp-messages-container');
        const prechatForm = document.getElementById('vgp-prechat-form');
        const startChatBtn = document.getElementById('vgp-start-btn');
        const nameInput = document.getElementById('vgp-name-input');
        const emailInput = document.getElementById('vgp-email-input');
        const fileInput = document.getElementById('vgp-file-input');
        const attachBtn = document.getElementById('vgp-attach-btn');
        const vgpTypingIndicator = document.getElementById('vgp-typing-indicator');
        const notificationSound = document.getElementById('vgp-notification-sound');

        let isOpen = false;
        let unreadCount = 0;
        let hasInteracted = false;
        let isChatActive = localStorage.getItem('vgp_chat_active') === 'true';

        // --- 6. Socket Connection ---
        // Load environment variables or default to localhost
        const SOCKET_URL = window.VGP_CHAT_URL || 'http://localhost:3000';
        const socket = io(SOCKET_URL);

        function joinSocket() {
            socket.emit('visitor_join', {
                visitor_id: visitorId,
                name: localStorage.getItem('vgp_visitor_name') || 'Visitor',
                email: localStorage.getItem('vgp_visitor_email') || '',
                url: window.location.href,
                title: document.title
            });
        }

        socket.on('connect', () => {
            if (isChatActive) {
                joinSocket();
                prechatForm.style.display = 'none';
                messagesContainer.classList.remove('hidden');
                chatForm.classList.remove('hidden');
                chatForm.style.display = 'flex';
            }
        });

        // Handle pre-chat form submission
        startChatBtn.addEventListener('click', () => {
            const name = nameInput.value.trim();
            const email = emailInput.value.trim();
            if (!name || !email) return alert('Please enter your name and email to start chatting.');

            localStorage.setItem('vgp_visitor_name', name);
            localStorage.setItem('vgp_visitor_email', email);
            localStorage.setItem('vgp_chat_active', 'true');
            isChatActive = true;

            prechatForm.style.display = 'none';
            messagesContainer.classList.remove('hidden');
            chatForm.classList.remove('hidden');
            chatForm.style.display = 'flex';
            joinSocket();
        });

        // Load History
        socket.on('visitor_history', (messages) => {
            messagesContainer.innerHTML = '';
            messages.forEach(msg => {
                appendMessage(msg, msg.sender === 'visitor');
            });
            scrollToBottom();

            // Mark read since we opened the window
            if (isOpen) socket.emit('mark_read', { visitor_id: visitorId, sender: 'visitor' });
        });

        // Receive Message from Admin
        socket.on('visitor_receive_message', (data) => {
            if (data.visitor_id === visitorId) {
                appendMessage(data, false);
                scrollToBottom();

                if (!isOpen) {
                    unreadCount++;
                    badge.innerText = unreadCount;
                    badge.style.display = 'flex';
                    // Show a quick popup preview
                    greetingPopup.innerText = data.type === 'file' ? 'Admin sent an attachment' : (data.message.length > 20 ? data.message.substring(0, 20) + '...' : data.message);
                    greetingPopup.classList.add('vgp-show');
                    setTimeout(() => { greetingPopup.classList.remove('vgp-show'); }, 4000);
                    try { notificationSound.play().catch(e => { }); } catch (e) { }
                } else {
                    // Instantly mark read if window is open
                    socket.emit('mark_read', { visitor_id: visitorId, sender: 'visitor' });
                }
            }
        });

        // Handle typing events
        let typingTimer;
        chatInput.addEventListener('input', () => {
            if (!isChatActive) return;
            socket.emit('typing', { visitor_id: visitorId, is_typing: true, sender: 'visitor' });
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                socket.emit('typing', { visitor_id: visitorId, is_typing: false, sender: 'visitor' });
            }, 2000);
        });

        socket.on('visitor_admin_typing', (data) => {
            if (data.visitor_id === visitorId) {
                if (data.is_typing) {
                    vgpTypingIndicator.classList.remove('hidden');
                } else {
                    vgpTypingIndicator.classList.add('hidden');
                }
            }
        });

        // Handle file uploads
        attachBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file || !isChatActive) return;

            const formData = new FormData();
            formData.append('file', file);

            try {
                const res = await fetch(`${SOCKET_SERVER}/api/upload`, { method: 'POST', body: formData });
                const data = await res.json();

                if (data.url) {
                    const msgData = { type: 'file', file_url: data.url, message: '' };
                    socket.emit('visitor_message', { visitor_id: visitorId, ...msgData });
                    appendMessage(msgData, true);
                    scrollToBottom();
                }
            } catch (err) {
                console.error('Upload failed', err);
            }
            fileInput.value = ''; // reset
        });

        // --- 7. Event Listeners ---
        chatBtn.addEventListener('click', () => {
            isOpen = !isOpen;
            if (isOpen) {
                chatWindow.classList.add('vgp-open');
                greetingPopup.classList.remove('vgp-show');
                chatBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
                badge.style.display = 'none';
                unreadCount = 0;
                hasInteracted = true;

                if (isChatActive) {
                    socket.emit('mark_read', { visitor_id: visitorId, sender: 'visitor' });
                    setTimeout(() => chatInput.focus(), 300);
                }
            } else {
                chatWindow.classList.remove('vgp-open');
                chatBtn.innerHTML = '<i class="fa-solid fa-comment-dots"></i>';
            }
        });

        closeBtn.addEventListener('click', () => {
            isOpen = false;
            chatWindow.classList.remove('vgp-open');
            chatBtn.innerHTML = '<i class="fa-solid fa-comment-dots"></i>';
        });

        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            hasInteracted = true;
            const text = chatInput.value.trim();
            if (!text) return;

            // Send to server
            const msgData = { type: 'text', message: text };
            socket.emit('visitor_message', { visitor_id: visitorId, ...msgData });

            // Append locally
            appendMessage(msgData, true);
            scrollToBottom();
            chatInput.value = '';
        });

        // --- 8. Automated Greeting ---
        setTimeout(() => {
            if (!hasInteracted && !isOpen) {
                greetingPopup.classList.add('vgp-show');

                // Hide after 6 seconds
                setTimeout(() => {
                    greetingPopup.classList.remove('vgp-show');
                }, 6000);
            }
        }, 3000); // 3 seconds delay

        // --- 9. Helpers ---
        function appendMessage(msg, isSelf) {
            const div = document.createElement('div');
            div.className = `vgp-msg ${isSelf ? 'vgp-msg-visitor' : 'vgp-msg-admin'}`;

            if (msg.type === 'file' && msg.file_url) {
                const isImg = msg.file_url.match(/\.(jpeg|jpg|gif|png)$/) != null;
                if (isImg) {
                    div.innerHTML = `<img src="${msg.file_url}" style="max-width:100%;border-radius:8px;cursor:pointer;" onclick="window.open('${msg.file_url}')" />`;
                } else {
                    div.innerHTML = `<a href="${msg.file_url}" target="_blank" style="color:inherit;text-decoration:underline;">View Attachment</a>`;
                }
            } else {
                div.innerText = msg.message;
            }
            messagesContainer.appendChild(div);
        }

        function scrollToBottom() {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
})();
