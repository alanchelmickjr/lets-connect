
import requests
import json
import sys
import time
import uuid
import os
import base64

class LetsConnectAPITester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.user_id = None
        self.test_profile = None
        self.connection_id = None
        self.qr_code_data = None

    def run_test(self, name, method, endpoint, expected_status, data=None, files=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                if files:
                    # For multipart/form-data requests (file uploads)
                    response = requests.post(url, files=files)
                else:
                    response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return success, response.json()
                except:
                    return success, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    print(f"Response: {response.text}")
                    return False, response.json()
                except:
                    return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test the API health check endpoint"""
        success, response = self.run_test(
            "API Health Check",
            "GET",
            "api",
            200
        )
        return success

    def test_event_types(self):
        """Test the event types endpoint"""
        success, response = self.run_test(
            "Get Event Types",
            "GET",
            "api/event-types",
            200
        )
        if success:
            print(f"Event Types: {response.get('event_types', [])}")
        return success

    def test_person_categories(self):
        """Test the person categories endpoint"""
        success, response = self.run_test(
            "Get Person Categories",
            "GET",
            "api/person-categories",
            200
        )
        if success:
            print(f"Person Categories: {response.get('person_categories', [])}")
        return success

    def test_create_profile(self):
        """Test creating a user profile"""
        profile_data = {
            "name": f"Test User {uuid.uuid4().hex[:8]}",
            "linkedin_url": "https://linkedin.com/in/testuser",
            "email": "test@example.com",
            "title": "Software Engineer",
            "company": "Test Company"
        }
        
        success, response = self.run_test(
            "Create User Profile",
            "POST",
            "api/profile",
            200,
            data=profile_data
        )
        
        if success:
            self.user_id = response.get('id')
            self.test_profile = response
            print(f"Created profile with ID: {self.user_id}")
        
        return success

    def test_get_profile(self):
        """Test getting a user profile"""
        if not self.user_id:
            print("❌ Cannot test get_profile: No user ID available")
            return False
            
        success, response = self.run_test(
            "Get User Profile",
            "GET",
            f"api/profile/{self.user_id}",
            200
        )
        
        return success

    def test_qr_code_generation(self):
        """Test QR code generation"""
        if not self.user_id:
            print("❌ Cannot test QR code generation: No user ID available")
            return False
            
        success, response = self.run_test(
            "Generate QR Code",
            "GET",
            f"api/qr-code/{self.user_id}",
            200
        )
        
        if success and 'qr_code' in response:
            print("QR code generated successfully")
            # Verify it's a valid base64 image
            if response['qr_code'].startswith('data:image/png;base64,'):
                print("✅ Valid QR code format")
                self.qr_code_data = response['qr_code']
            else:
                print("❌ Invalid QR code format")
                success = False
        
        return success

    def test_transcribe_audio(self):
        """Test audio transcription"""
        # Create a simple test audio file
        test_audio_path = "/app/test_audio.txt"
        with open(test_audio_path, "w") as f:
            f.write("Test audio content")
        
        try:
            # Create a dummy audio file for testing
            with open(test_audio_path, "rb") as f:
                files = {
                    "audio_file": ("test_audio.wav", f, "audio/wav")
                }
                
                success, response = self.run_test(
                    "Transcribe Audio",
                    "POST",
                    "api/transcribe",
                    200,
                    files=files
                )
                
                if success:
                    if 'transcript' in response:
                        print(f"Transcription: {response['transcript']}")
                    else:
                        print("❌ No transcript in response")
                        success = False
                
                return success
        except Exception as e:
            print(f"❌ Failed to test transcription: {str(e)}")
            return False

    def test_ai_message_generation_with_event_context(self):
        """Test AI message generation with event context"""
        if not self.test_profile:
            print("❌ Cannot test AI message generation: No test profile available")
            return False
            
        connection_data = {
            "contact_name": self.test_profile['name'],
            "contact_title": self.test_profile['title'],
            "contact_company": self.test_profile['company'],
            "event_name": "Tech Conference 2025",
            "event_type": "Conference",
            "person_category": "Potential Collaborator",
            "voice_transcript": "We discussed potential collaboration on AI projects and exchanged ideas about the latest LLM advancements.",
            "notes": "Follow up next week about the project proposal.",
            "location": {
                "lat": 37.7749,
                "lng": -122.4194
            }
        }
        
        success, response = self.run_test(
            "Generate AI Message with Event Context",
            "POST",
            "api/generate-message",
            200,
            data=connection_data
        )
        
        if success and 'ai_message' in response:
            print(f"AI Message with Event Context: {response['ai_message']}")
        
        return success

    def test_create_connection_with_location(self):
        """Test creating a connection with location data"""
        if not self.user_id or not self.test_profile:
            print("❌ Cannot test create_connection: No user ID or test profile available")
            return False
            
        connection_data = {
            "user_id": self.user_id,
            "contact_name": "John Doe",
            "contact_linkedin": "https://linkedin.com/in/johndoe",
            "contact_email": "john@example.com",
            "contact_title": "CTO",
            "contact_company": "Tech Corp",
            "event_name": "Tech Conference 2025",
            "event_type": "Conference",
            "person_category": "Industry Expert",
            "notes": "Great conversation about AI trends."
        }
        
        success, response = self.run_test(
            "Create Connection with Location",
            "POST",
            "api/connection",
            200,
            data=connection_data
        )
        
        if success:
            self.connection_id = response.get('id')
            print(f"Created connection with ID: {self.connection_id}")
        
        return success

    def test_update_connection(self):
        """Test updating a connection with voice transcript and AI message"""
        if not self.connection_id:
            print("❌ Cannot test update_connection: No connection ID available")
            return False
            
        update_data = {
            "voice_transcript": "We discussed AI trends and potential collaboration opportunities.",
            "ai_message": "Hi John, great meeting you at Tech Conference 2025! Let's connect to discuss those AI trends further."
        }
        
        success, response = self.run_test(
            "Update Connection",
            "PUT",
            f"api/connection/{self.connection_id}",
            200,
            data=update_data
        )
        
        return success

    def test_get_connections(self):
        """Test getting user connections"""
        if not self.user_id:
            print("❌ Cannot test get_connections: No user ID available")
            return False
            
        success, response = self.run_test(
            "Get User Connections",
            "GET",
            f"api/connections/{self.user_id}",
            200
        )
        
        if success:
            print(f"Found {len(response)} connections")
        
        return success

def main():
    # Get the backend URL from the environment variable
    backend_url = "https://8129108a-9ec1-4f39-9c62-ab4d346e8331.preview.emergentagent.com"
    
    print(f"Testing API at: {backend_url}")
    
    # Setup tester
    tester = LetsConnectAPITester(backend_url)
    
    # Run tests
    tests = [
        tester.test_health_check,
        tester.test_event_types,
        tester.test_person_categories,
        tester.test_create_profile,
        tester.test_get_profile,
        tester.test_qr_code_generation,
        tester.test_transcribe_audio,
        tester.test_ai_message_generation_with_event_context,
        tester.test_create_connection_with_location,
        tester.test_update_connection,
        tester.test_get_connections
    ]
    
    for test in tests:
        test()
        time.sleep(1)  # Small delay between tests
    
    # Print results
    print(f"\n📊 Tests passed: {tester.tests_passed}/{tester.tests_run}")
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    sys.exit(main())
