// Azure Avatar - Real-time Voice Conversation
// Supports: Text input, Push-to-talk, Continuous listening
// Integrates: Azure Speech SDK + Azure OpenAI

// ============================================
// Global State
// ============================================
let speechConfig = null;
let avatarConfig = null;
let avatarSynthesizer = null;
let peerConnection = null;
let speechRecognizer = null;
let isListening = false;
let isContinuousMode = false;
let isPushToTalkActive = false;
let conversationHistory = [];
let isAvatarSpeaking = false;

// ============================================
// DOM Elements
// ============================================
const elements = {
    // Config inputs
    speechKey: document.getElementById('speechKey'),
    speechRegion: document.getElementById('speechRegion'),
    openaiEndpoint: document.getElementById('openaiEndpoint'),
    openaiKey: document.getElementById('openaiKey'),
    openaiDeployment: document.getElementById('openaiDeployment'),
    avatarCharacter: document.getElementById('avatarCharacter'),
    avatarStyle: document.getElementById('avatarStyle'),
    voiceName: document.getElementById('voiceName'),
    systemPrompt: document.getElementById('systemPrompt'),
    
    // Video/Audio
    videoPlayer: document.getElementById('videoPlayer'),
    audioPlayer: document.getElementById('audioPlayer'),
    placeholder: document.getElementById('placeholder'),
    
    // Controls
    startButton: document.getElementById('startButton'),
    stopButton: document.getElementById('stopButton'),
    pushToTalkBtn: document.getElementById('pushToTalkBtn'),
    continuousBtn: document.getElementById('continuousBtn'),
    sendTextBtn: document.getElementById('sendTextBtn'),
    textInput: document.getElementById('textInput'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    
    // Status
    avatarStatus: document.getElementById('avatarStatus'),
    avatarStatusText: document.getElementById('avatarStatusText'),
    micStatus: document.getElementById('micStatus'),
    micStatusText: document.getElementById('micStatusText'),
    conversationIndicator: document.getElementById('conversationIndicator'),
    indicatorText: document.getElementById('indicatorText'),
    listeningWaves: document.getElementById('listeningWaves'),
    voiceHint: document.getElementById('voiceHint'),
    
    // History
    conversationLog: document.getElementById('conversationLog'),
    configSection: document.getElementById('configSection')
};

// ============================================
// Event Listeners
// ============================================
elements.startButton.addEventListener('click', startAvatar);
elements.stopButton.addEventListener('click', stopAvatar);
elements.pushToTalkBtn.addEventListener('mousedown', startPushToTalk);
elements.pushToTalkBtn.addEventListener('mouseup', stopPushToTalk);
elements.pushToTalkBtn.addEventListener('mouseleave', stopPushToTalk);
elements.pushToTalkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startPushToTalk(); });
elements.pushToTalkBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopPushToTalk(); });
elements.continuousBtn.addEventListener('click', toggleContinuousMode);
elements.sendTextBtn.addEventListener('click', sendTextMessage);
elements.clearHistoryBtn.addEventListener('click', clearHistory);
elements.textInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTextMessage();
    }
});

// Spacebar shortcut for push-to-talk
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && 
        document.activeElement.tagName !== 'INPUT' && 
        document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (!elements.pushToTalkBtn.disabled) startPushToTalk();
    }
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && 
        document.activeElement.tagName !== 'INPUT' && 
        document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        stopPushToTalk();
    }
});

// ============================================
// Status Updates
// ============================================
function setAvatarStatus(status, message) {
    elements.avatarStatus.className = 'status-indicator ' + status;
    elements.avatarStatusText.textContent = 'Avatar: ' + message;
}

function setMicStatus(status, message) {
    elements.micStatus.className = 'status-indicator ' + status;
    elements.micStatusText.textContent = 'Mic: ' + message;
}

function setConversationIndicator(state, text) {
    elements.indicatorText.textContent = text;
    elements.conversationIndicator.className = 'conversation-indicator ' + state;
    
    if (state === 'listening') {
        elements.listeningWaves.classList.add('active');
    } else {
        elements.listeningWaves.classList.remove('active');
    }
}

// ============================================
// Conversation Log
// ============================================
function addToConversationLog(role, message) {
    const log = elements.conversationLog;
    
    // Remove empty state if present
    const emptyState = log.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${role}`;
    
    const icon = role === 'user' ? '👤' : '🤖';
    const label = role === 'user' ? 'You' : 'Avatar';
    
    entry.innerHTML = `
        <span class="log-icon">${icon}</span>
        <div class="log-content">
            <span class="log-label">${label}</span>
            <p class="log-message">${escapeHtml(message)}</p>
        </div>
    `;
    
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function clearHistory() {
    conversationHistory = [];
    elements.conversationLog.innerHTML = '<p class="empty-state">Conversation will appear here...</p>';
}

// ============================================
// ICE Server Credentials
// ============================================
async function fetchIceServerCredentials() {
    const response = await fetch(
        `https://${elements.speechRegion.value}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`,
        {
            method: 'GET',
            headers: {
                'Ocp-Apim-Subscription-Key': elements.speechKey.value
            }
        }
    );
    
    if (!response.ok) {
        throw new Error(`Failed to fetch ICE credentials: ${response.status}`);
    }
    
    return await response.json();
}

// ============================================
// Avatar Management
// ============================================
async function startAvatar() {
    // Validate inputs
    if (!elements.speechKey.value.trim()) {
        alert('Please enter your Azure Speech key');
        elements.configSection.open = true;
        return;
    }
    if (!elements.openaiEndpoint.value.trim() || !elements.openaiKey.value.trim()) {
        alert('Please enter your Azure OpenAI endpoint and key');
        elements.configSection.open = true;
        return;
    }

    try {
        setAvatarStatus('connecting', 'Connecting...');
        elements.startButton.disabled = true;
        elements.configSection.open = false;

        // Create Speech config
        speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
            elements.speechKey.value,
            elements.speechRegion.value
        );
        speechConfig.speechSynthesisVoiceName = elements.voiceName.value;
        speechConfig.speechRecognitionLanguage = 'en-US';

        // Create Avatar config
        avatarConfig = new SpeechSDK.AvatarConfig(
            elements.avatarCharacter.value,
            elements.avatarStyle.value
        );

        // Fetch ICE credentials
        console.log('Fetching ICE credentials...');
        const iceCredentials = await fetchIceServerCredentials();

        // Create WebRTC peer connection
        peerConnection = new RTCPeerConnection({
            iceServers: [{
                urls: iceCredentials.Urls,
                username: iceCredentials.Username,
                credential: iceCredentials.Password
            }]
        });

        // Handle incoming tracks
        peerConnection.ontrack = function(event) {
            console.log('Track received:', event.track.kind);
            
            if (event.track.kind === 'video') {
                elements.videoPlayer.srcObject = event.streams[0];
                elements.videoPlayer.classList.add('active');
                elements.placeholder.style.display = 'none';
            }
            if (event.track.kind === 'audio') {
                elements.audioPlayer.srcObject = event.streams[0];
            }
        };

        // Handle connection state
        peerConnection.onconnectionstatechange = function() {
            console.log('Connection state:', peerConnection.connectionState);
            
            switch (peerConnection.connectionState) {
                case 'connected':
                    setAvatarStatus('connected', 'Connected');
                    enableVoiceControls(true);
                    setConversationIndicator('ready', 'Ready to chat');
                    elements.voiceHint.textContent = 'Hold the button or press spacebar to talk';
                    break;
                case 'disconnected':
                case 'failed':
                    setAvatarStatus('error', 'Disconnected');
                    cleanup();
                    break;
                case 'closed':
                    setAvatarStatus('', 'Disconnected');
                    cleanup();
                    break;
            }
        };

        // Add transceivers
        peerConnection.addTransceiver('video', { direction: 'sendrecv' });
        peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

        // Create avatar synthesizer
        avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);
        
        avatarSynthesizer.avatarEventReceived = function(s, e) {
            console.log('Avatar event:', e.description);
        };

        // Start avatar
        console.log('Starting avatar...');
        await avatarSynthesizer.startAvatarAsync(peerConnection);
        
        elements.stopButton.disabled = false;

    } catch (error) {
        console.error('Error starting avatar:', error);
        setAvatarStatus('error', 'Error');
        alert('Failed to start avatar: ' + error.message);
        cleanup();
    }
}

function stopAvatar() {
    console.log('Stopping avatar...');
    
    if (isContinuousMode) {
        toggleContinuousMode();
    }
    
    if (speechRecognizer) {
        speechRecognizer.stopContinuousRecognitionAsync();
        speechRecognizer.close();
        speechRecognizer = null;
    }
    
    if (avatarSynthesizer) {
        avatarSynthesizer.close();
    }
    
    cleanup();
}

function cleanup() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    avatarSynthesizer = null;
    speechConfig = null;
    avatarConfig = null;
    speechRecognizer = null;
    isListening = false;
    isContinuousMode = false;

    elements.videoPlayer.srcObject = null;
    elements.videoPlayer.classList.remove('active');
    elements.audioPlayer.srcObject = null;
    elements.placeholder.style.display = 'flex';

    elements.startButton.disabled = false;
    elements.stopButton.disabled = true;
    enableVoiceControls(false);
    
    setAvatarStatus('', 'Disconnected');
    setMicStatus('', 'Off');
    setConversationIndicator('', 'Ready');
    elements.voiceHint.textContent = 'Start the avatar first, then use voice controls';
}

function enableVoiceControls(enabled) {
    elements.pushToTalkBtn.disabled = !enabled;
    elements.continuousBtn.disabled = !enabled;
    elements.sendTextBtn.disabled = !enabled;
}

// ============================================
// Speech Recognition
// ============================================
let pendingRecognitionText = '';

function createSpeechRecognizer() {
    const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    return new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
}

// Push-to-talk: Click once to start, click again (or auto) to stop
function startPushToTalk() {
    if (isContinuousMode || !avatarSynthesizer) return;
    if (isAvatarSpeaking) {
        console.log('Avatar is speaking, please wait');
        return;
    }
    
    // If already listening, stop and process
    if (isPushToTalkActive) {
        finishPushToTalk();
        return;
    }
    
    isPushToTalkActive = true;
    pendingRecognitionText = '';
    elements.pushToTalkBtn.classList.add('active');
    elements.pushToTalkBtn.querySelector('.btn-label').textContent = 'Release to Send';
    setMicStatus('connected', 'Listening...');
    setConversationIndicator('listening', 'Listening... (release when done)');
    
    speechRecognizer = createSpeechRecognizer();
    
    // Track partial results for display
    speechRecognizer.recognizing = (s, e) => {
        if (e.result.text) {
            console.log('Recognizing:', e.result.text);
            pendingRecognitionText = e.result.text;
            setConversationIndicator('listening', e.result.text);
        }
    };
    
    // Track final results
    speechRecognizer.recognized = (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text) {
            console.log('Recognized segment:', e.result.text);
            pendingRecognitionText = e.result.text;
        } else if (e.result.reason === SpeechSDK.ResultReason.NoMatch) {
            console.log('No speech recognized');
        }
    };
    
    speechRecognizer.canceled = (s, e) => {
        console.log('Recognition canceled:', e.reason, e.errorDetails);
        if (e.reason === SpeechSDK.CancellationReason.Error) {
            alert('Speech recognition error: ' + e.errorDetails);
            resetPushToTalk();
        }
    };
    
    speechRecognizer.startContinuousRecognitionAsync(
        () => console.log('Recognition started - speak now!'),
        (err) => {
            console.error('Recognition start error:', err);
            alert('Could not start microphone. Please check permissions.');
            resetPushToTalk();
        }
    );
}

function stopPushToTalk() {
    if (!isPushToTalkActive) return;
    finishPushToTalk();
}

function finishPushToTalk() {
    if (!isPushToTalkActive || !speechRecognizer) return;
    
    setConversationIndicator('thinking', 'Processing...');
    
    // Stop recognition and wait a moment for final results
    speechRecognizer.stopContinuousRecognitionAsync(
        () => {
            console.log('Recognition stopped, text captured:', pendingRecognitionText);
            
            // Small delay to ensure final recognition is captured
            setTimeout(() => {
                const finalText = pendingRecognitionText.trim();
                
                speechRecognizer.close();
                speechRecognizer = null;
                resetPushToTalk();
                
                if (finalText) {
                    console.log('Sending to AI:', finalText);
                    handleUserInput(finalText);
                } else {
                    console.log('No speech detected');
                    setConversationIndicator('ready', 'No speech detected. Try again.');
                    setTimeout(() => setConversationIndicator('ready', 'Ready'), 2000);
                }
            }, 300);
        },
        (err) => {
            console.error('Stop error:', err);
            resetPushToTalk();
        }
    );
}

function resetPushToTalk() {
    isPushToTalkActive = false;
    pendingRecognitionText = '';
    elements.pushToTalkBtn.classList.remove('active');
    elements.pushToTalkBtn.querySelector('.btn-label').textContent = 'Hold to Talk';
    setMicStatus('', 'Off');
    if (!isAvatarSpeaking) {
        setConversationIndicator('ready', 'Ready');
    }
}

function toggleContinuousMode() {
    if (isAvatarSpeaking) {
        alert('Please wait for the avatar to finish speaking');
        return;
    }
    
    isContinuousMode = !isContinuousMode;
    
    if (isContinuousMode) {
        elements.continuousBtn.classList.add('active');
        elements.pushToTalkBtn.disabled = true;
        startContinuousListening();
    } else {
        elements.continuousBtn.classList.remove('active');
        elements.pushToTalkBtn.disabled = false;
        stopContinuousListening();
    }
}

function startContinuousListening() {
    if (!avatarSynthesizer || isAvatarSpeaking) return;
    
    setMicStatus('connected', 'Listening...');
    setConversationIndicator('listening', 'Listening...');
    
    speechRecognizer = createSpeechRecognizer();
    
    speechRecognizer.recognizing = (s, e) => {
        if (!isAvatarSpeaking) {
            setConversationIndicator('listening', e.result.text || 'Listening...');
        }
    };
    
    speechRecognizer.recognized = (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text) {
            console.log('Recognized:', e.result.text);
            handleUserInput(e.result.text);
        }
    };
    
    speechRecognizer.canceled = (s, e) => {
        console.log('Recognition canceled:', e.reason);
        if (isContinuousMode && !isAvatarSpeaking) {
            // Restart recognition
            setTimeout(() => {
                if (isContinuousMode) startContinuousListening();
            }, 1000);
        }
    };
    
    speechRecognizer.startContinuousRecognitionAsync(
        () => console.log('Continuous recognition started'),
        (err) => console.error('Recognition error:', err)
    );
}

function stopContinuousListening() {
    if (speechRecognizer) {
        speechRecognizer.stopContinuousRecognitionAsync(
            () => {
                speechRecognizer.close();
                speechRecognizer = null;
                setMicStatus('', 'Off');
                setConversationIndicator('ready', 'Ready');
            },
            (err) => console.error('Stop error:', err)
        );
    }
}

// ============================================
// Text Input
// ============================================
function sendTextMessage() {
    const text = elements.textInput.value.trim();
    if (!text || !avatarSynthesizer) return;
    
    elements.textInput.value = '';
    handleUserInput(text);
}

// ============================================
// Azure OpenAI Integration
// ============================================
async function handleUserInput(userMessage) {
    // Add to conversation log
    addToConversationLog('user', userMessage);
    
    // Pause continuous listening while processing
    if (isContinuousMode && speechRecognizer) {
        speechRecognizer.stopContinuousRecognitionAsync();
    }
    
    setConversationIndicator('thinking', 'Thinking...');
    
    try {
        // Get AI response
        const aiResponse = await getAIResponse(userMessage);
        
        // Add AI response to log
        addToConversationLog('assistant', aiResponse);
        
        // Make avatar speak
        await speakWithAvatar(aiResponse);
        
    } catch (error) {
        console.error('Error handling input:', error);
        setConversationIndicator('error', 'Error occurred');
        alert('Error: ' + error.message);
    }
    
    // Resume continuous listening
    if (isContinuousMode) {
        setTimeout(() => startContinuousListening(), 500);
    } else {
        setConversationIndicator('ready', 'Ready');
    }
}

async function getAIResponse(userMessage) {
    const endpoint = elements.openaiEndpoint.value.trim();
    const apiKey = elements.openaiKey.value.trim();
    const deployment = elements.openaiDeployment.value.trim();
    
    // Build messages array with conversation history
    const systemMessage = {
        role: 'system',
        content: elements.systemPrompt.value || 'You are a helpful assistant. Keep responses concise.'
    };
    
    // Add user message to history
    conversationHistory.push({ role: 'user', content: userMessage });
    
    // Keep history manageable (last 10 exchanges)
    if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-20);
    }
    
    const messages = [systemMessage, ...conversationHistory];
    
    const response = await fetch(
        `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-15-preview`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey
            },
            body: JSON.stringify({
                messages: messages,
                max_tokens: 150,
                temperature: 0.7
            })
        }
    );
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    const assistantMessage = data.choices[0].message.content;
    
    // Add assistant response to history
    conversationHistory.push({ role: 'assistant', content: assistantMessage });
    
    return assistantMessage;
}

// ============================================
// Avatar Speech
// ============================================
async function speakWithAvatar(text) {
    if (!avatarSynthesizer) return;
    
    isAvatarSpeaking = true;
    setConversationIndicator('speaking', 'Speaking...');
    
    try {
        const result = await avatarSynthesizer.speakTextAsync(text);
        
        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log('Avatar speech completed');
        } else if (result.reason === SpeechSDK.ResultReason.Canceled) {
            const cancellation = SpeechSDK.CancellationDetails.fromResult(result);
            console.error('Speech canceled:', cancellation.errorDetails);
        }
    } catch (error) {
        console.error('Avatar speech error:', error);
    } finally {
        isAvatarSpeaking = false;
    }
}

// ============================================
// Page Cleanup
// ============================================
window.addEventListener('beforeunload', () => {
    if (avatarSynthesizer) avatarSynthesizer.close();
    if (peerConnection) peerConnection.close();
    if (speechRecognizer) speechRecognizer.close();
});
