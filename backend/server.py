from fastapi import FastAPI, APIRouter, HTTPException, File, UploadFile, Form
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
import qrcode
import io
import base64
import json
import httpx
import cohere
from urllib.parse import urlencode
import requests

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Environment variables
LINKEDIN_CLIENT_ID = os.environ.get('LINKEDIN_CLIENT_ID')
LINKEDIN_CLIENT_SECRET = os.environ.get('LINKEDIN_CLIENT_SECRET')
AZURE_OPENAI_ENDPOINT = os.environ.get('AZURE_OPENAI_ENDPOINT')
AZURE_OPENAI_KEY = os.environ.get('AZURE_OPENAI_KEY')
AZURE_OPENAI_MODEL = os.environ.get('AZURE_OPENAI_MODEL')
AZURE_TRANSCRIPTION_ENDPOINT = os.environ.get('AZURE_TRANSCRIPTION_ENDPOINT')
AZURE_TRANSCRIPTION_KEY = os.environ.get('AZURE_TRANSCRIPTION_KEY')
COHERE_API_KEY = os.environ.get('COHERE_API_KEY')

# Initialize Cohere client
co = cohere.Client(COHERE_API_KEY)

# Data Models
class UserProfile(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    linkedin_url: Optional[str] = None
    email: Optional[str] = None
    title: Optional[str] = None
    company: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Connection(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    contact_name: str
    contact_linkedin: Optional[str] = None
    contact_email: Optional[str] = None
    contact_title: Optional[str] = None
    contact_company: Optional[str] = None
    event_name: str
    event_type: str
    person_category: str
    voice_transcript: Optional[str] = None
    notes: Optional[str] = None
    ai_message: Optional[str] = None
    connection_sent: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

class CreateUserProfile(BaseModel):
    name: str
    linkedin_url: Optional[str] = None
    email: Optional[str] = None
    title: Optional[str] = None
    company: Optional[str] = None

class CreateConnection(BaseModel):
    user_id: str
    contact_name: str
    contact_linkedin: Optional[str] = None
    contact_email: Optional[str] = None
    contact_title: Optional[str] = None
    contact_company: Optional[str] = None
    event_name: str
    event_type: str
    person_category: str
    notes: Optional[str] = None

class LinkedInAuth(BaseModel):
    code: str
    state: str

# Basic Routes
@api_router.get("/")
async def root():
    return {"message": "Lets Connect API - Networking Made Easy"}

# User Profile Management
@api_router.post("/profile", response_model=UserProfile)
async def create_profile(profile: CreateUserProfile):
    profile_dict = profile.dict()
    profile_obj = UserProfile(**profile_dict)
    await db.profiles.insert_one(profile_obj.dict())
    return profile_obj

@api_router.get("/profile/{user_id}", response_model=UserProfile)
async def get_profile(user_id: str):
    profile = await db.profiles.find_one({"id": user_id})
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return UserProfile(**profile)

@api_router.get("/profiles", response_model=List[UserProfile])
async def get_all_profiles():
    profiles = await db.profiles.find().to_list(1000)
    return [UserProfile(**profile) for profile in profiles]

# QR Code Generation
@api_router.get("/qr-code/{user_id}")
async def generate_qr_code(user_id: str):
    try:
        profile = await db.profiles.find_one({"id": user_id})
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        # Create QR code data
        qr_data = {
            "id": profile["id"],
            "name": profile["name"],
            "linkedin_url": profile.get("linkedin_url"),
            "email": profile.get("email"),
            "title": profile.get("title"),
            "company": profile.get("company")
        }
        
        # Generate QR code
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(json.dumps(qr_data))
        qr.make(fit=True)
        
        # Create image
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Convert to base64
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)
        img_base64 = base64.b64encode(buffer.read()).decode()
        
        return {"qr_code": f"data:image/png;base64,{img_base64}"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Voice Transcription
@api_router.post("/transcribe")
async def transcribe_audio(audio_file: UploadFile = File(...)):
    try:
        # Read audio file
        audio_data = await audio_file.read()
        
        # Prepare the request to Azure OpenAI Whisper
        headers = {
            "api-key": AZURE_TRANSCRIPTION_KEY,
        }
        
        files = {
            "file": (audio_file.filename, audio_data, audio_file.content_type)
        }
        
        data = {
            "model": os.environ.get('AZURE_TRANSCRIPTION_MODEL')
        }
        
        # Make request to Azure OpenAI
        response = requests.post(
            AZURE_TRANSCRIPTION_ENDPOINT,
            headers=headers,
            files=files,
            data=data
        )
        
        if response.status_code == 200:
            result = response.json()
            return {"transcript": result.get("text", "")}
        else:
            raise HTTPException(status_code=500, detail="Transcription failed")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# AI Message Generation
@api_router.post("/generate-message")
async def generate_ai_message(connection_data: dict):
    try:
        # Create prompt for AI message generation
        prompt = f"""
        Create a professional LinkedIn connection message based on this networking interaction:
        
        Contact: {connection_data.get('contact_name')}
        Their Role: {connection_data.get('contact_title', 'Professional')} at {connection_data.get('contact_company', 'their company')}
        Event: {connection_data.get('event_name')} ({connection_data.get('event_type')})
        Connection Type: {connection_data.get('person_category')}
        Conversation Summary: {connection_data.get('voice_transcript', 'Had a great conversation')}
        Additional Notes: {connection_data.get('notes', 'None')}
        
        Write a personalized LinkedIn connection message that:
        1. Mentions where we met specifically
        2. References something from our conversation
        3. Suggests a relevant next step based on the connection type
        4. Maintains a professional but friendly tone
        5. Is concise (under 200 characters for LinkedIn limit)
        
        Message:
        """
        
        # Use Azure OpenAI to generate message
        headers = {
            "Content-Type": "application/json",
            "api-key": AZURE_OPENAI_KEY
        }
        
        payload = {
            "messages": [
                {
                    "role": "system",
                    "content": "You are a professional networking assistant. Create personalized LinkedIn connection messages that are warm, specific, and actionable."
                },
                {
                    "role": "user", 
                    "content": prompt
                }
            ],
            "max_tokens": 150,
            "temperature": 0.7
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                AZURE_OPENAI_ENDPOINT,
                headers=headers,
                json=payload
            )
            
        if response.status_code == 200:
            result = response.json()
            message = result["choices"][0]["message"]["content"].strip()
            return {"ai_message": message}
        else:
            raise HTTPException(status_code=500, detail="AI message generation failed")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Connection Management
@api_router.post("/connection", response_model=Connection)
async def create_connection(connection: CreateConnection):
    connection_dict = connection.dict()
    connection_obj = Connection(**connection_dict)
    await db.connections.insert_one(connection_obj.dict())
    return connection_obj

@api_router.get("/connections/{user_id}", response_model=List[Connection])
async def get_user_connections(user_id: str):
    connections = await db.connections.find({"user_id": user_id}).to_list(1000)
    return [Connection(**connection) for connection in connections]

@api_router.put("/connection/{connection_id}")
async def update_connection(connection_id: str, updates: dict):
    result = await db.connections.update_one(
        {"id": connection_id},
        {"$set": updates}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"message": "Connection updated successfully"}

# LinkedIn OAuth
@api_router.get("/linkedin/auth-url")
async def get_linkedin_auth_url():
    redirect_uri = "http://localhost:3000/linkedin-callback"  # Update for production
    scope = "r_liteprofile r_emailaddress w_member_social"
    
    params = {
        "response_type": "code",
        "client_id": LINKEDIN_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": str(uuid.uuid4())
    }
    
    auth_url = f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"
    return {"auth_url": auth_url, "state": params["state"]}

@api_router.post("/linkedin/token")
async def exchange_linkedin_token(auth_data: LinkedInAuth):
    try:
        token_url = "https://www.linkedin.com/oauth/v2/accessToken"
        redirect_uri = "http://localhost:3000/linkedin-callback"
        
        data = {
            "grant_type": "authorization_code",
            "code": auth_data.code,
            "redirect_uri": redirect_uri,
            "client_id": LINKEDIN_CLIENT_ID,
            "client_secret": LINKEDIN_CLIENT_SECRET
        }
        
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        
        async with httpx.AsyncClient() as client:
            response = await client.post(token_url, data=data, headers=headers)
            
        if response.status_code == 200:
            token_data = response.json()
            return token_data
        else:
            raise HTTPException(status_code=400, detail="Failed to exchange token")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Event Categories
@api_router.get("/event-types")
async def get_event_types():
    return {
        "event_types": [
            "Conference",
            "Hackathon", 
            "Networking Event",
            "Workshop",
            "Trade Show",
            "Meetup",
            "Webinar",
            "Other"
        ]
    }

@api_router.get("/person-categories") 
async def get_person_categories():
    return {
        "person_categories": [
            "Potential Collaborator",
            "Industry Expert", 
            "Investor",
            "Peer",
            "Client Prospect",
            "Mentor",
            "Mentee",
            "Other"
        ]
    }

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
