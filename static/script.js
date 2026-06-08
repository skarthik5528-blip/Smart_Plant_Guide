document.addEventListener("DOMContentLoaded", () => {
    const chatWindow = document.getElementById("chatWindow");
    const chatInput = document.getElementById("chatInput");
    const sendBtn = document.getElementById("sendBtn");

    const uploadZone = document.getElementById("uploadZone");
    const imageInput = document.getElementById("imageInput");
    const imagePreview = document.getElementById("imagePreview");
    const analyzeBtn = document.getElementById("analyzeBtn");

    let chatHistory = [];
    const languageSelect = document.getElementById("languageSelect");

    // Language map for Web Speech API
    const languageMap = {
        "English": "en-US",
        "Kannada": "kn-IN",
        "Hindi": "hi-IN",
        "Tamil": "ta-IN",
        "Telugu": "te-IN"
    };

    const playBackendTTS = (text, lang, btnElement) => {
        // Stop any currently playing audio
        if (window.currentAudio) {
            window.currentAudio.pause();
            document.querySelectorAll('.tts-btn').forEach(btn => btn.classList.remove('playing'));
        }

        btnElement.classList.add('playing');
        const url = `/speak?text=${encodeURIComponent(text.replace(/[*#`_~]/g, ''))}&lang=${encodeURIComponent(lang)}`;
        const audio = new Audio(url);
        window.currentAudio = audio;

        audio.play().catch(err => {
            console.error("Audio play error:", err);
            btnElement.classList.remove('playing');
        });

        audio.onended = () => {
            btnElement.classList.remove('playing');
        };
        audio.onerror = () => {
            btnElement.classList.remove('playing');
        };
    };

    // Configure Marked.js for markdown parsing
    marked.setOptions({
        breaks: true,
        gfm: true
    });

    // --- Chat Logic ---
    const addMessage = (content, sender = 'user') => {
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${sender}-message`;

        const avatar = document.createElement("div");
        avatar.className = "avatar";
        avatar.innerHTML = sender === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-leaf"></i>';

        const bubble = document.createElement("div");
        bubble.className = "bubble";

        if (sender === 'ai') {
            bubble.innerHTML = marked.parse(content);

            // Add TTS Button
            const controlsDiv = document.createElement("div");
            controlsDiv.className = "message-controls";

            const ttsBtn = document.createElement("button");
            ttsBtn.className = "tts-btn";
            ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> Read Aloud';
            ttsBtn.title = "Read aloud";

            ttsBtn.addEventListener("click", () => {
                if (ttsBtn.classList.contains('playing')) {
                    if (window.currentAudio) window.currentAudio.pause();
                    ttsBtn.classList.remove('playing');
                } else {
                    playBackendTTS(content, languageSelect.value, ttsBtn);
                }
            });

            controlsDiv.appendChild(ttsBtn);
            bubble.appendChild(controlsDiv);
        } else {
            bubble.textContent = content;
        }

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(bubble);
        chatWindow.appendChild(msgDiv);
        scrollToBottom();
    };

    const showTyping = () => {
        const typingDiv = document.createElement("div");
        typingDiv.className = "message ai-message typing-msg";
        typingDiv.id = "typingIndicator";

        typingDiv.innerHTML = `
            <div class="avatar"><i class="fa-solid fa-leaf"></i></div>
            <div class="typing-indicator">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
        `;
        chatWindow.appendChild(typingDiv);
        scrollToBottom();
    };

    const removeTyping = () => {
        const typing = document.getElementById("typingIndicator");
        if (typing) typing.remove();
    };

    const scrollToBottom = () => {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

    const handleSend = async () => {
        const text = chatInput.value.trim();
        if (!text) return;

        addMessage(text, 'user');
        chatHistory.push({ role: "user", content: text });
        chatInput.value = "";
        showTyping();

        try {
            const res = await fetch("/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    language: languageSelect.value,
                    history: chatHistory
                })
            });
            const data = await res.json();
            removeTyping();
            addMessage(data.reply, 'ai');
            chatHistory.push({ role: "assistant", content: data.reply });
        } catch (error) {
            removeTyping();
            addMessage("Sorry, I'm having trouble connecting right now.", 'ai');
        }
    };

    sendBtn.addEventListener("click", handleSend);
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // --- Backend-based STT (Whisper) ---
    const micBtn = document.getElementById("micBtn");
    let mediaRecorder;
    let audioChunks = [];

    if (micBtn) {
        micBtn.addEventListener("click", async () => {
            if (micBtn.classList.contains("recording")) {
                mediaRecorder.stop();
            } else {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    audioChunks = [];

                    mediaRecorder.ondataavailable = (event) => {
                        audioChunks.push(event.data);
                    };

                    mediaRecorder.onstop = async () => {
                        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                        const formData = new FormData();
                        formData.append("audio", audioBlob);

                        micBtn.classList.remove("recording");
                        const oldPlaceholder = chatInput.placeholder;
                        chatInput.placeholder = "Transcribing...";

                        try {
                            const res = await fetch("/transcribe", {
                                method: "POST",
                                body: formData
                            });
                            const data = await res.json();
                            if (data.transcript) {
                                chatInput.value = data.transcript;
                                handleSend();
                            }
                        } catch (err) {
                            console.error("Transcription error:", err);
                        }
                        chatInput.placeholder = oldPlaceholder;

                        // Stop all tracks to release the microphone
                        stream.getTracks().forEach(track => track.stop());
                    };

                    mediaRecorder.start();
                    micBtn.classList.add("recording");
                    chatInput.placeholder = "Listening... Click again to stop.";
                } catch (err) {
                    console.error("Microphone access error:", err);
                    alert("Please allow microphone access to use voice search.");
                }
            }
        });
    }

    // --- Image Upload Logic ---
    uploadZone.addEventListener("click", () => imageInput.click());

    uploadZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = "var(--primary)";
    });

    uploadZone.addEventListener("dragleave", () => {
        uploadZone.style.borderColor = "var(--card-border)";
    });

    uploadZone.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = "var(--card-border)";
        if (e.dataTransfer.files.length) {
            imageInput.files = e.dataTransfer.files;
            handleImagePreview();
        }
    });

    imageInput.addEventListener("change", handleImagePreview);

    function handleImagePreview() {
        const file = imageInput.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.innerHTML = `<img src="${e.target.result}" alt="Uploaded plant">`;
                imagePreview.style.display = "block";
                analyzeBtn.disabled = false;
            };
            reader.readAsDataURL(file);
        }
    }

    analyzeBtn.addEventListener("click", async () => {
        if (!imageInput.files.length) return;

        addMessage("Uploaded an image for analysis...", 'user');
        chatHistory.push({ role: "user", content: "Uploaded an image for analysis..." });
        showTyping();

        // Simulate file upload (Since API uses form-data usually)
        const formData = new FormData();
        formData.append("image", imageInput.files[0]);
        formData.append("language", languageSelect.value);

        try {
            const res = await fetch("/upload", {
                method: "POST",
                body: formData // No content-type, browser sets multipart/form-data
            });
            const data = await res.json();
            removeTyping();
            addMessage(data.reply, 'ai');
            chatHistory.push({ role: "assistant", content: data.reply });
        } catch (error) {
            removeTyping();
            addMessage("Image analysis failed.", 'ai');
        }
    });

});
