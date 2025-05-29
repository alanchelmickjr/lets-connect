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
  const [transcript, setTranscript] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [aiMessage, setAiMessage] = useState('');
  const [connections, setConnections] = useState([]);
  const [location, setLocation] = useState(null);
  const [recordingTimer, setRecordingTimer] = useState(0);
  const [qrCodeData, setQrCodeData] = useState('');
  
  const videoRef = useRef(null);
  const qrScannerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingIntervalRef = useRef(null);

  useEffect(() => {
    loadUserProfile();
    getCurrentLocation();
    
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
            setCurrentStep('meetgreet');
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

  const startMeetGreetRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      setRecordingTimer(0);
      setStreamingText('');

      // Start 30-second timer
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTimer(prev => {
          if (prev >= 30) {
            stopMeetGreetRecording();
            return 30;
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
        formData.append('audio_file', audioBlob, 'meetgreet.wav');
        
        try {
          const response = await axios.post(`${API}/transcribe`, formData);
          const fullTranscript = response.data.transcript;
          setTranscript(fullTranscript);
          
          // Generate AI message immediately
          await generateAndSendMessage(fullTranscript);
        } catch (error) {
          console.error('Transcription error:', error);
          setTranscript("Hi, nice meeting you at " + (currentEvent?.name || "the event") + "!");
          await generateAndSendMessage("Brief introduction exchanged");
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

  const stopMeetGreetRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
    }
  };

  const simulateStreamingTranscription = () => {
    const phrases = [
      "Hi, nice to meet you...",
      "I'm from XYZ company...", 
      "What brings you to this event?",
      "That sounds interesting...",
      "We should connect on LinkedIn..."
    ];
    
    let phraseIndex = 0;
    const interval = setInterval(() => {
      if (phraseIndex < phrases.length && isRecording) {
        setStreamingText(phrases[phraseIndex]);
        phraseIndex++;
      } else {
        clearInterval(interval);
      }
    }, 3000);
  };

  const generateAndSendMessage = async (conversationText) => {
    try {
      const messageData = {
        contact_name: scannedProfile.name,
        contact_title: scannedProfile.title || 'Professional',
        contact_company: scannedProfile.company || 'Company',
        event_name: currentEvent?.name || 'Event',
        event_type: 'Networking Event',
        person_category: 'New Connection',
        voice_transcript: conversationText,
        notes: `Met at ${currentEvent?.name || 'event'} - ${new Date().toLocaleDateString()}`
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
        person_category: 'New Connection',
        voice_transcript: conversationText,
        ai_message: response.data.ai_message,
        location: location,
        created_at: new Date().toISOString()
      };

      // Save to backend
      await axios.post(`${API}/connection`, connectionData);
      
      // Sync to Gun.js for real-time updates
      gun.get('connections').get(connectionData.id).put(connectionData);
      
    } catch (error) {
      console.error('Error generating message:', error);
      setAiMessage(`Hi ${scannedProfile.name}, great meeting you at ${currentEvent?.name || 'the event'}! Let's stay connected.`);
    }
  };

  const resetToHome = () => {
    setCurrentStep('home');
    setScannedProfile(null);
    setTranscript('');
    setStreamingText('');
    setAiMessage('');
    setRecordingTimer(0);
  };

  // Profile Creation Component
  const ProfileForm = () => {
    const [formData, setFormData] = useState({
      name: '', linkedin_url: '', email: '', title: '', company: ''
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
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Create Your Profile</h2>
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
            Create Profile
          </button>
        </form>
      </div>
    );
  };

  // Event Setup Component
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

  // QR Scanner Component
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

  // Meet & Greet Recording Component
  const MeetGreetRecording = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Meet & Greet Recording</h2>
      
      {scannedProfile && (
        <div className="mb-4 p-4 bg-green-50 rounded-lg">
          <h3 className="font-semibold text-green-800">Connecting with:</h3>
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
            onClick={startMeetGreetRecording}
            className="bg-red-600 text-white px-8 py-4 rounded-full hover:bg-red-700 text-lg"
          >
            🎤 Start 30s Meet & Greet
          </button>
        ) : (
          <div className="space-y-4">
            <button
              onClick={stopMeetGreetRecording}
              className="bg-gray-600 text-white px-8 py-4 rounded-full hover:bg-gray-700 text-lg animate-pulse"
            >
              ⏹️ Stop Recording ({30 - recordingTimer}s)
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

      {transcript && (
        <div className="mt-4 p-4 bg-green-50 rounded-lg">
          <h4 className="font-semibold text-green-800">Conversation:</h4>
          <p className="text-green-700 text-sm">{transcript}</p>
        </div>
      )}

      {aiMessage && (
        <div className="mt-4 p-4 bg-purple-50 rounded-lg">
          <h4 className="font-semibold text-purple-800">LinkedIn Message Ready:</h4>
          <p className="text-purple-700 text-sm">{aiMessage}</p>
          <div className="mt-3 space-y-2">
            <button
              onClick={() => navigator.clipboard.writeText(aiMessage)}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
            >
              📋 Copy Message
            </button>
            <button
              onClick={resetToHome}
              className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700"
            >
              ✅ Done - New Connection
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Home Screen
  const HomeScreen = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Let's Connect</h1>
        <p className="text-gray-600">AI-Powered Networking</p>
      </div>
      
      {userProfile ? (
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-blue-800">Welcome, {userProfile.name}!</h3>
            <p className="text-blue-600 text-sm">{userProfile.title} at {userProfile.company}</p>
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
            onClick={() => setCurrentStep('event')}
            className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700"
          >
            📍 Set Event Location
          </button>
          
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
      {currentStep === 'home' && <HomeScreen />}
      {currentStep === 'profile' && <ProfileForm />}
      {currentStep === 'event' && <EventSetup />}
      {currentStep === 'scan' && <QRScanner />}
      {currentStep === 'meetgreet' && <MeetGreetRecording />}
    </div>
  );
}

export default App;
