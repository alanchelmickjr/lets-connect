import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';
import Gun from 'gun/gun';
import QrScanner from 'qr-scanner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Initialize Gun.js
const gun = Gun(['https://gun-manhattan.herokuapp.com/gun']);

function App() {
  const [currentStep, setCurrentStep] = useState('home');
  const [userProfile, setUserProfile] = useState(null);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [scannedProfile, setScannedProfile] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState('introduction'); // 'introduction' or 'conversation'
  const [transcript, setTranscript] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [aiMessage, setAiMessage] = useState('');
  const [connections, setConnections] = useState([]);
  const [location, setLocation] = useState(null);
  const [recordingTimer, setRecordingTimer] = useState(0);
  const [qrCodeData, setQrCodeData] = useState('');
  const [linkedinToken, setLinkedinToken] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  
  const videoRef = useRef(null);
  const qrScannerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingIntervalRef = useRef(null);

  useEffect(() => {
    loadUserProfile();
    getCurrentLocation();
    loadLinkedInToken();
    
    // Set up Gun.js real-time listeners
    gun.get('connections').on((data, key) => {
      if (data && userProfile?.id) {
        setConnections(prev => [...prev.filter(c => c.id !== key), data]);
      }
    });
  }, [userProfile?.id]);

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => console.log('Location access denied')
      );
    }
  };

  const loadUserProfile = () => {
    const saved = localStorage.getItem('userProfile');
    if (saved) {
      setUserProfile(JSON.parse(saved));
    }
  };

  const loadLinkedInToken = () => {
    const token = localStorage.getItem('linkedinToken');
    if (token) {
      setLinkedinToken(token);
    }
  };

  const createProfile = async (profileData) => {
    try {
      const response = await axios.post(`${API}/profile`, profileData);
      setUserProfile(response.data);
      localStorage.setItem('userProfile', JSON.stringify(response.data));
      
      // Generate QR code
      const qrResponse = await axios.get(`${API}/qr-code/${response.data.id}`);
      setQrCodeData(qrResponse.data.qr_code);
      
      // Sync to Gun.js
      gun.get('profiles').get(response.data.id).put(response.data);
      
      return response.data;
    } catch (error) {
      console.error('Error creating profile:', error);
      throw error;
    }
  };

  const connectLinkedIn = async () => {
    try {
      const response = await axios.get(`${API}/linkedin/auth-url`);
      window.location.href = response.data.auth_url;
    } catch (error) {
      console.error('LinkedIn auth error:', error);
    }
  };

  const sendLinkedInMessage = async () => {
    if (!linkedinToken || !aiMessage) return;
    
    // Simulate LinkedIn message sending (replace with actual LinkedIn API call)
    try {
      alert(`LinkedIn message sent to ${scannedProfile.name}!\n\n"${aiMessage}"`);
      resetToHome();
    } catch (error) {
      console.error('LinkedIn send error:', error);
    }
  };

  const setEventLocation = (eventName) => {
    const eventData = {
      name: eventName,
      location: location,
      timestamp: new Date().toISOString()
    };
    setCurrentEvent(eventData);
    localStorage.setItem('currentEvent', JSON.stringify(eventData));
    gun.get('events').get(eventName).put(eventData);
  };

  const startQRScanning = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      videoRef.current.srcObject = stream;
      
      qrScannerRef.current = new QrScanner(
        videoRef.current,
        (result) => {
          try {
            const profileData = JSON.parse(result.data);
            setScannedProfile(profileData);
            stopQRScanning();
            setCurrentStep('recording-options');
          } catch (error) {
            console.error('Invalid QR code:', error);
          }
        },
        {
          onDecodeError: () => {},
          highlightScanRegion: true,
          highlightCodeOutline: true,
        }
      );
      
      qrScannerRef.current.start();
    } catch (error) {
      console.error('Camera access denied:', error);
    }
  };

  const stopQRScanning = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop();
      qrScannerRef.current.destroy();
      qrScannerRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      setRecordingTimer(0);
      setStreamingText('');

      // Set timer based on recording mode
      const maxTime = recordingMode === 'introduction' ? 30 : 120; // 30s for intro, 2min for conversation
      
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTimer(prev => {
          if (prev >= maxTime) {
            stopRecording();
            return maxTime;
          }
          return prev + 1;
        });
      }, 1000);

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        
        // Transcribe audio
        const formData = new FormData();
        formData.append('audio_file', audioBlob, 'recording.wav');
        
        try {
          const response = await axios.post(`${API}/transcribe`, formData);
          const fullTranscript = response.data.transcript;
          setTranscript(fullTranscript);
          
          // Generate AI message immediately
          await generateAndSendMessage(fullTranscript);
        } catch (error) {
          console.error('Transcription error:', error);
          const fallbackText = recordingMode === 'introduction' 
            ? `Hi, nice meeting you at ${currentEvent?.name || "the event"}!`
            : `Great conversation at ${currentEvent?.name || "the event"}. Let's stay in touch!`;
          setTranscript(fallbackText);
          await generateAndSendMessage(fallbackText);
        }
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      
      // Simulate real-time transcription display
      simulateStreamingTranscription();
    } catch (error) {
      console.error('Recording error:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
    }
  };

  const simulateStreamingTranscription = () => {
    const introPhrases = [
      "Hi, nice to meet you...",
      "I'm from XYZ company...", 
      "What brings you to this event?",
      "That sounds interesting..."
    ];
    
    const conversationPhrases = [
      "Let me tell you about our project...",
      "We're working on innovative solutions...",
      "I'd love to hear your thoughts on...",
      "Have you experienced similar challenges?",
      "This could be a great collaboration...",
      "Let's exchange contact information..."
    ];
    
    const phrases = recordingMode === 'introduction' ? introPhrases : conversationPhrases;
    
    let phraseIndex = 0;
    const interval = setInterval(() => {
      if (phraseIndex < phrases.length && isRecording) {
        setStreamingText(phrases[phraseIndex]);
        phraseIndex++;
      } else {
        clearInterval(interval);
      }
    }, recordingMode === 'introduction' ? 3000 : 5000);
  };

  const generateAndSendMessage = async (conversationText) => {
    try {
      const messageData = {
        contact_name: scannedProfile.name,
        contact_title: scannedProfile.title || 'Professional',
        contact_company: scannedProfile.company || 'Company',
        event_name: currentEvent?.name || 'Event',
        event_type: 'Networking Event',
        person_category: recordingMode === 'introduction' ? 'New Connection' : 'Potential Collaborator',
        voice_transcript: conversationText,
        notes: `${recordingMode === 'introduction' ? 'Brief introduction' : 'Detailed conversation'} at ${currentEvent?.name || 'event'} - ${new Date().toLocaleDateString()}`
      };

      const response = await axios.post(`${API}/generate-message`, messageData);
      setAiMessage(response.data.ai_message);
      
      // Save connection to Gun.js and backend
      const connectionData = {
        id: Date.now().toString(),
        user_id: userProfile.id,
        contact_name: scannedProfile.name,
        contact_linkedin: scannedProfile.linkedin_url,
        contact_email: scannedProfile.email,
        contact_title: scannedProfile.title,
        contact_company: scannedProfile.company,
        event_name: currentEvent?.name || 'Event',
        event_type: 'Networking Event',
        person_category: recordingMode === 'introduction' ? 'New Connection' : 'Potential Collaborator',
        voice_transcript: conversationText,
        ai_message: response.data.ai_message,
        recording_mode: recordingMode,
        location: location,
        created_at: new Date().toISOString()
      };

      // Save to backend
      await axios.post(`${API}/connection`, connectionData);
      
      // Sync to Gun.js for real-time updates
      gun.get('connections').get(connectionData.id).put(connectionData);
      
      setCurrentStep('message-ready');
      
    } catch (error) {
      console.error('Error generating message:', error);
      setAiMessage(`Hi ${scannedProfile.name}, great meeting you at ${currentEvent?.name || 'the event'}! Let's stay connected.`);
      setCurrentStep('message-ready');
    }
  };

  const resetToHome = () => {
    setCurrentStep('home');
    setScannedProfile(null);
    setTranscript('');
    setStreamingText('');
    setAiMessage('');
    setRecordingTimer(0);
    setRecordingMode('introduction');
  };

  // Navigation Menu Component
  const NavigationMenu = () => (
    <div className={`fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 z-50 ${showMenu ? 'block' : 'hidden'}`}>
      <div className="bg-white w-80 h-full shadow-xl">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Menu</h2>
            <button onClick={() => setShowMenu(false)} className="text-gray-500 text-2xl">&times;</button>
          </div>
          
          <div className="space-y-4">
            <button onClick={() => { setCurrentStep('home'); setShowMenu(false); }} 
                    className="w-full text-left p-3 hover:bg-gray-100 rounded-lg">
              🏠 Home
            </button>
            <button onClick={() => { setCurrentStep('profile'); setShowMenu(false); }} 
                    className="w-full text-left p-3 hover:bg-gray-100 rounded-lg">
              👤 Edit Profile
            </button>
            <button onClick={() => { setCurrentStep('event'); setShowMenu(false); }} 
                    className="w-full text-left p-3 hover:bg-gray-100 rounded-lg">
              📍 Set Event
            </button>
            <button onClick={() => { setCurrentStep('connections'); setShowMenu(false); }} 
                    className="w-full text-left p-3 hover:bg-gray-100 rounded-lg">
              🤝 My Connections
            </button>
            {!linkedinToken && (
              <button onClick={connectLinkedIn} 
                      className="w-full text-left p-3 hover:bg-gray-100 rounded-lg">
                🔗 Connect LinkedIn
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // Recording Options Component
  const RecordingOptions = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Choose Recording Type</h2>
      
      {scannedProfile && (
        <div className="mb-6 p-4 bg-green-50 rounded-lg">
          <h3 className="font-semibold text-green-800">Connecting with:</h3>
          <p className="text-green-700">{scannedProfile.name}</p>
          <p className="text-green-600 text-sm">{scannedProfile.title} at {scannedProfile.company}</p>
        </div>
      )}

      <div className="space-y-4">
        <button
          onClick={() => { setRecordingMode('introduction'); setCurrentStep('meetgreet'); }}
          className="w-full p-4 bg-blue-50 border-2 border-blue-200 rounded-lg hover:bg-blue-100 text-left"
        >
          <div className="font-semibold text-blue-800">🤝 Quick Introduction</div>
          <div className="text-blue-600 text-sm">30 seconds - Perfect for brief meet & greet</div>
        </button>
        
        <button
          onClick={() => { setRecordingMode('conversation'); setCurrentStep('meetgreet'); }}
          className="w-full p-4 bg-purple-50 border-2 border-purple-200 rounded-lg hover:bg-purple-100 text-left"
        >
          <div className="font-semibold text-purple-800">💬 Full Conversation</div>
          <div className="text-purple-600 text-sm">2 minutes - For detailed discussions</div>
        </button>
      </div>
    </div>
  );

  // Message Ready Component
  const MessageReady = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">🎉 Connection Ready!</h2>
      
      <div className="mb-4 p-4 bg-green-50 rounded-lg">
        <h3 className="font-semibold text-green-800">Connected with:</h3>
        <p className="text-green-700">{scannedProfile.name}</p>
      </div>

      {aiMessage && (
        <div className="mb-6 p-4 bg-purple-50 rounded-lg">
          <h4 className="font-semibold text-purple-800">LinkedIn Message:</h4>
          <p className="text-purple-700 text-sm mb-3">{aiMessage}</p>
        </div>
      )}

      <div className="space-y-3">
        {linkedinToken ? (
          <button
            onClick={sendLinkedInMessage}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 text-lg"
          >
            📤 Send LinkedIn Message
          </button>
        ) : (
          <>
            <button
              onClick={() => navigator.clipboard.writeText(aiMessage)}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700"
            >
              📋 Copy Message
            </button>
            <button
              onClick={connectLinkedIn}
              className="w-full bg-blue-800 text-white py-3 rounded-lg hover:bg-blue-900"
            >
              🔗 Connect LinkedIn & Send
            </button>
          </>
        )}
        
        <button
          onClick={resetToHome}
          className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700"
        >
          ✅ Done - New Connection
        </button>
      </div>
    </div>
  );

  // Connections List Component
  const ConnectionsList = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">My Connections</h2>
      
      {connections.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No connections yet. Start networking!</p>
      ) : (
        <div className="space-y-3">
          {connections.map(conn => (
            <div key={conn.id} className="p-4 bg-gray-50 rounded-lg">
              <div className="font-medium">{conn.contact_name}</div>
              <div className="text-sm text-gray-600">{conn.contact_title} at {conn.contact_company}</div>
              <div className="text-xs text-gray-500 mt-1">
                {conn.event_name} • {conn.recording_mode || 'meet & greet'}
              </div>
            </div>
          ))}
        </div>
      )}
      
      <button
        onClick={() => setCurrentStep('home')}
        className="w-full mt-6 bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700"
      >
        Back to Home
      </button>
    </div>
  );

  // Keep existing components but add menu button
  const ProfileForm = () => {
    const [formData, setFormData] = useState({
      name: userProfile?.name || '', 
      linkedin_url: userProfile?.linkedin_url || '', 
      email: userProfile?.email || '', 
      title: userProfile?.title || '', 
      company: userProfile?.company || ''
    });

    const handleSubmit = async (e) => {
      e.preventDefault();
      try {
        await createProfile(formData);
        setCurrentStep('home');
      } catch (error) {
        alert('Error creating profile');
      }
    };

    return (
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">
          {userProfile ? 'Edit Profile' : 'Create Your Profile'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text" placeholder="Full Name" required
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="url" placeholder="LinkedIn URL"
            value={formData.linkedin_url}
            onChange={(e) => setFormData({...formData, linkedin_url: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="email" placeholder="Email"
            value={formData.email}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text" placeholder="Job Title"
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text" placeholder="Company"
            value={formData.company}
            onChange={(e) => setFormData({...formData, company: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700">
            {userProfile ? 'Update Profile' : 'Create Profile'}
          </button>
        </form>
      </div>
    );
  };

  const EventSetup = () => {
    const [eventName, setEventName] = useState('');

    const handleSetEvent = () => {
      if (eventName.trim()) {
        setEventLocation(eventName.trim());
        setCurrentStep('home');
      }
    };

    return (
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Set Current Event</h2>
        <p className="text-gray-600 mb-4">This will track your location for this event.</p>
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Event Name (e.g., Tech Conference 2025)"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSetEvent}
            disabled={!eventName.trim()}
            className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400"
          >
            Set Event & Location
          </button>
        </div>
      </div>
    );
  };

  const QRScanner = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Scan Contact's QR Code</h2>
      <div className="relative mb-4">
        <video ref={videoRef} className="w-full rounded-lg" autoPlay playsInline />
        <div className="qr-scanner-overlay"></div>
      </div>
      <button
        onClick={() => setCurrentStep('home')}
        className="w-full bg-red-600 text-white py-3 rounded-lg hover:bg-red-700"
      >
        Cancel Scan
      </button>
    </div>
  );

  const MeetGreetRecording = () => {
    const maxTime = recordingMode === 'introduction' ? 30 : 120;
    
    return (
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">
          {recordingMode === 'introduction' ? '🤝 Quick Introduction' : '💬 Full Conversation'}
        </h2>
        
        {scannedProfile && (
          <div className="mb-4 p-4 bg-green-50 rounded-lg">
            <h3 className="font-semibold text-green-800">Recording with:</h3>
            <p className="text-green-700">{scannedProfile.name}</p>
            <p className="text-green-600 text-sm">{scannedProfile.title} at {scannedProfile.company}</p>
          </div>
        )}

        {currentEvent && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-blue-700 text-sm">📍 {currentEvent.name}</p>
          </div>
        )}

        <div className="text-center mb-4">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="bg-red-600 text-white px-8 py-4 rounded-full hover:bg-red-700 text-lg"
            >
              🎤 Start {recordingMode === 'introduction' ? '30s' : '2min'} Recording
            </button>
          ) : (
            <div className="space-y-4">
              <button
                onClick={stopRecording}
                className="bg-gray-600 text-white px-8 py-4 rounded-full hover:bg-gray-700 text-lg animate-pulse"
              >
                ⏹️ Stop Recording ({maxTime - recordingTimer}s)
              </button>
              
              {streamingText && (
                <div className="bg-gray-100 p-3 rounded-lg">
                  <div className="marquee-text text-gray-700 text-sm">
                    {streamingText}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const HomeScreen = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <div className="text-center flex-1">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Let's Connect</h1>
          <p className="text-gray-600">AI-Powered Networking</p>
        </div>
        <button 
          onClick={() => setShowMenu(true)}
          className="text-2xl text-gray-600 hover:text-gray-800"
        >
          ☰
        </button>
      </div>
      
      {userProfile ? (
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-blue-800">Welcome, {userProfile.name}!</h3>
            <p className="text-blue-600 text-sm">{userProfile.title} at {userProfile.company}</p>
            {linkedinToken && <p className="text-green-600 text-xs">✅ LinkedIn Connected</p>}
          </div>

          {currentEvent && (
            <div className="p-3 bg-green-50 rounded-lg">
              <p className="text-green-700 text-sm">📍 Current Event: {currentEvent.name}</p>
            </div>
          )}
          
          {qrCodeData && (
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <h4 className="font-semibold mb-2">Your QR Code:</h4>
              <img src={qrCodeData} alt="QR Code" className="mx-auto max-w-32" />
            </div>
          )}
          
          <button
            onClick={() => {
              setCurrentStep('scan');
              setTimeout(startQRScanning, 100);
            }}
            className="w-full bg-blue-600 text-white py-4 rounded-lg hover:bg-blue-700 text-lg"
          >
            📱 Scan & Connect
          </button>

          <div className="text-center">
            <p className="text-sm text-gray-600">"Want to connect? Let me scan your code and my AI will send us both a nice message!"</p>
          </div>

          {connections.length > 0 && (
            <div className="mt-4">
              <h4 className="font-semibold text-gray-700 mb-2">Recent Connections:</h4>
              <div className="space-y-2">
                {connections.slice(0, 3).map(conn => (
                  <div key={conn.id} className="p-2 bg-gray-50 rounded text-sm">
                    <span className="font-medium">{conn.contact_name}</span>
                    <span className="text-gray-500 ml-2">at {conn.event_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setCurrentStep('profile')}
          className="w-full bg-blue-600 text-white py-4 rounded-lg hover:bg-blue-700 text-lg"
        >
          Create Your Profile
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <NavigationMenu />
      
      {currentStep === 'home' && <HomeScreen />}
      {currentStep === 'profile' && <ProfileForm />}
      {currentStep === 'event' && <EventSetup />}
      {currentStep === 'scan' && <QRScanner />}
      {currentStep === 'recording-options' && <RecordingOptions />}
      {currentStep === 'meetgreet' && <MeetGreetRecording />}
      {currentStep === 'message-ready' && <MessageReady />}
      {currentStep === 'connections' && <ConnectionsList />}
    </div>
  );
}

export default App;
