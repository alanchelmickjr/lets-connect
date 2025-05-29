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
  const [currentStep, setCurrentStep] = useState('home'); // home, profile, scan, event, connect
  const [userProfile, setUserProfile] = useState(null);
  const [scannedProfile, setScannedProfile] = useState(null);
  const [eventData, setEventData] = useState({ name: '', type: '', category: '' });
  const [voiceRecording, setVoiceRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiMessage, setAiMessage] = useState('');
  const [notes, setNotes] = useState('');
  const [connections, setConnections] = useState([]);
  const [eventTypes, setEventTypes] = useState([]);
  const [personCategories, setPersonCategories] = useState([]);
  const [qrCodeData, setQrCodeData] = useState('');
  
  const videoRef = useRef(null);
  const qrScannerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    loadEventTypes();
    loadPersonCategories();
    loadUserProfile();
  }, []);

  const loadEventTypes = async () => {
    try {
      const response = await axios.get(`${API}/event-types`);
      setEventTypes(response.data.event_types);
    } catch (error) {
      console.error('Error loading event types:', error);
    }
  };

  const loadPersonCategories = async () => {
    try {
      const response = await axios.get(`${API}/person-categories`);
      setPersonCategories(response.data.person_categories);
    } catch (error) {
      console.error('Error loading person categories:', error);
    }
  };

  const loadUserProfile = async () => {
    // Try to load from local storage first
    const savedProfile = localStorage.getItem('userProfile');
    if (savedProfile) {
      setUserProfile(JSON.parse(savedProfile));
    }
  };

  const createProfile = async (profileData) => {
    try {
      const response = await axios.post(`${API}/profile`, profileData);
      setUserProfile(response.data);
      localStorage.setItem('userProfile', JSON.stringify(response.data));
      
      // Generate QR code for the profile
      const qrResponse = await axios.get(`${API}/qr-code/${response.data.id}`);
      setQrCodeData(qrResponse.data.qr_code);
      
      return response.data;
    } catch (error) {
      console.error('Error creating profile:', error);
      throw error;
    }
  };

  const startQRScanning = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoRef.current.srcObject = stream;
      
      qrScannerRef.current = new QrScanner(
        videoRef.current,
        (result) => {
          try {
            const profileData = JSON.parse(result.data);
            setScannedProfile(profileData);
            stopQRScanning();
            setCurrentStep('event');
          } catch (error) {
            console.error('Invalid QR code data:', error);
          }
        },
        {
          onDecodeError: (error) => {
            console.log('QR Scan error:', error);
          },
          highlightScanRegion: true,
          highlightCodeOutline: true,
        }
      );
      
      qrScannerRef.current.start();
    } catch (error) {
      console.error('Error starting QR scanner:', error);
    }
  };

  const stopQRScanning = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop();
      qrScannerRef.current.destroy();
      qrScannerRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        setVoiceRecording(audioBlob);
        
        // Transcribe the audio
        const formData = new FormData();
        formData.append('audio_file', audioBlob, 'recording.wav');
        
        try {
          const response = await axios.post(`${API}/transcribe`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          setTranscript(response.data.transcript);
        } catch (error) {
          console.error('Error transcribing audio:', error);
        }
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting voice recording:', error);
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const generateAIMessage = async () => {
    try {
      const connectionData = {
        contact_name: scannedProfile.name,
        contact_title: scannedProfile.title,
        contact_company: scannedProfile.company,
        event_name: eventData.name,
        event_type: eventData.type,
        person_category: eventData.category,
        voice_transcript: transcript,
        notes: notes
      };

      const response = await axios.post(`${API}/generate-message`, connectionData);
      setAiMessage(response.data.ai_message);
    } catch (error) {
      console.error('Error generating AI message:', error);
    }
  };

  const saveConnection = async () => {
    try {
      const connectionData = {
        user_id: userProfile.id,
        contact_name: scannedProfile.name,
        contact_linkedin: scannedProfile.linkedin_url,
        contact_email: scannedProfile.email,
        contact_title: scannedProfile.title,
        contact_company: scannedProfile.company,
        event_name: eventData.name,
        event_type: eventData.type,
        person_category: eventData.category,
        notes: notes
      };

      const response = await axios.post(`${API}/connection`, connectionData);
      
      // Save to Gun.js for real-time sync
      gun.get('connections').get(response.data.id).put(response.data);
      
      alert('Connection saved successfully!');
      resetApp();
    } catch (error) {
      console.error('Error saving connection:', error);
    }
  };

  const resetApp = () => {
    setCurrentStep('home');
    setScannedProfile(null);
    setEventData({ name: '', type: '', category: '' });
    setVoiceRecording(null);
    setTranscript('');
    setAiMessage('');
    setNotes('');
  };

  // Profile Creation Component
  const ProfileForm = () => {
    const [formData, setFormData] = useState({
      name: '',
      linkedin_url: '',
      email: '',
      title: '',
      company: ''
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
            type="text"
            placeholder="Full Name"
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            required
          />
          <input
            type="url"
            placeholder="LinkedIn URL"
            value={formData.linkedin_url}
            onChange={(e) => setFormData({...formData, linkedin_url: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="email"
            placeholder="Email"
            value={formData.email}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            placeholder="Job Title"
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            placeholder="Company"
            value={formData.company}
            onChange={(e) => setFormData({...formData, company: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Profile
          </button>
        </form>
      </div>
    );
  };

  // QR Scanner Component
  const QRScanner = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Scan QR Code</h2>
      <div className="relative">
        <video ref={videoRef} className="w-full rounded-lg" autoPlay playsInline />
        <div className="absolute inset-0 border-2 border-blue-500 rounded-lg pointer-events-none"></div>
      </div>
      <div className="mt-4 space-y-2">
        <button
          onClick={stopQRScanning}
          className="w-full bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 transition-colors"
        >
          Cancel Scan
        </button>
      </div>
    </div>
  );

  // Event Data Component
  const EventForm = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Event Information</h2>
      {scannedProfile && (
        <div className="mb-4 p-4 bg-green-50 rounded-lg">
          <h3 className="font-semibold text-green-800">Contact Scanned:</h3>
          <p className="text-green-700">{scannedProfile.name}</p>
          <p className="text-green-600 text-sm">{scannedProfile.title} at {scannedProfile.company}</p>
        </div>
      )}
      
      <div className="space-y-4">
        <input
          type="text"
          placeholder="Event Name"
          value={eventData.name}
          onChange={(e) => setEventData({...eventData, name: e.target.value})}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        />
        
        <select
          value={eventData.type}
          onChange={(e) => setEventData({...eventData, type: e.target.value})}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select Event Type</option>
          {eventTypes.map(type => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        
        <select
          value={eventData.category}
          onChange={(e) => setEventData({...eventData, category: e.target.value})}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select Person Category</option>
          {personCategories.map(category => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
        
        <button
          onClick={() => setCurrentStep('connect')}
          disabled={!eventData.name || !eventData.type || !eventData.category}
          className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
        >
          Continue to Voice Recording
        </button>
      </div>
    </div>
  );

  // Connection Recording Component  
  const ConnectionForm = () => (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Record Your Interaction</h2>
      
      <div className="space-y-4">
        <div className="p-4 bg-blue-50 rounded-lg">
          <h3 className="font-semibold text-blue-800">Voice Recording (30-60 seconds)</h3>
          <p className="text-blue-600 text-sm">Describe your conversation and key points</p>
        </div>
        
        <div className="flex justify-center">
          {!isRecording ? (
            <button
              onClick={startVoiceRecording}
              className="bg-red-600 text-white px-8 py-4 rounded-full hover:bg-red-700 transition-colors text-lg"
            >
              🎤 Start Recording
            </button>
          ) : (
            <button
              onClick={stopVoiceRecording}
              className="bg-gray-600 text-white px-8 py-4 rounded-full hover:bg-gray-700 transition-colors text-lg animate-pulse"
            >
              ⏹️ Stop Recording
            </button>
          )}
        </div>
        
        {transcript && (
          <div className="p-4 bg-green-50 rounded-lg">
            <h4 className="font-semibold text-green-800">Transcript:</h4>
            <p className="text-green-700 text-sm">{transcript}</p>
          </div>
        )}
        
        <textarea
          placeholder="Additional notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 h-24"
        />
        
        {transcript && (
          <button
            onClick={generateAIMessage}
            className="w-full bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 transition-colors"
          >
            Generate AI Message
          </button>
        )}
        
        {aiMessage && (
          <div className="p-4 bg-purple-50 rounded-lg">
            <h4 className="font-semibold text-purple-800">AI Generated Message:</h4>
            <p className="text-purple-700 text-sm">{aiMessage}</p>
            <button
              onClick={saveConnection}
              className="mt-2 w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-colors"
            >
              Save Connection
            </button>
          </div>
        )}
      </div>
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
            <h3 className="font-semibold text-blue-800">Welcome back, {userProfile.name}!</h3>
            <p className="text-blue-600 text-sm">{userProfile.title} at {userProfile.company}</p>
          </div>
          
          {qrCodeData && (
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <h4 className="font-semibold mb-2">Your QR Code:</h4>
              <img src={qrCodeData} alt="Your QR Code" className="mx-auto max-w-32" />
            </div>
          )}
          
          <button
            onClick={() => {
              setCurrentStep('scan');
              setTimeout(startQRScanning, 100);
            }}
            className="w-full bg-blue-600 text-white py-4 rounded-lg hover:bg-blue-700 transition-colors text-lg"
          >
            📱 Scan Someone's QR Code
          </button>
          
          <div className="text-center">
            <p className="text-sm text-gray-600 mb-2">Want to connect? Allow me to scan your code and my AI will send us both a nice message with the details... is that ok with you?!</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => setCurrentStep('profile')}
            className="w-full bg-blue-600 text-white py-4 rounded-lg hover:bg-blue-700 transition-colors text-lg"
          >
            Create Your Profile
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      {currentStep === 'home' && <HomeScreen />}
      {currentStep === 'profile' && <ProfileForm />}
      {currentStep === 'scan' && <QRScanner />}
      {currentStep === 'event' && <EventForm />}
      {currentStep === 'connect' && <ConnectionForm />}
    </div>
  );
}

export default App;
